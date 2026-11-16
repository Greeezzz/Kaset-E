# RESILIENCE — Kebijakan Resolver Stream

> Dokumen ini menutup celah `ARCHITECTURE.md` bagian 10: "ekstraktor: crate vs yt-dlp" dan perilaku saat resolver gagal. Bagian ini **bukan** keputusan akhir soal crate mana — itu diputuskan setelah uji ketahanan — tapi kontrak perilaku yang tidak boleh berubah apa pun implementasinya.

## 1. Kenapa Ini Penting

`StreamResolver` adalah komponen yang **pasti rusak berulang kali** seumur hidup proyek: YouTube mengubah signature, menambah PoToken, memblokir IP secara bertahap. Kalau kegagalannya tidak dikelola dengan rapi, gejalanya bukan "error yang jelas" tapi: lagu diam tanpa pesan, skip cepat dibanjiri request, IP kena throttle, dan tiap kegagalan terlihat seperti bug acak. Jadi kebijakan di bawah adalah bagian dari arsitektur, bukan polish belakangan.

## 2. Kontrak Perilaku Resolver

Semua implementasi `StreamResolver` **wajib** memenuhi:

1. **Hasil berumur pendek.** `ResolvedStream` membawa `expires_at`. URL stream YouTube kedaluwarsa dalam hitungan jam. **Jangan pernah menulis URL stream ke disk** — bukan hanya karena cepat basi, tapi karena ia berisi token sesi. Simpan di memori saja.
2. **Resolve ulang otomatis** ketika: `expires_at` lewat, atau play/seek mengembalikan error HTTP 403/410.
3. **Hasil idempoten untuk lagu sama dalam jendela singkat.** Resolve `video_id` yang sama dua kali dalam <60 detik mengembalikan hasil yang sama dari cache memori (hindari double-request saat prefetch dan play bertabrakan).
4. **Tidak pernah resolve paralel untuk lagu yang sama** (dedupe in-flight), dan jumlah resolve paralel lintas lagu dibatasi (`Semaphore` max **1** untuk lagu aktif + prefetch; naik ke 2 hanya kalau uji ketahanan membuktikan aman).

## 3. Backoff dan Retry

- **Exponential backoff + jitter.** Kegagalan berturut-turut: jeda `base * 2^(n-1)`, base 800 ms, cap 30 detik, jitter ±30% (jitter wajib supaya tidak menabrak serentak setelah outage YouTube).
- **Klasifikasi error** — jangan retry semuanya:
  - *Transient* (timeout, 5xx, network): retry dengan backoff.
  - *Rate-limit* (429 / ciri throttle): jeda panjang, tambah ke 60 detik + backoff.
  - *Permanen* (video dihapus, privat, geo-block): **jangan retry**, langsung tandai lagu `unavailable` dan skip.
  - *Perlu update* (signature berubah, PoToken diminta): berhenti retry, tampilkan pesan "extractor perlu diperbarui", jangan spam request.
- **Retry per lagu maksimal 2×**, lalu skip ke lagu berikutnya. Ini yang di `MVP.md` disebut "retry, lalu skip" — di sini detailnya.

## 4. Circuit Breaker

Tiga status, supaya outage YouTube tidak membuat aplikasi nembak ribuan request gagal:

- **Closed** (normal): request lewat.
- **Open**: setelah **5 kegagalan transient berturut-turut dalam 60 detik**. Semua resolve langsung gagal-cepat tanpa menyentuh jaringan. UI: "Sedang tidak bisa memutar, coba lagi sebentar".
- **Half-open**: setelah cooldown 60 detik, izinkan **1** request percobaan. Sukses → Closed. Gagal → Open lagi, cooldown digandakan (cap 5 menit).

Circuit breaker status ditampilkan halus di Settings → Diagnostik (bukan di muka pemutaran).

## 5. Rate Limiting dan Prefetch

- **Jarak minimal antar resolve** ke host yang sama: 1,5 detik (mencegah pola "user spam next" memicu throttle).
- **Prefetch** 20 detik sebelum lagu selesai (sesuai `ARCHITECTURE.md`), tapi prefetch **tidak boleh mencuri slot** dari resolve lagu aktif. Kalau slot sempit, lagu aktif menang.
- Kalau user skip lebih cepat dari interval minimal, request di-*coalesce*: hanya lagu yang akhirnya benar-benar diputar yang di-resolve, sisanya dibatalkan sebelum dikirim. Ini mencegah satu sesi skip 30 lagu mengirim 30 request.

## 6. Telemetri Lokal (bukan kirim ke mana-mana)

Supaya kegagalan bisa didiagnosis, catat **lokal** di log file (rotasi 5 MB × 3):

```
[ts] resolve video_id=... attempt=1 outcome=429 latency=812ms breaker=closed
```

Yang **tidak boleh** dicatat: URL stream penuh (token sesi), cookie, isi tanggapan mentah. Yang **boleh**: video_id, kode status, latensi, status breaker, jenis error.

## 7. Urutan Implementasi Terkait

Kebijakan ini baru bisa diuji setelah ada implementasi resolver nyata. Urutannya:

1. Fase 0: mock resolver yang **sengaja** bisa disuruh gagal (untuk menguji backoff/breaker tanpa internet).
2. Fase 1: implementasi nyata + unit test untuk backoff, klasifikasi error, dan transisi circuit breaker.
3. Uji ketahanan manual: skip 30 lagu berturut-turut sambil memantau log, pastikan tidak ada banjir request.
