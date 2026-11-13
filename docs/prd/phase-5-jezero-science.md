# Phase 5 — Jezero through the same pipeline; science ranking

> Read [`00-contracts.md`](00-contracts.md) first. File formats, coordinates and units are defined there and override anything below.

**Owner:** Dev's machine (needs `data/`). **Window:** hours 14–24. **Branch:** `dev/p5-jezero`.

## Goal

Show the tool is a generator, not a one-off: Jezero appears in the site switcher having gone through the identical scripts, with the walkability model's score on Perseverance's real path displayed.

## Part A — Jezero (committed)

- `pipeline/sites/jezero.yaml` only. No new pipeline code; if code has to change, change it for both sites.
- Inputs: `jezero_hirise_dtm/` (1 m), `jezero_hirise_ortho/` (25 cm), `jezero_ctx/` (5 m image, 20 m DEM for context), `pds_places/best_interp.csv`.
- Outputs: the same bundle as Gale (tiles, terrain, cost grid, `site.json`, photo index input for phase 4).
- In the app: a small "validated on an unseen site" panel with the number from the model card and Perseverance's path drawn over the walkability layer.
- Radiation at Jezero is not ground-measured. Label it as carried over from Curiosity's measurements, adjusted for elevation if that is cheap, and say so in the UI.

## Part B — Science-target ranking (only if the phase 2 gate passed)

- Rank candidate stops inside the walk area by mineral index strength, thermal contrast and image texture.
- Seed Gale with Curiosity's documented boxwork locations as named stops, each with a one-line reason and a source.
- Show as suggested stops in the Plan view that the user can accept; never auto-add.
- Timebox: 4 hours. If it is not clearly useful by then, ship the curated named stops only.

## Done when

- Switching to Jezero works end to end (layers, route, walk) with zero site-specific code.
- The validation panel shows the real number and method in one sentence.

## Additions (contracts v1)

- Jezero's bundle follows contracts section 4 with no exceptions; weather comes from Perseverance's station (MEDA, Spain).
- Stretch, only after Jezero is live: regional dust and temperature context from the UAE Hope orbiter as one extra `atmospheric` layer.
- If the model did not pass its gate, part B is curated named stops only.

## Reviewer check

1. Switch sites in the deployed app: layers, route and walk all work on Jezero.
2. `git diff main --stat` for this phase shows changes only under `pipeline/sites/`, data outputs and docs.
