# `geometry.js`

> **Türkçe özet:** İki three.js sahnesi: "Yazıcı Tablası" (baskı düzeni, ölçüler, gölge maskesi) ve "Karanlık Oda" (duvardaki lamba, LED, simülasyon dokusu veya gerçek gölge haritası). Karşılaştırma modeli bindirmesi de burada.

Layer: **service** (three.js r128, WebGL). Global: `Geometry`. Overview: `ARCHITECTURE.md` §8.

## API

```js
const geo = Geometry.init(wrapEl);   // inserts the WebGL canvas, starts the rAF render loop
geo.buildScene(opts);                // full rebuild (meshes changed)
geo.updateRoom({ look, simCanvas, wallR }); // look-only refresh, no mesh rebuild
geo.setView('bed' | 'room'); geo.getView();
geo.setCamPreset('iso' | 'top' | 'front');
geo.setShowLid(b) / isLidVisible();  // "Montaj parçaları" on the bed
geo.setShowDims(b) / isDimsVisible();
geo.setLightOn(b) / isLightOn();
geo.setRealShadow(b) / isRealShadow(); // shadow map from the real meshes instead of the simulation
geo.setCompareModel(THREE.Group | null); geo.setCompareOptions(o); geo.compareStats();
```

`buildScene(opts)`: `{ meshes (assembled, mm), printMeshes (print layout, mm), floatingNames, d, cz, R, simCanvas, maskCanvas, shadowBBox, wallR, bed, bodyMM, fitsBed, look }`.

## Scenes

- **Bed:** `bedSpace` rotated so lamp `z` is world up; meshes scaled 0.1 (mm → cm). White material, floating parts red. Shadow mask plane `2R × 2R` under the bed; red dimension lines, green axes, bed plate with 20 mm grid (red edge if the body doesn't fit). Light parts (`/^(cap|led-|tube-cap|tube-holder)/`) hidden unless "Montaj parçaları".
- **Room:** lamp coordinates = world (wall `z = 0`). Wall plane + shadow texture plane (`2·wallR`), floor, point light at `(0, 0, cz)` with glow sprite and bulb. Light off → daylight lighting. Real shadow → PCF soft shadow map, `autoUpdate = false`, `dirtyShadow()` on change, distance decay off.
- `applyLook(opts)`: LED colour/intensity, glow size, wall colours (the lit-wall material uses `convertSRGBToLinear()` + `toneMapped: false` so it matches the texture's dark exactly), shadow plane size, wall/floor scale (`wallR·10`), fog distance, floor height.

## Camera

Orbit camera per view (`cams.bed` free, `cams.room` limited to the front). Presets use `sceneExtent()` on the bed and `max(R, 0.75·wallR)` in the room. `buildScene` refits when the extent changes by > 35 %; `updateRoom` refits the room when `wallR` changes by > 20 %.

## Pitfalls

- The render loop uses `requestAnimationFrame`; hidden/background windows don't paint. Screenshot harnesses need `setBackgroundThrottling(false)`.
- Materials flagged `userData.keep` are shared and must not be disposed by `clearGroup`.
- Colour-space mismatch between a basic material and an sRGB canvas texture shows as a visible square seam; see `DESIGN_RULES.md` §4.
- Two light-part regexes live here (`KNOWN_ISSUES.md` #6).
