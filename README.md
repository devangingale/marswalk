# Sol-48

A layered, walk-scale map for planning and carrying out a Marswalk. Built for the NASA Space Apps Challenge 2026.

An astronaut stacks terrain, thermal, mineral and radiation layers over a few square kilometres of Mount Sharp (Gale crater), drops science stops, and gets a safe route with distance, time, energy and radiation budgets and a turn-back limit. The same plan is then walked in a tablet view and a helmet-visor view, with real rover photos at each stop. Jezero crater runs through the identical pipeline as a second site.

## Layout

| Path | What |
|---|---|
| `docs/plan.md` | The full plan |
| `docs/prd/` | One short brief per phase. Start here if you are picking up work |
| `docs/references.md` | Every dataset, library and tool used (feeds the submission form) |
| `docs/submission.md` | Draft text for the project page |
| `pipeline/` | Python: crop, derive, model, bake tiles |
| `app/` | Web app: Vite + React, CesiumJS globe and MapLibre GL maps |
| `data/` | Datasets. Git-ignored; present only on the coordinator machine |

## Working here

- `main` is always deployable.
- Branch as `<person>/<phase>-<topic>`, open one pull request per PRD deliverable.
- The repository is public. No secrets, keys or tokens in any commit.
- Anything you pull in from outside (data, code, images, fonts, libraries) gets a line in `docs/references.md` in the same pull request.
- No NASA logos, mission patches or insignia anywhere in the app, deck or video.

## Deploy

The app is a static site on Cloudflare Pages. Its data (site bundles, relay passes, the 360° panoramas) is served from a Cloudflare R2 bucket:

- **Every push to `main`** builds, tests and deploys the app (`.github/workflows/deploy-pages.yml`).
- **Daily at 06:17 UTC**, `.github/workflows/refresh-data.yml` refreshes the data on R2:
  - fetches the current NASA NAIF SPICE kernels (`pipeline/fetch_spice.py`);
  - recomputes 30 days of MRO and Mars Odyssey relay passes over Gale and Jezero (`pipeline/passes.py`);
  - rebuilds the 2:1 Photojournal panoramas and `panoramas.json` (`pipeline/build_panoramas.py`);
  - syncs everything to R2 (`pipeline/upload_r2.py`).
- **DEM-derived site bundles** (tiles, route grids, walkability) need the raw datasets, so they are built and uploaded from the coordinator machine.
- **3D Mars terrain** streams from Cesium ion (Cesium Mars 3D Tiles) when `VITE_CESIUM_ION_TOKEN` is set.

[docs/deploy.md](docs/deploy.md) has the exact setup: R2 bucket and CORS, Cesium ion token restrictions, the Pages project, the GitHub secrets and variables, and the coordinator commands. `app/.env.example` lists the build variables.

## Use of AI

AI coding assistants (Claude, Gemini) were used to write code and documentation in this repository, directed and reviewed by the team. Commits made with AI assistance carry a `Co-Authored-By` trailer. No AI-generated images, video or audio are used.
