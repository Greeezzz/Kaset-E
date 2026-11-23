use tauri::State;

use crate::db::library;
use crate::error::{AppError, AppResult};
use crate::models::Track;
use crate::state::AppState;

/// Favorit: tambah kalau belum ada, hapus kalau sudah ada.
///
/// Satu command untuk dua arah karena UI-nya satu tombol. Mengembalikan
/// keadaan akhir supaya UI tidak perlu menebak.
#[tauri::command]
pub async fn toggle_favorite(state: State<'_, AppState>, track: Track) -> AppResult<bool> {
    if library::is_favorite(&state.db, &track.video_id)? {
        library::remove_favorite(&state.db, &track.video_id)?;
        Ok(false)
    } else {
        library::add_favorite(&state.db, &track)?;
        Ok(true)
    }
}

#[tauri::command]
pub async fn list_favorites(state: State<'_, AppState>) -> AppResult<Vec<Track>> {
    library::list_favorites(&state.db)
}

#[tauri::command]
pub async fn is_favorite(state: State<'_, AppState>, video_id: String) -> AppResult<bool> {
    library::is_favorite(&state.db, &video_id)
}

/// Catat pemutaran. Dipanggil UI saat audio benar-benar mulai berbunyi.
#[tauri::command]
pub async fn record_play(state: State<'_, AppState>, track: Track) -> AppResult<()> {
    library::record_play(&state.db, &track)
}

/// Catat potongan waktu mendengar (Fase 4a).
///
/// UI mengirim delta yang sudah dihitung `Akumulator` di sisi frontend; di sini
/// tinggal menulis. `deltaMs` <= 0 diabaikan, dan pencatatan dihormati kalau
/// pengguna mematikannya.
#[tauri::command]
pub async fn listen_record(
    state: State<'_, AppState>,
    video_id: String,
    delta_ms: i64,
    started_at: i64,
) -> AppResult<()> {
    if !crate::db::listen::aktif(&state.db) {
        return Ok(());
    }
    // FK ke `tracks`: pastikan lagunya dikenal sebelum menulis, kalau tidak
    // insert akan gagal dan delta itu hilang diam-diam.
    if !crate::db::tracks::track_exists(&state.db, &video_id)? {
        return Ok(());
    }
    crate::db::listen::catat_delta(&state.db, &video_id, delta_ms, started_at)
}

/// Ringkasan statistik mendengar. Dipakai layar Stats (Fase 4b).
#[tauri::command]
pub async fn listen_summary(
    state: State<'_, AppState>,
) -> AppResult<crate::db::listen::Ringkasan> {
    crate::db::listen::ringkasan(&state.db)
}

/// Statistik mendengar lengkap untuk layar Stats (Fase 4b).
///
/// `tz_offset_min` = menit ke timur UTC (WIB = 420). Dikirim UI karena Rust
/// tidak punya akses ke zona waktu lokal tanpa dependensi tambahan, dan
/// "mendengar jam 21:00" hanya bermakna dalam waktu lokal pengguna.
#[tauri::command]
pub async fn listen_stats(
    state: State<'_, AppState>,
    rentang: crate::db::stats::Rentang,
    tz_offset_min: i32,
    limit: Option<usize>,
) -> AppResult<crate::db::stats::Statistik> {
    crate::db::stats::hitung(
        &state.db,
        rentang,
        tz_offset_min,
        crate::db::listen::sekarang_ms(),
        limit.unwrap_or(20),
    )
}

/// Hapus seluruh data statistik mendengar.
#[tauri::command]
pub async fn listen_clear(state: State<'_, AppState>) -> AppResult<usize> {
    crate::db::listen::hapus_semua(&state.db)
}

#[tauri::command]
pub async fn list_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> AppResult<Vec<Track>> {
    library::list_history(&state.db, limit.unwrap_or(100))
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> AppResult<usize> {
    library::clear_history(&state.db)
}

#[tauri::command]
pub async fn history_count(state: State<'_, AppState>) -> AppResult<i64> {
    library::history_count(&state.db)
}

/// Validasi nama playlist: tidak kosong, tidak kepanjangan.
fn validate_name(name: &str) -> AppResult<&str> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::invalid("nama playlist kosong"));
    }
    if n.chars().count() > 120 {
        return Err(AppError::invalid("nama playlist terlalu panjang"));
    }
    Ok(n)
}

#[tauri::command]
pub async fn create_playlist(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<crate::db::playlist::Playlist> {
    crate::db::playlist::create(&state.db, validate_name(&name)?)
}

#[tauri::command]
pub async fn rename_playlist(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> AppResult<crate::db::playlist::Playlist> {
    crate::db::playlist::rename(&state.db, id, validate_name(&name)?)
}

#[tauri::command]
pub async fn delete_playlist(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    // Hapus berkas cover lebih dulu, sebelum baris DB hilang — kalau urutannya
    // dibalik, nama file di DB sudah tidak ada dan berkasnya jadi yatim.
    if let Ok(pl) = crate::db::playlist::get(&state.db, id) {
        if let Some(name) = pl.cover_path {
            if let Some(dir) = crate::paths::playlist_covers_dir() {
                crate::playlist_cover::remove(&dir, &name);
            }
        }
    }
    crate::db::playlist::delete(&state.db, id)
}

/// Simpan detail playlist (nama, deskripsi, mode cover) tanpa menyentuh berkas.
///
/// `coverPath` sengaja tidak diekspos di sini — nama file cover hanya boleh
/// ditulis oleh `playlist_cover_set` / `playlist_cover_clear`, supaya DB tidak
/// bisa menunjuk berkas yang tidak pernah dibuat service gambar.
#[tauri::command]
pub async fn playlist_update_details(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
    description: Option<String>,
    cover_mode: Option<String>,
) -> AppResult<crate::db::playlist::Playlist> {
    let nama = name.as_deref().map(validate_name).transpose()?;

    if let Some(d) = description.as_deref() {
        if d.chars().count() > 200 {
            return Err(AppError::invalid("deskripsi maksimal 200 karakter"));
        }
    }
    if let Some(m) = cover_mode.as_deref() {
        if !matches!(m, "auto" | "custom" | "generative") {
            return Err(AppError::invalid("mode cover tidak dikenal"));
        }
    }

    crate::db::playlist::update_details(
        &state.db,
        id,
        nama,
        description.as_deref().map(Some),
        cover_mode.as_deref(),
        None,
    )?;
    crate::db::playlist::get(&state.db, id)
}

/// Unggah cover playlist dari byte gambar.
///
/// Pemrosesan seluruhnya di Rust: validasi magic bytes, batas ukuran, decode
/// dengan batas dimensi, crop tengah 1:1, resize 512, encode JPEG. UI hanya
/// mengirim byte mentah; tidak ada gambar yang ditulis apa adanya ke disk dan
/// tidak ada base64 di SQLite.
///
/// Kalau playlist sudah punya cover kustom, berkas lama dihapus setelah berkas
/// baru berhasil ditulis — urutan ini mencegah playlist kehilangan cover kalau
/// penulisan baru gagal.
#[tauri::command]
pub async fn playlist_cover_set(
    state: State<'_, AppState>,
    id: i64,
    bytes: Vec<u8>,
) -> AppResult<crate::db::playlist::Playlist> {
    let pl = crate::db::playlist::get(&state.db, id)?;
    let dir =
        crate::paths::playlist_covers_dir().ok_or_else(|| AppError::invalid("folder data tidak ada"))?;

    let jpeg = crate::playlist_cover::process(&bytes)?;
    let name = crate::playlist_cover::file_name_for(id);
    crate::playlist_cover::write(&dir, &name, &jpeg)?;

    // Berkas lama baru dihapus setelah berkas baru benar-benar ada di disk.
    if let Some(lama) = pl.cover_path.as_deref() {
        if lama != name {
            crate::playlist_cover::remove(&dir, lama);
        }
    }

    crate::db::playlist::update_details(
        &state.db,
        id,
        None,
        None,
        Some("custom"),
        Some(Some(&name)),
    )?;
    crate::db::playlist::get(&state.db, id)
}

/// Hapus cover kustom dan kembalikan playlist ke mode otomatis (mosaik).
#[tauri::command]
pub async fn playlist_cover_clear(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<crate::db::playlist::Playlist> {
    let pl = crate::db::playlist::get(&state.db, id)?;
    if let Some(name) = pl.cover_path.as_deref() {
        if let Some(dir) = crate::paths::playlist_covers_dir() {
            crate::playlist_cover::remove(&dir, name);
        }
    }
    crate::db::playlist::update_details(&state.db, id, None, None, Some("auto"), Some(None))?;
    crate::db::playlist::get(&state.db, id)
}

/// Path absolut cover playlist untuk `convertFileSrc` di UI.
///
/// UI tidak pernah menyusun path sendiri dari nama file: hanya Rust yang tahu
/// folder data, dan hanya nama file yang aman yang boleh digabung.
#[tauri::command]
pub async fn playlist_cover_path(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<Option<String>> {
    let pl = crate::db::playlist::get(&state.db, id)?;
    let Some(name) = pl.cover_path else {
        return Ok(None);
    };
    let dir =
        crate::paths::playlist_covers_dir().ok_or_else(|| AppError::invalid("folder data tidak ada"))?;
    Ok(crate::playlist_cover::resolve(&dir, &name).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn list_playlists(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::playlist::Playlist>> {
    crate::db::playlist::list(&state.db)
}

#[tauri::command]
pub async fn playlist_tracks(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Track>> {
    crate::db::playlist::tracks(&state.db, id)
}

#[tauri::command]
pub async fn add_to_playlist(state: State<'_, AppState>, id: i64, track: Track) -> AppResult<()> {
    crate::db::playlist::add_track(&state.db, id, &track)
}

#[tauri::command]
pub async fn remove_from_playlist(
    state: State<'_, AppState>,
    id: i64,
    video_id: String,
) -> AppResult<bool> {
    crate::db::playlist::remove_track(&state.db, id, &video_id)
}

#[tauri::command]
pub async fn play_playlist(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<crate::commands::QueueView> {
    let tracks = crate::db::playlist::tracks(&state.db, id)?;
    if tracks.is_empty() {
        return Err(AppError::invalid("playlist kosong"));
    }
    // Ganti antrean dengan isi playlist, lalu mulai dari lagu pertama.
    crate::db::ensure_tracks(&state.db, &tracks)?;
    Ok(state.with_queue(|q| {
        q.replace(tracks, 0);
        crate::commands::queue::view(q)
    }))
}

#[tauri::command]
pub async fn export_library(state: State<'_, AppState>) -> AppResult<String> {
    crate::db::export::export_json(&state.db)
}

#[tauri::command]
pub async fn import_library(
    state: State<'_, AppState>,
    json: String,
) -> AppResult<crate::db::export::ImportReport> {
    crate::db::export::import_json(&state.db, &json)
}
