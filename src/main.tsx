import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Font self-host lewat @fontsource: di-bundle dari node_modules, BUKAN dari CDN,
// supaya aplikasi tetap benar saat offline (DESIGN-ENDFIELD §4).
// Hanya bobot yang benar-benar dipakai, supaya bundle tidak membengkak.
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { App } from "./app/App";
import "./styles/global.css";
import { applyStoredTheme } from "./lib/theme";

// Terapkan tema tersimpan SEBELUM render pertama supaya tidak ada kedipan
// warna salah saat aplikasi dibuka.
applyStoredTheme();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root tidak ditemukan di index.html");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
