use async_trait::async_trait;
use parking_lot::Mutex;
use std::time::{Duration, Instant};

use crate::catalog::StreamResolver;
use crate::error::{AppError, AppResult};
use crate::models::{Quality, ResolvedStream};

/// Kebijakan backoff & circuit breaker untuk resolver. Lihat docs/RESILIENCE.md.
///
/// Kenapa lapisan terpisah, bukan di dalam resolver? Karena setiap implementasi
/// resolver (yt-dlp, crate, API lain) pasti punya mode gagal yang berbeda, tapi
/// kebijakan "jangan membanjiri YouTube" harus sama untuk semuanya.
pub struct ResilientResolver {
    inner: Box<dyn StreamResolver>,
    policy: Policy,
    state: Mutex<BreakerState>,
}

#[derive(Debug, Clone)]
pub struct Policy {
    /// Jeda dasar untuk backoff eksponensial.
    pub base_delay: Duration,
    /// Batas atas jeda.
    pub max_delay: Duration,
    /// Berapa kegagalan transient berturut-turut sebelum breaker membuka.
    pub failure_threshold: u32,
    /// Lama breaker terbuka sebelum mencoba satu request percobaan.
    pub cooldown: Duration,
    /// Retry maksimum per lagu sebelum menyerah dan skip.
    pub max_retries: u32,
    /// Jarak minimum antar resolve (anti-throttle saat user spam next).
    pub min_interval: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            base_delay: Duration::from_millis(800),
            max_delay: Duration::from_secs(30),
            failure_threshold: 5,
            cooldown: Duration::from_secs(60),
            max_retries: 2,
            min_interval: Duration::from_millis(1500),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreakerStatus {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug)]
struct BreakerState {
    status: BreakerStatus,
    consecutive_failures: u32,
    opened_at: Option<Instant>,
    last_request_at: Option<Instant>,
}

impl BreakerState {
    fn new() -> Self {
        Self {
            status: BreakerStatus::Closed,
            consecutive_failures: 0,
            opened_at: None,
            last_request_at: None,
        }
    }
}

impl ResilientResolver {
    pub fn new(inner: Box<dyn StreamResolver>) -> Self {
        Self::with_policy(inner, Policy::default())
    }

    /// Pembungkus ini melaporkan status resolver di dalamnya — kalau dalamnya
    /// mock, UI harus tahu bahwa pemutaran nyata belum tersedia.
    pub fn is_live(&self) -> bool {
        self.inner.is_live()
    }

    pub fn with_policy(inner: Box<dyn StreamResolver>, policy: Policy) -> Self {
        Self {
            inner,
            policy,
            state: Mutex::new(BreakerState::new()),
        }
    }

    pub fn status(&self) -> BreakerStatus {
        self.state.lock().status
    }

    /// Delay untuk percobaan ke-`attempt` (1-based), dengan jitter.
    /// Jitter wajib: tanpa itu, semua client menabrak serentak setelah outage.
    fn backoff(&self, attempt: u32) -> Duration {
        let exp = 2u32.saturating_pow(attempt.saturating_sub(1));
        let raw = self.policy.base_delay.saturating_mul(exp);
        let capped = raw.min(self.policy.max_delay);
        // Jitter ±30% deterministik dari waktu — cukup untuk memecah kerumunan.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let factor = 0.7 + (nanos % 601) as f64 / 1000.0; // 0.70 ..= 1.30
        Duration::from_millis((capped.as_millis() as f64 * factor) as u64)
    }

    /// Menahan request supaya jaraknya minimal `min_interval`. Ini yang mencegah
    /// user yang menekan "next" 30 kali mengirim 30 request.
    async fn throttle(&self) {
        let wait = {
            let mut st = self.state.lock();
            let now = Instant::now();
            let wait = match st.last_request_at {
                Some(prev) if now.duration_since(prev) < self.policy.min_interval => {
                    Some(self.policy.min_interval - now.duration_since(prev))
                }
                _ => None,
            };
            st.last_request_at = Some(now + wait.unwrap_or_default());
            wait
        };
        if let Some(d) = wait {
            tokio::time::sleep(d).await;
        }
    }

    fn on_success(&self) {
        let mut st = self.state.lock();
        st.consecutive_failures = 0;
        st.status = BreakerStatus::Closed;
        st.opened_at = None;
    }

    fn on_failure(&self, permanent: bool) -> BreakerStatus {
        let mut st = self.state.lock();
        // Error permanen (video dihapus) bukan tanda YouTube sedang bermasalah,
        // jadi TIDAK boleh membuka breaker — kalau iya, satu video rusak bisa
        // mematikan pemutaran semua lagu.
        if !permanent {
            st.consecutive_failures += 1;
            if st.consecutive_failures >= self.policy.failure_threshold
                || st.status == BreakerStatus::HalfOpen
            {
                st.status = BreakerStatus::Open;
                st.opened_at = Some(Instant::now());
            }
        }
        st.status
    }

    /// Cek breaker: kalau Open dan cooldown belum lewat, gagal cepat tanpa
    /// menyentuh jaringan. Kalau cooldown lewat, izinkan 1 percobaan (HalfOpen).
    fn gate(&self) -> Result<(), AppError> {
        let mut st = self.state.lock();
        match st.status {
            BreakerStatus::Closed => Ok(()),
            BreakerStatus::HalfOpen => Ok(()),
            BreakerStatus::Open => {
                let elapsed = st.opened_at.map(|t| t.elapsed()).unwrap_or(Duration::ZERO);
                if elapsed >= self.policy.cooldown {
                    st.status = BreakerStatus::HalfOpen;
                    Ok(())
                } else {
                    let sisa = self.policy.cooldown.saturating_sub(elapsed);
                    Err(AppError::stream(
                        format!(
                            "pemutaran dijeda sementara karena banyak kegagalan. Coba lagi dalam {} detik.",
                            sisa.as_secs().max(1)
                        ),
                        false,
                    ))
                }
            }
        }
    }
}

#[async_trait]
impl StreamResolver for ResilientResolver {
    async fn resolve(&self, video_id: &str, quality: Quality) -> AppResult<ResolvedStream> {
        self.gate()?;

        let mut attempt: u32 = 0;
        loop {
            attempt += 1;
            self.throttle().await;

            match self.inner.resolve(video_id, quality).await {
                Ok(stream) => {
                    self.on_success();
                    return Ok(stream);
                }
                Err(e) => {
                    let permanent = matches!(
                        e,
                        AppError::Stream {
                            permanent: true,
                            ..
                        }
                    );
                    let invalid = matches!(e, AppError::Invalid(_));

                    // Error permanen/validasi tidak layak diulang.
                    if permanent || invalid {
                        self.on_failure(permanent);
                        return Err(e);
                    }

                    let status = self.on_failure(false);
                    if attempt > self.policy.max_retries || status == BreakerStatus::Open {
                        return Err(e);
                    }

                    tracing::warn!(
                        video_id,
                        attempt,
                        error = %e,
                        breaker = ?status,
                        "resolve gagal, mencoba lagi"
                    );
                    tokio::time::sleep(self.backoff(attempt)).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Resolver palsu: gagal N kali lalu sukses. Dipakai untuk menguji retry,
    /// backoff, dan breaker tanpa menyentuh jaringan — sesuai RESILIENCE.md §7.
    #[derive(Clone)]
    struct ScriptedResolver {
        fail_times: std::sync::Arc<AtomicU32>,
        calls: std::sync::Arc<AtomicU32>,
        permanent: bool,
    }

    impl ScriptedResolver {
        fn new(fail_times: u32, permanent: bool) -> Self {
            Self {
                fail_times: std::sync::Arc::new(AtomicU32::new(fail_times)),
                calls: std::sync::Arc::new(AtomicU32::new(0)),
                permanent,
            }
        }
    }

    #[async_trait]
    impl StreamResolver for ScriptedResolver {
        async fn resolve(&self, _id: &str, _q: Quality) -> AppResult<ResolvedStream> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail_times.load(Ordering::SeqCst) > 0 {
                self.fail_times.fetch_sub(1, Ordering::SeqCst);
                return Err(AppError::stream("palsu gagal", self.permanent));
            }
            Ok(ResolvedStream {
                url: "https://contoh/stream".into(),
                mime: "audio/webm".into(),
                bitrate_kbps: Some(128),
                expires_at_ms: 0,
            })
        }
    }

    fn fast_policy() -> Policy {
        Policy {
            base_delay: Duration::from_millis(1),
            max_delay: Duration::from_millis(5),
            failure_threshold: 3,
            cooldown: Duration::from_millis(50),
            max_retries: 2,
            min_interval: Duration::ZERO,
        }
    }

    #[tokio::test]
    async fn sukses_langsung_tanpa_retry() {
        let inner = Box::new(ScriptedResolver::new(0, false));
        let r = ResilientResolver::with_policy(inner, fast_policy());
        let out = r.resolve("x", Quality::High).await.unwrap();
        assert_eq!(out.url, "https://contoh/stream");
        assert_eq!(r.status(), BreakerStatus::Closed);
    }

    #[tokio::test]
    async fn retry_lalu_sukses() {
        let inner = Box::new(ScriptedResolver::new(2, false));
        let r = ResilientResolver::with_policy(inner, fast_policy());
        let out = r.resolve("x", Quality::High).await.unwrap();
        assert_eq!(out.bitrate_kbps, Some(128));
        assert_eq!(r.status(), BreakerStatus::Closed);
    }

    #[tokio::test]
    async fn menyerah_setelah_max_retry() {
        let inner = Box::new(ScriptedResolver::new(99, false));
        let r = ResilientResolver::with_policy(inner.clone(), fast_policy());
        let err = r.resolve("x", Quality::High).await.unwrap_err();
        assert!(matches!(err, AppError::Stream { .. }));
        // 1 percobaan awal + 2 retry
        assert_eq!(inner.calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn error_permanen_tidak_diulang() {
        let inner = Box::new(ScriptedResolver::new(99, true));
        let r = ResilientResolver::with_policy(inner.clone(), fast_policy());
        let err = r.resolve("x", Quality::High).await.unwrap_err();
        assert!(matches!(
            err,
            AppError::Stream {
                permanent: true,
                ..
            }
        ));
        assert_eq!(
            inner.calls.load(Ordering::SeqCst),
            1,
            "error permanen tidak boleh di-retry"
        );
        assert_eq!(
            r.status(),
            BreakerStatus::Closed,
            "satu video rusak tidak boleh membuka breaker"
        );
    }

    #[tokio::test]
    async fn breaker_membuka_setelah_ambang() {
        let inner = Box::new(ScriptedResolver::new(999, false));
        let r = ResilientResolver::with_policy(inner.clone(), fast_policy());

        // Tiga kegagalan transient → breaker Open.
        let _ = r.resolve("x", Quality::High).await;
        assert_eq!(r.status(), BreakerStatus::Open);

        // Request berikutnya gagal cepat tanpa memanggil resolver lagi.
        let before = inner.calls.load(Ordering::SeqCst);
        let err = r.resolve("y", Quality::High).await.unwrap_err();
        assert_eq!(
            inner.calls.load(Ordering::SeqCst),
            before,
            "breaker Open harus gagal cepat tanpa menyentuh resolver"
        );
        let msg = format!("{err}");
        assert!(
            msg.contains("dijeda sementara") || msg.contains("gagal"),
            "{msg}"
        );
    }

    #[tokio::test]
    async fn breaker_setengah_terbuka_setelah_cooldown() {
        let inner = Box::new(ScriptedResolver::new(999, false));
        let r = ResilientResolver::with_policy(inner.clone(), fast_policy());
        let _ = r.resolve("x", Quality::High).await;
        assert_eq!(r.status(), BreakerStatus::Open);

        tokio::time::sleep(Duration::from_millis(70)).await;
        // Percobaan berikutnya diizinkan lewat (status jadi HalfOpen → gagal → Open lagi).
        let _ = r.resolve("y", Quality::High).await;
        assert!(
            inner.calls.load(Ordering::SeqCst) > 3,
            "cooldown harus mengizinkan percobaan"
        );
    }
}
