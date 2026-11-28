import { describe, expect, it, vi } from "vitest";
import {
  FITUR_JENDELA_BARU,
  URL_KASETLYRIC,
  bukaTautanKasetLyric,
  urlKasetLyricValid,
  type PembukaTautan,
} from "./kasetlyric";

function pembuka(ubah: Partial<PembukaTautan> = {}): PembukaTautan {
  return {
    diTauri: false,
    bukaDiTauri: vi.fn().mockResolvedValue(undefined),
    bukaDiBrowser: vi.fn().mockReturnValue({}),
    ...ubah,
  };
}

describe("URL KasetLyric", () => {
  it("menunjuk ke situs KasetLyric", () => {
    expect(URL_KASETLYRIC).toBe("https://arimakaori.github.io/kasetlyric/");
    expect(urlKasetLyricValid()).toBe(true);
  });

  it("menolak protokol selain https", () => {
    expect(urlKasetLyricValid("http://arimakaori.github.io/kasetlyric/")).toBe(false);
  });

  it("menolak host lain", () => {
    expect(urlKasetLyricValid("https://contoh.example/kasetlyric/")).toBe(false);
  });

  it("menolak jalur lain di host yang sama", () => {
    expect(urlKasetLyricValid("https://arimakaori.github.io/")).toBe(false);
    expect(urlKasetLyricValid("https://arimakaori.github.io/proyek-lain/")).toBe(false);
  });

  it("menolak teks yang bukan URL", () => {
    expect(urlKasetLyricValid("bukan url")).toBe(false);
  });
});

describe("bukaTautanKasetLyric", () => {
  it("di Tauri memakai plugin opener dengan URL yang benar", async () => {
    const p = pembuka({ diTauri: true });
    await bukaTautanKasetLyric(p);

    expect(p.bukaDiTauri).toHaveBeenCalledTimes(1);
    expect(p.bukaDiTauri).toHaveBeenCalledWith(URL_KASETLYRIC);
    expect(p.bukaDiBrowser).not.toHaveBeenCalled();
  });

  it("di browser memakai window.open tanpa membocorkan opener", async () => {
    const p = pembuka({ diTauri: false });
    await bukaTautanKasetLyric(p);

    expect(FITUR_JENDELA_BARU).toBe("noopener,noreferrer");
    expect(p.bukaDiBrowser).toHaveBeenCalledWith(URL_KASETLYRIC, "_blank", FITUR_JENDELA_BARU);
    expect(p.bukaDiTauri).not.toHaveBeenCalled();
  });

  it("melempar error saat browser menolak membuka tab", async () => {
    const p = pembuka({
      bukaDiBrowser: vi.fn(() => {
        throw new Error("popup diblokir");
      }),
    });
    await expect(bukaTautanKasetLyric(p)).rejects.toThrow("popup diblokir");
  });

  it("meneruskan kegagalan dari Tauri supaya UI bisa menampilkan pesan", async () => {
    const p = pembuka({
      diTauri: true,
      bukaDiTauri: vi.fn().mockRejectedValue(new Error("izin ditolak")),
    });
    await expect(bukaTautanKasetLyric(p)).rejects.toThrow("izin ditolak");
  });
});
