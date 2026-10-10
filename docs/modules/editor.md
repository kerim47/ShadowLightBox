# `editor.js` — Siluet Editörü

> **Türkçe özet:** Lamba ekranından ayrı tam ekran boyama alanı (2048²): fırça, ışık fırçası, silgi, kova, şekiller, metin, resim katmanları, geri al/yinele. "Lambaya uygula" gri tonlu (kenar yumuşatmalı) hedef görüntüyü tasarımcıya yazar.

Layer: **UI** (canvas). Global: `SilhouetteEditor`. Overview: `ARCHITECTURE.md` §9.

## API

```js
const editor = SilhouetteEditor.init(hostEl, {
  getOverlay(),        // designer.footprintInTarget(): { poly, light } in target px (lamp outline overlay)
  onApply(dataURL),    // grey PNG, white = lit
  onClose(),
});
editor.open(targetDataURL);  // load the current target as the base layer, reset history
editor.render(); editor.fit();
```

## Document model

| Layer | Storage | Meaning |
|---|---|---|
| base | `Uint8Array N²` grey | the silhouette being edited |
| image layers | `{ id, name, orig, src, x, y, scale, rot, flip, opacity, threshold, invert, visible }` | composited with `multiply` (black adds shadow, white is transparent) |
| paint | `Uint8Array N²` | 0 none, 1 shadow, 2 light |

`composite()` = white → base → layers (multiply) → paint. `flattenGray()` returns the red channel; whole-image operations (invert, flip, rotate, dilate/erode, smooth, despeckle) flatten into the base first.

Tools (`TOOLS`): brush `B`, light `L`, erase `E`, fill `G`, line `I`, rect `R`, ellipse `O`, text `T`, move `V`, hand `H`. Symmetry X/Y, smoothing, size `[ ]`, swap `X`.

## History

Full snapshots (`base`, `paint`, layer list, selection) before each operation; `HISTORY = 20` (~8 MB each at 2048²). `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` handled inside the editor's own keydown listener (the menu hides lamp undo while the editor is open).

## Pitfalls

- Keyboard handlers check `host.hidden`; keep that guard on any new global listener.
- Keep edges grey on apply; thresholding loses sub-pixel accuracy.
- Memory: raising `HISTORY` or `N` multiplies snapshot size.
