//! QueueManager — antrean pemutaran.
//!
//! Modul ini **murni**: tidak menyentuh database atau jaringan sama sekali.
//! Itu disengaja (AGENTS.md): queue adalah logika paling rawan bug (shuffle,
//! repeat, reorder, pemulihan), jadi harus bisa diuji tanpa I/O. Persistensi ke
//! SQLite ada di `crate::db::queue` yang hanya memanggil modul ini.
//!
//! ## Konsep
//!
//! Ada dua urutan yang harus dibedakan dengan jelas, karena inilah sumber bug
//! di player mana pun:
//!
//! - **`items`** — urutan asli yang dilihat/diatur pengguna. Ini yang ditampilkan
//!   di panel Antrean, dan **tidak pernah** diubah oleh shuffle.
//! - **`order`** — urutan pemutaran: permutasi indeks ke `items`. Saat shuffle
//!   mati, `order` adalah identitas (0, 1, 2, …). Saat shuffle hidup, `order`
//!   diacak sekali lalu dipertahankan, sehingga lagu tidak "lompat" tiap kali
//!   panel dibuka.
//!
//! Karena `items` tidak pernah diacak, mematikan shuffle cukup mengembalikan
//! `order` ke identitas — urutan asli tidak perlu disimpan terpisah.

use serde::{Deserialize, Serialize};

use crate::models::{QueueItem, RepeatMode, Track};

pub mod smart;

/// Pengacak kecil deterministik (xorshift64*).
///
/// Kenapa tidak `rand`? Karena queue harus **deterministik saat diuji**: dengan
/// `seed` yang sama, urutan hasil shuffle harus identik. Ini juga menghindari
/// satu dependensi hanya untuk mengacak daftar pendek.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        // Seed 0 membuat xorshift macet; ganti dengan konstanta.
        Self(if seed == 0 { 0x9E3779B97F4A7C15 } else { seed })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }

    /// Fisher–Yates dengan pengacak di atas.
    fn shuffle<T>(&mut self, slice: &mut [T]) {
        if slice.len() < 2 {
            return;
        }
        for i in (1..slice.len()).rev() {
            let j = (self.next_u64() % (i as u64 + 1)) as usize;
            slice.swap(i, j);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueManager {
    /// Urutan asli (tampilan). Tidak pernah diubah oleh shuffle.
    items: Vec<QueueItem>,
    /// Permutasi indeks ke `items` = urutan pemutaran.
    order: Vec<usize>,
    /// Posisi di dalam `order` (bukan indeks `items`).
    cursor: usize,
    shuffle: bool,
    repeat: RepeatMode,
    /// Shuffle pintar: urutan disusun dari riwayat mendengar, bukan acak rata.
    shuffle_pintar: bool,
    /// Riwayat mendengar per `video_id`, diisi pemanggil dari database.
    ///
    /// Disimpan di sini (bukan dibaca `QueueManager` sendiri) supaya modul ini
    /// tetap murni: tanpa database, tanpa I/O, bisa diuji berdiri sendiri.
    ///
    /// `serde(skip)`: riwayat dibangun ulang dari database setiap kali aplikasi
    /// dibuka. Ikut menyerialisasinya akan menggandakan data yang sudah ada di
    /// `listen_events` ke dalam state antrean.
    #[serde(skip)]
    riwayat: std::collections::HashMap<String, smart::RiwayatLagu>,
    /// Disimpan supaya hasil shuffle bisa direproduksi (dan diuji).
    seed: u64,
    rng: Rng,
}

impl Default for QueueManager {
    fn default() -> Self {
        Self::new(0)
    }
}

impl QueueManager {
    pub fn new(seed: u64) -> Self {
        Self {
            items: Vec::new(),
            order: Vec::new(),
            cursor: 0,
            shuffle: false,
            shuffle_pintar: false,
            riwayat: std::collections::HashMap::new(),
            repeat: RepeatMode::Off,
            seed,
            rng: Rng::new(seed),
        }
    }

    // ---------------------------------------------------------------- query

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn shuffle_enabled(&self) -> bool {
        self.shuffle
    }

    pub fn repeat(&self) -> RepeatMode {
        self.repeat
    }

    /// Seed shuffle. Dipakai test untuk mereproduksi urutan.
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// Lagu yang sedang diputar.
    pub fn current(&self) -> Option<&QueueItem> {
        self.order.get(self.cursor).and_then(|&i| self.items.get(i))
    }

    /// Indeks lagu aktif di dalam `order` (dipakai UI untuk menyorot baris).
    pub fn cursor(&self) -> usize {
        self.cursor
    }

    /// Semua lagu dalam **urutan pemutaran** (yang benar untuk ditampilkan
    /// sebagai antrean "berikutnya"), lengkap dengan `position` yang dihitung
    /// ulang mengikuti urutan itu.
    pub fn play_order(&self) -> Vec<QueueItem> {
        self.order
            .iter()
            .enumerate()
            .filter_map(|(pos, &idx)| {
                self.items.get(idx).map(|it| QueueItem {
                    position: pos as i64,
                    original_order: it.original_order,
                    track: it.track.clone(),
                    prioritas: it.prioritas,
                    prioritas_urut: it.prioritas_urut,
                })
            })
            .collect()
    }

    /// Semua lagu dalam urutan asli (tampilan daftar saat shuffle mati).
    pub fn items(&self) -> &[QueueItem] {
        &self.items
    }

    // ---------------------------------------------------------------- mutasi

    /// Tambah lagu di akhir antrean. Mengembalikan posisi tampilan barunya.
    ///
    /// Lagu yang ditambahkan lewat cara ini ditandai PRIORITAS: itu jalur
    /// "Tambah ke antrean", dan pengguna mengharapkan lagu pilihannya diputar
    /// sebelum sisa playlist yang acak. Gunakan `add_biasa` untuk lagu yang
    /// datang dari playlist/acak.
    pub fn add(&mut self, track: Track) -> usize {
        self.add_dengan_prioritas(track, true)
    }

    /// Tambah lagu tanpa menandainya prioritas (dipakai `replace` untuk
    /// mengisi antrean dari playlist).
    pub fn add_biasa(&mut self, track: Track) -> usize {
        self.add_dengan_prioritas(track, false)
    }

    fn add_dengan_prioritas(&mut self, track: Track, prioritas: bool) -> usize {
        let original_order = self.next_original_order();
        // Urutan prioritas terus naik, sama seperti `original_order`, supaya
        // lagu yang ditambahkan lebih dulu tetap diputar lebih dulu.
        let prioritas_urut = if prioritas { original_order } else { 0 };
        self.items.push(QueueItem {
            position: self.items.len() as i64,
            original_order,
            track,
            prioritas,
            prioritas_urut,
        });
        let item_idx = self.items.len() - 1;

        if self.shuffle && !prioritas {
            // Lagu playlist ditaruh acak di antara sisa antrean supaya tidak
            // selalu muncul belakangan.
            let insert_at = if self.order.len() <= 1 {
                self.order.len()
            } else {
                let ahead = self.cursor + 1;
                let span = self.order.len() - ahead;
                ahead + (self.rng.next_u64() as usize % (span + 1))
            };
            self.order.insert(insert_at, item_idx);
        } else if self.shuffle {
            // Lagu prioritas: taruh SETELAH semua prioritas yang sudah ada,
            // dan sebelum lagu acak. Itulah "custom queue" — pengguna
            // menambahkan dua lagu, keduanya harus berurutan dan didahulukan.
            let mulai = self.cursor + 1;
            let mut akhir_prioritas = mulai;
            while akhir_prioritas < self.order.len() {
                let idx = self.order[akhir_prioritas];
                if !self.items[idx].prioritas {
                    break;
                }
                akhir_prioritas += 1;
            }
            self.order.insert(akhir_prioritas, item_idx);
        } else {
            self.order.push(item_idx);
        }

        // Antrean yang tadinya kosong: cursor harus menunjuk lagu pertama.
        if self.items.len() == 1 {
            self.cursor = 0;
        }
        item_idx
    }

    /// Tambah lagu ke akhir antrean **dan langsung jadikan lagu aktif**.
    ///
    /// Ini yang dipakai saat pengguna mengklik lagu di Search. `add` saja tidak
    /// cukup: cursor tetap menunjuk lagu sebelumnya, sehingga panel antrean
    /// menampilkan lagu lama sebagai "sedang diputar" padahal yang berbunyi
    /// sudah lagu baru. Itu bug nyata — dua tempat membaca keadaan berbeda.
    pub fn add_and_play(&mut self, track: Track) -> usize {
        self.add(track);
        let item_idx = self.items.len() - 1;
        // `add` menaruh lagu baru di akhir saat shuffle mati, tapi menyisipkannya
        // acak saat shuffle hidup — jadi posisinya dicari, bukan diasumsikan
        // "selalu terakhir". `add` selalu memasukkan item ke `order`, jadi
        // pencarian ini tidak pernah gagal.
        if let Some(pos) = self.order.iter().position(|&i| i == item_idx) {
            self.cursor = pos;
        }
        item_idx
    }

    /// Sisipkan segera setelah lagu yang sedang diputar.
    ///
    /// Kalau antrean kosong, perilakunya sama dengan `add`.
    pub fn play_next(&mut self, track: Track) -> usize {
        if self.items.is_empty() {
            return self.add(track);
        }

        let original_order = self.next_original_order();
        self.items.push(QueueItem {
            position: self.items.len() as i64,
            original_order,
            track,
            prioritas: true,
            prioritas_urut: original_order,
        });
        let item_idx = self.items.len() - 1;
        let at = (self.cursor + 1).min(self.order.len());
        self.order.insert(at, item_idx);
        item_idx
    }

    fn next_original_order(&self) -> i64 {
        self.items
            .iter()
            .map(|i| i.original_order)
            .max()
            .map(|m| m + 1)
            .unwrap_or(0)
    }

    /// Hapus lagu pada posisi **pemutaran** `pos`.
    ///
    /// Mengembalikan `true` kalau ada yang terhapus. Cursor disesuaikan supaya
    /// tetap menunjuk lagu yang sama (atau lagu berikutnya kalau lagu aktif
    /// yang dihapus).
    pub fn remove(&mut self, pos: usize) -> bool {
        let Some(&item_idx) = self.order.get(pos) else {
            return false;
        };
        self.order.remove(pos);
        self.items.remove(item_idx);

        // Semua indeks di `order` setelah item yang dihapus bergeser satu.
        for idx in self.order.iter_mut() {
            if *idx > item_idx {
                *idx -= 1;
            }
        }
        self.reindex_positions();

        if self.order.is_empty() {
            self.cursor = 0;
        } else if pos < self.cursor {
            // Yang dihapus ada sebelum lagu aktif: cursor ikut bergeser.
            self.cursor -= 1;
        } else if self.cursor >= self.order.len() {
            // Yang dihapus adalah lagu terakhir: mundur satu, jangan melewati ujung.
            self.cursor = self.order.len() - 1;
        }
        true
    }

    /// Pindahkan lagu dari posisi pemutaran `from` ke `to` (drag-reorder).
    pub fn move_item(&mut self, from: usize, to: usize) -> bool {
        if from >= self.order.len() || to >= self.order.len() || from == to {
            return false;
        }
        let moved = self.order.remove(from);
        self.order.insert(to, moved);

        // Cursor harus tetap menunjuk lagu yang sama. Kalau lagu aktif yang
        // dipindah, cursor ikut pindah; kalau perpindahan melewati cursor,
        // cursor bergeser satu.
        self.cursor = match self.cursor {
            c if c == from => to,
            c if from < c && to >= c => c - 1,
            c if from > c && to <= c => c + 1,
            c => c,
        };
        true
    }

    /// Kosongkan antrean.
    pub fn clear(&mut self) {
        self.items.clear();
        self.order.clear();
        self.cursor = 0;
    }

    /// Ganti seluruh antrean dengan daftar baru dan mulai dari `start_index`.
    ///
    /// Kalau shuffle aktif, lagu yang dipilih (`start_index`) ditaruh di posisi
    /// pertama (`cursor = 0`) lalu sisanya diacak — jadi klik ganda baris #7
    /// selalu memutar baris #7 lebih dulu, bukan lagu acak lain.
    pub fn replace(&mut self, tracks: Vec<Track>, start_index: usize) {
        self.items = tracks
            .into_iter()
            .enumerate()
            .map(|(i, track)| QueueItem {
                position: i as i64,
                original_order: i as i64,
                track,
                // Isi playlist bukan prioritas: urutannya boleh diacak.
                prioritas: false,
                prioritas_urut: 0,
            })
            .collect();
        if self.items.is_empty() {
            self.order.clear();
            self.cursor = 0;
            return;
        }
        let idx = start_index.min(self.items.len() - 1);
        if self.shuffle {
            self.enable_shuffle_for(idx);
        } else {
            self.order = (0..self.items.len()).collect();
            self.cursor = idx;
        }
    }

    /// Ajukan lagu pada posisi pemutaran `pos` sebagai lagu aktif.
    pub fn jump_to(&mut self, pos: usize) -> bool {
        if pos < self.order.len() {
            self.cursor = pos;
            true
        } else {
            false
        }
    }

    /// Nyalakan/matikan shuffle **tanpa merusak urutan asli**.
    ///
    /// Saat dinyalakan, lagu aktif tetap di posisi pertama supaya pemutaran
    /// tidak melompat, dan sisanya diacak. Saat dimatikan, urutan kembali ke
    /// urutan asli dengan cursor tetap menunjuk lagu yang sama.
    pub fn set_shuffle(&mut self, on: bool) {
        if on == self.shuffle {
            return;
        }
        self.shuffle = on;
        if on {
            self.enable_shuffle();
        } else {
            self.order = (0..self.items.len()).collect();
            // Kembalikan cursor ke posisi lagu aktif di urutan asli.
            self.cursor = self.current_item_index().unwrap_or(0);
        }
    }

    /// Isi riwayat mendengar yang dipakai smart shuffle.
    pub fn set_riwayat(&mut self, riwayat: std::collections::HashMap<String, smart::RiwayatLagu>) {
        self.riwayat = riwayat;
    }

    /// Apakah shuffle pintar aktif.
    pub fn shuffle_pintar(&self) -> bool {
        self.shuffle_pintar
    }

    /// Epoch ms sekarang.
    ///
    /// Modul `smart` sengaja tidak membaca jam sendiri supaya bisa diuji dengan
    /// waktu tetap; hanya di sini jam dinding disentuh.
    fn jam_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Pilih jenis shuffle. `true` = pintar (berbobot), `false` = acak rata.
    ///
    /// Kalau shuffle sedang menyala, urutannya langsung disusun ulang dengan
    /// aturan baru — tanpa itu, mengganti jenis shuffle tidak berpengaruh apa
    /// pun sampai pengguna mematikan dan menyalakannya lagi.
    pub fn set_shuffle_pintar(&mut self, pintar: bool) {
        if pintar == self.shuffle_pintar {
            return;
        }
        self.shuffle_pintar = pintar;
        if self.shuffle {
            let cur = self.current_item_index().unwrap_or(0);
            self.enable_shuffle_for(cur);
        }
    }

    /// Nyalakan shuffle memakai lagu aktif saat ini sebagai titik awal.
    ///
    /// Sengaja memanggil `enable_shuffle_for` supaya HANYA ADA SATU aturan
    /// urutan shuffle. Dua implementasi berbeda sebelumnya membuat lagu
    /// prioritas didahulukan di satu jalur tapi tidak di jalur lain.
    fn enable_shuffle(&mut self) {
        let cur = self.current_item_index().unwrap_or(0);
        self.enable_shuffle_for(cur);
    }

    fn current_item_index(&self) -> Option<usize> {
        self.order.get(self.cursor).copied()
    }

    /// Nomor urut tampilan (`position`) disamakan dengan urutan asli di `items`.
    fn reindex_positions(&mut self) {
        for (i, it) in self.items.iter_mut().enumerate() {
            it.position = i as i64;
        }
    }

    pub fn set_repeat(&mut self, mode: RepeatMode) {
        self.repeat = mode;
    }

    // ------------------------------------------------------- navigasi lagu

    /// Lagi berikutnya, atau `None` kalau antrean sudah habis.
    ///
    /// Semantik repeat:
    /// - `One` tidak ditangani di sini — pemanggil yang mengulang lagu yang
    ///   sama, karena lagunya tidak perlu dimuat ulang dari resolver.
    /// - `All` membungkus ke awal setelah lagu terakhir.
    /// - `Off` berhenti di akhir.
    pub fn advance(&mut self) -> Option<&QueueItem> {
        if self.order.is_empty() {
            return None;
        }
        if self.cursor + 1 < self.order.len() {
            self.cursor += 1;
        } else if self.repeat == RepeatMode::All {
            self.cursor = 0;
        } else {
            return None;
        }
        self.current()
    }

    /// Lagi sebelumnya. Tidak membungkus dari awal, sesuai kebiasaan player:
    /// di lagu pertama, "previous" mengulang lagu aktif.
    pub fn retreat(&mut self) -> Option<&QueueItem> {
        if self.order.is_empty() {
            return None;
        }
        if self.cursor > 0 {
            self.cursor -= 1;
        }
        self.current()
    }

    /// Pulihkan antrean dari database (app dibuka lagi).
    ///
    /// `items` dianggap sudah dalam urutan asli; cursor dikembalikan ke posisi
    /// `cursor` yang tersimpan.
    pub fn restore(
        items: Vec<QueueItem>,
        cursor: usize,
        shuffle: bool,
        repeat: RepeatMode,
    ) -> Self {
        let mut q = Self::new(0);
        q.items = items;
        q.reindex_positions();
        q.shuffle = shuffle;
        q.repeat = repeat;

        let idx = if q.items.is_empty() {
            0
        } else {
            cursor.min(q.items.len() - 1)
        };

        if shuffle {
            q.enable_shuffle_for(idx);
        } else {
            q.order = (0..q.items.len()).collect();
            q.cursor = idx;
        }
        q
    }

    /// Indeks lagu aktif di dalam `items` (urutan asli), bukan posisi di
    /// `order`.
    ///
    /// Ini yang harus DISIMPAN dan dipulihkan: posisi di `order` berubah setiap
    /// kali shuffle dinyalakan ulang, sedangkan indeks `items` stabil. Bug
    /// "antrean balik ke awal" terjadi karena yang disimpan posisi `order` tapi
    /// `restore` menafsirkannya sebagai indeks `items`.
    pub fn active_item_index(&self) -> usize {
        self.order.get(self.cursor).copied().unwrap_or(0)
    }

    /// Sama seperti `enable_shuffle`, tapi lagu aktif ditentukan indeks `items`.
    ///
    /// Urutan hasil: [lagu aktif] → [lagu prioritas sesuai urutan penambahan]
    /// → [sisanya, diacak]. Itulah "custom queue" ala Spotify: yang pengguna
    /// pilih sendiri selalu didahulukan, sisanya baru acak.
    fn enable_shuffle_for(&mut self, item_idx: usize) {
        // Pisahkan dulu supaya prioritas tidak ikut teracak.
        let mut prioritas: Vec<usize> = Vec::new();
        let mut biasa: Vec<usize> = Vec::new();
        for (i, item) in self.items.iter().enumerate() {
            if i == item_idx {
                continue; // lagu aktif selalu paling depan
            }
            if item.prioritas {
                prioritas.push(i);
            } else {
                biasa.push(i);
            }
        }
        // Lagu yang ditambahkan lebih dulu diputar lebih dulu.
        prioritas.sort_by_key(|&i| self.items[i].prioritas_urut);

        if self.shuffle_pintar && biasa.len() > 1 {
            // Susun sisa lagu menurut riwayat. Prioritas tetap di depan dan
            // tidak ikut disusun: pilihan pengguna tidak boleh "dipintarkan".
            let ids: Vec<String> = biasa.iter().map(|&i| self.items[i].track.video_id.clone()).collect();
            let artis: Vec<String> = biasa.iter().map(|&i| self.items[i].track.artist.clone()).collect();
            let m = smart::Masukan {
                ids: &ids,
                artis: &artis,
                aktif: 0,
                riwayat: &self.riwayat,
                sekarang_ms: Self::jam_ms(),
                seed: self.rng.next_u64(),
            };
            // `susun` mengembalikan indeks ke dalam `ids`; terjemahkan kembali
            // ke indeks `items` lewat `biasa`.
            let urutan = smart::susun(&m);
            let disusun: Vec<usize> = urutan.iter().map(|&k| biasa[k]).collect();
            self.order = vec![item_idx];
            self.order.extend(prioritas);
            self.order.extend(disusun);
            self.cursor = 0;
            return;
        }

        self.rng.shuffle(&mut biasa);

        self.order = vec![item_idx];
        self.order.extend(prioritas);
        self.order.extend(biasa);
        self.cursor = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Track;

    fn track(id: &str) -> Track {
        Track {
            video_id: id.to_string(),
            title: format!("Lagu {id}"),
            artist: "Artis".into(),
            album: None,
            duration_ms: Some(180_000),
            cover_key: Track::cover_key_for(id),
        }
    }

    fn ids(q: &QueueManager) -> Vec<String> {
        q.play_order()
            .iter()
            .map(|i| i.track.video_id.clone())
            .collect()
    }

    #[test]
    fn tambah_lagu_urutan_benar_dan_cursor_di_awal() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.add(track("c"));
        assert_eq!(ids(&q), vec!["a", "b", "c"]);
        assert_eq!(q.current().unwrap().track.video_id, "a");
    }

    #[test]
    fn play_next_menyisipkan_setelah_lagu_aktif() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.add(track("c"));
        // Sisipkan setelah 'a' (yang sedang diputar)
        q.play_next(track("x"));
        assert_eq!(ids(&q), vec!["a", "x", "b", "c"]);
        assert_eq!(q.current().unwrap().track.video_id, "a");
    }

    #[test]
    fn play_next_pada_antrean_kosong_sama_dengan_add() {
        let mut q = QueueManager::new(1);
        q.play_next(track("solo"));
        assert_eq!(ids(&q), vec!["solo"]);
        assert_eq!(q.current().unwrap().track.video_id, "solo");
    }

    /// Regresi: mengklik lagu baru saat antrean sudah berisi lagu lain harus
    /// memindahkan lagu aktif, bukan hanya menambah di belakang.
    ///
    /// Bug aslinya: `add` hanya menyetel cursor kalau antrean tadinya kosong.
    /// Akibatnya memutar "Let Down" saat "Original Me" ada di antrean membuat
    /// panel antrean tetap menulis "Original Me" sebagai sedang diputar padahal
    /// yang berbunyi sudah "Let Down".
    #[test]
    fn add_and_play_memindahkan_lagu_aktif() {
        let mut q = QueueManager::new(1);
        q.add(track("original"));
        q.add_and_play(track("letdown"));

        assert_eq!(ids(&q), vec!["original", "letdown"]);
        assert_eq!(q.current().unwrap().track.video_id, "letdown");
    }

    /// Saat antrean masih kosong, `add_and_play` sama hasilnya dengan `add`.
    #[test]
    fn add_and_play_pada_antrean_kosong_menunjuk_lagu_pertama() {
        let mut q = QueueManager::new(1);
        q.add_and_play(track("solo"));
        assert_eq!(ids(&q), vec!["solo"]);
        assert_eq!(q.current().unwrap().track.video_id, "solo");
    }

    /// Dengan shuffle hidup, lagu baru disisipkan acak — bukan di akhir. Cursor
    /// tetap harus menunjuk lagu itu, karena posisinya tidak bisa diasumsikan.
    #[test]
    fn add_and_play_dengan_shuffle_tetap_menunjuk_lagu_baru() {
        let mut q = QueueManager::new(7);
        for i in 0..6 {
            q.add(track(&format!("l{i}")));
        }
        q.set_shuffle(true);
        q.add_and_play(track("baru"));

        assert_eq!(q.current().unwrap().track.video_id, "baru");
        // Dan cursor menunjuk posisi yang benar di urutan pemutaran.
        let urut = ids(&q);
        assert_eq!(urut[q.cursor()], "baru");
    }

    #[test]
    fn next_berhenti_di_akhir_saat_repeat_off() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        assert_eq!(q.advance().unwrap().track.video_id, "b");
        assert!(q.advance().is_none(), "repeat off harus berhenti di akhir");
        // Cursor tidak berubah setelah gagal maju.
        assert_eq!(q.current().unwrap().track.video_id, "b");
    }

    #[test]
    fn next_membungkus_saat_repeat_all() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.set_repeat(RepeatMode::All);
        q.advance();
        assert_eq!(
            q.advance().unwrap().track.video_id,
            "a",
            "harus kembali ke awal"
        );
    }

    #[test]
    fn previous_di_lagu_pertama_tetap_di_lagu_pertama() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        assert_eq!(q.retreat().unwrap().track.video_id, "a");
        assert_eq!(q.retreat().unwrap().track.video_id, "a");
    }

    #[test]
    fn hapus_lagu_sebelum_aktif_tidak_menggeser_lagu_aktif() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.add(track("c"));
        q.advance(); // aktif = b
        assert!(q.remove(0)); // hapus a
        assert_eq!(ids(&q), vec!["b", "c"]);
        assert_eq!(
            q.current().unwrap().track.video_id,
            "b",
            "lagu aktif harus tetap b setelah lagu sebelumnya dihapus"
        );
    }

    #[test]
    fn hapus_lagu_aktif_memicu_lagu_berikutnya() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.add(track("c"));
        q.advance(); // aktif = b
        assert!(q.remove(1)); // hapus b (yang aktif)
        assert_eq!(ids(&q), vec!["a", "c"]);
        assert_eq!(q.current().unwrap().track.video_id, "c");
    }

    #[test]
    fn hapus_lagu_terakhir_tidak_keluar_batas() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.advance(); // aktif = b (terakhir)
        assert!(q.remove(1));
        assert_eq!(ids(&q), vec!["a"]);
        assert_eq!(q.current().unwrap().track.video_id, "a");
    }

    #[test]
    fn hapus_satu_satunya_lagu_mengosongkan_dengan_aman() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        assert!(q.remove(0));
        assert!(q.is_empty());
        assert!(
            q.current().is_none(),
            "tidak boleh panik saat antrean kosong"
        );
        assert!(q.advance().is_none());
    }

    #[test]
    fn hapus_posisi_tidak_valid_mengembalikan_false() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        assert!(!q.remove(5));
        assert_eq!(q.len(), 1);
    }

    #[test]
    fn reorder_memindahkan_dan_mempertahankan_lagu_aktif() {
        let mut q = QueueManager::new(1);
        for id in ["a", "b", "c", "d"] {
            q.add(track(id));
        }
        q.advance(); // aktif = b (pos 1)
        assert!(q.move_item(3, 0)); // d ke depan
        assert_eq!(ids(&q), vec!["d", "a", "b", "c"]);
        assert_eq!(
            q.current().unwrap().track.video_id,
            "b",
            "memindahkan lagu lain tidak boleh menggeser lagu aktif"
        );
    }

    #[test]
    fn reorder_lagu_aktif_sendiri_mengikuti_cursor() {
        let mut q = QueueManager::new(1);
        for id in ["a", "b", "c"] {
            q.add(track(id));
        }
        assert!(q.move_item(0, 2)); // aktif (a) dipindah ke akhir
        assert_eq!(ids(&q), vec!["b", "c", "a"]);
        assert_eq!(q.current().unwrap().track.video_id, "a");
    }

    #[test]
    fn reorder_tidak_valid_mengembalikan_false() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        assert!(!q.move_item(0, 0), "dari dan ke sama = tidak ada perubahan");
        assert!(!q.move_item(0, 9));
        assert_eq!(ids(&q), vec!["a"]);
    }

    #[test]
    fn clear_mengosongkan_semuanya() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.clear();
        assert!(q.is_empty());
        assert!(q.current().is_none());
        assert_eq!(q.cursor(), 0);
    }

    // ------------------------------------------------------------ shuffle

    #[test]
    fn shuffle_deterministik_dengan_seed_sama() {
        let build = || {
            let mut q = QueueManager::new(42);
            for i in 0..20 {
                q.add(track(&format!("t{i}")));
            }
            q.set_shuffle(true);
            ids(&q)
        };
        assert_eq!(build(), build(), "seed sama harus menghasilkan urutan sama");
    }

    #[test]
    fn shuffle_seed_beda_menghasilkan_urutan_beda() {
        let build = |seed| {
            let mut q = QueueManager::new(seed);
            for i in 0..20 {
                q.add_biasa(track(&format!("t{i}")));
            }
            q.set_shuffle(true);
            ids(&q)
        };
        assert_ne!(build(1), build(999));
    }

    #[test]
    fn shuffle_non_destruktif_urutan_asli_kembali() {
        let mut q = QueueManager::new(7);
        for id in ["a", "b", "c", "d", "e"] {
            q.add(track(id));
        }
        let asli = ids(&q);
        q.set_shuffle(true);
        q.advance();
        q.set_shuffle(false);
        assert_eq!(
            ids(&q),
            asli,
            "mematikan shuffle harus memulihkan urutan asli"
        );
    }

    #[test]
    fn shuffle_mempertahankan_lagu_aktif_di_depan() {
        let mut q = QueueManager::new(3);
        for i in 0..10 {
            q.add(track(&format!("t{i}")));
        }
        q.advance();
        q.advance(); // aktif = t2
        let aktif_sebelum = q.current().unwrap().track.video_id.clone();
        q.set_shuffle(true);
        assert_eq!(
            q.current().unwrap().track.video_id,
            aktif_sebelum,
            "menyalakan shuffle tidak boleh mengganti lagu yang sedang diputar"
        );
    }

    #[test]
    fn shuffle_tidak_kehilangan_atau_menggandakan_lagu() {
        let mut q = QueueManager::new(11);
        for i in 0..15 {
            q.add(track(&format!("t{i}")));
        }
        q.set_shuffle(true);
        let mut got = ids(&q);
        got.sort();
        let mut want: Vec<String> = (0..15).map(|i| format!("t{i}")).collect();
        want.sort();
        assert_eq!(got, want, "shuffle harus permutasi, bukan daftar baru");
    }

    #[test]
    fn lagu_baru_masuk_saat_shuffle_tidak_selalu_di_akhir() {
        // Kalau lagu baru selalu ditaruh di akhir, antrean terasa "belakangan
        // melulu" saat shuffle hidup. Cek lintas beberapa seed.
        let mut posisi: Vec<usize> = Vec::new();
        for seed in 1..25u64 {
            let mut q = QueueManager::new(seed * 7919);
            for i in 0..10 {
                q.add_biasa(track(&format!("t{i}")));
            }
            q.set_shuffle(true);
            q.add_biasa(track("baru"));
            posisi.push(ids(&q).iter().position(|x| x == "baru").unwrap());
        }
        assert!(
            !posisi.iter().all(|&p| p == 10),
            "lagu baru tidak boleh selalu di posisi terakhir"
        );
    }

    #[test]
    fn lagu_baru_saat_shuffle_tidak_menyisipkan_sebelum_lagu_aktif() {
        // Menyisipkan di depan lagu yang sedang diputar berarti lagu itu tidak
        // akan pernah diputar berikutnya — itu bug, bukan kejutan menyenangkan.
        for seed in 1..15u64 {
            let mut q = QueueManager::new(seed * 104_729);
            for i in 0..8 {
                q.add_biasa(track(&format!("t{i}")));
            }
            q.set_shuffle(true);
            q.advance(); // cursor maju di dalam order
            q.add_biasa(track("baru"));
            let p = ids(&q).iter().position(|x| x == "baru").unwrap();
            assert!(
                p > q.cursor(),
                "lagu baru (pos {p}) tidak boleh di depan cursor {}",
                q.cursor()
            );
        }
    }

    // ---------------------------------------------------------- pemulihan

    #[test]
    fn restore_mengembalikan_urutan_dan_lagu_aktif() {
        let mut asli = QueueManager::new(1);
        for id in ["a", "b", "c"] {
            asli.add(track(id));
        }
        asli.advance(); // aktif = b

        let items = asli.items().to_vec();
        let q = QueueManager::restore(items, 1, false, RepeatMode::Off);
        assert_eq!(ids(&q), vec!["a", "b", "c"]);
        assert_eq!(q.current().unwrap().track.video_id, "b");
        assert_eq!(q.repeat(), RepeatMode::Off);
    }

    #[test]
    fn restore_dengan_cursor_di_luar_batas_aman() {
        let mut asli = QueueManager::new(1);
        asli.add(track("a"));
        let q = QueueManager::restore(asli.items().to_vec(), 99, false, RepeatMode::Off);
        assert_eq!(q.current().unwrap().track.video_id, "a");
    }

    #[test]
    fn restore_antrean_kosong_aman() {
        let mut q = QueueManager::restore(vec![], 0, true, RepeatMode::All);
        assert!(q.is_empty());
        assert!(q.current().is_none());
        assert!(q.advance().is_none());
    }

    #[test]
    fn restore_dengan_shuffle_menjaga_semua_lagu() {
        let mut asli = QueueManager::new(1);
        for id in ["a", "b", "c", "d"] {
            asli.add(track(id));
        }
        asli.advance();
        let q = QueueManager::restore(asli.items().to_vec(), 1, true, RepeatMode::Off);
        assert_eq!(q.len(), 4);
        let mut got = ids(&q);
        got.sort();
        assert_eq!(got, vec!["a", "b", "c", "d"]);
        assert_eq!(
            q.current().unwrap().track.video_id,
            "b",
            "lagu aktif yang tersimpan harus tetap aktif setelah shuffle"
        );
    }

    #[test]
    fn original_order_naik_monoton_dan_bertahan_setelah_hapus() {
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        q.add(track("c"));
        q.remove(0);
        q.add(track("d"));
        // original_order tidak boleh dipakai ulang setelah penghapusan, kalau
        // tidak pemulihan urutan bisa kacau.
        let orders: Vec<i64> = q.items().iter().map(|i| i.original_order).collect();
        let mut sorted = orders.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(orders.len(), sorted.len(), "original_order harus unik");
    }

    #[test]
    fn replace_mengganti_antrean_dan_mulai_dari_indeks() {
        let mut q = QueueManager::new(1);
        q.add(track("lama"));
        q.replace(vec![track("a"), track("b"), track("c"), track("d")], 2);
        assert_eq!(ids(&q), vec!["a", "b", "c", "d"]);
        assert_eq!(q.cursor(), 2);
        assert_eq!(q.current().unwrap().track.video_id, "c");
        assert_eq!(q.advance().unwrap().track.video_id, "d");
    }

    #[test]
    fn replace_dengan_shuffle_menaruh_lagu_pilihan_di_awal() {
        let mut q = QueueManager::new(42);
        q.set_shuffle(true);
        let list: Vec<Track> = (0..10).map(|i| track(&format!("t{i}"))).collect();
        q.replace(list, 6);
        assert_eq!(q.cursor(), 0);
        assert_eq!(
            q.current().unwrap().track.video_id,
            "t6",
            "lagu yang diklik harus diputar pertama walau shuffle aktif"
        );
        let mut got = ids(&q);
        got.sort();
        let mut want: Vec<String> = (0..10).map(|i| format!("t{i}")).collect();
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn replace_kosong_dan_indeks_di_luar_batas_aman() {
        let mut q = QueueManager::new(1);
        q.replace(vec![track("a"), track("b")], 99);
        assert_eq!(q.current().unwrap().track.video_id, "b");

        q.replace(vec![], 0);
        assert!(q.is_empty());
        assert!(q.current().is_none());
    }
    /// Regresi: cursor yang disimpan adalah posisi di `order`, bukan indeks
    /// `items`. Saat shuffle aktif keduanya BERBEDA, jadi memulihkan dengan
    /// `cursor.min(items.len())` menunjuk lagu yang salah — antrean terlihat
    /// "balik ke awal" padahal sebenarnya menunjuk indeks yang salah.
    #[test]
    fn restore_dengan_shuffle_memulihkan_lagu_yang_sama() {
        let mut q = QueueManager::new(7);
        for i in 0..10 {
            q.add(track(&format!("l{i}")));
        }
        q.set_shuffle(true);
        // Maju tiga lagu di urutan shuffle.
        q.advance();
        q.advance();
        q.advance();
        let lagu_aktif = q.current().unwrap().track.video_id.clone();
        let cursor_tersimpan = q.cursor();
        let items_tersimpan = q.items().to_vec();

        // Simulasi simpan -> muat ulang.
        let q2 = QueueManager::restore(items_tersimpan, cursor_tersimpan, true, RepeatMode::Off);
        assert_eq!(
            q2.current().map(|i| i.track.video_id.clone()),
            Some(lagu_aktif.clone()),
            "setelah dipulihkan, lagu aktif harus sama (cursor {} menunjuk lagu yang salah)",
            cursor_tersimpan
        );
    }

    /// Fitur antrean prioritas: lagu yang pengguna tambahkan sendiri harus
    /// diputar sebelum lagu playlist, walau shuffle menyala.
    #[test]
    fn prioritas_didahului_walau_shuffle() {
        let mut q = QueueManager::new(42);
        // Isi dari playlist (bukan prioritas).
        q.replace(
            (0..8).map(|i| track(&format!("pl{i}"))).collect(),
            0,
        );
        q.set_shuffle(true);
        // Pengguna menambahkan dua lagu sendiri, berurutan.
        q.add(track("pilihA"));
        q.add(track("pilihB"));

        let urut = ids(&q);
        assert_eq!(urut[0], "pl0", "lagu aktif tetap di depan");
        assert_eq!(urut[1], "pilihA", "prioritas pertama didahulukan");
        assert_eq!(urut[2], "pilihB", "prioritas kedua setelah yang pertama");
        assert!(
            urut[3..].iter().all(|s| s.starts_with("pl")),
            "sisanya lagu playlist yang diacak: {:?}",
            &urut[3..]
        );
    }

    /// Menyalakan shuffle lagi tidak boleh mengacak lagu prioritas.
    #[test]
    fn shuffle_ulang_tetap_mendahului_prioritas() {
        let mut q = QueueManager::new(9);
        q.replace((0..6).map(|i| track(&format!("pl{i}"))).collect(), 0);
        q.add(track("pilihA"));
        q.add(track("pilihB"));
        q.set_shuffle(true);
        q.advance(); // pindah ke pilihA
        // Nyalakan ulang shuffle tanpa melewati mode mati: yang diuji adalah
        // apakah prioritas tetap berurutan, bukan perilaku shuffle-off.
        q.set_shuffle(true);
        q.enable_shuffle();

        let urut = ids(&q);
        assert_eq!(urut[0], "pilihA");
        assert_eq!(urut[1], "pilihB", "prioritas tetap berurutan setelah shuffle ulang");
    }

    /// Isi playlist (replace) BUKAN prioritas — itu lagu yang boleh diacak.
    #[test]
    fn replace_tidak_menandai_prioritas() {
        let mut q = QueueManager::new(1);
        q.replace(vec![track("a"), track("b")], 0);
        assert!(q.items().iter().all(|i| !i.prioritas));
        q.add(track("c"));
        assert!(q.items().last().unwrap().prioritas);
    }

}