# Phase 3 — App shell, Plan view, route and budgets

**Owner:** Samruddhi's machine (git only, no raw data). **Window:** hours 1–14. **Branch:** `samruddhi/p3-plan-view`.

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
