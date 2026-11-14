# Cesium migration: design

Status: draft for Dev's review, 14 Nov 2026.

## Goal

Render Plan, Walk and Visor on a CesiumJS Mars globe (Cesium Mars from Cesium ion) instead of MapLibre, keeping the route planner, the science data and every panel unchanged.

## Why

- MapLibre assumes Earth and Web Mercator. Trek tiles cannot be used, the Visor has no real horizon, and the context beyond the 4 km site is a baked 200 m hillshade.
- Cesium Mars is a hosted global Mars tileset (3D Tiles, IAU_2015:49901): ~232 m imagery and ~200 m terrain globally, 6 m / 20 m at Jezero, 25 cm / 1 m at Gale. CesiumJS has `Ellipsoid.MARS`.

## What stays

- `app/src/lib/` (grid frame, A*, energy, budgets, turn-back, plan.json) and `app/src/plan/planLogic.ts`, `app/src/walk/*.ts` (track, playback, hazard, nearby, feeds, format, keys). All measurement stays in the local-metre frame with Mars radius 3396190 m.
- The pipeline and every bundle file (PMTiles layers, cost.bin, elev.bin, grid.json, site.json, photos.json, chemistry.geojson, conditions.json, traverse.geojson).
- All React panels: PlanRail, Walk rail (StopDetails), PlaybackBar, LayerPanel, SiteSwitcher, ModeSwitch, shell.

## What changes

| Part | MapLibre today | Cesium |
|---|---|---|
| Globe | `marsBaseStyle` + basemap.pmtiles | Cesium Mars 3D tileset from ion, `Ellipsoid.MARS`; basemap.pmtiles only when ion is unavailable |
| Science layers | PMTiles raster sources | Same PMTiles files through a custom Cesium imagery provider (Web Mercator tiling on the Mars ellipsoid), draped on the tileset |
| Plan map | `components/Map.tsx` | `globe/GlobePlanMap.tsx`, same props; click picks a lon/lat on the globe; stops and drop-off draggable |
| Overlays | roverOverlays.ts, MapLibre markers | `globe/overlays.ts`: entities clamped to the tileset for route, stops, drop-off, traverse, photo sites, chemistry |
| Walk map | `components/WalkMap.tsx` | `globe/WalkGlobe.tsx`, same props, chase camera |
| Visor | MapLibre pitched terrain | `globe/VisorGlobe.tsx`, first-person camera 1.7 m above ground, real horizon |
| Scale bar | metres per pixel from MapLibre zoom | metres per pixel from two picked points, measured in the local-metre frame |

## Heights

Bundle elevations (elev.bin, terrain) are MOLA-datum heights (e.g. Gale ≈ -4500 m). Cesium Mars heights are relative to its IAU 2015 reference body. They differ by a per-site offset. Each site gets `heightOffsetM = cesiumSurfaceHeight(siteCentre) - bundleElevation(siteCentre)`, measured once at load; Visor eye height is `bundleElevation(pose) + heightOffsetM + 1.7`.

## Token and failure

- `VITE_CESIUM_ION_TOKEN` in `app/.env.local` (git-ignored) and in Vercel env. Never committed.
- No token, an invalid token or ion unreachable: the app runs on the bare Mars ellipsoid with basemap.pmtiles and the site layers, and shows one notice line. Plan routing still works.

## Process

1. Spike (gate): Cesium Mars loads, PMTiles drape and align, picks land in the right grid cell, height offset measured on both sites. If draping on 3D Tiles fails, fall back to a Cesium globe with a heightmap terrain provider built from elev.bin inside the site.
2. Build behind `VITE_RENDERER=cesium|maplibre` (default `maplibre`) so main stays deployable.
3. Cut-over by Sun 15 Nov 12:00 IST (six hours before the planned 18:00 first submission; the hard deadline is 23:59 IST) only if Cesium is at least as good on both sites at 1440x900 and 1024x768; otherwise submit MapLibre.

## Needs Dev

Cesium ion account, an access token restricted to the deploy domain and localhost, Cesium Mars added to the account's assets.
