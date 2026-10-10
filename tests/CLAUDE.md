# tests

> **Türkçe özet:** `npm test` = `node tests/run-tests.js` (~30 sn). Çekirdek modülleri Node'a yükleyip izdüşüm, su geçirmezlik, yapısal kurallar, dönüştürücü çekirdeği ve dışa aktarma biçimlerini denetler. Her değişiklikten sonra yeşil kalmalı.

`run-tests.js` is a plain Node script (no framework). It sets `globalThis.THREE = require('three')`, `require`s the core files from `renderer/src` (`shapes`, `projection`, `wall_field`, `shell_mesher`, `stencil`, `exporters`) and prints `ok` / `FAIL` per `check(name, ok, detail)`. Exit code 1 on any failure.

| Section | Checks |
|---|---|
| 1) İzdüşüm | `forwardShell ∘ inverseShell` identity for 8 shapes × 3 tapers; box parity with `inverseMap` |
| 2) Su geçirmez mesh | every part of 22 shape/mode/mount cases: each edge in exactly two opposite triangles, positive volume; `validatePrint` finds no floating part |
| 3) Yapısal kurallar | head bridging, rim-floating detection, 45° chamfer, tube length, overhang roofs, keyhole placement; converter core (floating parts bridged, thin lines thickened, closed contours, SVG); far-edge smoothness with the SDF sampler |
| 5) Dışa aktarma biçimleri | light parts separable; welded parts closed by index; STL/3MF/OBJ/FBX/PLY/GLB written and read back (three.js loaders via `vm.runInThisContext`, 3MF unzip + XML, GLB structure) with equal triangle counts |

## Rules

- Add checks to the matching section; name each check as a Turkish sentence stating the guarantee.
- Helpers available: `person(X, Y)` sample silhouette, `meshCheck(mesh)` → `{ bad, vol }`, `KINDS`, `D`, `CZ`, `MARGIN`.
- Section 5 replaces `globalThis.THREE` with a copy and loads three.js `examples/js` loaders; keep it last so earlier sections use the plain module.
- There is no UI test runner; see `docs/DESIGN_RULES.md` §9 for the Electron harness pattern.
