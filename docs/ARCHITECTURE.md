# Architecture

This document explains how a photo becomes a printable shadow lamp: the data flow, every algorithm, and the reasons behind the main choices. Read `AGENTS.md` first for conventions and invariants, `DESIGN_RULES.md` for coding rules, and `modules/*.md` for each module's API.

## 1. Data flow

```
 photo / SVG ──► Silhouette (quick | AI matte | portrait stencil) ──► mask image (black = shadow)
                                                                        │
 Siluet Editörü (paint, layers) ─────────────────────────────────────┐  │  placement (pan/zoom)
                                                                     ▼  ▼
                                           target canvas 2048² (white = lit, anti-aliased) ──┐
                                                                                             │ sample(X, Y)
 settings (SCHEMA in main.js) ──► designer.readParams() ──► Shapes.make() ──► WallField.compute()
                                                                                    │ field F(s, z)
                       ┌────────────────────────────────────────────────────────────┼──────────────────────┐
                       ▼                                ▼                           ▼                      ▼
        designer.simulateShadow()            drawWallStrip()          ShellMesher.buildLamp()   measureAccuracy()
        (room texture + bed mask)            (unrolled wall)          (meshes in mm)            (IoU, lost, extra)
                       │                                                 │          │
                       └──────────► Geometry.buildScene() ◄──────────────┘          └─► ModelExport ─► .stl .3mf .obj .fbx .ply .glb
```

Every preview samples the **same final field** that is meshed, so what you see is what prints.

## 2. Shapes (`shapes.js`)

Every body cross-section is a **closed CCW polygon, star-shaped around the light axis** (each ray from the axis crosses it exactly once). Smooth shapes are just sampled finely (circle 360 vertices, superellipse, flower, heart).

`Shapes.make(spec, depth)` returns:

| Member | What it is |
|---|---|
| `pts` | Polygon vertices (cm), the wall mid-surface at `z = 0` |
| `hitAngle(φ)` | The ray from the axis at angle φ, as `{ r, s }`: radius and arc length where it meets the outline (binary search on the vertex angles plus segment intersection) |
| `pointAt(s)` | Point at arc length `s` |
| `normalAt(s)` | Normal at arc length `s`; at vertices it is mitred, scaled so an offset by `d·n` keeps distance `d` from both edges |
| `vertexS()` | Arc length of each vertex (used as grid columns) |
| `scaleAt(z) = 1 + k·z` | Taper; `k = taper / depth` |
| `offset(dist)` | Mitred polygon offset; folds are removed so the result stays star-shaped |
| `faceted` | True for square, rect and polygon, the only shapes allowed as flat panels |

`autoSuggest(isDark, n, baseSize)` picks a shape from the silhouette's bounding-box aspect ratio, fill and circularity. `main.js` passes the geometric mean `√(W·H)` as `baseSize`, so repeated suggestions don't grow the body.

## 3. Projection (`projection.js`)

The light is at `L = (0, 0, cz)` and the room wall is `z = 0`. Take the wall point at arc length `s` and height `z`. Its outline point `p(s)` is scaled by `a = 1 + k z`. The ray from `L` through it lands at:

```
forwardShell:  (X, Y) = p(s) · a · cz / (cz − z)
inverseShell:  ρ = |(X, Y)|,  {r, s} = hitAngle(atan2(Y, X))
               z = (ρ − r) / (ρ / cz + r k)          (closed form for linear taper)
               returns null inside the footprint (ρ ≤ r); blocked if z ∉ [0, cz − margin]
```

For a rectangle with `k = 0` this reduces exactly to the original box formula (`inverseMap`). A test checks it.

## 4. Wall field (`wall_field.js`) — the core

`WallField.compute(opts)` returns `{ F, nr, nc, colS, rowZ, vertexCol, colEdge, shape, d, cz, margin, stats }`.

### Grid

- **Columns:** every outline vertex is a column (keeps corners crisp). Each edge is subdivided uniformly to ≤ `g`. Columns are periodic in `s`.
- **Rows:** the magnification of a wall cell onto the room wall is `t = cz / (cz − z)` horizontally and `r t² / cz` vertically. Rows are spaced `Δz ∝ 1/t` (uniform in log t), clamped to `[0.2 mm, g]`. This keeps projected resolution roughly isotropic; uniform rows used to give 3 cm steps at the far edge. Above `zTop = cz − margin` a few rows cover the solid (cap mount) or empty (tube mount) band.
- **Budget:** `g` is the smallest cell size whose `cols × rows` fits `maxCells`:

  | Detail level | `maxCells` |
  |---|---|
  | low | 120k |
  | medium | 220k |
  | high | 380k |
  | ultra | 650k |

### Passes, in order

1. **Sample.** For each vertex, `F = sample(forwardShell(s, z))`, a bilinear read of the target's **signed distance field** (`smoothSampler`: `0.5 + sd / 96 px`, clamped; exact EDT computed once per target and cached by hash in `designer.js`). Far from the light one cell covers many target pixels; sampling the sharp image there gave 0/1 vertices and stair-stepped edges. The SDF is linear across an edge at any scale, so contours land on the true edge. Below `bottomBand` (the base plate) `F = 0`. Above `zTop`, `F = 0` in cap mount (solid rim) and `F = 1` in tube mount (`openTop`; the wall ends where the silhouette ends).
2. **Pin-holes.** Light components smaller than `minHole` (cm²) become solid.
3. **Corner posts.** Flat panels with cap mount only. Solid strips at the polygon vertices carry the rim.
4. **Ribs.** Cap mount only. Each rib only runs from the rim down to the nearest solid already anchored to the base. Columns are chosen globally by the lit length they would cover, with a minimum spacing.
5. **Islands → bridges.** This pass is skipped with `keepIslands` (flat + 0.2 mm layer).
   - Solid components touching row 0 (or the rim, in cap mount) are anchored.
   - A **0-1 BFS** runs from the anchored set: entering solid costs 0 and entering light costs 1. So bridges run inside the existing silhouette and cross light at the shortest point, which is the least visible in the shadow.
   - Each island traces its cheapest cell back to the anchored set, painting a bridge of width `ribWidth`.
   - Only specks below `minIsland` (~0.5 mm²) are deleted.
   - In cap mount, if the rim isn't connected, `stats.rimFloating` is set.
6. **Support-free overhangs** (`supportFree`, upright one-piece print).
   - The field is resampled on a raster with `Δz = Δs / tan(angle)` (angle 60°), so "one row down, ±1 column" is exactly the overhang limit.
   - Scanning top-down, it finds runs of solid cells with no support below.
     - Runs anchored on both sides and ≤ `maxBridge` (12 mm) are printable bridges.
     - Runs ≤ `maxCantilever` (2.5 mm) are printable drips.
     - Anything else gets a roof below: the side next to a supported neighbour is not narrowed, so slanted edges get one clean wedge instead of saw-teeth.
   - Roof cells are written back into `F`.
   - The cap rim band (`z > zTop`) is excluded; it prints as a bridge between ribs.

`WallField.sampleField(field, s, z)` is the bilinear read used by every preview. It uses a binary search on `rowZ`, because rows are non-uniform.

## 5. Mesher (`shell_mesher.js`)

### Marching squares → watertight solid

- Cell corners are traversed CCW: bl, br, tr, tl. Solid means `F ≤ 0.5`.
- Crossing points are interpolated linearly at 0.5.
- In a saddle cell, the centre average decides between one hexagon and two triangles.
- Every point is keyed as `(row, col, kind)`, with kind = corner, horizontal edge or vertical edge. Neighbouring cells therefore share vertices exactly.
- Each polygon is fan-triangulated on the outer (+½t) and inner (−½t) surfaces.
- Polygon edges that are not shared with a neighbouring cell get side walls: contour edges, plus grid-border edges (top/bottom; left/right on flat panels).
- Orientation: the 2D frame (s, z) maps to 3D with normal `T × Z` = outward, so CCW polygons face outward.

### Mapping 2D → 3D

- **One-piece:** `(s, z) → p(s)·(1+kz) + n(s)·side·t/2`, at height z. The body is printed upright on its base plate.
- **Flat panels** (faceted shapes): one planar panel per polygon edge, `x = (s − s_mid)·(1+kz)`, `y = z·slant`.
  - With `chamfer`, x is scaled by `1 ± miter` per side. The outer face gets longer and the inner face shorter by `t/2·tan(θ/2)` at each end; for a square that is 45°.
  - `supportLayer` adds a 0.2 mm trapezoid under each panel.

### Other parts

All built with `extrude(contour, holes, z0, z1)`, which triangulates with `THREE.ShapeUtils`.

| Part | What it is |
|---|---|
| Base plate | Outline offset by +t/2, with a keyhole searched top-down so it clears the wall, and the tube ring in tube mount |
| Tube mount | `tube-holder` ring on the plate. `tube-cap` disk + `tube-cap-plug` (inside the tube) + `tube-cap-post` + `tube-cap-cup` (LED seat at the bottom, LED face at `cz`). The LED is the lowest opaque point. `info.tubeLengthMM = cz + 2 + 3 + 4 − plate` |
| Cap mount | `cap` + `cap-lip` (fits inside the rim) + `led-tube` + `led-cup` |

### Layouts and output

- `assembled: true` gives lamp coordinates (for preview, always the one-piece shell, even in flat mode). It adds the preview-only `tube-glass`.
- One-piece print layout: body + plate at the origin, cap flipped beside it.
- Flat layout: panels shelf-packed within `bed`.
- `toBinarySTL` writes 50-byte facets. Each mesh is a separate object in slicers.
- `exporters.js` (`ModelExport.exportMeshes(format, meshes, title)`) writes the other formats from the same meshes. It drops `previewOnly` meshes and welds coincident vertices (1e-4 mm) so each piece is closed by index, dropping triangles that collapse. 3MF: OPC zip (fflate when loaded, else stored), mm, one object per piece plus one assembly object of components. OBJ / PLY: mm, Z up. FBX: binary 7.4 with Blender's node/footer layout, `UpAxis` 2 and `UnitScaleFactor` 0.1, `LayerElementNormal` (ByPolygonVertex, faces within 30° averaged), one `Material` + `LayerElementMaterial`, arrays zlib-compressed (encoding 1) when fflate is loaded. The download dialog (`modal-export`) asks every time whether to include `ModelExport.isLightPart` meshes (LED cap / tube parts); default no. GLB: `(x, y, z) mm → (x, z, −y) m` (a rotation, so winding is kept). Tests reload each format with the three.js loaders and check triangle counts and closure.

## 6. Silhouette extraction (`silhouette.js`)

The working resolution is 2048 px on the long side.

- **Quick (model-free).**
  - Pixels are converted to Lab colour.
  - Border pixels are grouped by k-means (k = 4) into background colours.
  - Each pixel gets a distance to the nearest background colour, followed by an Otsu threshold (shifted by sensitivity).
  - Background = border-connected background-coloured region, plus enclosed background regions of at least 0.04 % of the image.
  - Then `cleanup`: keep blobs ≥ 0.05 % of the largest (letters and twig tips survive), fill only pixel-noise holes, and smooth with radius `smooth` (default 1).
- **AI matte.** The renderer normalises the image to the model size (IS-Net 1024, mean 0.5; or U²-Net-p 320 with ImageNet stats) and sends a Float32 tensor over IPC. The main process runs onnxruntime-node and returns the prediction. The result is min-max normalised, resampled, thresholded (by sensitivity), then cleaned up.
- **Portrait stencil (default method).**
  - Subject mask comes from AI if available, otherwise quick.
  - Inside the subject, luminance is normalised (2–98 %).
  - Global Otsu threshold T is blended with a local box mean (radius ≈ size/45) weighted by `local`, so eyes and brows are caught under uneven light.
  - Dark becomes shadow and light becomes lit.
  - An optional outline of `outline` px is added, so a light face doesn't merge into a light background.
  - Specks are removed and the result smoothed.

## 7. Designer (`designer.js`)

- Owns the 2048² target canvas, photo placement (pan/zoom with a lamp footprint overlay) and `outsideLit`.
- `readParams()` collects every setting that affects the field: shape, d, cz, R, rotation/offset, margin, ribs, bridge width, minHole, plate thickness, detail budget, mode, mount, layer, supportFree, look.
- `recomputeNow()` runs in this order:
  1. `computeField`
  2. `drawWallStrip`
  3. `simulateShadow` — the room texture is wall colour × LED colour × a perceptual falloff with an edge fade; the bed mask is grey shadow; it also builds the shadow bounding box
  4. `measureAccuracy` — a 640² grid; IoU of target-dark vs result-dark, footprint excluded; plus lost and extra fractions
  5. `window.onWallFieldUpdated`
- Look-only settings (LED colour, brightness, wall colour, wall size) take a short path: `relook()` re-runs only `simulateShadow` on the last field and calls `window.onLookUpdated` → `Geometry.updateRoom()`. No field, no meshes.
- The room texture covers `[-E, E]²` with `E = max(R, wallSize/2)` ("Aydınlanan duvar genişliği"); the bed mask and shadow bounding box stay on `[-R, R]²`.
- `evaluate(overrides)` computes field + accuracy for hypothetical settings. The optimizer in `main.js` uses it to try body sizes (within the bed), the "ultra" level, and print modes (support-free, slicer supports, flat + layer). It picks the best and explains why.

## 8. 3D views (`geometry.js`)

- **Bed** (`Yazıcı Tablası`): a `bedSpace` group rotated so lamp z = world up.
  - Shows the white model on a grid bed with the grey shadow mask on the ground, placed below the bed so the bed sits on top.
  - Dimension lines and sprite labels in red; green axes.
- **Room** (`Karanlık Oda`): lamp coordinates = world, the wall is z = 0.
  - Shows a dark lamp body, a point-light LED (colour/brightness) with a glow sprite, and the simulation as the wall texture (`2·wallR` wide). The lit-wall material matches the texture's dark exactly (sRGB → linear, no tone mapping), so no seam shows around the texture. LED colour and intensity are also on the room toolbar.
  - **Gerçek gölge:** PCF shadow maps from the LED (`autoUpdate = false`, marked dirty on change). Distance decay is off, so the far wall stays visible.
  - Lights on/off toggles a daylight room.
- **Compare overlay:** loaded models sit in both scenes, with units, up axis, align (auto / original), rotation and offset.
  - `compareStats()` compares the model's bounding box restricted to the lamp region against the generated body.
  - An STL from this app loaded with original coordinates gives 0.0 mm differences.

## 9. Silhouette editor (`editor.js`)

- **Document:** 2048². The layers are:
  - base — grey, 1 byte per pixel;
  - image layers — transform, opacity, threshold, invert, convert-to-silhouette; composited with `multiply`, so black adds shadow and white stays transparent;
  - paint — 0 none, 1 shadow, 2 light.
- **Brush:** stamps circles with interpolation, smoothing and X/Y symmetry.
- **Shapes and text:** rasterised through a temporary canvas.
- **Fill:** a flood fill on the flattened image.
- **Whole-image operations:** invert, flip, rotate 90°, dilate/erode (separable box), smooth, despeckle. These flatten first.
- **Undo/redo:** full snapshots, 20 levels.
- **Lambaya uygula:** flattens to grey (anti-aliased) and calls `designer.loadTargetImageDataURL`.

## 9b. Image converter (`stencil.js` core, `converter.js` UI)

An optional extra workspace, not part of the main photo → lamp flow: it opens only from **Araçlar → Görsel Dönüştürücü** (`Ctrl+Shift+G`). Dropped or pasted images go to the photo window unless the converter is open.

Pipeline, each stage cached and re-run only from the first changed setting:

1. **A — image space** (≤ 1400 px): tone adjust → method (threshold / k-means colour layers / Sobel edges / `Silhouette.quick|aiMatte|portrait`) → binary mask.
2. **B — target frame** (1024² working resolution for speed; the output is the vector path rendered anti-aliased at the designer's 2048²): placement transform (size, rotation, offset, mirror), grow/shrink (EDT), smoothing, despeckle, hole fill.
3. **C — print check** (`Stencil.analyzePrint`):
   - `buildPrintMap` builds an unrolled wall raster (s × z, ~500k square cells ≈ 0.15–0.5 mm) with both maps: wall cell → target pixel (forward) and target pixel → wall cell (`Projection.inverseShell`; −1 footprint, −2 beyond the light). Cached per lamp geometry.
   - The wall raster is the stencil sampled at cell centres, plus every cell that any shadow pixel lands in (so sub-cell lines near the light are not lost). Rows below the base band are solid.
   - Thin shadow / thin light parts = what a morphological opening with the minimum width removes (EDT based, periodic in s). Fixes: thicken, remove, close, widen.
   - Floating = solid components touching neither the base band nor (cap mount) the front rim. Bridges follow a multi-source 0-1 BFS from anchored solid (solid is free, light costs 1), as in `wall_field.js`.
   - Only cells touched by a fix are written back to the target; untouched pixels keep their full target resolution.
4. **D — vector:** one "Ayrıntı" choice (high / balanced / light) sets the simplify tolerance and curve smoothing; marching squares (4-connected shadow, consistent with the analysis) → closed-loop RDP → Catmull-Rom Béziers with sharp corners kept → SVG. **Lambaya uygula** renders this path anti-aliased into the 2048² target, so the lamp gets exactly the SVG.

The **Basılacak gölge** view calls `designer.fieldForTarget()` (the real `WallField.compute` with bridges, roofs and hole filling) and samples that final field, as required by invariant 3.

## 9c. Menus and shortcuts (`menubar.js`)

Menus are data (`{ label, shortcut, action, enabled, visible, checked }`) defined in `main.js`. The same entry drives the menu row and the keyboard shortcut; `visible` scopes a shortcut to a workspace (e.g. `Alt+1` is the print bed in Lamba and the original view in the converter). Shortcuts are matched by physical key code for letters/digits and by character for symbols (Turkish layouts). Window zoom (Ctrl+= / Ctrl+- / Ctrl+0) stays in `electron/main.cjs` (`before-input-event`). Lamp undo/redo stores debounced snapshots (settings + target PNG) after each recompute.

## 10. Electron (`electron/`)

On Linux the main process forces `--gtk-version=3`: with GNOME/Wayland's default GTK 4 dialogs, opening the file chooser after a save dialog crashed the app (SIGTRAP). Exports also avoid the save dialog entirely (`file:save`).

| IPC channel | What it does |
|---|---|
| `fs:places` / `fs:list(dir)` / `fs:read(path)` | In-app file picker (`filepicker.js`): common folders, directory listing (non-hidden; folders + supported file types), file bytes (≤ 300 MB, allowed extensions only) |
| `file:save` `(name, ArrayBuffer)` / `file:reveal` | Writes an export (STL/3MF/OBJ/FBX/PLY/GLB/SVG/PNG/JSON) to the Downloads folder without a dialog (unique name), returns the path; reveal shows it in the file manager |
| `designs:list / read / write / delete / exists / dir / reveal` | JSON designs in `<userData>/designs/` |
| `bg:remove` `{ model, size, data }` | Runs the ONNX model and returns `{ mask }`. Returns `{ fallback: 'u2netp' }` if the big model can't be downloaded. Progress is sent on `bg:progress` |

`preload.cjs` exposes these as `window.appAPI`. `storage.js` falls back to `localStorage` when `appAPI` is absent (browser mode).

## 11. Tests (`tests/run-tests.js`)

Plain Node: it loads the core modules on `globalThis` and `THREE` from `node_modules`. It covers:

- projection round-trips for 8 shapes × 3 tapers, and box parity;
- watertightness, positive volume and no floating parts for 22 shape/mode/mount combinations;
- head bridging, rim-floating detection, the 45° chamfer, tube length, overhang roofs on a real cantilever, keyhole placement, and far-edge smoothness with the SDF sampler;
- the converter core: floating parts bridged, thin lines thickened, closed contours, SVG output;
- export: light-part separation, welded parts closed by index, and all six formats read back with equal triangle counts.

Extend it whenever you touch `wall_field.js`, `shell_mesher.js`, `exporters.js` or `stencil.js`. Details: `tests/CLAUDE.md`.
