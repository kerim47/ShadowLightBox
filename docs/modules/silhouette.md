# `silhouette.js`

> **Türkçe özet:** Fotoğraf → siluet maskesi: hızlı (arka plan rengi), yapay zeka matı (IS-Net / U²-Net-p, ana süreçte) ve detaylı portre; kullanıcı yardımı (detay alanları, ekle/çıkar fırçası) ve önizleme.

Layer: **service** (canvas; AI through `window.appAPI.removeBackground`). Global: `Silhouette`. Algorithms: `ARCHITECTURE.md` §6.

## API

Masks are `{ w, h, data: Uint8Array }` with **1 = subject = shadow**, at working resolution (long side ≤ 2048).

```js
Silhouette.quick(img, { sensitivity, invert, fillGaps, smooth })          // model-free
Silhouette.aiAvailable()                                                   // desktop only
await Silhouette.aiMatte(img, 'isnet-general-use' | 'u2netp', onProgress)  // → { w, h, alpha: Float32Array }
Silhouette.fromMatte(matte, { sensitivity, invert, fillGaps, smooth })
Silhouette.portrait(img, subjectMask, { sensitivity, local, outline, invert, smooth })
Silhouette.addRegions(img, mask, rects, opts)   // → { mask, skipped } detail boxes (normalised rects)
Silhouette.applyHints(mask, hintsCanvas, rect?, removeOnly?) // green = add, red = remove
Silhouette.cropCanvas(img, rect)
Silhouette.drawPreview(canvas, img, mask, { rects, hints }) // → { ox, oy, dw, dh } image box in canvas px
await Silhouette.maskToImage(mask)              // Image: subject black, background white
```

`onProgress(msg)`: `{ phase: 'download' | 'load' | 'run' | 'fallback', received?, total?, model? }`. If the big model can't be downloaded the main process answers `{ fallback: 'u2netp' }` and `aiMatte` retries with the small model.

## Callers

- Photo modal in `main.js` (`runSilhouette`): method `portrait` (default), `ai`, `quick`; caches the AI matte and the subject mask per photo.
- `converter.js` stage A (`subject` / `portrait` modes).
- `editor.js` "Siluete çevir" on image layers.

## Pitfalls

- `cleanup` keeps small blobs on purpose (letters, twig tips); thresholds are fractions of the image area. Raising them erases detail.
- AI input is squashed to a square (model size); output is resampled back to the photo's aspect. That is expected.
- The AI path exists only in the desktop app; the UI removes AI options when `aiAvailable()` is false.
