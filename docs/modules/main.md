# `main.js` — app wiring

> **Türkçe özet:** Giriş noktası (~1800 satır). Ayar şeması ve alan üretimi, baskı seçenekleri ve önizleme, gölge uyumu ve detay iyileştirme, dışa aktarma (biçim seçimi + ışık parçası sorusu), fotoğraf penceresi, model karşılaştırma, çalışma alanları, kaydet/aç, geri al, menüler, sürükle-bırak.

Layer: **UI**. Sets no global; everything is inside one IIFE. Find code by the `// ---------- <section> ----------` headers (Turkish):

| Section header | What is there |
|---|---|
| `ayar şeması` | `SCHEMA` (all settings by panel: `shadow`, `body`, `support`, `print`, `room`, `compare`), `makeField`, `updateVisibility`, `fire(el)` |
| `kayıt durumu` | `STATE_IDS`, `readState`, `writeState` |
| `şekle özel alanlar` | `PARAM_LABELS`, `updateShapeControls` (hides params, removes "flat" for non-faceted shapes) |
| `baskı seçenekleri + sahne` | `printOpts(assembled)`, `schedulePreview`, `rebuildPreview` (buildLamp ×2, validatePrint, `geo.buildScene`) |
| `gölge uyumu + detay iyileştirme` | `updateAccuracy`, print status bar (`updatePrintStatus`, hidden without a silhouette), message log, `detailLimitHtml`, `optimizeDetail` |
| `görünüm modları + araç çubuğu` | `setView`, `syncTools`, bed/room toolbar |
| `durum kartı` | `showStatus(html, warnings)`, `escapeHtml` |
| `STL` | `downloadBlob` (Downloads via `appAPI.saveFile`, or browser download), format select (`localStorage.exportFormat`), export modal (`askExport` → `downloadModel(format, withLight)`) |
| `şekil önerisi` | `applySuggestion` |
| `tasarımcı` | `Designer.init` with `simCanvas` / `maskCanvas` |
| `fotoğraf → siluet` | photo modal: `runSilhouette`, `loadPhotoFile`, detail boxes, add/remove brush, hint undo |
| `model karşılaştırma` | `loadCompareFile` (`ModelImport.load`), `applyCompare`, `updateCompareStats` |
| `Siluet Editörü ve Görsel Dönüştürücü` | `setWorkspace('lamp' | 'editor' | 'convert')`, lazy init of editor / converter |
| `kaydet / aç` | `buildPayload`, `applyPayload` (v1/v2 migrations), save-as / open modals, toast |
| `belge durumu` | dirty flag, recent list, `newDesign`, import/export `.json` |
| `lamba geri al / yinele` | `history` (debounced snapshots of settings + target PNG, 40 levels), `window.onWallFieldUpdated` chain, `window.onLookUpdated`, room toolbar sync |
| `menü çubuğu ve kısayollar` | `MENUS` (Dosya, Düzen, Görünüm, Araçlar, Yardım), `Inspector.init` |
| `yardım pencereleri` | `EXTRA_KEYS`, `showHelp('keys' | 'guide' | 'about')` |
| `sürükle-bırak ve yapıştırma` | `fileKind`, `handleFile` (image → photo window or open converter; `.json` → design; model → compare), paste |
| (end) | status bar names/hints per workspace, `beforeunload`, first status card |

## Flows

- **Setting change:** input event → `designer.recompute()` (field settings) or `schedulePreview()` (mesh settings) or `relook()` (look settings) → `onWallFieldUpdated` → `rebuildPreview` + `updateAccuracy` + `history.schedule` + `inspector.sync`.
- **Photo:** "Fotoğraf yükle" / drop / paste → `loadPhotoFile` → `runSilhouette` → "Silueti kullan" → `designer.loadSilhouetteImage` → placement → `applyCrop` → recompute.
- **Export:** button / `Ctrl+E` / Dosya → Farklı biçimde indir → `askExport` modal (light parts unchecked) → `downloadModel` → `buildLamp(printOpts(false))` → filter `ModelExport.isLightPart` unless chosen → `ModelExport.exportMeshes` → `downloadBlob`.
- **Save/open:** `buildPayload` / `applyPayload` through `DesignStorage`; recent list in `localStorage['shadowlamp.recent']`.

## Pitfalls

- `setWorkspace` is wrapped at the end of the file (status bar text). Call the wrapped name.
- `window.onWallFieldUpdated` is wrapped once in the preview section and again in the history section; extend the chain, don't replace it.
- Menu shortcuts must be unique per workspace; check `MENUS` and `EXTRA_KEYS` before adding one.
- The file is large. Prefer adding a new DOM-free helper in the right module over growing `main.js`.
