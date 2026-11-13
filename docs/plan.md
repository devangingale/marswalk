# Marswalk — NASA Space Apps 2026 plan (fresh start)

## Context

We are restarting the hackathon entry from zero in a new folder, `D:\NASA - Marswalk`, keeping only the datasets from `D:\NASA - P11`. The old code, frontend, worktrees and Samruddhi's branch are ignored.

**Challenge:** a layered, hyperlocal map or tool a Mars astronaut could use to plan and carry out a Marswalk, combining at least three kinds of NASA data, with safety and a route that avoids obstacles.

**Hard constraints (from the rules Dev pasted):**
- Submit before **Sunday 15 Nov, 23:59 local**. Resubmission is allowed until then; only the last save counts.
- The demo field takes **one** public link: a deck of at most 7 slides **or** a video of at most 30 s. Exceeding either limit makes the project ineligible.
- The final-project link must open with no login.
- Judged 1–5 on Impact, Creativity, Validity, Relevance, Presentation. Most of the judging is on the project page text, not the demo.
- Every external dataset, library, image and tool goes in the References field. At least one NASA dataset is required; Space Agency Partner data is encouraged.
- AI use must be disclosed: code acknowledged in text and metadata, any AI-generated image or video visibly watermarked, no NASA logos or mission insignia anywhere.
- The rules say AI should not be used to come up with the idea itself. The concept below follows Dev's direction (plan-then-walk, rover-explored sites, ML that transfers); Dev should be comfortable stating it as the team's idea.

**Decisions made with Dev:**
- Product: one app that plans a Marswalk on a console view, then walks it in a tablet/visor view. All three form factors appear, with plan-then-walk as the complete core.
- ML: walkability first, science-target ranking second.
- Demo: both a deck and a video if time allows.
- Destination: `D:\NASA - Marswalk`.
- Team: Dev, Samruddhi, Archisha, each on their own machine with Orca installed and logged in.
- Machines linked by Orca pairing over the shared Wi-Fi, with Dev's machine coordinating.
- One new public GitHub repo under Dev's personal `devangingale` account; `main` plus a branch per person or agent; pull requests for specific pieces.

**My calls (Dev did not pick; correct me if wrong):**
- **Sites:** Gale / Mount Sharp is the full Marswalk; Jezero is the unseen second site. Gale has ground-measured radiation and the boxwork goal the brief names. No other rover sites: we hold no 1 m terrain for them.
- **Demo link = the deck**, with the 30 s video on the project site and linked from the deck. The deck carries validation numbers and sources; the video cannot.
- **No backend.** Static web app with pre-baked tiles, so the public link cannot fail during judging.

## What we are building

A static web app with three views over the same plan:

1. **Plan (habitat console).** Layer stack over a roughly 4 × 4 km area at Mount Sharp: image, elevation and slope, walkability, thermal inertia, mineral indices, radiation and dust conditions. The user drops science stops; a safe route draws with distance, time, climb, energy and dose budgets, plus a turn-back limit.
2. **Walk (tablet).** Position along the route, next stop, remaining budget, and the real rover photo taken nearest to each stop.
3. **Visor.** The same route in a pitched 3D terrain view with a minimal overlay: heading, distance to next stop, budget remaining, hazard ahead.

A site switcher loads Jezero through the identical pipeline, with the model's score on Perseverance's actual path shown.

## Approach

**Data pipeline (Python, the existing `gdal-env` conda environment plus rasterio, scikit-learn/LightGBM).** One script per step, driven by a per-site config file so Jezero is a config change, not new code.
- Crop each site to its walk area; derive slope, roughness and curvature at 1 m from the DEM.
- Resample coarse layers (THEMIS thermal inertia 100 m, CRISM summary bands, dust, pressure) onto the area and label their true resolution in the UI, so nothing coarse pretends to be 1 m.
- Bake image and overlay tiles as PMTiles, elevation as terrain-RGB tiles, and a 2 m cost grid as a compact binary for the route planner.

**Walkability model.**
- Positives: cells Curiosity drove over (`pds_places/localized_interp.csv`, 49k poses, already carries DEM pixel coordinates).
- Background: random cells within a corridor around the traverse. This is a positive-versus-background setup, since nobody labelled "unsafe" ground.
- Features: multi-scale slope, roughness, curvature, image texture and brightness.
- Test: train on Gale only, score on Jezero against Perseverance's path (`pds_places/best_interp.csv`, 33k poses). Report how much more often the rover's path falls in ground the model calls walkable than chance would give.
- Stated limit: a rover's choices are a conservative stand-in for a suited human. Human slope limits are applied on top as a hard rule.
- **Gate:** if the Jezero score is not clearly better than slope alone, ship the slope-and-roughness rule and say so. No model is shown that we cannot defend.

**Science-target ranking (second, timeboxed).** Rank candidate stops by mineral index strength, thermal contrast and image texture, and seed the map with Curiosity's documented boxwork locations. Dropped without regret if walkability is not validated by its gate.

**Route and budgets.** Least-cost path in a browser web worker over the baked cost grid. Cost combines walkability with a slope-dependent walking-energy model scaled for Mars gravity and suit load. Budgets: distance, time, climb, energy, radiation dose for the walk (Curiosity RAD daily dose × duration, with a solar-event scenario toggle), and a turn-back limit where the remaining budget equals the cost of returning.

**Map (Vite + React + MapLibre GL).** Both sites sit near the equator, so tiles are published in Web Mercator at their true latitude and longitude and MapLibre's built-in 3D terrain gives the visor view for free. Mars is smaller than Earth, so all distances and slopes are computed in the pipeline in true metres, the scale bar is custom, and terrain exaggeration is set to compensate.

**Rover photos.** Fetch Navcam and Mastcam image metadata from NASA's public raw-image feeds, join each image to a position through its site and drive numbers, and keep the nearest ones to the route. The old Curiosity snapshot came back empty, so this is tested in the first hour; the fallback is the PDS image archive, and failing that the walk view uses Perseverance photos at Jezero only.

**Partner data.** The ESA Mars Express HRSC–MOLA blended DEM (already on disk) is the regional context layer, giving a real Space Agency Partner credit.

## Team, machines and git

**Who does what.** The 45 GB of data stays on Dev's machine only, so work splits by what needs it.

| Machine | Work |
|---|---|
| Dev (coordinator) | Data move, terrain pipeline, walkability model, tile baking, deploy |
| Samruddhi | App shell and Plan view, route planner and budgets |
| Archisha | Rover-photo fetching, Walk and Visor views, deck and submission text |

Small baked outputs (tiles, cost grid, photo index) are published from Dev's machine to the repo's release assets or the static host, so the other two never need the raw data. Until the first real tiles land, the app is built against a tiny sample tile set committed to the repo.

**Pairing.**
- Samruddhi and Archisha each run `orca pair` and send the access link.
- On Dev's machine: `orca environment add --name samruddhi --pairing-code <link>`, same for `archisha`. Confirm with `orca host list`.
- Agents on their machines are started and watched from Dev's Orca with `--environment <name>`, using their own logins and limits.
- **If the Wi-Fi link is not holding within 30 minutes:** install Tailscale on all three and re-pair with `orca pair --address <tailscale-ip>`. If that also fails, each person starts agents locally from the phase PRDs and everything meets in pull requests. A dropped link never loses work; agents keep running where they started and push to their branch.

**Git.**
- New public repo under Dev's personal GitHub account `devangingale`; Samruddhi and Archisha added as collaborators. Before the first push, confirm `gh auth status` shows `devangingale` and set the repo's local git author to Dev's personal email, so only the personal identity appears in the public history.
- `main` is always deployable. Branches are named `<person>/<phase>-<topic>`. One pull request per PRD deliverable; the coordinator reviews and merges.
- `data/` is git-ignored. No secrets in the repo (it is public from the first commit).
- Commits made by agents carry the AI co-author trailer, which doubles as the required AI-use disclosure in metadata.

## Phases

Each phase gets a one-page PRD in `docs/prd/phase-N-<name>.md` (goal, inputs, outputs, done-when, owner) written during phase 0, so any agent on any machine can pick one up cold. Times are hours from start.

| # | Phase | Owner | Hours | Done when |
|---|---|---|---|---|
| 0 | Data move, repo, pairing, PRDs | Dev | 0–1 | Data in place, repo pushed, both machines paired (or fallback chosen), PRDs written, references file started |
| 1 | Site data and tiles (Gale) | Dev | 1–6 | Gale area opens in a bare map with image, slope and one coarse layer |
| 2 | Walkability model | Dev | 1–8 | Jezero score computed; ship-or-fallback decision recorded |
| 3 | App shell, Plan view, route and budgets | Samruddhi | 1–14 | Dropping three stops draws a route with all budgets and a turn-back limit |
| 4 | Rover photos, Walk and Visor views | Archisha | 1–20 | A planned route can be walked start to finish with photos at stops |
| 5 | Jezero through the same pipeline; science ranking if gate passed | Dev | 14–24 | Site switcher works; no site-specific code added |
| 6 | Deploy, project page text, deck, video, submit | Archisha + Dev | 20–30 | Public links open in a private window; "Submit for Judging" clicked |

**Fixed points regardless of progress:**
- **Hour 1:** rover-photo fetch tested for Curiosity, since it is the riskiest input.
- **Hour 14:** first deploy to the public URL, however rough.
- **Sunday 18:00:** first real submission with whatever exists. Everything after is a resubmission.
- **Sunday 22:00:** code freeze. The last two hours are for links, page text and the final submit only.

The deck skeleton and References list are kept current from phase 0 rather than written at the end.

### Phase 0 detail — data move

Same drive, so the move is instant. Move only:

| From (`D:\NASA - P11\`) | To (`D:\NASA - Marswalk\`) |
|---|---|
| `raw-data\` (45 GB, 26 datasets, with manifests) | `data\raw\` |
| `out\layers\` (674 MB, global rasters) | `data\processed\global-layers\` |
| `out\crism_vrt\` (8 MB) | `data\processed\crism_vrt\` |
| `out\tanaka2014_extracted\` (1.2 GB) | `data\processed\tanaka2014\` |

Nothing else moves: no code, frontend, worktrees, handoff file, staging or other `out\` contents (those are results of the old site-selection logic, not data).

- `data\README.md` lists each dataset, its source URL and licence, which doubles as the References draft.
- The CRISM `.vrt` files point at raw files by path and will need their paths checked after the move.
- The old project stops running once its data is gone. That is accepted.

### Phase 6 detail — submission

- **Project page fields** drafted in `docs/submission.md`: name, summary, detailed description, NASA data, partner data and references, AI-use statement.
- **Detailed description** is written as direct answers to the form's five prompts, in this order: what exactly it does; how it works; what benefits it has; what we hope to achieve; what tools, languages, hardware and software we used. Since most of the judging is on this page, it carries the validation number, the stated limits and one screenshot per view (images up to 10 MB can be uploaded to the page).
- **Deck (7 slides):** title and team; the problem at walk scale; the layered map; the route and budgets; the walk and visor; validation on an unseen site; data sources and what comes next.
- **Video (30 s), proposed shots:** layers stack up; stops dropped and route drawn with budgets; walk and visor with rover photos; switch to Jezero. To be confirmed with Dev before recording. English narration or subtitles.
- **AI disclosure:** README section plus commit trailers; no AI-generated imagery is used, so no watermarking is needed.
- All three team members must be registered at the same event and listed on the team page before submission closes. Dev to verify.

## Not doing

- Other rover sites, a global site finder, or anything from the old site-selection work.
- A seamless stitched photo walkthrough; photos appear at stops only.
- A server, accounts, or live data feeds.
- Real-time positioning. The walk view replays the plan.
- Copying raw data to the other two machines.

## Verification

- **Pairing:** `orca host list` shows both environments; a trivial test agent started on each from Dev's machine pushes a commit to its branch.
- **Pipeline:** each step prints the output raster's extent, resolution and value range; a check script confirms rover poses land on the image where the traverse is visible.
- **Model:** the Jezero score is produced by a script that never reads Jezero during training; the number, the slope-only baseline and the method go in the deck as-is.
- **Route:** unit tests on small synthetic grids (wall, slope ramp, unreachable stop), plus a check that the planned route between two points Curiosity drove between does not cross ground steeper than the human limit.
- **App:** click through plan → walk → visor → switch site on the deployed URL in a private browser window, on a laptop and at tablet width.
- **Submission:** every link opened logged-out; deck counted at seven slides or fewer; video length checked at 30 s or under; References list compared against `data\README.md` and `package.json` / environment files.
