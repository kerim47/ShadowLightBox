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
| `labels` | true | flat panels: raised 7-segment assembly number (0.6 mm) on each panel's outer face, placed in a fully solid window of the field (bottom first, centre outward), and the same number on the plate top beside each edge (avoids keyhole / tube ring). Meshes `panel-N-label`, `base-plate-label-N`. |
| `rayAlign` | true | inner/outer surface points on the LED ray through the mid-surface (hole walls parallel to the light); bands and flat-panel ends blend to normal cuts |
| `merge` | true | false → no solid-region merge (tests compare volume against it) |
| `bed` | 256 | `{ x, y, z }` or a number (square) |
| `assembled` | false | true → lamp coordinates for the room preview (always the one-piece shell) and adds `tube-glass` (`previewOnly`) |

`info = { triangles, lightZcm, tubeLengthMM, mount, beds, bedPitchMM, fitsBed, bodyMM: { w, h, d } }`.

### Part names (contract — see `DESIGN_RULES.md` §2.3)

`shell` | `panel-N` (+ `panel-N-layer`, `panel-N-label`), `base-plate-label-N` (flat), `base-plate`, tube mount: `tube-holder`, `tube-cap`, `tube-cap-plug`, `tube-cap-post`, `tube-cap-cup`, `tube-glass` (preview); cap mount: `cap`, `cap-lip`, `led-tube`, `led-cup`.

### Layouts

- Assembled (room view): lamp coordinates.
- One-piece print: body + plate at the origin, cap parts flipped (`capTop − z`) and placed beside the body.
- Flat print: panel groups, plate and cap shelf-packed (largest first, rotated 90° when it fits better, 8 mm gap). Bed 1 is centred on the lamp axis like the preview bed; pieces that don't fit go to further beds laid out along +X (`info.beds`, `info.bedPitchMM` = bed X + 20 mm); the bed view draws one plate per bed. `info.fitsBed` reports whether every piece fits a bed.

### `validatePrint`

Flat panels: a component of a `panel-N` mesh other than its main body (largest bed contact) is `loose` (lies on the bed but falls out of the panel) unless `panel-N-layer` exists; `main.js` reports it separately. Welds coincident vertices per mesh, splits into connected components, marks a component grounded if its lowest point is at `z ≈ 0` with ≥ 4 mm² of downward-facing contact, then propagates "grounded" to any component whose bounding box touches a grounded one (slicers merge overlapping solids). `main.js` shows floating parts in red on the bed.

## Watertightness rules

- `wallMesh` keys each vertex as `(row, col, kind)` with kind = corner / horizontal edge / vertical edge, so neighbouring cells share vertices exactly.
- Side walls are emitted only for polygon edges not shared with a neighbour cell (contours) and for grid-border edges.
- `extrude` builds plates/caps from a CCW contour + holes; it reverses wrong-winding inputs.
- Overlapping parts (`cap` + `cap-lip`, holder on plate) are separate meshes on purpose; slicers union them.

## Pitfalls

- Any change to mesh topology must keep `tests/run-tests.js` section 2 green (every edge exactly twice, opposite orientations, positive volume) for all shape × mode × mount cases.
- Exporters other than STL weld vertices themselves (`ModelExport.weld`); don't rely on that to hide topology bugs.
- The LED cup must stay the lowest opaque point of the tube-mount cap (`ARCHITECTURE.md` §5).
