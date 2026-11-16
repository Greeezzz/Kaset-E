use serde::{Serialize, Serializer};

/// Error aplikasi. `thiserror` untuk tipe milik sendiri (AGENTS.md: anyhow hanya
/// dipakai di lapisan paling atas, bukan di sini).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialisasi: {0}")]
    Serde(#[from] serde_json::Error),

    /// Kegagalan katalog (pencarian/metadata).
    #[error("katalog: {0}")]
    Catalog(String),

    /// Kegagalan resolver stream. `permanent` membedakan "coba lagi nanti" dari
    /// "lagu ini memang tidak bisa diputar" (lihat docs/RESILIENCE.md).
    #[error("stream: {message}")]
    Stream { message: String, permanent: bool },

    #[error("tidak ditemukan: {0}")]
    NotFound(String),

    #[error("input tidak valid: {0}")]
    Invalid(String),
}

impl AppError {
    /// Menandai error katalog sebagai permanen (mis. video dihapus) supaya
    /// lapisan atas tahu ini bukan kasus "coba lagi nanti".
    pub fn with_permanent(self, permanent: bool) -> Self {
        match self {
            AppError::Catalog(msg) => AppError::Stream {
                message: msg,
                permanent,
            },
            other => other,
        }
    }

    pub fn catalog(msg: impl Into<String>) -> Self {
        Self::Catalog(msg.into())
    }

    pub fn stream(msg: impl Into<String>, permanent: bool) -> Self {
        Self::Stream {
            message: msg.into(),
            permanent,
        }
    }

    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::Invalid(msg.into())
    }
}

/// UI hanya butuh pesan singkat + penanda bisa-dicoba-ulang. Detail teknis masuk log.
#[derive(Serialize)]
struct WireError<'a> {
    message: &'a str,
    permanent: bool,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let permanent = matches!(
            self,
            AppError::Stream {
                permanent: true,
                ..
            }
        );
        WireError {
            message: &self.to_string(),
            permanent,
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
