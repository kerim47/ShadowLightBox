# electron — main process

> **Türkçe özet:** Pencere, güvenlik ayarları, tasarım dosyaları, dışa aktarma (İndirilenler'e pencere açmadan), uygulama içi dosya seçici ve yapay zeka arka plan silme (onnxruntime-node). Renderer bunlara yalnızca `preload.cjs` üzerinden `window.appAPI` ile ulaşır.

| File | Role |
|---|---|
| `main.cjs` | `BrowserWindow`, security hardening, all IPC handlers, model download + ONNX inference |
| `preload.cjs` | `contextBridge` → `window.appAPI` (the renderer's only door to Node) |
| `samples/zoro.json` | legacy **v1** design, copied into the user's designs folder on a fresh install (keeps the v1 load path tested by hand) |

## IPC (`window.appAPI` → channel)

| appAPI | Channel | Notes |
|---|---|---|
| `list/read/write/remove/exists/dataDir/reveal` | `designs:*` | JSON designs in `<userData>/designs/`; names through `safeName()`; ≤ 64 MB; content must parse as JSON |
| `saveFile(name, ArrayBuffer)` | `file:save` | writes into Downloads, unique name, extension must match `EXPORT_EXT` (`stl 3mf obj fbx ply glb svg png json`), ≤ 512 MB; returns the path |
| `revealFile(path)` | `file:reveal` | only for files directly in Downloads |
| `places/listDir/readFile` | `fs:places`, `fs:list`, `fs:read` | in-app picker; non-hidden entries; files must match `PICK_EXT`; ≤ 300 MB |
| `removeBackground(payload, onProgress)` | `bg:remove` + `bg:progress` events | `{ model, size, data: Float32Array(3·S²) }` validated exactly; returns the raw S² prediction or `{ fallback: 'u2netp' }` |
| `onSaveAndClose(fn)` | `app:save-and-close` | sent when the user picks "Kaydet ve çık" on close |
| `isDesktop` | — | `true` in the app; `storage.js` / `filepicker.js` / AI features check it |

## Rules

- Register every handler with `handle()` (checks the sender frame is the app page). Validate every argument in the main process.
- Security settings are deliberate: `contextIsolation`, `sandbox`, no `nodeIntegration`, navigation locked to the app page, no new windows/webviews, all permission requests denied, CSP in `index.html`.
- Linux: `--gtk-version=3` is forced and native file dialogs are never used (GTK crashes). `npm start` passes `--no-sandbox` (SUID sandbox).
- Models (`MODELS`): downloaded on first use to `<userData>/models/`, size-capped, **SHA-256 pinned** before loading. Changing a model URL means updating `bytes` and `sha256`.
- New export format → add its extension to `EXPORT_EXT`. New openable type → `PICK_EXT` and the MIME map in `renderer/src/filepicker.js`.
- Zoom keys (`Ctrl + = / − / 0`) are handled here in `before-input-event`, not in the renderer menu.
