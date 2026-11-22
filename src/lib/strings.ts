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
  menyimpan: "MENYIMPAN…",
  buat: "BUAT",
  tutup: "Tutup",
  hapus: "HAPUS",
  gantiNama: "GANTI NAMA",
  detailCover: "DETAIL & COVER",
  baru: "+ BARU",
  baruPlaylist: "Playlist baru",
  memuat: "MEMUAT…",
  gagal: "GAGAL",
  standby: "STANDBY",

  // Pencarian
  cariPlaceholder: "Cari lagu, artis, atau album",
  labelKataKunci: "Kata kunci pencarian",
  sedangMencari: "Mencari…",
  pencarianGagal: "Pencarian gagal",
  tidakAdaHasil: "TIDAK ADA HASIL",
  tidakAdaHasilHint: "Coba kata kunci lain.",
  mulaiDariSini: "MULAI DARI SINI",
  saranPencarian: "Saran pencarian",
  mencariSaran: "mencari saran…",
  berapaKaliDicari: "Berapa kali dicari",
  hapusDariRiwayat: "Hapus dari riwayat",
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
  bukaPemutarPenuh: "Buka pemutar penuh",
  tutupPemutarPenuh: "Tutup pemutar penuh",
  pilihLaguDariCari: "Pilih lagu dari Cari.",
  antreanKosongFullHint: "Lagu yang kamu putar akan muncul di sini.",

  // Antrean & Panel Kanan
  antrean: "ANTREAN",
  antreanKosong: "ANTREAN KOSONG",
  antreanKosongHint: "Tambahkan lagu dari hasil pencarian atau playlist.",
  sedangDiputar: "SEDANG DIPUTAR",
  berikutnya: "BERIKUTNYA",
  kosongkan: "KOSONGKAN",
  konfirmasiKosongkanAntrean: "Kosongkan seluruh antrean pemutaran?",
  tidakAdaBerikutnya: "Tidak ada lagu setelah ini.",
  hapusDariAntrean: "Hapus dari antrean",
  tutupPanel: "Tutup panel",
  item: "ITEM",
  memutar: "MEMUTAR",
  dijeda: "DIJEDA",
  belumAdaLaguHint: "Pilih lagu dari pencarian atau playlist untuk mulai memutar.",
  bukaSedangDiputar: "Lihat detail sedang diputar",
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
  koleksiDipin: "KOLEKSI · DIPIN",
  playlist: "PLAYLIST",
  favorit: "FAVORIT",
  riwayat: "RIWAYAT",
  riwayatPutar: "RIWAYAT PUTAR",
  hapusRiwayatSemua: "HAPUS RIWAYAT",
  konfirmasiHapusRiwayat: "Hapus seluruh riwayat putar?",
  belumAdaFavorit: "BELUM ADA FAVORIT",
  belumAdaPlaylist: "BELUM ADA PLAYLIST",
  belumAdaPlaylistSidebar: "Belum ada playlist. Tekan + BARU.",
  namaPlaylistBaru: "Nama playlist baru",
  menuPlaylist: (nama: string) => `Menu playlist ${nama}`,
  namaBaruUntuk: (nama: string) => `Nama baru untuk ${nama}`,
  konfirmasiHapusPlaylist: (nama: string) =>
    `Hapus playlist "${nama}"? Lagu di dalamnya tidak terhapus.`,
  hapusDariPlaylist: "Hapus dari playlist",
  hapusPlaylist: "Hapus playlist",
  noDataStandby: "NO DATA / STANDBY",
  playlistKosongHint: "Belum ada lagu di sini. Cari lagu untuk mulai mengisi.",
  favoritKosongHint: "Tandai hati pada lagu yang kamu suka untuk mengumpulkannya di sini.",
  cariLagu: "CARI LAGU",
  riwayatKosong: "RIWAYAT KOSONG",
  riwayatKosongHint: "Lagu yang kamu putar akan tercatat di sini.",
  lagu: "LAGU",
  laguTerakhir: "LAGU TERAKHIR",

  // Tabel lagu & urutan
  kolomJudul: "JUDUL",
  kolomAlbum: "ALBUM",
  kolomDurasi: "DURASI",
  urutkan: "Urutkan lagu",
  urutAsli: "URUTAN",
  urutJudul: "JUDUL",
  urutArtis: "ARTIS",
  urutDurasi: "DURASI",

  // Dialog playlist
  tambahKePlaylistCaps: "TAMBAH KE PLAYLIST",
  belumAdaPlaylistPicker: "Belum ada playlist. Buat satu di kolom bawah.",
  playlistBaruPlaceholder: "Playlist baru…",
  playlistBaruCaps: "PLAYLIST BARU",
  detailPlaylist: "Detail playlist",
  detailPlaylistCaps: "DETAIL PLAYLIST",
  labelNama: "NAMA",
  labelDeskripsi: "DESKRIPSI",
  opsional: "(opsional)",
  labelCover: "COVER",
  coverOtomatis: "OTOMATIS",
  coverOtomatisKet: "Mosaik 4 cover lagu pertama",
  coverUpload: "UPLOAD",
  coverUploadGantiKet: "Gambar sudah diunggah — pilih untuk mengganti",
  coverUploadPilihKet: "Pilih gambar dari disk (PNG/JPG/WebP)",
  coverGeneratif: "GENERATIF",
  coverGeneratifKet: "Pola dari inisial judul",
  hapusCover: "HAPUS COVER",
  errNamaPlaylistKosong: "Nama playlist tidak boleh kosong.",
  errGambarGagal: "Gambar gagal diproses. Coba file lain.",
  errCoverGagalHapus: "Cover gagal dihapus.",
  errGagalSimpan: "Gagal menyimpan.",

  // Pengaturan
  pengaturan: "PENGATURAN",
  pengaturanShell: "Shell",
  shellDesktop: "Tauri (desktop)",
  shellBrowser: "Browser (mock)",
  pengaturanKatalog: "Katalog",
  memeriksa: "Memeriksa…",
  katalogAktif: "YouTube Music (aktif)",
  katalogMock: "Mock (contoh)",
  katalogMockHint: "Pencarian masih memakai data contoh. Biasanya karena belum ada koneksi.",
  pengaturanLaguTersimpan: "Lagu tersimpan",
  laguTersimpanHint:
    "Metadata lagu yang sudah dikenal database. Wajib ada sebelum lagu bisa difavoritkan, masuk playlist, atau disimpan di antrean.",
  pengaturanPemutaran: "Pemutaran",
  pemutaranAktif: "Aktif (yt-dlp)",
  pemutaranBelumTersedia: "Belum tersedia",
  pemutaranHint:
    "Kaset mengunduh yt-dlp otomatis sekali saat pertama jalan. Kalau ini tetap begini, sambungkan internet lalu buka ulang aplikasi.",
  pengaturanTema: "Tema",
  temaTerang: "Terminal Kertas",
  temaGelap: "Terminal Malam",
  pengaturanData: "Data",
  dataLokal: "Lokal saja — tanpa server, tanpa telemetri.",
  pengaturanCadangan: "Cadangan",
  eksporJson: "EKSPOR JSON",
  imporJson: "IMPOR JSON",
  eksporBerhasil: "Cadangan JSON berhasil diunduh.",
  eksporGagal: "Gagal mengekspor library.",
  imporGagal: "Gagal mengimpor berkas JSON.",
  imporHasil: (fav: number, pl: number, tr: number) =>
    `Impor selesai: ${fav} favorit baru, ${pl} playlist baru, ${tr} lagu ditambahkan.`,
  cadanganHint:
    "Simpan favorit dan playlist sebagai berkas JSON untuk cadangan atau dipindah ke perangkat lain. Impor menggabungkan data tanpa menghapus yang sudah ada.",
  disclaimer:
    "Kaset adalah proyek pribadi/edukasi dan tidak berafiliasi dengan Google atau YouTube.",
} as const;
