use tauri::State;

use crate::db::{get_setting, set_setting};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Baca satu pengaturan. `null` = belum pernah diset.
#[tauri::command]
pub async fn setting_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    if key.trim().is_empty() {
        return Err(AppError::invalid("key pengaturan kosong"));
    }
    get_setting(&state.db, &key)
}

/// Tulis satu pengaturan. Nilai disimpan sebagai teks; UI yang menafsirkan.
#[tauri::command]
pub async fn setting_set(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::invalid("key pengaturan kosong"));
    }
    set_setting(&state.db, &key, &value)
}
