//! Tray icon desktop + menu dasar (MVP.md Fase 1 Desktop polish).
//!
//! Hanya dikompilasi di target desktop (`#[cfg(desktop)]` di `lib.rs`) supaya
//! tidak pernah menghalangi build Android di Fase 2 (AGENTS.md aturan 3).
//!
//! Ikon tray sendiri sudah dibuat otomatis oleh Tauri dari `tauri.conf.json`
//! (`id: "main"`). Modul ini memasang menu konteks dan handler kliknya.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const ID_BUKA: &str = "tray_buka";
const ID_TOGGLE: &str = "tray_toggle";
const ID_NEXT: &str = "tray_next";
const ID_PREV: &str = "tray_prev";
const ID_KELUAR: &str = "tray_keluar";

/// Pasang menu dasar dan handler klik pada tray icon `"main"`.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id("main") else {
        tracing::warn!("tray icon 'main' tidak ditemukan");
        return Ok(());
    };

    let buka = MenuItem::with_id(app, ID_BUKA, "Buka Kaset", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let toggle = MenuItem::with_id(app, ID_TOGGLE, "Putar / Jeda", true, None::<&str>)?;
    let next = MenuItem::with_id(app, ID_NEXT, "Berikutnya", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, ID_PREV, "Sebelumnya", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let keluar = MenuItem::with_id(app, ID_KELUAR, "Keluar", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&buka, &sep1, &toggle, &next, &prev, &sep2, &keluar])?;
    tray.set_menu(Some(menu))?;
    tray.set_show_menu_on_left_click(false)?;

    tray.on_menu_event(|app, event| match event.id().as_ref() {
        ID_BUKA => tampilkan_jendela(app),
        ID_TOGGLE => {
            let _ = app.emit("tray://toggle-play", ());
        }
        ID_NEXT => {
            let _ = app.emit("tray://next", ());
        }
        ID_PREV => {
            let _ = app.emit("tray://previous", ());
        }
        ID_KELUAR => app.exit(0),
        _ => {}
    });

    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            tampilkan_jendela(tray.app_handle());
        }
    });

    Ok(())
}

fn tampilkan_jendela(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
