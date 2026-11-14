# Cesium Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Plan, Walk and Visor on a CesiumJS Mars globe (Cesium Mars from Cesium ion) while the route planner, science data and panels stay as they are.

**Architecture:** A new `app/src/globe/` module owns everything Cesium: viewer setup, a PMTiles imagery provider, pure frame/camera maths, overlay entities, and three view components with the same props as today's `Map`, `WalkMap` and `VisorView`. `App.tsx` picks the renderer from `VITE_RENDERER` so main stays on MapLibre until cut-over.

**Tech Stack:** CesiumJS (`cesium`, exact version pinned in Task 1), `vite-plugin-static-copy` for Cesium's static assets, existing React 19 + Vite 8 + pmtiles 4.5.0 + vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-cesium-migration-design.md`

## Global Constraints

- All distances, slopes and areas come from the local-metre frame in `app/src/lib/grid.ts` (Mars radius 3396190 m), never from Cesium geodesics.
- `VITE_CESIUM_ION_TOKEN` lives only in `app/.env.local` (git-ignored) and Vercel env; never committed, never logged.
- `VITE_RENDERER` = `maplibre` (default) or `cesium`; MapLibre code is deleted only after Dev approves the cut-over.
- Dependencies pinned to exact versions, each released at least two weeks ago.
- Do not edit `app/src/lib/`, `app/src/plan/planLogic.ts`, `app/src/walk/*.ts` logic or `pipeline/` except where a task names the file.
- Visual bar: design tokens only, no gradients, glows, emoji, filler copy or quotation marks; works at 1440x900 and 1024x768 on Gale and Jezero.
- Done for every task: `npx tsc -b`, `npm run build`, `npx vitest run` pass in `app/`; screenshots in `<worktree>/.shots/`.
- Commit trailer for Codex: `Co-Authored-By: GPT-6-Luna (Codex) <noreply@openai.com>`.

## Review Focus

1. No token, a bad token or ion unreachable: the app still renders the site layers on the bare Mars ellipsoid with basemap.pmtiles and one notice line; planning works. (Task 1 test `initCesium` returns `'offline'`; Task 8 manual check with the token unset.)
2. Height datum mismatch between bundle elevations (MOLA datum) and Cesium Mars: Visor eye must sit 1.7 m above the visible ground, never underground or floating. (Task 2 test for `eyeHeightM`; Task 7 screenshots at three route points per site.)
3. Click on sky, space or a spot the pick misses: no stop added, no error. (Task 2 test `cartesianToLonLat(undefined)` returns `null`; Task 5 manual check.)
4. Click or drag outside the 4 km grid: same behaviour as the MapLibre Plan map today (stop refused). (Task 5 test on `isInsideSite`.)
5. Switching site while tiles load: previous site's imagery layers and entities are all removed. (Task 3 test on `syncImageryLayers`; Task 4 test that `GlobeOverlays.clear()` empties its collections.)

---

### Task 1: Cesium setup and spike (gate)

**Files:**
- Modify: `app/package.json`, `app/vite.config.ts`, `app/.gitignore` (add `.env.local` if missing), `app/src/vite-env.d.ts`
- Create: `app/src/globe/cesiumSetup.ts`, `app/src/globe/cesiumSetup.test.ts`, `docs/cesium/spike.md`

**Interfaces:**
- Produces: `initCesium(token: string | undefined): 'ion' | 'offline'` (sets `window.CESIUM_BASE_URL`, `Ion.defaultAccessToken`, `Ellipsoid.default = Ellipsoid.MARS`); `createMarsViewer(container: HTMLElement, opts: { interactive: boolean }): Promise<{ viewer: Viewer; tileset: Cesium3DTileset | null }>` (no timeline, animation, geocoder, base layer picker, home or info widgets; tileset null when offline); `CESIUM_MARS_ASSET_ID: number`.

- [ ] **Step 1:** Add `cesium` (latest release at least two weeks old that exports `Ellipsoid.MARS`) and `vite-plugin-static-copy` as exact versions; copy `node_modules/cesium/Build/Cesium/{Workers,Assets,ThirdParty,Widgets}` to `cesium/` in dev and build; declare `VITE_CESIUM_ION_TOKEN` and `VITE_RENDERER` in `vite-env.d.ts`.
- [ ] **Step 2: Write the failing tests** in `cesiumSetup.test.ts`: `initCesium(undefined)` and `initCesium('')` return `'offline'`; `initCesium('abc')` returns `'ion'`; after either call `Ellipsoid.default.radii.x === 3396190`.
- [ ] **Step 3:** Run `npx vitest run src/globe/cesiumSetup.test.ts`; expected FAIL (module missing).
- [ ] **Step 4:** Implement `cesiumSetup.ts`. Take `CESIUM_MARS_ASSET_ID` from Cesium's Cesium Mars Sandcastle example.
- [ ] **Step 5:** Run the tests; expected PASS.
- [ ] **Step 6: Spike page.** A throwaway route `?spike=1` (not committed) that opens Gale and Jezero with the tileset, `image.pmtiles` draped through a quick provider, and `traverse.geojson` as a ground-clamped polyline. Answer in `docs/cesium/spike.md`, with screenshots:
  - Tileset loads with Dev's token; FPS at 1440x900 on this laptop.
  - Draping imagery on the 3D tileset works in this Cesium version (or not).
  - Alignment: the traverse polyline sits on the rover tracks visible in HiRISE (within ~5 m) on both sites; longitude convention matches (east-positive).
  - Pick: clicking the drop-off marker returns a lon/lat whose `grid.lonlatToRowCol` is within one cell of the drop-off's cell.
  - Height offset: Cesium surface height minus bundle elevation at each site centre, in metres.
- [ ] **Step 7: Gate.** If draping on 3D Tiles fails, note it in `spike.md`, then stop and report. The orchestrator then adds Task 3b: a `CustomHeightmapTerrainProvider` from `elev.bin` inside the site on a Cesium globe, with imagery layers on the globe. If the tileset does not load, stop and report.
- [ ] **Step 8: Commit** `cesiumSetup.ts`, its test, the config changes and `docs/cesium/spike.md`.

### Task 2: Frame and camera maths

**Files:**
- Create: `app/src/globe/frame.ts`, `app/src/globe/frame.test.ts`

**Interfaces:**
- Consumes: `GridOrigin`, `lonlatToLocalMetres` from `lib/grid.ts`.
- Produces:
  - `cartesianToLonLat(c: Cartesian3 | undefined): { lon: number; lat: number; heightM: number } | null`
  - `lonLatToCartesian(lon: number, lat: number, heightM: number): Cartesian3`
  - `eyeHeightM(bundleElevM: number, heightOffsetM: number, eyeM = 1.7): number`
  - `visorCamera(pose: { lon: number; lat: number; headingDeg: number }, groundM: number, pitchDeg = -4): { destination: Cartesian3; orientation: { heading: number; pitch: number; roll: number } }`
  - `chaseCamera(pose: { lon: number; lat: number; headingDeg: number }, groundM: number, rangeM = 220, pitchDeg = -40): { target: Cartesian3; offset: HeadingPitchRange }`
  - `metresPerPixel(a: { lon: number; lat: number }, b: { lon: number; lat: number }, pixels: number, origin: GridOrigin): number`

- [ ] **Step 1: Write failing tests** with exact values:
  - `cartesianToLonLat(undefined)` → `null`.
  - `cartesianToLonLat(new Cartesian3(3396190, 0, 0))` → lon 0, lat 0, heightM 0 (to 1e-6).
  - Round trip: `lonLatToCartesian(137.441633, -4.589467, -4501.04)` back through `cartesianToLonLat` returns the same values to 1e-7 deg and 1e-3 m.
  - `eyeHeightM(-4501.04, 12.5)` → `-4486.84`.
  - `visorCamera({lon:137.4,lat:-4.7,headingDeg:90}, -4500).orientation.heading` → `Math.PI/2`; pitch → `-4*Math.PI/180`; destination height `-4500 + 1.7` via `cartesianToLonLat`.
  - `metresPerPixel` for two points 0.001 deg of longitude apart at the Gale origin over 100 px equals `3396190*cos(lat_c)*0.001*PI/180/100`.
- [ ] **Step 2:** Run `npx vitest run src/globe/frame.test.ts`; expected FAIL.
- [ ] **Step 3:** Implement with `Ellipsoid.MARS.cartesianToCartographic` / `Cartesian3.fromDegrees(..., Ellipsoid.MARS)`; `metresPerPixel` uses `lonlatToLocalMetres`, not Cesium.
- [ ] **Step 4:** Run the tests; expected PASS.
- [ ] **Step 5: Commit.**

### Task 3: PMTiles imagery and science layers

**Files:**
- Create: `app/src/globe/pmtilesImagery.ts`, `app/src/globe/imageryLayers.ts`, `app/src/globe/imageryLayers.test.ts`

**Interfaces:**
- Consumes: `SiteData`, `SiteLayer`, `LayerState` from `types.ts`; `resolveSiteAssetUrl` from `config.ts`.
- Produces:
  - `createPMTilesImagery(url: string): Promise<ImageryProvider>`: Web Mercator tiling scheme on `Ellipsoid.MARS`; min/max level and rectangle from the PMTiles header; `requestImage(x, y, level)` reads `PMTiles.getZxy` and returns an `ImageBitmap`, or an empty transparent tile when the tile is missing.
  - `syncImageryLayers(current: ReadonlyMap<string, { show: boolean; alpha: number }>, layers: SiteLayer[], states: Record<string, LayerState>): { add: string[]; remove: string[]; update: { id: string; show: boolean; alpha: number }[] }` (pure)
  - `class GlobeImagery { constructor(target: ImageryLayerCollection); setSite(site: SiteData): Promise<void>; apply(states: Record<string, LayerState>): void; clear(): void }`. `target` is the tileset's imagery collection, or `viewer.imageryLayers` in the offline or fallback case.

- [ ] **Step 1: Write failing tests** for `syncImageryLayers`:
  - Empty current, two raster layers, one checked → `add` both ids, `update` sets show true/false and alpha from opacity.
  - Current has a layer not in the new site → it appears in `remove`.
  - Unchanged state → empty `add`, `remove` and `update`.
  - Layers with `type: 'points'` are never added as imagery.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement `syncImageryLayers`, `createPMTilesImagery` and `GlobeImagery`. Keep layer order the same as in the layer panel.
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5:** Screenshot Gale and Jezero with the image, slope and CRISM layers on, aligned with the traverse from the spike.
- [ ] **Step 6: Commit.**

### Task 4: Overlays

**Files:**
- Create: `app/src/globe/overlays.ts`, `app/src/globe/overlays.test.ts`

**Interfaces:**
- Consumes: `Plan` from `lib/plan.ts`; `RouteTrack` from `walk/track.ts`; `RoverOverlayState` from `components/roverOverlays.ts`; `groupChemistryByPosition` from `lib/chemistry.ts`.
- Produces: `interface OverlayHost { entities: EntityCollection }` (a `Viewer` satisfies it); `photoSites(photos: RoverPhoto[]): { lon: number; lat: number; count: number; solMin: number; solMax: number }[]` (pure; moved from roverOverlays.ts logic); `class GlobeOverlays { constructor(host: OverlayHost); setPlan(plan: Plan | undefined): void; setRover(traverse: GeoJSON.LineString | null, sites: ReturnType<typeof photoSites>, state: RoverOverlayState): void; setChemistry(groups: ChemistryGroup[], visible: boolean): void; setWalker(pose: { lon: number; lat: number; headingDeg: number } | null): void; hoverLabel(picked: unknown): string | null; clear(): void }`.

- [ ] **Step 1: Write failing tests:**
  - `photoSites` groups three photos at one position and one at another into two sites with counts 3 and 1 and the right sol range.
  - `hoverLabel` for a photo-site entity with count 24, sols 3543–3560 → `24 photos · sol 3543–3560`.
  - After `setPlan(samplePlan)` then `clear()`, `host.entities.values.length === 0`, where `host = { entities: new EntityCollection() }` (no Viewer needed in tests).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement. Route and traverse are polylines with `clampToGround: true` and `classificationType: ClassificationType.CESIUM_3D_TILE` (or `TERRAIN` in the fallback). Stops are numbered billboards drawn from SVG with tokens. The drop-off is the same hexagon SVG as the MapLibre marker. Photo dots are 2–4 px points by count. Points use `HeightReference.CLAMP_TO_3D_TILE`.
- [ ] **Step 3b: Route readability (owner request).**
  - Chevrons every ~150 m along each leg, pointing in the direction of travel.
  - Legs coloured in order, one step darker per leg, from the route token.
  - Where two or more legs share ground (within 3 m), draw that stretch once, as one line, with chevrons for every direction it is walked (one-way stretches get one-way chevrons, out-and-back stretches get both). Shared stretches have their own colour, never a stack of leg colours.
  - A fork marker (diamond) wherever the single line splits into separate legs or legs merge back into one line, labelled with where each branch goes ("to Stop 2", "back to drop-off").
  - A leg label "1 → 2 · 1.2 km · 25 min" at mid-leg, shown when there is room or on hover.
  - Hovering a leg highlights it, dims the others and emits `onLegHover(legIndex | null)` so the side panel can highlight the matching stop.
  - Pure helpers in `app/src/globe/routeShape.ts` with exact tests: `sharedSegments(legs, toleranceM)` (stretches with the leg indices and directions that use them), `forkPoints(legs, toleranceM)` (where the line splits or merges, with each branch's destination), `chevronPositions(line, spacingM)`. All distances use the local-metre frame.
- [ ] **Step 3c: Coordinates (owner request).**
  - A cursor readout of lat, lon (4 decimals, N/S and E/W) and elevation in metres.
  - Lat/lon shown on each stop and the drop-off, in the stop row and its hover label.
  - A toggleable graticule (every 10° on the globe, finer when zoomed into a site) with edge labels.
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5: Commit.**

### Task 5: Plan globe

**Files:**
- Create: `app/src/globe/GlobePlanMap.tsx`, `app/src/globe/globe.css`, `app/src/globe/planPick.ts`, `app/src/globe/planPick.test.ts`
- Modify: `app/src/App.tsx` (renderer switch only), `app/src/components/ScaleBar.tsx` (accept `metresPerPixel` as a prop if it does not already)

**Interfaces:**
- Consumes: Tasks 1–4; `MapProps` as currently defined in `components/Map.tsx` (siteData, layerStates, roverOverlayState, plan, onMapPoint, onStartChange, onStopChange).
- Produces: `GlobePlanMap: React.FC<MapProps>`; `isInsideSite(grid: RouteGrid, lon: number, lat: number): boolean`; `const RENDERER: 'maplibre' | 'cesium'` exported from `config.ts`.

- [ ] **Step 1: Write failing tests** for `isInsideSite`: the Gale drop-off is inside; a point 3 km west of the grid's west edge is outside; the exact north-east corner cell is inside.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement `planPick.ts`. In `GlobePlanMap`:
  - Use `createMarsViewer(..., { interactive: true })` and frame the site rectangle with 10 % padding on load and on site change.
  - A left click picks a position with `scene.pickPosition`, falling back to `globe.pick`. Use `cartesianToLonLat`; ignore `null` and points outside the site. Otherwise call `onMapPoint`.
  - Dragging a stop or the drop-off disables camera input while dragging and calls `onStopChange` / `onStartChange` on release.
  - Hover uses `GlobeOverlays.hoverLabel` in the map label style.
  - The 3D relief button toggles between top-down (pitch -90°) and tilted (pitch -45°).
  - The scale bar uses `metresPerPixel` from two picks 100 px apart at bottom centre.
  - Show the offline notice when `initCesium` returned `'offline'`.
- [ ] **Step 4:** Run; expected PASS.
- [ ] **Step 5:** With `VITE_RENDERER=cesium`, screenshot Gale and Jezero at 1440x900 and 1024x768: empty plan, a 3-stop plan on photo sites, the hover label and a dragged stop. The route must recompute after the drag.
- [ ] **Step 6: Commit.**

### Task 6: Walk globe

**Files:**
- Create: `app/src/globe/WalkGlobe.tsx`
- Modify: `app/src/components/WalkView.tsx` (choose WalkMap or WalkGlobe by `RENDERER`)

**Interfaces:**
- Consumes: `chaseCamera` (Task 2), `GlobeOverlays` (Task 4), `GlobeImagery` (Task 3); `WalkMapProps` as in `components/WalkMap.tsx` (siteData, plan, track, lon, lat, alongM).
- Produces: `WalkGlobe: React.FC<WalkMapProps>`.

- [ ] **Step 1:** Implement `WalkGlobe`: a non-interactive viewer, the route and stops from `GlobeOverlays.setPlan`, the walker from `setWalker`, and the camera from `chaseCamera` every frame with heading from the track. With an empty plan, frame the drop-off as the MapLibre Walk does.
- [ ] **Step 2:** Screenshot Walk on both sites at both sizes: start, at a stop with photos, near the end, and the empty plan.
- [ ] **Step 3: Commit.**

### Task 7: Visor globe

**Files:**
- Create: `app/src/globe/VisorGlobe.tsx`
- Modify: `app/src/components/VisorView.tsx` (render VisorGlobe when `RENDERER === 'cesium'`, keeping the heading, next-stop, remaining and hazard overlays)

**Interfaces:**
- Consumes: `visorCamera`, `eyeHeightM` (Task 2); the site's `heightOffsetM` measured once on load (Cesium surface height at the site centre minus `grid.getElevation` at the centre cell); `walkStateAt`, `hazardAhead` unchanged.
- Produces: `VisorGlobe: React.FC<VisorViewProps>` (siteData, plan, track, elapsedS).

- [ ] **Step 1:** Implement: camera from `visorCamera(pose, eyeHeightM(grid elevation at pose, heightOffsetM))`, field of view about 70°, `scene.skyAtmosphere` and fog on, tuned to read as Mars dusk using tokens where Cesium accepts colours.
- [ ] **Step 2:** Screenshot the Visor at 0 %, 50 % and 90 % of the route on both sites at both sizes. Check the eye sits about 1.7 m above the visible ground in each shot, and that the horizon is continuous with no hard band.
- [ ] **Step 3: Commit.**

### Task 8: Cut-over and review

**Files:**
- Modify: `app/src/config.ts` (default `RENDERER` to `cesium`), `docs/deploy.md` (add `VITE_CESIUM_ION_TOKEN` to the Vercel env steps), `docs/prd/00-contracts.md` (regional basemap line: Cesium Mars, basemap.pmtiles offline fallback), `docs/references.md` (Cesium Mars and its data sources)

- [ ] **Step 1:** Full visual review on both sites at both sizes, comparing Cesium and MapLibre for every Plan, Walk and Visor state. Run once with the token unset to confirm the offline mode.
- [ ] **Step 2:** Run `npm run build` and record the bundle size; Cesium's static assets must be served from `cesium/`.
- [ ] **Step 3:** Hand the comparison to Dev and flip the default only with his approval. Deleting MapLibre (`Map.tsx`, `WalkMap.tsx`, `mapSetup.ts`, `roverOverlays.ts`, the `maplibre-gl` dependency) is a separate commit after the flip.
- [ ] **Step 4: Commit.**

## Execution order

Task 1 alone (gate). Then Tasks 2 and 3 in one worker. Then two workers in parallel: Tasks 4 and 5 (Plan), and Tasks 6 and 7 (Walk and Visor). Task 6 depends on Task 4's `GlobeOverlays`, so the Walk worker starts after Task 4 merges. Task 8 is done by the orchestrator with a review worker.
