# `shapes.js` and `projection.js`

> **Türkçe özet:** Gövde kesitleri (yıldız biçimli, saat yönü tersine çokgenler) ve LED → duvar ışın eşlemesi. Çekirdek katman: DOM yok, Node testleri yükler.

Layer: **core** (DOM-free). Globals: `Shapes`, `Projection`. Algorithms: `ARCHITECTURE.md` §2–3.

## `Shapes`

```js
Shapes.CATALOG           // { kind: { label, faceted, params: ['W','H','N','A'], build(spec) → [[x,y]...] } }
Shapes.make(spec, depth) // → shape object (below)
Shapes.autoSuggest(isDark(x, y), n, baseSize) // → { kind, W, H, N, A, reason }
```

`spec = { kind, W, H, N, A, taper }` in cm (`A` is a 0..1 ratio, `taper` a fraction of radius change from `z = 0` to `z = depth`).

Kinds: `square`, `rect`, `roundedRect` (superellipse n = 4), `circle` (360 samples), `polygon` (flat edge at the bottom), `star`, `flower`, `heart` (re-centred so the axis is inside the star-shaped belly). `faceted: true` only for `square`, `rect`, `polygon`; only those can be printed as flat panels.

### Shape object

| Member | Meaning |
|---|---|
| `kind`, `label`, `faceted`, `starShaped` | `starShaped` false means the outline is not valid for projection; callers should not proceed |
| `pts` | CCW vertices (cm), wall mid-surface at `z = 0` |
| `perimeter`, `k`, `depth` | `k = taper / depth` |
| `hitAngle(φ)` | `{ r, s, i, f }`: radius and arc length where the ray at angle φ hits the outline |
| `pointAt(s)` | `{ x, y, i, f }` at arc length `s` (wraps) |
| `normalAt(s)` | outward normal; mitred and scaled at vertices so an offset keeps distance from both edges |
| `vertexS()` | arc length of every vertex (grid columns snap to these) |
| `scaleAt(z)` | `1 + k·z` |
| `offset(dist)` | mitred offset polygon (`dist > 0` outward); folds removed so the result stays star-shaped |
| `bounds()` | `{ minX, minY, maxX, maxY }` |

### Adding a shape

1. Write a vertex generator returning a star-shaped polygon around `(0,0)` (any orientation; `make` reverses CW input).
2. Add a `CATALOG` entry with Turkish `label`, `faceted`, and `params`.
3. Add the option to `s-shape` in `SCHEMA` (`main.js`) and parameter labels in `PARAM_LABELS`.
4. Add the kind to `KINDS` in `tests/run-tests.js` (projection round-trip + watertight checks).

`autoSuggest` uses the silhouette's bounding-box aspect, fill and circularity. Pass `baseSize = √(W·H)` (`main.js` does) so repeated suggestions don't grow the body.

## `Projection`

```js
Projection.forwardShell(s, z, shape, cz)          // wall (s, z) → { X, Y } on the room wall, null if z ≥ cz
Projection.inverseShell(X, Y, shape, cz, margin)   // room wall → { s, z, blocked } | null (inside footprint)
Projection.inverseMap(X, Y, dim, marginZ)          // legacy box formula, used only by the parity test
```

- `forwardShell`: `(X, Y) = p(s) · (1 + k z) · cz / (cz − z)`.
- `inverseShell`: closed form `z = (ρ − r) / (ρ/cz + r k)`. Returns `null` when `ρ ≤ r` (behind the body). `blocked` is true when `z ∉ [0, cz − margin]` — the ray would leave through the solid band in front of the light (cap mount) or the open top (tube mount; see `KNOWN_ISSUES.md` #1).
- The two must stay exact inverses; `tests/run-tests.js` section 1 checks every shape × taper.

## Pitfalls

- `hitAngle` needs a star-shaped outline. Offsetting concave corners can fold; `offset()` removes folds, raw arithmetic does not.
- Taper changes the outline with `z`; anything that converts between wall and room coordinates must go through these functions, not `pts` directly.
