# Phase 3 — App shell, Plan view, route and budgets

> Read [`00-contracts.md`](00-contracts.md) first. File formats, coordinates and units are defined there and override anything below.

**Owner:** Samruddhi's machine (git only, no raw data). **Window:** hours 1–14. **Branch:** `samruddhi/p3-plan-view-route`.

## Goal

The habitat-console view: stack layers, drop science stops, get a safe route with budgets and a turn-back limit. This is the core of the product.

## Inputs

- `app/public/sample/` tile bundle and `site.json` (from phase 1; a tiny stand-in exists until then). Real tiles are fetched by URL from `site.json` — never hard-code a site.
- Cost grid: flat binary + JSON header (width, height, cell size in metres, origin, nodata).

## Deliverables

1. **App shell** in `app/`: Vite + React + TypeScript + MapLibre GL, PMTiles protocol, static build. Top-level mode switch: Plan / Walk / Visor. Site switcher driven by a list of `site.json` URLs.
2. **Layer panel:** toggle and opacity per layer, legend with units, and each layer's true resolution shown (for example "Thermal inertia · 100 m").
3. **Stops:** click to add, drag to move, reorder, name, delete. Start/end is the habitat marker.
4. **Route planner** in a web worker: least-cost path (A*) across the cost grid through the stops in order. Impassable cells are never crossed; if a stop is unreachable, say so.
5. **Budgets panel:** distance, time, climb/descent, energy, radiation dose, and a turn-back point where remaining budget equals the cost of walking home. Parameters (walk speed, suit mass, time limit) editable with sensible defaults.
6. **Plan export:** the plan as one JSON object in app state (stops, route polyline, per-leg budgets) that Walk and Visor read.

## Rules

- All distances come from the cost grid's metre coordinates, not from MapLibre (the map thinks it is on Earth, which is 1.88× bigger). Custom scale bar.
- Energy model lives in one file, `app/src/lib/energy.ts`, with its source cited in a comment and in `docs/references.md`. Mars gravity 3.71 m/s².
- Dose = daily surface dose from `site.json` × walk hours; a "solar event" toggle swaps in the elevated rate. Show the number plainly; do not dramatise a small value.
- No backend, no accounts, no network calls except tile/asset fetches.

## Done when

- Dropping three stops draws a route that visibly avoids steep ground, with every budget filled in and a turn-back marker.
- Route unit tests pass on synthetic grids: a wall, a ramp, an unreachable stop.
- Works at laptop width and at tablet width.
- Switching the site list entry reloads everything with no code change.

## Additions (contracts v1)

- Build against `app/public/sample/gale/` until real tiles are published; the only switch is the `TILES_BASE` config value.
- Route grids, plan object and budgets exactly as contracts sections 6, 7 and 10. The planner reads `cost.bin` and `elev.bin`; it does not compute slope limits itself.
- **Conditions panel:** season selector driving weather, dust and radiation from `conditions.json` (section 9), each value shown with its source and agency.
- **Chemistry points** from `chemistry.geojson` as a `points` layer; clicking one shows composition and offers "add as stop".
- **Suggested stops** from `stops.json`, shown as suggestions the user accepts.
- Start marker is movable and labelled "Rover drop-off"; the route always returns to it.
- Commit `app/src/fixtures/plan.sample.json` in the first pull request so phase 4 can start.
- Deploys to Vercel from `main`.

## Reviewer check

1. On the sample bundle, drop three stops: a route appears, every budget has a value, a turn-back marker is shown.
2. Put a stop on ground marked impassable: the app says it cannot be reached and draws nothing through red ground.
3. Measure one leg by hand from the local-metre formulas in contracts section 3; it matches `distance_m` within 2 %.
4. Export the plan; it validates against the shape in contracts section 7.
