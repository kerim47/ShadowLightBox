# `wall_field.js` — the core

> **Türkçe özet:** Açılmış lamba duvarını (s, z) ızgarasında örnekler: her köşe 0..1, 0,5'ten büyükse ışık (kesilir). Ardından baskı düzeltmeleri (iğne delikleri, köşe direkleri, destek kolonları, köprüler, desteksiz çatılar). Hedef örneklemesi işaretli uzaklık alanıyla yapılır.

Layer: **core** (DOM-free). Global: `WallField`. Algorithm details: `ARCHITECTURE.md` §4.

## API

```js
WallField.compute(opts)                       // → field
WallField.sampleField(field, s, z)            // bilinear read → 0..1 (0 outside [0, rowZ[last]])
WallField.signedDistance(rgba, N)             // Float32Array N², px, + = lit (red > 127)
WallField.smoothSampler(rgba, N, R, outside, sd?) // → sample(X, Y) over [-R, R]² cm
```

### `compute(opts)`

| Option | Unit | Meaning |
|---|---|---|
| `shape`, `d`, `cz`, `margin` | cm | geometry; `zTop = cz − margin` is the last cut row |
| `sample(X, Y)` | → 0..1 | target sampler on the room wall; `> 0.5` lit |
| `grid` / `maxCells` | cm / count | fixed cell size, or auto-fit to a budget (`QUALITY_CELLS` in `designer.js`) |
| `bottomBand` | cm | solid band at `z = 0` (base plate) |
| `ribs`, `ribWidth` | count, cm | support ribs (cap mount only; ignored with `openTop`) |
| `cornerPosts` | bool | solid strips at polygon vertices (flat panels + cap) |
| `minHole` | cm² | fill lit components smaller than this |
| — | — | `WallField.litFraction(field, X, Y, emitterCm)` → lit fraction 0..1 with a disk LED emitter (null behind the body); see ARCHITECTURE "Real light". |
| `minWall`, `minGap` | mm | printable widths (UI: `d-minwall` 0.8, `d-mingap` 0.5; 0 = off). Local thickness per vertex from sub-cell horizontal/vertical runs, `t = 1/√(1/h² + 1/v²)` (exact for a straight strip at any angle); for each run thinner than the limit a disk of diameter = limit is drawn on the strip's centre line, written as a signed-distance ramp so the 0.5 contour lands on the disk edge even on a coarse grid. Gaps first, then walls (strength wins). Bands excluded. `stats.thickened` / `stats.widened` count the drawn disks. |
| `minIsland` | cm² | default 0.005; smaller solid islands are deleted, bigger ones bridged |
| `openTop` | bool | tube mount: `F = 1` above `zTop` |
| `keepIslands` | bool | flat + 0.2 mm layer: skip bridging |
| `panels` | bool | flat panels: islands are bridged inside each facet (no connection across a corner, which the cut would break); the shared corner column is never painted; corner specks get a one-cell link; sets `rimFloating` per panel |
| `supportFree`, `overhangAngle`, `maxBridge`, `maxCantilever` | bool, °, mm, mm | upright-print roofs (60°, 12 mm, 2.5 mm defaults) |

Returns `{ F, nr, nc, colS, rowZ, vertexCol, colEdge, periodic: true, shape, d, cz, margin, stats }`.

- `F[r * nc + c]`: row-major, rows are `rowZ[r]` (non-uniform), columns `colS[c]` (arc length, periodic).
- `stats`: `{ holesFilled, islandsRemoved, bridges, rimFloating, ribS[], grid, nr, nc, roofArea (cm²), printBridges }`. `designer.drawWallStrip` and `main.js` show these to the user.

### Pass order (do not reorder casually)

sample → pin-holes → corner posts → ribs → islands/bridges → support-free roofs.

Roofs run last because they only add solid; bridges run before roofs so roofs see the bridges. A new pass that removes solid must run before the island pass.

### Smooth sampling

`designer.makeSampler` wraps `smoothSampler` with the wall → target rotation/offset. The SDF (exact Felzenszwalb EDT, both sides) is computed once per target and cached by hash in `designer.js` (~400 ms at 2048²). The sampler returns `clamp(0.5 + sd / (2·48 px))`; the 0.5 crossing is the true edge at any magnification. Don't replace it with raw pixel sampling: far edges stair-step (test "uzak kenar pürüzsüz").

## Pitfalls

- `> 0.5` is lit everywhere. The mesher nudges values in `(0.499, 0.501)` away from 0.5 to avoid degenerate crossings.
- Columns wrap: neighbour of `c = 0` is `nc − 1`. Every component search here is periodic in `s`.
- `sampleField` returns 0 (solid) outside the row range; callers that need "no wall" semantics (tube mount above `zTop`) must handle it themselves.
- Roof teeth far from the lamp are physical (see `KNOWN_ISSUES.md` #2).

## Tests

`tests/run-tests.js` sections 2–3 and the "uzak kenar pürüzsüz" check. Extend them when you change a pass.
