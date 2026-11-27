//! Local HTTP Loopback Server untuk OAuth Callback (Fase 6 Cloud Sync).
//!
//! Mendengarkan di `http://127.0.0.1:3000` saat proses login Google/OAuth berjalan.
//! Mengambil `#access_token` dan `refresh_token`, mengoper ke frontend via Tauri event,
//! lalu menyajikan halaman HTML "Login Berhasil, silakan kembali ke Kaset".

use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

static RUNNING_SERVER: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::const_new(None);

/// Membaca satu HTTP request secara utuh hingga batas header dan seluruh Content-Length terbaca.
async fn read_http_request(stream: &mut TcpStream) -> Result<String, std::io::Error> {
    let mut data = Vec::with_capacity(4096);
    let mut buf = [0u8; 1024];

    // 1. Baca sampai "\r\n\r\n" (akhir header)
    let mut header_end = None;
    while header_end.is_none() {
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = Some(pos + 4);
        }
        if data.len() > 32 * 1024 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "HTTP request header terlalu besar",
            ));
        }
    }

    let end_pos = match header_end {
        Some(pos) => pos,
        None => return Ok(String::from_utf8_lossy(&data).to_string()),
    };

    let header_str = String::from_utf8_lossy(&data[..end_pos]).to_string();
    let mut content_length: usize = 0;
    for line in header_str.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                if let Ok(len) = v.trim().parse::<usize>() {
                    content_length = len;
                }
            }
        }
    }

    // 2. Baca sisa body sesuai Content-Length
    let current_body_len = data.len() - end_pos;
    if current_body_len < content_length {
        let remaining = content_length - current_body_len;
        let mut body_buf = vec![0u8; remaining];
        stream.read_exact(&mut body_buf).await?;
        data.extend_from_slice(&body_buf);
    }

    Ok(String::from_utf8_lossy(&data).to_string())
}

/// Mulai loopback listener di port 3000 (jika belum berjalan).
pub async fn start_oauth_listener(app: AppHandle) -> Result<(), String> {
    let mut lock = RUNNING_SERVER.lock().await;
    if lock.is_some() {
        return Ok(()); // Sudah berjalan
    }

    let addr: SocketAddr = "127.0.0.1:3000".parse().unwrap();
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => return Err(format!("Gagal membuka port 3000: {e}")),
    };

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    *lock = Some(shutdown_tx);

    let app_clone = Arc::new(app);

    tokio::spawn(async move {
        tracing::info!("OAuth local server mendengarkan di http://127.0.0.1:3000");

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    tracing::info!("OAuth local server dihentikan.");
                    break;
                }
                accept_res = listener.accept() => {
                    let (mut stream, _) = match accept_res {
                        Ok(pair) => pair,
                        Err(_) => continue,
                    };

                    let req = match tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        read_http_request(&mut stream),
                    ).await {
                        Ok(Ok(r)) => r,
                        _ => continue,
                    };

                    // Jika ini adalah request POST yang membawa hash fragment via JavaScript
                    if req.starts_with("POST /callback") {
                        if let Some(body_start) = req.find("\r\n\r\n") {
                            let body = &req[body_start + 4..];
                            let _ = app_clone.emit("oauth://token", body.trim().to_string());

                            // Bawa jendela Kaset ke depan
                            if let Some(w) = app_clone.get_webview_window("main") {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }

                        let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\nOK";
                        let _ = stream.write_all(resp.as_bytes()).await;
                        continue;
                    }

                    // Halaman landing pertama untuk menangkap `#access_token` di URL fragment
                    let html = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Kaset — Login Berhasil</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0c0d0e; color: #e5e5e5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
        .card { background: #141517; border: 1px solid #ffcc00; padding: 40px; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); max-width: 440px; }
        h1 { font-size: 18px; color: #ffcc00; margin-bottom: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
        p { font-size: 13px; color: #888; margin: 0; line-height: 1.6; }
        #status { margin-top: 15px; font-size: 12px; color: #ffcc00; font-family: monospace; }
    </style>
</head>
<body>
    <div class="card">
        <h1>// LOGIN BERHASIL</h1>
        <p>Autentikasi Google berhasil diterima oleh aplikasi <b>Kaset</b>.</p>
        <div id="status">Menyambungkan ke aplikasi Kaset...</div>
        <p style="margin-top: 15px; color: #666; font-size: 12px;">Kamu bisa menutup tab ini dan kembali ke aplikasi Kaset.</p>
    </div>
    <script>
        const hash = window.location.hash.substring(1);
        if (hash) {
            fetch('/callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hash })
            }).then(() => {
                document.getElementById('status').innerText = '✓ Terhubung! Silakan kembali ke Kaset.';
                setTimeout(() => { window.close(); }, 1200);
            }).catch(() => {
                document.getElementById('status').innerText = 'Gagal mengirim ke Kaset. Coba kembali ke aplikasi.';
            });
        }
    </script>
</body>
</html>"#;

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                }
            }
        }

        let mut lock = RUNNING_SERVER.lock().await;
        *lock = None;
    });

    Ok(())
}
