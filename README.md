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
| `app/` | Web app: Vite + React + MapLibre GL |
| `data/` | Datasets. Git-ignored; present only on the coordinator machine |

## Working here

- `main` is always deployable.
- Branch as `<person>/<phase>-<topic>`, open one pull request per PRD deliverable.
- The repository is public. No secrets, keys or tokens in any commit.
- Anything you pull in from outside (data, code, images, fonts, libraries) gets a line in `docs/references.md` in the same pull request.
- No NASA logos, mission patches or insignia anywhere in the app, deck or video.

## Deploy

See [docs/deploy.md](docs/deploy.md) for R2 bundle hosting and the Vercel production deploy steps.

## Use of AI

AI coding assistants (Claude, Gemini) were used to write code and documentation in this repository, directed and reviewed by the team. Commits made with AI assistance carry a `Co-Authored-By` trailer. No AI-generated images, video or audio are used.
