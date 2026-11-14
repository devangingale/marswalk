# Project page draft

One section per field on the Space Apps project form. Keep this current as the build progresses; it is pasted into the form on Sunday. Anything marked _TBD_ must be filled in or removed before submitting.

## Project name

Sol-48

## High-level project summary

Sol-48 is a layered, walk-scale map that helps a Mars astronaut plan a Marswalk and then carry it out.

On a habitat console, the astronaut stacks NASA data layers over a 4 × 4 km area of Mount Sharp in Gale crater: orbital images, elevation and slope, thermal, mineral, radiation and dust. They drop science stops, and Sol-48 draws a safe walking route that avoids steep and impassable ground. The route comes with distance, time, climb, energy and radiation budgets, and a turn-back point. The same plan can then be walked in a tablet view and a helmet-visor view, with real rover photos at each stop.

This answers the challenge directly: a hyperlocal map, built from more than three kinds of NASA data, with safety budgets and an obstacle-avoiding route. To show it is not a one-off, Jezero crater runs through the identical pipeline as a second site.

It matters because the first people on Mars will walk, not just drive. Today's Mars maps work at regional scale. A walk is planned metre by metre, against time, energy and dose, and Sol-48 is built for that scale.

## Link to project demo

_TBD: public link to the deck (7 slides max), opening without login._

## Link to final project

_TBD: public app URL (Vercel), opening without login._

Repository: https://github.com/devangingale/marswalk

## Detailed project description

### What exactly does it do?

Sol-48 has three views over one plan.

Plan (habitat console). A layer stack over a 4 × 4 km walk area. Layers are grouped by kind (optical, topographic, thermal, spectral, radiation, atmospheric, chemical, geologic), and each shows its true resolution, so a 100 m thermal layer never looks like 1 m data. The astronaut places a rover or habitat start marker, then adds, moves, names and reorders science stops. Sol-48 plans a route through the stops and back to the start, and shows distance, time, climb and descent, energy, radiation dose and a turn-back point. Crew size, time limit, suit mass and other parameters are editable; the default is two astronauts and an 8-hour limit. If a stop cannot be reached safely, the app says so instead of drawing a line through it.

Walk (tablet). A marker replays the route. The screen shows the next stop, distance and time to it, budget remaining, and whether the turn-back point has been passed. At each stop it shows the real rover photo taken nearest to that spot, with sol, camera and credit, and a line on why the stop matters. Where no photo exists nearby, it says so.

Visor. The same route in a pitched 3D terrain view at eye height, with a minimal overlay: heading, distance to next stop, budget remaining, and a hazard-ahead cue.

A site switcher loads Jezero crater through the same pipeline, with Perseverance's real path shown over the walkability layer.

_TBD: one screenshot each of Plan, Walk and Visor (JPG/PNG/GIF, up to 10 MB)._

### How does it work?

A Python pipeline takes one config file per site. It crops the 1 m elevation model and image mosaic to the walk area, derives slope, roughness and curvature, and resamples the coarse layers (thermal inertia, mineral indices, dust) without hiding their real pixel size. It bakes map tiles and a 2 m route grid. Jezero needed a new config file, not new code.

Route cost. Each 2 m cell gets a terrain difficulty value. Ground steeper than 20° is marked impassable. The default cost comes from a slope-and-roughness rule. We also trained a walkability model on where Curiosity actually drove, and tested it, unchanged, on Jezero against Perseverance's path. The model replaces the rule only if it clearly beats slope alone on that unseen site.

_TBD: validation result. Model AUC and lift on Perseverance's path at Jezero, the slope-only baseline, and whether the model or the rule ships._

Route and budgets. The app runs an A* least-cost search in a web worker over the route grid, through the stops in order and back to the start. Energy per step uses a walking-energy model with body-plus-suit weight scaled to Mars gravity (3.71 m/s²), uphill and downhill grade, and the cell's terrain cost. _TBD: name and cite the published walking-energy equation once confirmed (Pandolf load-carriage equation proposed)._ Walking speed starts at 0.8 m/s on flat ground and drops with slope. Dose is Curiosity's measured daily surface dose times walk duration, with a solar-event toggle that swaps in an elevated rate. The turn-back point is the last place from which walking home still fits the time or energy limit, with a 15% reserve.

Rover photos. Image records from NASA's public Curiosity and Perseverance raw-image feeds are placed on the map by joining each image's site and drive numbers to the rover location tables. Images stay on NASA's servers and carry their credit line.

The app is static, with no backend and no accounts, so the public link cannot fail during judging. Distances and slopes are always computed in true Mars metres, never by the map library, which assumes Earth.

Limits, stated plainly:
- Energy and dose are planning-grade estimates. They are not validated against suited human trials.
- Jezero has no ground-measured radiation. Its radiation values are carried over from Curiosity's measurements at Gale, and the app labels them that way.
- A rover's path is a conservative stand-in for where a suited human can walk. Rovers avoid some things people could step over, and the reverse.
- 1 m elevation data cannot see rocks smaller than about a metre.
- The walk and visor views replay the plan. There is no real-time positioning.

### What benefits does it have?

It works at the scale of a walk, not a region. Every route stays out of ground steeper than the human limit. Budgets and a turn-back point are visible before anyone leaves the habitat. Rover photos show what a stop looks like on arrival. Each layer shows its true resolution, so coarse data is never mistaken for fine data. And because a new site is a config file, the same tool can be pointed at any landing site with high-resolution terrain.

### What do we hope to achieve?

We want to show that EVA planning on Mars can combine orbital data, rover ground truth and simple physiology in one honest tool. Next steps would be validating the energy and dose models against suited human data, finer hazard data such as rock counts, and adding more candidate landing sites.

### What tools, coding languages, hardware or software did we use?

_TBD: final tool list, checked against app/package.json and the Python environment._

Planned:
- Languages: Python, TypeScript.
- Pipeline: GDAL, rasterio, scikit-learn or LightGBM.
- App: Vite, React, MapLibre GL, PMTiles.
- Hosting: Vercel (app), Cloudflare R2 (tiles).
- Collaboration: GitHub, Orca.
- Hardware: no special hardware; built on the team's own computers.

## Use of AI

AI coding assistants (Claude by Anthropic, Gemini by Google) were used to write code and documentation in this repository, directed and reviewed by the team. Commits made with AI assistance carry a Co-Authored-By trailer in the repository history. No AI-generated images, video or audio are used anywhere in the project.

## NASA data

_TBD: trim this list to what the final build uses (see docs/references.md)._

- MRO HiRISE 1 m elevation mosaic of Gale crater (USGS Astrogeology / NASA PDS): elevation, slope, roughness and curvature; the route grid.
- MRO HiRISE colour mosaic of Gale crater (USGS Astrogeology / NASA PDS): base image for the walk area.
- MRO HiRISE elevation model and orthoimages of Jezero crater (USGS Astrogeology / NASA PDS): the same layers for the second site.
- MRO CTX image and elevation of Gale and Jezero (USGS Astrogeology / NASA PDS): wider context around each walk area.
- Mars Odyssey THEMIS quantitative thermal inertia, 100 m (USGS / NASA): thermal layer.
- MRO CRISM summary products (NASA PDS): mineral index layers.
- MOLA elevation (NASA), as part of the MOLA–HRSC blended global DEM: regional context.
- Curiosity RAD dose records (NASA PDS): daily surface radiation dose used in the dose budget.
- Curiosity and Perseverance location tables (NASA PDS): rover paths, training and testing the walkability model, and placing photos.
- Curiosity and Perseverance raw-image feeds (NASA/JPL-Caltech): rover photos at stops.
- Global geologic map of Mars, SIM 3292 (USGS–NASA Planetary Geologic Mapping Program): geologic context.
- NASA JPL Mars Trek: regional basemap tiles.

## Space Agency Partner data and other references

_TBD: confirm each partner credit against the instrument's official page before submitting._

Space Agency Partner data:
- ESA Mars Express HRSC, as part of the HRSC–MOLA blended global DEM: regional context elevation. HRSC portion CC BY-SA 3.0 IGO.
- Spain: REMS weather station on Curiosity (Centro de Astrobiología / INTA) and MEDA weather station on Perseverance: air temperature, pressure and UV conditions by season.
- Canada: APXS on Curiosity: rock chemistry points at Gale.

_TBD: UAE Hope orbiter data, only if used._

Other references:
- Mars dust climatology (Montabone et al.), Mars Climate Database, CC-BY-SA-3.0: dust opacity layer.
- NASA/JPL proposed-route map for Curiosity on lower Mount Sharp: reference for how a science route map reads.
- NASA Worldview: reference for layered map interfaces.
- _TBD: walking-energy equation source._
- _TBD: software libraries, fonts and icons, from docs/references.md once filled in._
