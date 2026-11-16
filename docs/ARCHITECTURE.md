# ARCHITECTURE — Kaset

## 1. Stack

| Lapisan | Pilihan |
|---------|---------|
| Shell aplikasi | **Tauri 2** (desktop + Android) |
| Backend / logika | **Rust** |
| UI | **React + TypeScript + Vite** |
| State UI | Zustand (ringan) |
| Database | **SQLite** lokal (`rusqlite` atau `sqlx`) |
| Audio desktop | `rodio` + `symphonia` (atau webview `<audio>` sebagai opsi awal yang lebih cepat) |
| Audio Android | **ExoPlayer/Media3** lewat plugin Kotlin (foreground service + MediaSession) |
| Metadata YT Music | crate seperti `ytmapi-rs` (verifikasi masih aktif sebelum dipakai) |
| Ekstraksi stream | crate seperti `rusty_ytdl`, atau memanggil `yt-dlp` eksternal yang diinstal pengguna (verifikasi dulu) |
| CI/CD | GitHub Actions + `tauri-action` |

> Catatan: nama crate di atas adalah titik awal. Agent harus mengecek versi terbaru, status maintenance, dan kompatibilitas sebelum memakainya, dan boleh menggantinya kalau ada opsi yang lebih sehat.

## 2. Diagram Tingkat Tinggi

```
┌──────────────────────────── React UI ────────────────────────────┐
│  Search · Player · Queue · Library · Settings                    │
└───────────────▲──────────────────────────────┬───────────────────┘
                │ events                       │ invoke (commands)
┌───────────────┴──────────────────────────────▼───────────────────┐
│                         Rust Core (src-tauri)                    │
│  ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ Catalog  │ │  Resolver  │ │  Queue    │ │  Library (SQLite)│  │
│  │ (trait)  │ │  (trait)   │ │  Manager  │ │  playlists, hist │  │
│  └──────────┘ └────────────┘ └─────┬─────┘ └──────────────────┘  │
│                                    │                             │
│                           ┌────────▼────────┐                    │
│                           │ PlayerBackend   │ (trait)            │
│                           └───┬─────────┬───┘                    │
└───────────────────────────────┼─────────┼────────────────────────┘
                                │         │
                  ┌─────────────▼──┐   ┌──▼───────────────────────┐
                  │ Desktop audio  │   │ Android plugin (Kotlin)  │
                  │ rodio/symphonia│   │ ExoPlayer + MediaSession │
                  └────────────────┘   └──────────────────────────┘
```

## 3. Prinsip Desain

1. **Abstraksi di titik rapuh.** Ekstraksi stream dan katalog YouTube sering berubah. Keduanya di balik trait supaya mudah diganti tanpa menyentuh UI.
2. **Rust memegang logika, UI hanya menampilkan.** Queue, shuffle, dan persistensi ada di Rust. UI mengirim perintah dan mendengarkan event.
3. **Satu `PlayerBackend`, dua implementasi.** Desktop dan Android memakai interface yang sama; perbedaan platform tersembunyi di belakangnya.
4. **Offline-first.** Library tidak pernah butuh internet.
5. **Tanpa telemetri, tanpa server.**

## 4. Trait Kunci (sketsa)

```rust
// src-tauri/src/catalog/mod.rs
#[async_trait]
pub trait MusicCatalog: Send + Sync {
    async fn search(&self, query: &str, filter: SearchFilter) -> Result<SearchResults>;
    async fn suggestions(&self, query: &str) -> Result<Vec<String>>;
    async fn track(&self, video_id: &str) -> Result<Track>;
}

// src-tauri/src/resolver/mod.rs
#[async_trait]
pub trait StreamResolver: Send + Sync {
    /// Mengembalikan URL audio langsung + masa berlaku.
    async fn resolve(&self, video_id: &str, quality: Quality) -> Result<ResolvedStream>;
}

// src-tauri/src/player/mod.rs
#[async_trait]
pub trait PlayerBackend: Send + Sync {
    async fn load(&self, stream: ResolvedStream, meta: TrackMeta) -> Result<()>;
    async fn play(&self) -> Result<()>;
    async fn pause(&self) -> Result<()>;
    async fn seek(&self, position_ms: u64) -> Result<()>;
    async fn set_volume(&self, volume: f32) -> Result<()>;
    fn subscribe(&self) -> Receiver<PlayerEvent>; // Position, Ended, Error, StateChanged
}
```

URL stream dari YouTube **kedaluwarsa**. Resolve ulang kalau `expires_at` sudah lewat atau saat seek gagal.

## 5. Struktur Folder

```
kaset/
├── README.md
├── PRD.md
├── MVP.md
├── ARCHITECTURE.md
├── DESIGN.md
├── RELEASE.md
├── AGENTS.md
├── LICENSE
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .github/
│   └── workflows/
│       ├── ci.yml              # lint + test di setiap push/PR
│       └── release.yml         # build semua platform saat tag v*
├── src/                        # React UI
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── layout/             # AppShell, Sidebar, MiniPlayer, BottomNav
│   ├── features/
│   │   ├── search/
│   │   ├── player/             # NowPlaying, controls, progress
│   │   ├── queue/
│   │   ├── library/            # playlists, favorites, history
│   │   └── settings/
│   ├── components/             # tombol, kartu, list item, slider
│   ├── hooks/
│   ├── lib/
│   │   ├── tauri.ts            # wrapper invoke + listen yang bertipe
│   │   └── format.ts
│   ├── stores/                 # zustand
│   ├── styles/
│   │   ├── tokens.css          # warna, spacing, tipografi
│   │   └── global.css
│   └── types/                  # tipe yang mirror struct Rust
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── migrations/             # 0001_init.sql, dst.
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs              # setup, register commands & plugin
│   │   ├── commands/           # fungsi #[tauri::command]
│   │   │   ├── search.rs
│   │   │   ├── player.rs
│   │   │   ├── queue.rs
│   │   │   └── library.rs
│   │   ├── catalog/            # trait + implementasi YT Music
│   │   ├── resolver/           # trait + implementasi ekstraktor
│   │   ├── player/
│   │   │   ├── mod.rs          # trait PlayerBackend
│   │   │   ├── desktop.rs      # rodio/symphonia
│   │   │   └── android.rs      # jembatan ke plugin Kotlin
│   │   ├── queue/              # QueueManager, shuffle, repeat
│   │   ├── db/                 # koneksi, migrasi, repository
│   │   ├── models/             # Track, Playlist, QueueItem, dll
│   │   ├── events.rs           # event ke UI
│   │   └── error.rs
│   └── gen/android/            # dihasilkan Tauri (jangan edit manual kecuali perlu)
└── plugins/
    └── tauri-plugin-media/     # plugin Tauri khusus
        ├── Cargo.toml
        ├── src/                # sisi Rust plugin
        └── android/            # Kotlin: PlaybackService, MediaSession, ExoPlayer
```

## 6. Alur Data Utama

**Memutar lagu dari hasil pencarian**
1. UI: `invoke("play_track", { videoId })`
2. `QueueManager` menaruh lagu sebagai item aktif.
3. `StreamResolver.resolve(videoId)` mengembalikan URL audio.
4. `PlayerBackend.load(...)` lalu `play()`.
5. Backend mengirim event `PlayerEvent::Position` berkala ke UI.
6. Saat `Ended`, `QueueManager` memilih item berikutnya (menurut shuffle/repeat) dan siklus berulang.

**Prefetch:** resolve lagu berikutnya ketika sisa durasi lagu aktif sekitar 20 detik, supaya transisi cepat.

## 7. Skema Database (SQLite)

```sql
-- migrations/0001_init.sql
PRAGMA foreign_keys = ON;

CREATE TABLE tracks (
  video_id     TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL,
  album        TEXT,
  duration_ms  INTEGER,
  thumbnail    TEXT,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES tracks(video_id),
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE favorites (
  video_id   TEXT PRIMARY KEY REFERENCES tracks(video_id),
  added_at   INTEGER NOT NULL
);

CREATE TABLE history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   TEXT NOT NULL REFERENCES tracks(video_id),
  played_at  INTEGER NOT NULL
);
CREATE INDEX idx_history_played_at ON history(played_at DESC);

-- Queue yang disimpan agar bisa dipulihkan
CREATE TABLE queue_items (
  position       INTEGER PRIMARY KEY,
  video_id       TEXT NOT NULL REFERENCES tracks(video_id),
  original_order INTEGER NOT NULL  -- untuk membatalkan shuffle
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Setiap perubahan skema = file migrasi baru (`0002_*.sql`, dst.). Jangan edit migrasi yang sudah dirilis.

## 8. Kontrak UI ↔ Rust

**Commands (invoke):** `search`, `search_suggestions`, `play_track`, `toggle_play`, `next`, `previous`, `seek`, `set_volume`, `queue_add`, `queue_play_next`, `queue_remove`, `queue_move`, `queue_clear`, `queue_get`, `set_shuffle`, `set_repeat`, `playlist_*` (create/rename/delete/add/remove), `favorite_toggle`, `history_list`, `export_library`, `import_library`.

**Events (listen):** `player://state`, `player://position`, `player://track-changed`, `player://error`, `queue://changed`.

Tipe di `src/types/` harus mirror struct Rust (pertimbangkan `ts-rs` atau `specta` untuk generate otomatis).

## 9. Android: Catatan Khusus

- Foreground service dengan notifikasi media wajib agar audio tetap jalan.
- Gunakan `MediaSession` untuk kontrol lock screen dan headset.
- Tangani audio focus: pause saat telepon masuk, ducking untuk notifikasi.
- Izin: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `POST_NOTIFICATIONS` (Android 13+), `WAKE_LOCK`.
- Pada Android, ExoPlayer memegang audio; Rust mengirim perintah dan menerima event lewat plugin.

## 10. Keputusan Terbuka (agent boleh usulkan)

1. Desktop audio: `rodio` di Rust vs `<audio>` di webview. Mulai dari yang lebih cepat jadi, pindah kalau ada masalah.
2. Ekstraktor: crate Rust vs `yt-dlp` eksternal. Pilih setelah uji coba ketahanannya.
3. `rusqlite` vs `sqlx`.
4. Pembuatan tipe TS otomatis (`ts-rs` / `specta`).
