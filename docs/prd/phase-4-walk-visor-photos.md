# Phase 4 — Rover photos, Walk and Visor views

**Owner:** Archisha's machine (git only, no raw data). **Window:** hours 1–20. **Branch:** `archisha/p4-walk-visor`.

## Goal

Let the astronaut walk the planned route: a tablet view and a helmet-visor view, with the real rover photo taken nearest to each stop so they know what they will see on arrival.

## Part A — Rover photos (start in hour 1; riskiest input)

- Fetch image metadata for Curiosity (Navcam, Mastcam) and Perseverance (Navcam, Mastcam-Z) from NASA's public raw-image feeds. Each record carries sol, site, drive, camera, URL, credit.
- Join to position using the rover location tables. Dev's machine will publish two small files, `gale_poses.csv` and `jezero_poses.csv` (site, drive, lat, lon, heading, sol), cut from `pds_places`.
- Output `photos.json` per site: id, lat, lon, heading if known, sol, camera, image URL, thumbnail URL, credit line. Keep images inside the walk area only.
- **First-hour test:** the earlier Curiosity fetch returned zero images. Confirm within the hour that the feed works. If not, fall back to the PDS image archive; if that also fails, tell the coordinator — the walk view then uses Perseverance photos at Jezero only.
- Hot-link NASA's URLs or copy a small curated set; either way, keep the credit line with every image.

## Part B — Walk view (tablet)

- Reads the plan JSON from phase 3. Until that exists, use `app/src/fixtures/plan.sample.json`.
- A position marker moves along the route (scrubber and play). Shows next stop, distance and time to it, budget remaining, and whether the turn-back point has been passed.
- At each stop: the nearest photo(s), with sol, camera and credit, and a line on why this stop matters.
- Large touch targets, readable at arm's length.

## Part C — Visor view

- Same route in MapLibre's pitched 3D terrain, camera at eye height following the route heading.
- Minimal overlay only: heading, distance to next stop, budget remaining, hazard-ahead cue when the route nears impassable ground. Nothing else on screen.

## Rules

- Replays the plan; no real positioning.
- No NASA logos, mission patches or insignia. Credit lines are text.
- Every outside asset (fonts, icons, images) goes in `docs/references.md`.

## Done when

A route planned in the Plan view can be walked start to finish in both views, with a real photo and credit at each stop that has one nearby, and a clear "no photo here" state where none exists.
