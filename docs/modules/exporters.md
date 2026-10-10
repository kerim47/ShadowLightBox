# `exporters.js`

> **Türkçe özet:** Lamba mesh'lerini STL, 3MF, OBJ, FBX (ikili 7.4), PLY ve GLB olarak yazar. Önizleme parçalarını atar, köşeleri birleştirir; ışık parçalarını (LED kapağı / tüp) ayırmak için `isLightPart` sağlar.

Layer: **core** (DOM-free; uses `TextEncoder`, optional `globalThis.fflate` for zip/zlib, `ShellMesher.toBinarySTL` for STL). Global: `ModelExport`.

## API

```js
ModelExport.FORMATS                         // [{ id, label, ext, mime, note (Turkish) }]
ModelExport.exportMeshes(format, meshes, title) // → { data: ArrayBuffer, ext, mime, label }; throws if no printable mesh
ModelExport.isLightPart(mesh)               // name matches /^(cap|led-|tube-cap|tube-holder)/
ModelExport.weld(mesh)                      // merge vertices within 1e-4 mm, drop collapsed triangles
ModelExport.toOBJ / toPLY / to3MF / toFBX / toGLB(meshes, title) // → ArrayBuffer
```

Format ids: `stl`, `3mf`, `obj`, `fbx`, `ply`, `glb`. Adding one: add to `FORMATS`, the `switch` in `exportMeshes`, the extension to `EXPORT_EXT` in `electron/main.cjs`, a round-trip check in `tests/run-tests.js` section 5, and the docs (`README.md` Output, `ARCHITECTURE.md` §5).

## Per-format rules

| Format | Units / axes | Structure |
|---|---|---|
| STL | mm, Z up | binary, one solid, unwelded (`ShellMesher.toBinarySTL`) |
| 3MF | mm, Z up | OPC zip (`fflate.zipSync` level 6 if loaded, else stored zip with own CRC32). One `<object>` per part + one assembly object with `<components>`; single build item |
| OBJ | mm, Z up | text, `o <name>` per part, 1-based global indices, 4 decimals |
| PLY | mm, Z up | binary little-endian, all parts merged |
| FBX | mm (`UnitScaleFactor` 0.1), Z up declared in `GlobalSettings` | binary 7.4, Blender's node + footer layout; per part a `Geometry` (vertices, `PolygonVertexIndex`, `LayerElementNormal` ByPolygonVertex with 30° smoothing, `LayerElementMaterial` AllSame, `Layer`) and a `Model`; one shared `Material`; arrays zlib-compressed (encoding 1) when fflate is loaded |
| GLB | metres, Y up (`(x, y, z) → (x, z, −y)`, a rotation so winding is kept) | one node + mesh per part, one material, `POSITION` with min/max, `UNSIGNED_INT` indices, 4-byte aligned chunks |

All formats except STL go through `prepared()`: drop `previewOnly`, weld, drop empty parts, make names unique and ASCII-safe.

## Light parts

`isLightPart` is the single definition used by the export dialog (`main.js` → `downloadModel`, default: excluded). The 3D view still has its own regexes (`KNOWN_ISSUES.md` #6).

## Verification

`tests/run-tests.js` section 5 writes every format for two lamps and reads them back: STL/OBJ/FBX/PLY with the three.js loaders, 3MF by unzip + XML parse (index validity, manifold), GLB by header/JSON/buffer-view checks. Triangle counts must equal the welded parts. During development the files were also opened with trimesh (STL/3MF/OBJ/PLY/GLB) and Assimp (all six). Unity and slicers are not run (`KNOWN_ISSUES.md` #8).

## Pitfalls

- `fflate` is absent in Node tests unless the test loads it; both code paths (stored zip / uncompressed FBX arrays) must stay valid.
- FBX names use `Name\x00\x01Class`; node names must be ASCII (written with `charCodeAt`).
- three.js `FBXLoader` needs the 160-byte-ish footer to detect end of content; keep the footer code.
