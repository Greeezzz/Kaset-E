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
    pub resolver: Arc<dyn StreamResolver>,
    /// Direktori data aplikasi: database, cache cover, log.
    pub data_dir: std::path::PathBuf,
}

impl AppState {
    pub fn new(data_dir: std::path::PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let db = Arc::new(Db::open(data_dir.join("kaset.db"))?);

        // Mulai dari mock; `upgrade_catalog` menukarnya dengan katalog nyata.
        let mock = Arc::new(MockCatalog::default());

        // Resolver: pakai yt-dlp kalau ada di PATH, dan SELALU dibungkus
        // ResilientResolver supaya backoff + circuit breaker berlaku apa pun
        // implementasinya (RESILIENCE.md). Kalau yt-dlp tidak ada, mock dipakai
        // dan aplikasi tetap jalan — hanya belum bisa memutar audio nyata.
        let resolver: Arc<dyn StreamResolver> = match YtDlpResolver::detect() {
            Ok(ytdlp) => {
                tracing::info!("resolver yt-dlp aktif");
                Arc::new(ResilientResolver::new(Box::new(ytdlp)))
            }
            Err(e) => {
                tracing::warn!(error = %e, "yt-dlp tidak ditemukan; memakai resolver mock");
                mock.clone()
            }
        };

        Ok(Self {
            db,
            catalog: RwLock::new(mock),
            resolver,
            data_dir,
        })
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

    /// Folder cache cover: <data_dir>/covers.
    pub fn covers_dir(&self) -> std::path::PathBuf {
        self.data_dir.join("covers")
    }
}
