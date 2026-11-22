//! Media key global desktop (MVP.md Fase 1 Desktop polish).
//!
//! Mendaftarkan tombol media keyboard (Play/Pause, Next, Previous) lewat
//! `tauri-plugin-global-shortcut`. Hanya dikompilasi di desktop (`#[cfg(desktop)]`)
//! agar build Android di Fase 2 tetap bersih.
//!
//! Kegagalan registrasi (mis. tombol sedang dipakai aplikasi pemutar lain)
//! dicatat sebagai warning, bukan error fatal yang menggagalkan start aplikasi.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

/// Daftarkan media key dan hubungkan ke event pemutaran yang sama dengan tray.
pub fn setup(app: &AppHandle) {
    let daftar = [
        (Code::MediaPlayPause, "tray://toggle-play", "MediaPlayPause"),
        (Code::MediaTrackNext, "tray://next", "MediaTrackNext"),
        (
            Code::MediaTrackPrevious,
            "tray://previous",
            "MediaTrackPrevious",
        ),
    ];

    for (code, event_name, label) in daftar {
        let shortcut = Shortcut::new(None, code);
        let res = app
            .global_shortcut()
            .on_shortcut(shortcut, move |handle, _s, event| {
                // Hanya tanggapi saat ditekan, bukan saat dilepas (hindari toggle ganda).
                if event.state == ShortcutState::Pressed {
                    let _ = handle.emit(event_name, ());
                }
            });
        if let Err(e) = res {
            tracing::warn!(shortcut = label, error = %e, "gagal mendaftarkan media key");
        }
    }
}
