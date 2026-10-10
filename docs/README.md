# Documentation index

> **Türkçe özet:** Belgelerin haritası. Yapay zeka ajanları için: önce kök `AGENTS.md`, sonra yalnızca işin gerektirdiği dosyayı açın — hepsini birden okumayın.

Read only what the task needs.

| File | Read it when |
|---|---|
| `../AGENTS.md` | always first: the agent guide (invariants, "where to change what", physics facts, pitfalls) |
| `ARCHITECTURE.md` | you change an algorithm or need the data flow (shapes, projection, wall field, mesher, silhouette, designer, 3D, editor, converter, Electron) |
| `DESIGN_RULES.md` | you are about to write code: layers, data contracts, units, settings wiring, UI/physics/performance/security rules, change checklist |
| `KNOWN_ISSUES.md` | something behaves oddly, or before refactoring (known bugs, duplication, missing coverage) |
| `modules/*.md` | you change a specific module: its API, state, callers, extension recipe, pitfalls |
| `../README.md` | user-facing features and wording |


## Module docs

| Doc | Covers |
|---|---|
| `modules/shapes-projection.md` | `shapes.js`, `projection.js` |
| `modules/wall_field.md` | `wall_field.js` (field, passes, SDF sampler) |
| `modules/shell_mesher.md` | `shell_mesher.js` (meshes, parts, layouts, print validation, STL) |
| `modules/exporters.md` | `exporters.js` (3MF/OBJ/FBX/PLY/GLB, light parts) |
| `modules/designer.md` | `designer.js` (target, recompute, simulation, accuracy) |
| `modules/geometry.md` | `geometry.js` (bed and room scenes, compare overlay) |
| `modules/silhouette.md` | `silhouette.js` (photo → mask, AI matte, portrait) |
| `modules/stencil-converter.md` | `stencil.js` + `converter.js` (Görsel Dönüştürücü) |
| `modules/editor.md` | `editor.js` (Siluet Editörü) |
| `modules/main.md` | `main.js` (sections, flows, wiring) |
| `modules/ui-services.md` | `menubar.js`, `inspector.js`, `helptips.js`, `filepicker.js`, `storage.js`, `model_import.js` |

Keep these in sync with the code: a behaviour change updates `README.md`, `AGENTS.md`, `ARCHITECTURE.md` and the module doc (`DESIGN_RULES.md` §10).
