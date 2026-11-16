use std::sync::Arc;

use parking_lot::RwLock;

use crate::catalog::mock::MockCatalog;
use crate::catalog::youtube_music::YouTubeMusicCatalog;
use crate::catalog::{MusicCatalog, StreamResolver};
use crate::db::Db;
use crate::resolver::{ResilientResolver, YtDlpResolver};

/// State global aplikasi yang dibagikan ke setiap command.
pub struct AppState {
    pub db: Arc<Db>,
    /// Katalog bisa ditukar saat runtime: aplikasi start instan dengan mock,
    /// lalu di-upgrade ke YouTube Music di background. Dengan begitu user tidak
    /// pernah menunggu jaringan saat membuka aplikasi.
    catalog: RwLock<Arc<dyn MusicCatalog>>,
    resolver: RwLock<Arc<dyn StreamResolver>>,
    /// Direktori data aplikasi: database, cache cover, log.
    pub data_dir: std::path::PathBuf,
}

impl AppState {
    pub fn new(data_dir: std::path::PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let db = Arc::new(Db::open(data_dir.join("kaset.db"))?);

        // Mulai dari mock; `upgrade_catalog` menukarnya dengan katalog nyata.
        let mock = Arc::new(MockCatalog::default());

        // Resolver: mulai dari mock supaya aplikasi langsung bisa dibuka, lalu
        // `upgrade_resolver` menukarnya dengan yt-dlp asli di background.
        // Yang asli SELALU dibungkus ResilientResolver supaya backoff + circuit
        // breaker berlaku apa pun implementasinya (RESILIENCE.md).
        let resolver: Arc<dyn StreamResolver> = mock.clone();

        Ok(Self {
            db,
            catalog: RwLock::new(mock),
            resolver: RwLock::new(resolver),
            data_dir,
        })
    }

    /// Resolver yang sedang aktif.
    pub fn resolver(&self) -> Arc<dyn StreamResolver> {
        self.resolver.read().clone()
    }

    /// Ambil katalog saat ini. Clone `Arc`-nya supaya lock tidak ditahan selama
    /// menunggu jaringan — penting, karena pencarian bisa makan 1-2 detik.
    pub fn catalog(&self) -> Arc<dyn MusicCatalog> {
        self.catalog.read().clone()
    }

    /// True kalau katalog nyata sudah aktif (bukan mock).
    pub fn catalog_is_live(&self) -> bool {
        self.catalog.read().is_live()
    }

    /// Mencoba memakai katalog nyata. Aman dipanggil di background: kalau
    /// jaringan gagal, mock tetap dipakai dan aplikasi tetap jalan.
    ///
    /// Ini bukan error fatal — PRD menjanjikan library tetap bisa dibuka offline.
    pub async fn upgrade_catalog(&self) -> bool {
        match YouTubeMusicCatalog::new().await {
            Ok(yt) => {
                *self.catalog.write() = Arc::new(yt);
                tracing::info!("katalog YouTube Music aktif");
                true
            }
            Err(e) => {
                tracing::warn!(error = %e, "katalog nyata gagal dibuat; tetap memakai mock");
                false
            }
        }
    }

    /// Mengupayakan yt-dlp tersedia, lalu TUKAR resolver mock dengan yang asli.
    ///
    /// Dipanggil di background saat startup. Kalau belum ada, binary diunduh ke
    /// folder data aplikasi (supaya pengguna tidak perlu memasang apa pun).
    /// Kalau gagal — mis. offline — aplikasi tetap jalan dengan resolver mock,
    /// dan statusnya terlihat lewat command `resolver_status`.
    pub async fn upgrade_resolver(&self) -> bool {
        match crate::resolver::ytdlp::ensure_available().await {
            Ok(path) => {
                let real: Arc<dyn StreamResolver> = Arc::new(ResilientResolver::new(Box::new(
                    YtDlpResolver::with_binary(path.clone()),
                )));
                *self.resolver.write() = real;
                tracing::info!(path = %path.display(), "resolver yt-dlp aktif");
                true
            }
            Err(e) => {
                tracing::warn!(error = %e, "yt-dlp belum tersedia; pemutaran nonaktif");
                false
            }
        }
    }

    /// True kalau resolver nyata (yt-dlp) sudah aktif.
    pub fn resolver_is_live(&self) -> bool {
        self.resolver.read().is_live()
    }

    /// Folder cache cover: <data_dir>/covers.
    pub fn covers_dir(&self) -> std::path::PathBuf {
        self.data_dir.join("covers")
    }
}
