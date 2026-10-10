# Design rules

> **Türkçe özet:** Bu dosya kod yazarken uyulacak kuralları toplar: modül sınırları, veri sözleşmeleri, birimler, arayüz metni, performans, test ve belge güncelleme kuralları. Bir değişikliğe başlamadan önce ilgili bölümü okuyun; değişiklikten sonra en alttaki kontrol listesini uygulayın.

Read this when you are about to change code. `AGENTS.md` has the short list of invariants; this file explains each rule, why it exists, and how to follow it. Algorithms are in `ARCHITECTURE.md`; per-module APIs are in `docs/modules/`.

## 1. Module boundaries

### 1.1 Three layers

| Layer | Modules | May use | Must not use |
|---|---|---|---|
| **Core** (pure, tested in Node) | `shapes`, `projection`, `wall_field`, `shell_mesher`, `exporters`, `stencil` | each other, `THREE.ShapeUtils` (shell_mesher only), `globalThis.fflate` if present (exporters) | `document`, `window` APIs, canvas, `localStorage`, `appAPI` |
| **Services** (DOM, no layout of their own) | `silhouette`, `designer`, `geometry`, `model_import`, `storage`, `filepicker` | core, canvas, three.js, `appAPI` | other services' internals; `main.js` state |
| **UI** | `main`, `editor`, `converter`, `menubar`, `inspector`, `helptips`, `index.html`, `styles.css` | everything below | — |

- A core module that touches the DOM breaks `npm test` (Node has no `document`). If a core algorithm needs pixels, take an `RGBA Uint8ClampedArray` + size as input, never a canvas.
- Core modules end with `})(typeof window !== 'undefined' ? window : globalThis);`. DOM modules end with `})(window);`.
- Services talk to the UI only through **hooks passed at init** (`Designer.init(refs)`, `ImageConverter.init(host, hooks)`, `SilhouetteEditor.init(host, hooks)`, `Inspector.init(hooks)`) or through the two window callbacks `window.onWallFieldUpdated` / `window.onLookUpdated`. Don't add new globals for cross-module calls.

### 1.2 One global per file

- Every `renderer/src/*.js` is an IIFE that sets exactly one global (`Shapes`, `Projection`, `WallField`, `ShellMesher`, `ModelExport`, `Silhouette`, `Stencil`, `Designer`, `Geometry`, `ModelImport`, `DesignStorage`, `FilePicker`, `SilhouetteEditor`, `ImageConverter`, `HelpTips`, `Inspector`, `MenuBar`). `main.js` sets none.
- Load order is the `<script>` order in `renderer/index.html`. A module may reference another global **at call time** before that script loads, but not at load time. When you add a file, add its `<script>` before its first load-time user and list it in the code map in `AGENTS.md`.
- No bundler, no `import`/`export`, no npm packages in the renderer except three.js r128 files from `node_modules/three` (pinned `0.128.0`). Don't upgrade three: `examples/js` was removed in later versions.

### 1.3 Single source of truth

| Fact | Lives in | Everyone else |
|---|---|---|
| Body outline, arc length, normals | `Shapes.make()` | calls `shape.pointAt/normalAt/hitAngle` |
| Wall ↔ room-wall mapping | `Projection.forwardShell/inverseShell` | never re-derives the formula |
| What is lit / solid | the final field `F` from `WallField.compute` | samples it with `WallField.sampleField` |
| Settings and defaults | `SCHEMA` in `main.js` | reads DOM inputs by id |
| Which meshes are "light parts" | `ModelExport.isLightPart` | (`geometry.js` still has its own regexes — see `KNOWN_ISSUES.md`) |
| Allowed export / pick extensions | `EXPORT_EXT` / `PICK_EXT` in `electron/main.cjs` | renderer must stay within them |

## 2. Data contracts

### 2.1 Units and coordinates

- **cm** for lamp geometry, UI geometry fields, the target frame and everything in `shapes`, `projection`, `wall_field`, `designer`, `geometry` scene units.
- **mm** for meshes, STL/3MF/OBJ/PLY/FBX output, and print settings in the UI (thickness, plate, seat, bed). `ShellMesher` converts with `MM = 10`. GLB is the exception: metres, Y-up (glTF spec).
- Lamp frame: room wall is `z = 0`, body in `z ∈ [0, d]`, LED at `(0, 0, cz)`, `+Y` up on the wall. The outline polygon is the wall's mid-surface at `z = 0`.
- Target image: `N = 2048` square covering `[-R, R]²` cm. Row 0 is the top (`+Y`). Pixel → cm: `X = ((px + 0.5)/N − 0.5)·2R`, `Y = (0.5 − (py + 0.5)/N)·2R`. Use these exact expressions; off-by-half-pixel errors show up as shifted shadows.
- Name variables with their unit when it is not cm (`czmm`, `bedMM`, `minLineMm`, `cellMm`).

### 2.2 Images and masks

| Thing | Convention |
|---|---|
| Target canvas (designer) | white = lit, black = shadow, **anti-aliased** edges kept on purpose |
| `outsideLit` | true: area outside the target frame is lit (silhouettes). false: dark (legacy v1, inverted designs) |
| Silhouette mask `{ w, h, data }` | `1` = subject = casts shadow |
| Stencil mask (converter) | `1` = shadow = material on the lamp wall |
| Wall field `F` | `0..1`, **`> 0.5` = lit = hole**, `≤ 0.5` = solid |
| Editor paint layer | `0` none, `1` shadow, `2` light |

When you convert between these, write the conversion next to a comment that says which convention each side uses. Most past bugs here were inverted masks.

### 2.3 Meshes

`{ name: string, positions: Float32Array (mm), indices: Uint32Array, previewOnly?: true }`

- Watertight: every directed edge appears once and its reverse once; positive volume (outward CCW). The mesher keys vertices by grid corner / grid edge. Never emit duplicate vertices at a shared position inside one surface, and never create T-junctions.
- `previewOnly` meshes (the glass tube) are for the 3D view only. Every exporter must drop them (`printable()` in `exporters.js`, `filter` in `toBinarySTL`).
- Names are part of the contract: `shell`, `panel-N`, `panel-N-layer`, `base-plate`, `tube-holder`, `tube-cap*`, `cap`, `cap-lip`, `led-tube`, `led-cup`, `tube-glass`. UI code groups parts by these prefixes; renaming a part means updating `ModelExport.isLightPart`, `geometry.js` (`isCap`, `compareStats`), `printGroupsText` in `main.js` and the tests.

### 2.4 Design file

`{ version: 2, sliders: { [settingId]: value }, outsideLit: boolean, targetImage: dataURL }`

- `sliders` holds every `SCHEMA` id except `c-*` (compare panel) plus `wf-autoshape` (`STATE_IDS`).
- New settings are optional on load: an old file without the id keeps the field's default. Never require a new key.
- v1 files (no `version` or `< 2`) must keep opening: rectangle body, cap mount, no ribs, `outsideLit = false`. v2 files without `g-mount` predate the tube mount and open as cap mount. Single `g-bed` maps to `g-bedx/y/z`. These migrations live in `applyPayload()`; extend that function, don't fork it.

## 3. Settings

A setting is one `SCHEMA` entry in `main.js`: `{ id, label, unit?, type? ('num'|'select'|'check'|'color'), min, max, step, value, options?, swatches?, showIf?, note?, param? }`.

Id prefixes say which panel it belongs to: `d-` shadow, `s-` body, `g-` print/support, `l-` dark room, `c-` model compare (not saved). Then wire it by what it affects:

| It affects | Also do |
|---|---|
| The wall field (what is cut) | read it in `designer.readParams()`; add the id to the `recompute` listener list in `designer.js`; extend `getPrintGeometry().key` if the converter's print map depends on it |
| Only meshes | read it in `printOpts()` in `main.js`; add it to the `schedulePreview` listener list |
| Only the room look | read it in `readParams().look`; add it to the `relook` list in `designer.js`; consume it in `geometry.applyLook()` |
| Body shape params (`s-W/H/N/A`) | `Shapes.CATALOG[kind].params` and `PARAM_LABELS` |

- Explanations go in `note`. `HelpTips.compact` turns notes into "?" icons; don't put long text in labels.
- Defaults must produce a printable lamp on a 256 mm bed.
- A setting that changes saved designs' meaning needs a migration in `applyPayload()`.

## 4. UI rules

- **All user-facing text is Turkish**: labels, notes, status messages, warnings, alerts, file names we suggest, menu items. Code identifiers and log messages for developers are English. Comments follow the language of the surrounding file.
- Write status messages as: what happened, then what to do. Warnings start with `⚠` and are passed as the `warnings` array of `showStatus()` so they get logged in **Mesajlar**.
- Never open a native file dialog. Opening goes through `<input type="file">`, which `filepicker.js` intercepts on desktop. Saving goes through `downloadBlob()` → `appAPI.saveFile` (Downloads, no dialog). GTK dialogs crash Electron on Linux.
- Modals are `.modal` elements with `hidden`. `menubar.js` blocks shortcuts while any `.modal:not([hidden])` exists, so a new modal gets that for free. Handle `Escape` (close) and `Enter` (primary action) inside the modal and stop propagation.
- Every menu action that has a shortcut is defined once in `MENUS` (`main.js`). Use `visible` to scope a shortcut to a workspace. List keyboard-only shortcuts in `EXTRA_KEYS` so F1 shows them.
- The main flow is photo → silhouette → lamp → download. Optional tools (Görsel Dönüştürücü) live in the **Araçlar** menu, not in the top bar or the Siluet panel.
- First launch shows no errors or empty-state warnings; the print status bar stays hidden until there is a silhouette.
- Colours in CSS come from the `:root` tokens in `styles.css`; don't hard-code new greys.
- 3D materials that must match a 2D texture (wall vs. shadow texture) must use the same colour space: textures are sRGB and `toneMapped: false`, so matching materials use `convertSRGBToLinear()` and `toneMapped: false`.

## 5. Printing physics rules

- **Preview = print.** Every preview (room texture, bed mask, wall strip, accuracy, converter "Basılacak gölge") samples the final field after bridges, roofs and hole filling. Never compute a preview from the raw target.
- **Nothing floats.** Islands are bridged by the 0-1 BFS (or removed only if they are specks). Any new pass that removes material must re-run the island check or run before it.
- **Target sampling uses the signed distance field** (`WallField.smoothSampler`). Raw pixel sampling stair-steps far edges. Keep the sign exact (`> 0.5` ⇔ lit pixel).
- **Respect the printer:** minimum line ≈ 2 × nozzle (0.8 mm), bridges ≤ 12 mm, overhang ≤ 60° from vertical, cantilever ≤ 2.5 mm. These numbers appear in `wall_field.js`, `stencil.js` and `converter.js`; change them together.
- Magnification `t = ρ/r` is the reason for most "why is my detail gone" questions. When a result looks wrong far from the lamp, check magnification before suspecting the mesher.
- The LED must be the lowest opaque point of the tube-mount cap assembly; nothing opaque beside or below it.

## 6. Performance rules

- Recomputes are debounced with `setTimeout`, never `requestAnimationFrame` (rAF stalls in background windows).
- Expensive work keyed by inputs is cached by an explicit key: SDF by target hash (`designer.targetSD`), converter print map by `getPrintGeometry().key`, converter stages by `STAGE_OF`. When you add a heavy step, give it a key and a cache.
- Look-only changes (LED colour, brightness, wall colour/size) must not recompute the field or rebuild meshes; they go through `relook()` → `window.onLookUpdated` → `geometry.updateRoom()`.
- Typed arrays for anything per-pixel or per-cell. Avoid allocating objects in per-pixel loops of 2048² (4 M iterations).
- Long loops in the UI thread yield with `await sleep0()` between stages so the status text can paint.

## 7. Electron and security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer reaches Node only through `window.appAPI` (`preload.cjs`).
- Every IPC handler is registered with `handle()`, which checks the sender is the app page. New channels must use it.
- Validate every IPC argument in the main process: names through `safeName()`, extensions against `EXPORT_EXT`/`PICK_EXT`, sizes against the `MAX_*` limits, tensors by exact length.
- Downloaded models are verified by pinned SHA-256 before loading. Never load an unverified file.
- No navigation away from the app page, no new windows, no webviews, all permission requests denied. Keep it that way.

## 8. Code style

- `'use strict'`, `const`/`let`, arrow functions for small callbacks, 2-space indent, semicolons, single quotes.
- Comments explain *why*. Write the physical or historical reason ("GTK crashed…", "rAF stalls…") so nobody undoes the fix.
- Match the comment density and language of the file you edit.
- Prefer small pure helpers inside the IIFE over new globals.
- Don't reuse code from MakerWorld's "Light Shadow Art Generator" (MakerWorld Exclusive licence). Implement ideas independently.

## 9. Tests

- `npm test` must pass after every change (~30 s). It loads the core modules into Node.
- Touching `projection`, `wall_field`, `shell_mesher`, `exporters` or `stencil`? Add or extend a check in `tests/run-tests.js` in the matching numbered section. Keep each `check()` name a Turkish sentence describing the guarantee.
- UI changes have no automated runner. Verify them in the real app (Electron harness: require `electron/main.cjs`, drive with `executeJavaScript`, `capturePage()`; call `setBackgroundThrottling(false)` and `show()` first or frames come out stale). Don't write into the user's Downloads during checks.

## 10. Documentation

- Behaviour change → update `README.md` (user-facing), `AGENTS.md` (agent guide), `docs/ARCHITECTURE.md` (algorithms) and the matching `docs/modules/*.md` (API). New known limitation → `docs/KNOWN_ISSUES.md`.
- Docs are English (with a one-line Turkish summary at the top); UI strings quoted in docs stay Turkish.

## 11. Change checklist

1. Which layer does the change belong to (§1)? Is the core still DOM-free?
2. Units and conventions at every boundary (§2)?
3. New setting wired by its effect (§3) and safe for old design files (§2.4)?
4. Turkish UI text; no native dialogs; modal keys handled (§4)?
5. Previews still sample the final field; nothing floats (§5)?
6. No heavy work on look-only changes; caches keyed (§6)?
7. `npm test` green; new core behaviour has a check (§9)?
8. Docs updated (§10)?
