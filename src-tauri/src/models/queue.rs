use serde::{Deserialize, Serialize};

use super::Track;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub position: i64,
    pub track: Track,
    /// Posisi sebelum shuffle; dipakai untuk membatalkan shuffle tanpa kehilangan urutan asli.
    pub original_order: i64,
}
