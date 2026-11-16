use std::sync::Arc;

use crate::catalog::mock::MockCatalog;
use crate::catalog::{MusicCatalog, StreamResolver};
use crate::db::Db;

/// State global aplikasi yang dibagikan ke setiap command.
pub struct AppState {
    pub db: Arc<Db>,
    pub catalog: Arc<dyn MusicCatalog>,
    pub resolver: Arc<dyn StreamResolver>,
    /// Direktori data aplikasi: database, cache cover, log.
    pub data_dir: std::path::PathBuf,
}

impl AppState {
    pub fn new(data_dir: std::path::PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let db = Arc::new(Db::open(data_dir.join("kaset.db"))?);

        // Fase 0 memakai mock. Implementasi nyata masuk di Fase 1 di balik trait
        // yang sama, jadi tidak ada perubahan di sisi command/UI.
        let mock = Arc::new(MockCatalog::default());

        Ok(Self {
            db,
            catalog: mock.clone(),
            resolver: mock,
            data_dir,
        })
    }

    /// Folder cache cover: <data_dir>/covers.
    pub fn covers_dir(&self) -> std::path::PathBuf {
        self.data_dir.join("covers")
    }
}
