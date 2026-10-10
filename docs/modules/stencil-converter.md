# `stencil.js` (core) and `converter.js` (Görsel Dönüştürücü UI)

> **Türkçe özet:** İsteğe bağlı ek araç. Görsel → baskıya hazır gölge şablonu + SVG. `stencil.js` DOM'suz çekirdek (test edilir); `converter.js` arayüz ve aşamalı işlem hattı. Yalnızca Araçlar → Görsel Dönüştürücü (Ctrl+Shift+G) ile açılır.

Algorithms: `ARCHITECTURE.md` §9b.

## `Stencil` (core, DOM-free)

Stencil masks are `Uint8Array`, **1 = shadow = material**.

| Group | Functions |
|---|---|
| Tone | `luminance(rgba, n)`, `blurF(f, w, h, r)`, `adjust(rgba, w, h, { brightness, contrast, gamma, saturation, blur })` |
| Threshold / colour | `otsu(values)`, `threshold(lum, w, h, { level, adaptive })` → `{ mask, level }`, `kmeans(rgba, w, h, k)` → `{ palette, labels }`, `edges(lum, w, h, level)` |
| Morphology | `components(mask, w, h, value, periodicX)`, `despeckle(mask, w, h, minDark, minLight)`, `fillHoles`, `distanceTo` (EDT), `offset(mask, w, h, r)` (grow/shrink), `thinParts(mask, w, h, width, periodicX)` |
| Print check | `buildPrintMap(geo, S, Projection)` → map; `analyzePrint(mask, map, o)` → `{ mask, overlay, stats }` |
| Vector | `trace(mask, w, h)` → closed loops; `simplify(loop, tol)` (RDP); `pathData(loops, { smooth, cornerDeg, scale })` → `{ d, nodes, paths }`; `toSVG(d, S, { sizeCm, background, title, color })` |

- `buildPrintMap(geo)` takes `designer.getPrintGeometry()`; builds an unrolled wall raster (~500 k cells) with `wallToPx` and `pxToWall` (−1 footprint, −2 beyond the light). Cache it by `geo.key`.
- `analyzePrint` options: `{ outsideLit, minLineMm, minGapMm, bridgeMm, minIslandMm2, thin: 'thicken'|'remove'|'keep', gaps: 'close'|'widen'|'keep', floating: 'bridge'|'remove'|'keep' }`. Overlay codes: 1 added, 2 removed, 3 remaining problem, 4 footprint/base band, 5 unreachable. Only cells touched by a fix are written back to the target.

## `ImageConverter` (UI)

```js
const converter = ImageConverter.init(hostEl, {
  designer,            // getPrintGeometry, fieldForTarget, getTargetImageDataURL, isOutsideLit
  lampSummary(),       // HTML line with the current lamp
  download(blob, name),// main.js downloadBlob
  onApply(dataURL, outsideLit), onClose(),
});
```

Returned: `open()`, `loadFile(file)`, `loadImageURL(url, name, placement)`, `openFileDialog()`, `pasteFromClipboard()`, `loadFromLamp()`, `saveSVG()`, `savePNG()`, `copySVG()`, `apply()`, `resetSettings(ids)`, `hasResult()`, `hasImage()`, `undo()/redo()/canUndo()/canRedo()`, `setView(v)/getView()`, `zoomIn/zoomOut/zoomFit()`, `togglePaths()/pathsShown()`.

### Pipeline and caching

Settings live in `st` (persisted in `localStorage['sb-converter-v1']`, defaults in `DEFAULTS`). Each setting maps to the first stage it invalidates (`STAGE_OF`):

| Stage | Work | Resolution |
|---|---|---|
| A | tone adjust + method (`threshold`, `colors`, `edges`, `subject`, `portrait`) | ≤ 1400 px |
| B | placement (size, rot, offset, flip), grow/shrink, smooth, despeckle, fill | `S = 1024` |
| C | `analyzePrint` on the cached print map | wall raster |
| D | trace → simplify → Bézier path (`SVG_DETAIL`) | vector |
| R | redraw only | — |

`run()` re-runs from the lowest dirty stage, yields between stages, and restarts if settings change mid-run. "Lambaya uygula" renders the **vector path** into a 2048² anti-aliased target (`renderTarget`), so the lamp gets exactly the SVG. "Basılacak gölge" computes the real field through `designer.fieldForTarget` (preview = print).

### Adding a setting

Add it to `DEFAULTS`, to the right `STAGE_OF` group, and build its control in the side panel with `range/check/select/custom`. Turkish label; explanation via `.field-note` (HelpTips turns it into "?").

## Pitfalls

- Mask polarity differs from silhouette masks only in meaning (both 1 = shadow); target canvases are the inverse (white = lit).
- The converter must not open by itself: dropped/pasted images go to the photo window unless the converter workspace is open (`main.js` `handleFile`).
- Print thresholds (`minLine`, `minGap`, `bridge`) mirror the lamp's printer rules (`DESIGN_RULES.md` §5).
