# renderer/src — module map

> **Türkçe özet:** Uygulamanın tüm kodu burada; her dosya tek bir global tanımlayan bir IIFE. Bir modülü değiştirmeden önce aşağıdaki tablodan ilgili `docs/modules/*.md` dosyasını okuyun.

Each file is an IIFE that defines **one global**; no bundler, no ES modules. Load order = `<script>` order in `../index.html`. Rules: `docs/DESIGN_RULES.md`. Algorithms: `docs/ARCHITECTURE.md`.

| File | Global | Layer | Read before changing |
|---|---|---|---|
| `shapes.js` | `Shapes` | core | `docs/modules/shapes-projection.md` |
| `projection.js` | `Projection` | core | `docs/modules/shapes-projection.md` |
| `wall_field.js` | `WallField` | core | `docs/modules/wall_field.md` |
| `shell_mesher.js` | `ShellMesher` | core | `docs/modules/shell_mesher.md` |
| `exporters.js` | `ModelExport` | core | `docs/modules/exporters.md` |
| `stencil.js` | `Stencil` | core | `docs/modules/stencil-converter.md` |
| `silhouette.js` | `Silhouette` | service | `docs/modules/silhouette.md` |
| `designer.js` | `Designer` | service | `docs/modules/designer.md` |
| `geometry.js` | `Geometry` | service | `docs/modules/geometry.md` |
| `model_import.js` | `ModelImport` | service | `docs/modules/ui-services.md` |
| `storage.js` | `DesignStorage` | service | `docs/modules/ui-services.md` |
| `filepicker.js` | `FilePicker` | service | `docs/modules/ui-services.md` |
| `editor.js` | `SilhouetteEditor` | UI | `docs/modules/editor.md` |
| `converter.js` | `ImageConverter` | UI | `docs/modules/stencil-converter.md` |
| `menubar.js` | `MenuBar` | UI | `docs/modules/ui-services.md` |
| `inspector.js` | `Inspector` | UI | `docs/modules/ui-services.md` |
| `helptips.js` | `HelpTips` | UI | `docs/modules/ui-services.md` |
| `main.js` | — (entry) | UI | `docs/modules/main.md` |
| `styles.css` | — | UI | `../CLAUDE.md` |

## Must-know rules for this directory

- **Core files stay DOM-free** (`npm test` loads them in Node). They end with `})(typeof window !== 'undefined' ? window : globalThis);`.
- Field values: `> 0.5` = lit = hole. Target: white = lit, 2048² over `[-R, R]²` cm. Meshes in mm, everything else in cm.
- Every preview samples the **final field** (`WallField.sampleField`), never the raw target.
- New setting → `SCHEMA` in `main.js`, then wire it by effect (field / mesh / look) — `docs/DESIGN_RULES.md` §3.
- UI text is Turkish; never open a native file dialog.
- Data flow in one line: target (designer) → `WallField.compute` → `ShellMesher.buildLamp` → `Geometry.buildScene` / `ModelExport.exportMeshes`.
