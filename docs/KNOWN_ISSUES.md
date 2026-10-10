# Known issues and technical debt

> **Türkçe özet:** Kod incelemesinde (2026-10-10) bulunan, henüz düzeltilmemiş sorunlar ve teknik borç. Her madde: belirti, neden, yer, önerilen çözüm. Düzelttiğiniz maddeyi bu dosyadan silin.

Each entry: symptom, cause, location, suggested fix. Remove an entry when you fix it. Fixed during the same review: stale header comments in `editor.js`, `converter.js`, `main.js`, `preload.cjs`; unescaped `<title>` in `Stencil.toSVG` (a file name with `&` or `<` produced an invalid SVG).

## Behaviour

### 1. Room simulation is dark beyond the rim in tube mount

- **Symptom:** in tube mount, with a large "Aydınlanan duvar genişliği", the wall stays dark beyond radius `ρ_max = r·cz / margin` (≈ 135 cm for a 15 cm cylinder, `cz` 5.4 cm, margin 3 mm). The real lamp lights that area: above `zTop` there is no wall (`openTop`).
- **Cause:** `Projection.inverseShell` returns `blocked: true` for `z > cz − margin`, and `designer.simulateShadow` treats `blocked` as dark. The field itself has `F = 1` above `zTop` in tube mount.
- **Where:** `renderer/src/designer.js` → `simulateShadow` (`litAt`), `projection.js` → `inverseShell`.
- **Fix:** in `litAt`, when `p.mount === 'tube'` and `inv.blocked` with `inv.z < p.cz`, count the pixel as lit. Check the "Gerçek gölge" view agrees, and that `measureAccuracy` still uses the target frame only.

### 2. Support-free roofs show as saw teeth far from the lamp

- **Symptom:** a wide lit shape far out (crescent at ρ ≈ 45 cm on a 15 cm cylinder) gets dark spikes along its outer edge.
- **Cause:** physics, not a bug. A ~1 mm rim above the hole spans tens of cm and can't print upright without roofs; near the light the roofs are magnified ~50×.
- **Where:** `wall_field.js` support-free pass.
- **Mitigation:** `g-supportfree` is off by default (print upright with slicer supports); the sample `zoro.json` scores 99 % instead of 81 %.
- **Possible improvement:** detect this case and warn ("Desteksiz baskı bu tasarımda uzak kenarları bozuyor"), or suggest slicer supports / a larger body. The optimizer already compares print modes.

## Performance

### 3. Undo snapshots encode the 2048² target as PNG

- **Where:** `main.js` → `history.snap()` calls `designer.getTargetImageDataURL()` on every commit (debounced 700 ms after each recompute, including setting changes that don't touch the image).
- **Cost:** ~100 ms+ of main-thread PNG encoding per commit, and up to 40 large strings kept in memory.
- **Fix:** keep a target version counter in `designer` (bumped on every target write) and only encode when it changed; store the previous dataURL otherwise.

### 4. SDF cache thrash between converter and lamp

- **Where:** `designer.fieldForTarget()` (converter's "Basılacak gölge") computes the field for another target. `targetSD` caches one hash, so switching back recomputes the EDT (~400 ms at 2048²).
- **Fix:** cache two entries (LRU of 2) in `targetSD`.

## Duplication

### 5. Same helpers in several modules

| Helper | Copies |
|---|---|
| 1-D EDT (`edt1d`) | `wall_field.js`, `stencil.js` |
| Otsu threshold | `silhouette.js`, `stencil.js` |
| Lab conversion (`toLab`, `LIN`) | `silhouette.js`, `stencil.js` |
| Connected components | `wall_field.js` (`components`), `stencil.js` (`components`), `silhouette.js` (`labelComponents`), `editor.js` (`despeckle`) |
| `el()` DOM helper | `converter.js`, `editor.js`, `inspector.js` |
| `escapeHtml` | `main.js` (+ inline escapes in `exporters.js`, `stencil.js`) |

They differ slightly (periodic in s, return shape). Merging needs care: `stencil.js` and `wall_field.js` are core (Node-tested), `silhouette.js` is DOM. A shared core helper module (e.g. `imgcore.js`, DOM-free) loaded before all of them would remove most copies.

### 6. "Light part" regexes in three places

- `ModelExport.isLightPart`: `/^(cap|led-|tube-cap|tube-holder)/` (export dialog).
- `geometry.js` bed view `isCap`: same set (hidden behind "Montaj parçaları").
- `geometry.js` room view `isCap`: `/^(cap|led-|tube-)/` (all light parts incl. the glass tube; hidden in the room).
- `geometry.js` `compareStats`: `/^(cap|led-|tube-cap)/` (no `tube-holder`, on purpose: the holder sits on the base plate).
- **Fix:** use `ModelExport.isLightPart` for the bed view; give the room/compare variant its own named helper with a comment.

## Coverage

### 7. No automated UI tests

`designer.js`, `geometry.js`, `main.js`, `editor.js`, `converter.js` are only checked by hand. The Electron harness pattern in `DESIGN_RULES.md` §9 works; a scripted smoke test (load sample design, recompute, open each workspace, export dialog, no console errors) would catch most regressions.

### 8. FBX/3MF are not verified against the real consumers

FBX is checked with three.js `FBXLoader` and Assimp; 3MF with a zip + XML parse and trimesh. Neither Unity/Autodesk FBX SDK nor Bambu/Prusa slicers run in CI. If a user reports an import error, ask for the exact message.

## Security notes (by design, keep in mind)

- `fs:list` / `fs:read` can list and read any non-hidden file on disk with an allowed extension (images, json, models). That is what the in-app picker needs; the trusted-sender check limits it to the app page. Don't widen `PICK_EXT`.
- `file:save` writes only into Downloads with a sanitised base name; `file:reveal` only reveals files in Downloads.
