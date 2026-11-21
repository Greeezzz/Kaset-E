/**
 * Semua teks yang dilihat user, di satu tempat.
 *
 * Alasannya bukan sekadar kerapian: sebelumnya UI mencampur bahasa
 * ("SEARCH" di sidebar, "KOSONGKAN" di antrean, "MULAI DARI SINI" di empty
 * state). Mengumpulkannya di sini membuat campuran itu terlihat sekilas, dan
 * nanti siap dilokalisasi tanpa menyisir seluruh komponen.
 *
 * Aturan: satu bahasa untuk label UI, yaitu Indonesia. Istilah yang lazim
 * dipakai apa adanya (Library, Playlist, Antrean) dibiarkan.
 */
export const T = {
  // Navigasi
  navCari: "CARI",
  navLibrary: "LIBRARY",
  navPengaturan: "PENGATURAN",

  // Umum
  cari: "CARI",
  batal: "BATAL",
  simpan: "SIMPAN",
  hapus: "HAPUS",
  gantiNama: "GANTI NAMA",
  baru: "+ BARU",
  memuat: "MEMUAT…",
  standby: "STANDBY",

  // Pencarian
  cariPlaceholder: "Cari lagu, artis, atau album",
  labelKataKunci: "Kata kunci pencarian",
  sedangMencari: "Mencari…",
  pencarianGagal: "Pencarian gagal",
  tidakAdaHasil: "TIDAK ADA HASIL",
  tidakAdaHasilHint: "Coba kata kunci lain.",
  saranPencarian: "Saran pencarian",
  hapusRiwayat: (q: string) => `Hapus riwayat ${q}`,
  hapusSemuaRiwayat: "Hapus semua riwayat",
  mulaiHint: "Ketik judul lagu atau nama artis, lalu tekan Cari. Panah bawah membuka riwayat.",

  // Pemutar
  putar: "Putar",
  jeda: "Jeda",
  laguBerikutnya: "Lagu berikutnya",
  laguSebelumnya: "Lagu sebelumnya",
  posisiPemutaran: "Posisi pemutaran",
  volume: "Volume",
  bisukan: "Bisukan",
  bunyikan: "Bunyikan",
  belumAdaLagu: "Belum ada lagu",

  // Antrean
  antrean: "ANTREAN",
  antreanKosong: "ANTREAN KOSONG",
  antreanKosongHint: "Tambahkan lagu dari hasil pencarian atau playlist.",
  sedangDiputar: "SEDANG DIPUTAR",
  berikutnya: "BERIKUTNYA",
  kosongkan: "KOSONGKAN",
  acak: "ACAK",
  repeat: "REPEAT",
  repeatOff: "REPEAT OFF",
  repeatAll: "REPEAT ALL",
  repeatOne: "REPEAT ONE",

  // Aksi per baris lagu
  putarBerikutnya: "Putar berikutnya",
  tambahKeAntrean: "Tambah ke antrean",
  tambahKePlaylist: "Tambah ke playlist",
  favoritkan: "Favoritkan",
  hapusDariFavorit: "Hapus dari favorit",
  aksiLain: "Aksi lain",

  // Library
  laguDisukai: "LAGU DISUKAI",
  playlist: "PLAYLIST",
  favorit: "FAVORIT",
  riwayat: "RIWAYAT",
  belumAdaFavorit: "BELUM ADA FAVORIT",
  belumAdaPlaylist: "BELUM ADA PLAYLIST",
  riwayatKosong: "RIWAYAT KOSONG",
  lagu: "LAGU",

  // Pengaturan
  pengaturan: "PENGATURAN",
} as const;
