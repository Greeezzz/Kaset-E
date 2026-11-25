use serde::{Deserialize, Serialize};

use super::Track;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub position: i64,
    pub track: Track,
    /// Posisi sebelum shuffle; dipakai untuk membatalkan shuffle tanpa kehilangan urutan asli.
    pub original_order: i64,
    /// Lagu yang pengguna tambahkan sendiri ("Tambah ke antrean").
    ///
    /// Selalu diputar sebelum lagu acak dari playlist, sesuai urutan
    /// penambahan — inilah "custom queue" ala Spotify.
    pub prioritas: bool,
    /// Urutan penambahan antar lagu prioritas. Dipakai supaya lagu yang
    /// ditambahkan duluan tetap diputar duluan walau shuffle menyala.
    pub prioritas_urut: i64,
    /// Posisi cursor sudah melewati/memutar lagu ini.
    ///
    /// Disimpan ke database karena `order` tidak ikut disimpan: tanpa penanda
    /// ini, lagu prioritas yang sudah diputar muncul lagi setelah aplikasi
    /// dibuka ulang. Lihat migrasi `0007`.
    pub sudah_diputar: bool,
}
