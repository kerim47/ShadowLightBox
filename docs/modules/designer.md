# `designer.js`

> **Türkçe özet:** Hedef görüntünün (2048²) sahibi: siluet yerleştirme, ayarları okuma, duvar alanını hesaplama, açılmış duvar şeridi, karanlık oda simülasyonu, tabla maskesi ve gölge uyumu (IoU). Işık/duvar görünümü değişince yalnızca simülasyon yenilenir.

Layer: **service** (DOM: canvases, input elements by id). Global: `Designer`. Algorithms: `ARCHITECTURE.md` §7.

## Init

```js
const designer = Designer.init({
  target,      // <canvas id="target"> (resized to 2048²)
  sim,         // offscreen canvas: room texture (resized to 1024…1600 by wall size)
  mask,        // offscreen canvas: bed shadow mask (768²)
  wallStrip,   // <canvas id="wall-strip">
  onTargetClick(), onSilhouetteApplied(),
});
```

It also binds DOM ids directly: `image-apply`, `image-cancel`, `clear`, `image-edit-controls`, `brush-controls`, `wall-stats`, and every setting id it reads.

## Returned API

| Member | Purpose |
|---|---|
| `readParams()` | all field/look settings from the DOM: `{ shapeSpec, d, cz, R, rot, offX, offY, margin, ribs, ribWidth, minHole, plate, maxCells, mode, mount, supportLayer, supportFree, look: { ledColor, brightness, wallColor, wallSize }, outsideLit }` |
| `getParams()` | params of the last recompute (or fresh) |
| `recompute()` / `recomputeNow()` | debounced (16 ms `setTimeout`) / immediate |
| `getField()`, `getAccuracy()`, `getShadowBBox()` | last results |
| `evaluate(overrides)` | field + accuracy for hypothetical settings (optimizer) |
| `fieldForTarget(rgba, lit)` | field for another target without changing the current one (converter) |
| `getPrintGeometry()` | `{ shape, cz, margin, R, zb, openTop, ribWidthMm, N, toTarget, toWall, key }` for `Stencil.buildPrintMap` |
| `loadSilhouetteImage(img)` | enter placement mode (drag = move, wheel = scale) |
| `loadTargetImageDataURL(url, lit)` | replace the target (editor, converter, design files) |
| `getTargetImageDataURL()`, `isOutsideLit()`, `footprintInTarget()`, `suggestShape(baseSize)` | |

## Recompute pipeline

`recomputeNow()`: `readParams` → `computeField` (`WallField.compute` with `makeSampler`) → `drawWallStrip` → `simulateShadow` → `measureAccuracy` (640²) → `window.onWallFieldUpdated(field, p)`.

Look-only settings (`l-color`, `l-bright`, `l-wall`, `l-wallsize`) take the short path `relook()`: `simulateShadow(lastField, lastParams with new look)` → `window.onLookUpdated(p)`. No field, no meshes.

## Simulation (`simulateShadow`)

- Room texture covers `[-E, E]²` with `E = max(R, wallSize/2)`; resolution scales with `E/R` (max 1600). Lit pixels = `inverseShell` not null, not blocked, and `sampleField > 0.5`; brightness = LED × wall colour × `1/(1 + (ρ/near)^1.6)` with an edge fade near `E`.
- Bed mask + shadow bounding box cover only `[-R, R]²` (768²), so the bed view doesn't change with wall size.
- Uses the **final field** (invariant: preview = print).

## Target sampling

`makeSampler(p)` = wall → target rotation/offset, then `WallField.smoothSampler` with the SDF from `targetSD(data)` (FNV hash cache, one entry). See `KNOWN_ISSUES.md` #4.

## Adding a setting

Field-affecting: read in `readParams`, add to the `recompute` id list. Look-only: add to `look` and the `relook` list. See `DESIGN_RULES.md` §3.

## Pitfalls

- `outsideLit` is module state, swapped temporarily in `fieldForTarget`; always restore it (the `finally` does).
- `applyCrop` paints the image without thresholding: grey edges give sub-pixel accuracy. Don't binarise the target.
- `window.onWallFieldUpdated` is wrapped by `main.js` twice (preview + history). Assign through the existing chain, don't overwrite it.
