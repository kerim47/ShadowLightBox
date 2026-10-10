# CLAUDE.md

Electron app that turns a photo into a 3D-printable shadow lamp (STL, 3MF, OBJ, FBX, PLY, GLB). This file holds the essentials. Everything else is read **on demand** — open only the doc the task needs (map below), never all of them.

## Documentation map (read when needed)
| Need | Open |
|---|---|
| Which doc covers what | `docs/README.md` |
| Full agent guide: invariants, "where to change what", physics facts, pitfalls | `AGENTS.md` |
| Algorithms and data flow | `docs/ARCHITECTURE.md` |
| Rules before writing code (layers, data contracts, settings wiring, UI/physics/perf/security, checklist) | `docs/DESIGN_RULES.md` |
| Known bugs, duplication, coverage gaps | `docs/KNOWN_ISSUES.md` |
| One module's API, callers, extension recipe | `docs/modules/<module>.md` |
| Directory guides (auto-loaded when you open files there) | `renderer/CLAUDE.md`, `renderer/src/CLAUDE.md`, `electron/CLAUDE.md`, `tests/CLAUDE.md` |

## Run / test
- `npm start` to run, `npm test` to test (~30 s). Tests check projection math, mesh watertightness, the converter core and every export format, and **must pass after every change**.

## Conventions
- No bundler, no ES modules: each `renderer/src/*.js` is an IIFE exposing one global; script order in `index.html` matters. Core modules (`shapes`, `projection`, `wall_field`, `shell_mesher`, `exporters`, `stencil`) stay DOM-free so Node tests can load them.
- three.js is pinned to r128 (`examples/js` loaders as globals) — don't upgrade.
- UI text is **Turkish**; code identifiers English; comments match the surrounding file. Docs are English with a one-line Turkish summary.
- Units: lamp geometry / UI in **cm**; meshes / STL in **mm** (`MM = 10`).
- Wall field `F`: values 0..1, **> 0.5 = hole** (light passes). Target image: **white = lit**, 2048² covering `[-R, R]²` cm, sampled through its signed distance field.

## Invariants — never break
1. Meshes are watertight (shared vertices, no T-junctions).
2. Shapes are star-shaped around the axis and CCW.
3. Every preview (simulation, wall strip, room texture, bed mask, accuracy) samples the **final field**, never the raw target.
4. Printed parts never float (islands bridged or removed as specks).
5. `previewOnly` meshes never go into any export.
6. New setting = `SCHEMA` entry in `main.js`; field-affecting ones are also read in `designer.readParams()` and added to the recompute list in `designer.js`; look-only ones go to `look` + the `relook` list; mesh-only ones go in `printOpts()`.
7. Design file is v2; v1 files must keep loading.

## Key files (`renderer/src/`)
`shapes.js` body shapes · `projection.js` forward/inverse projection · `wall_field.js` field + printability passes (the core) · `shell_mesher.js` meshes + STL · `exporters.js` other formats + light parts · `silhouette.js` photo → mask · `designer.js` target canvas, simulation, accuracy · `geometry.js` 3D views · `editor.js` paint editor · `stencil.js` + `converter.js` image converter (optional tool, Araçlar menu) · `menubar.js` menus/shortcuts · `inspector.js` right-side Inspector · `filepicker.js` in-app file picker (never open GTK dialogs: they crash on Linux) · `helptips.js` "?" help icons (put explanations in `note`/`.field-note`) · `main.js` UI wiring + menu definitions. Tests: `tests/run-tests.js`. Full table: `renderer/src/CLAUDE.md`.

Keep `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md` and the matching `docs/modules/*.md` in sync when behaviour changes.
