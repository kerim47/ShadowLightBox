# `shell_mesher.js`

> **Türkçe özet:** Duvar alanından su geçirmez mesh üretir (marching squares), taban plakası, askı deliği, LED kapağı / şeffaf tüp parçaları, düz paneller; baskı düzeni ve fiziksel baskı doğrulaması; ikili STL.

Layer: **core** (DOM-free; uses only `THREE.ShapeUtils.triangulateShape`). Global: `ShellMesher`. Algorithms: `ARCHITECTURE.md` §5.

## API

```js
ShellMesher.buildLamp(field, opts)     // → { meshes, warnings: string[] (Turkish), info }
ShellMesher.validatePrint(meshes, o?)  // → { ok, parts, grounded, floating: [{ name, minZ, size }], contactMM2, names }
ShellMesher.toBinarySTL(meshes, header?) // → ArrayBuffer (drops previewOnly)
ShellMesher.bbox(meshes)               // → { minX, minY, minZ, maxX, maxY, maxZ } (mm)
```

### `buildLamp` options (mm unless noted)

| Option | Default | Meaning |
|---|---|---|
| `mode` | — | `'onepiece'` or `'flat'` (flat only for faceted shapes; otherwise a warning and one-piece) |
| `mount` | — | `'cap'` (front cap + lip + LED tube/cup) or `'tube'` (holder ring + cap/plug/post/cup on an acrylic tube) |
| `thickness` | 1.6 | wall thickness |
| `plateThickness`, `capThickness` | 3, 2.4 | |
| `ledSeat` | 20 | LED seat diameter |
| `keyhole` | true | search a keyhole position top-down that clears the wall and the tube ring |
| `tubeOD`, `holderHeight` | 40, 10 | tube mount |
| `chamfer`, `supportLayer` | true, false | flat panels: 45°-style mitred ends; 0.2 mm layer under each panel |
| `bed` | 256 | `{ x, y, z }` or a number (square) |
| `assembled` | false | true → lamp coordinates for the room preview (always the one-piece shell) and adds `tube-glass` (`previewOnly`) |

`info = { triangles, lightZcm, tubeLengthMM, mount, bodyMM: { w, h, d } }`.

### Part names (contract — see `DESIGN_RULES.md` §2.3)

`shell` | `panel-N` (+ `panel-N-layer`), `base-plate`, tube mount: `tube-holder`, `tube-cap`, `tube-cap-plug`, `tube-cap-post`, `tube-cap-cup`, `tube-glass` (preview); cap mount: `cap`, `cap-lip`, `led-tube`, `led-cup`.

### Layouts

- Assembled (room view): lamp coordinates.
- One-piece print: body + plate at the origin, cap parts flipped (`capTop − z`) and placed beside the body.
- Flat print: each panel group shelf-packed within the bed with an 8 mm gap.

### `validatePrint`

Welds coincident vertices per mesh, splits into connected components, marks a component grounded if its lowest point is at `z ≈ 0` with ≥ 4 mm² of downward-facing contact, then propagates "grounded" to any component whose bounding box touches a grounded one (slicers merge overlapping solids). `main.js` shows floating parts in red on the bed.

## Watertightness rules

- `wallMesh` keys each vertex as `(row, col, kind)` with kind = corner / horizontal edge / vertical edge, so neighbouring cells share vertices exactly.
- Side walls are emitted only for polygon edges not shared with a neighbour cell (contours) and for grid-border edges.
- `extrude` builds plates/caps from a CCW contour + holes; it reverses wrong-winding inputs.
- Overlapping parts (`cap` + `cap-lip`, holder on plate) are separate meshes on purpose; slicers union them.

## Pitfalls

- Any change to mesh topology must keep `tests/run-tests.js` section 2 green (every edge exactly twice, opposite orientations, positive volume) for all shape × mode × mount cases.
- Exporters other than STL weld vertices themselves (`ModelExport.weld`); don't rely on that to hide topology bugs.
- The LED cup must stay the lowest opaque point of the tube-mount cap (`ARCHITECTURE.md` §5).
