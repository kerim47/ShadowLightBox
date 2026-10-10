# renderer — page shell

> **Türkçe özet:** `index.html` statik sayfa iskeleti (üst çubuk, yan paneller, 3B görünüm, pencereler, betik sırası) ve `src/` içindeki modüller. Ayar alanları HTML'de değil, `main.js` şemasından üretilir.

- `index.html`: static layout only. Settings fields are **generated** from `SCHEMA` in `src/main.js` into the empty `#fields-<panel>` containers; don't hand-write setting inputs here.
  - Top bar: brand, `#menubar`, workspace switch (`Lamba`, `Siluet Editörü`; the converter is opened from the Araçlar menu), current design name, export format `<select id="wf-format">` + `#wf-stl` download button.
  - Lamp workspace: `.sidebar` panels (`silhouette`, `shadow`, `body`, `support`, `print`, `room`, `compare`, `wall`) and the `#three-wrap` viewport (view switch, status card, print status, toolbar incl. room-only LED colour `#t-lcolor` and intensity `#t-lbright`).
  - Workspace hosts filled by JS: `#editor`, `#converter`.
  - Modals: `#modal-photo`, `#modal-export` (light-parts question), `#modal-saveas`, `#modal-open`; plus `#msg-panel`, `#drop-overlay`, status bar.
  - CSP: scripts only from `'self'`; no inline scripts. Keep it that way.
  - **Script order matters:** three.js r128 + loaders (+ `fflate`) first, then `src/*.js`, `main.js` last. A module may only use globals of earlier scripts at load time.
- `src/styles.css`: dark editor theme; colours from `:root` tokens; sections marked `/* ---------- name ---------- */` (layout, panels, fields, modals, editor, converter, menu bar, status bar, help, Inspector, file picker). Responsive breakpoints at 860 px and 1100 px.
- `src/`: all modules — see `src/CLAUDE.md`.
