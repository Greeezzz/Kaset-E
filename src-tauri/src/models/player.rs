use serde::{Deserialize, Serialize};

use super::Track;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    One,
    All,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlayerStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub track: Option<Track>,
    pub status: PlayerStatus,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            track: None,
            status: PlayerStatus::Idle,
            position_ms: 0,
            duration_ms: 0,
            volume: 0.8,
            shuffle: false,
            repeat: RepeatMode::Off,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PlayerEvent {
    StateChanged { state: PlayerState },
    Position { position_ms: u64, duration_ms: u64 },
    Ended,
    Error { message: String, permanent: bool },
}
