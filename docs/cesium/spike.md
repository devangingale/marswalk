<!-- Written with AI assistance, directed and reviewed by the team. -->
# Cesium Mars spike

Go/no-go spike for moving Sol-48 from MapLibre onto the Cesium Mars globe. Run it with
`npm run dev` in `app/` and open `/?spike=1`. Add `&view=lon,lat,range` to start top-down over a spot.
The spike code is in `app/src/globe/spike.ts` and `app/src/globe/pmtilesImagery.ts`.

Setup: CesiumJS 1.146.0 (it has `Ellipsoid.MARS`) and tileset asset 3644333. Measured in Chrome
(Playwright, headed) on an Apple M1 MacBook Air, with a 1440x900 viewport at device pixel ratio 1.
Screenshots are in `.shots/` (git-ignored).

**Verdict: go.** Every gate passed. The open items are the height datum, the imagery resolution
at the landing sites, and the build setup notes at the end.

## Tileset and FPS

- The tileset loads with the token. `Cesium3DTileset.fromIonAssetId(3644333)` resolves, and the globe
  renders from space (`01-globe-space.png`). Cesium's credit display stays on.
- FPS (requestAnimationFrame rate over 5 s, 3 s while flying):

  | View | Idle | Flying in |
  |---|---|---|
  | Globe from space | 60.0 | n/a |
  | Gale, 6 km oblique, traverse and sample image | 60.1 | 53.5 to 55.9 |
  | Jezero, 6 km oblique, traverse | 60.1 | 59.4 to 60.0 |

## Imagery draping

- Draping works through `tileset.imageryLayers.add(new ImageryLayer(provider))`, the documented
  1.146 API. See `02-gale.png`, `05-sample-topdown.png` and `05b-sample-close.png`.
- The custom provider subclasses `UrlTemplateImageryProvider`. It uses a `WebMercatorTilingScheme` on
  `Ellipsoid.MARS` and overrides `requestImage` to read tiles with `pmtiles`.
- Gotcha: Cesium uploads imagery `ImageBitmap`s without flipping them. Tiles must be decoded with
  `createImageBitmap(blob, { imageOrientation: 'flipY' })`, or each tile renders upside down.
- Draped imagery picks its level from the 3D tile's geometric error, not from screen pixels. At 800 m
  range Cesium requested only z13 to z15 of the z13 to z17 sample, so the result is softer than the
  source. At 250 m range it is sharper (`05b`).
- Thin black seam lines show at some tileset tile edges at oblique angles (`02-gale.png`,
  `04-jezero.png`). They come from the tileset, not from our layers.

## Alignment of the traverses

- Longitude is east-positive, confirmed. Both traverses land on their sites at 137.4 E and 77.45 E,
  and the east-positive sample image matches the imagery under it to within 1 m (see the next section).
- Rover tracks are not visible in the Cesium Mars imagery at any spot checked. This means the line
  cannot be measured against tracks.
  - Gale: four top-down views at 300 m along the traverse (`08` to `11`) and the landing at 150 m
    (`06`, `06b`). The imagery there resolves to roughly 0.5 to 1 m.
  - Jezero: the imagery is about 6 m per pixel (`07c-jezero-pose.png`, `12-jezero-landing.png`).
- Against landforms, both lines are consistent with the terrain:
  - At Gale, the line follows the valley floor and ridge lips (`10-gale-trav-c.png`).
  - At Jezero, the line loops through Séítah and runs along the base of the delta scarp
    (`04-jezero.png`).
- Offset estimate:
  - Gale: no systematic shift visible. Without tracks, a shift under about 5 m cannot be ruled out.
  - Jezero: under about 20 m, set by the 6 m imagery.

## Sample image against Cesium imagery (Gale)

- The sample image lines up. Phase correlation between screenshots with the layer on and off
  (`05b-sample-close*.png`, `05-sample-topdown*.png`) measured:
  - 250 m range (about 0.20 m per pixel): a shift of 2 px, about 0.4 m.
  - 800 m range (about 0.64 m per pixel): a shift of 1 px, about 0.6 m.
- So the offset is under 1 m. Both layers look like the same orbital source: grayscale correlation at
  zero shift is 0.97.

## Heights against rover poses

`scene.sampleHeightMostDetailed` on the tileset, at the first pose of each `shared/poses/*.csv`:

| Site | Point | Cesium height | Pose elevation | Cesium minus pose |
|---|---|---|---|---|
| Gale | 137.441633, -4.589467 | -4427.28 m | -4501.04 m | +73.76 m |
| Jezero | 77.4508857, 18.4446271 | -2640.83 m | -2569.91 m | -70.92 m |

- The two offsets have opposite signs, so no single constant fixes both sites.
- This matches different vertical datums. Cesium heights are above the 3396190 m sphere, and the pose
  elevations are most likely above the MOLA areoid. This is not yet verified.
- The app needs a per-site height offset (or areoid correction) before rover poses or the local grid
  heights go onto the tileset. Horizontal metres in `app/src/lib/grid.ts` are unaffected.
- `sampleHeightMostDetailed` returned no height on one cold start. The camera then flew relative to the
  ellipsoid and framed the wrong view. It did not happen again, and the spike now logs a warning when
  it does.

## Picking

`scene.pickPosition` on a left click, compared with the known point projected to the screen:

| Case | Range | Lon/lat error |
|---|---|---|
| Gale pose, screen centre | 150 m top-down | under 0.001 m |
| Jezero pose, screen centre | 150 m top-down | under 0.001 m |
| Gale pose, about 230 px off centre | 150 m top-down | 0.007 m |
| Jezero pose, about 230 px off centre | 150 m top-down | 0.006 m |
| Jezero pose, oblique | 6 km, -60° pitch | 2.3 m (picked height 3.2 m below the most-detailed sample) |

Yes, a click lands within 1 m at walking zoom. At a 6 km overview the error grows to about 2 m. That
is a fraction of a pixel there and comes from the coarser tile level that is rendered.

## Notes for the migration

- `cesium@1.146.0` declares `@cesium/engine ^26.4.0`, which now resolves to 26.5.0 (the 1.147
  engine), and that engine drops the `ForEach` export the 1.146 entry still re-exports. `package.json`
  pins `@cesium/core` 0.1.0, `@cesium/engine` 26.4.0 and `@cesium/widgets` 16.3.0 through
  `overrides` so the 1.146 set stays consistent.
- `VITE_CESIUM_ION_TOKEN` is inlined into the built JavaScript. Any deployed build publishes it, so the
  token should be restricted to the deploy origins in Cesium ion.
- The spike chunk is 4.2 MB minified (1.1 MB gzip) and loads only behind `?spike=1`. The MapLibre
  entry chunk does not contain Cesium.
- `createMarsViewer` uses `globe: false`, so offline mode (no token) renders an empty scene. Offline
  will need its own fallback surface.
