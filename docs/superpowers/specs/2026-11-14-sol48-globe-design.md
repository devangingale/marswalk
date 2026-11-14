# Sol-48 on a Mars globe: design

Status: for Dev's approval, 14 Nov 2026. Extends `2026-11-14-cesium-migration-design.md` (renderer move); where they differ, this file wins.

## Intent

A field tool for astronauts, used twice:
- **On Earth, before the mission:** study the planet, find and compare sites, scrub through weather and dust history, plan walks and rover drives in detail.
- **On Mars, during the mission:** the same tool on a tablet or helmet visor at the site. It carries the plan, re-plans when conditions change, and guides the walk.

It answers the Space Apps challenge directly: a layered, hyperlocal view from many NASA (and partner) missions, current conditions, safety first, and a route that avoids obstacles.

## Goals

1. An interactive 3D Mars globe (CesiumJS, Cesium Mars from Cesium ion) with place annotations, a lat/lon readout and a graticule.
2. Science layers in one palette, stackable, with legends and hover readouts: water ice, radiation, dust and storms, thermal inertia, minerals, site score, caves, terrain, temperature, others.
3. A clock and time slider (NASA Worldview style): dust-storm history (Mars Years 24–36), Gale weather history, sunrise and sunset.
4. Current conditions with the age of each reading: latest Gale weather, last Jezero weather, live space-weather alerts, dust season.
5. A site-finder: hard landing rules, weighted scoring, ranked candidates with reasons, filter chips; precise 1 m sites where a HiRISE elevation model exists.
6. Walk route planning on 1 m terrain (existing A*, Pandolf–Santee energy at Mars gravity), and rover route planning with a sourced rover cost model, on the same grid.
7. Walk and Visor views that replay a plan, with warnings, in a theme that adapts to Mars daylight.

## Non-goals (this weekend)

Multi-sol timeline with sleep blocks; CTX imagery for every candidate; 3D meshes from rover stereo; our own cave survey; deploy (needs Dev's logins); the deck and submission text.

## Anti-goals

- AI slop: filler copy, decorative icons, gradients, glows, emoji, marketing words, quotation marks around text, tags that repeat what is shown.
- Numbers without sources. Research marks unknowns as "not found"; builders never invent thresholds.
- Advice that endangers a crew: no night walking, no unexplored cave as shelter.
- Mentions of the earlier prototype in commits or files.

## Constraints

- Deadline Sun 15 Nov 23:59 IST; planned first submission 18:00. MapLibre stays the default until the Cesium build is at least as good (cut-off Sun 12:00).
- Static app, no backend. Site bundles and globe layers are static files (local now, R2 later). On Mars it must run offline from a local bundle; Cesium Mars streaming is for Earth use and the demo.
- All distances and slopes in the local-metre frame (Mars radius 3396190 m). Per-site height offset between bundle elevations and Cesium Mars (Gale +73.76 m, Jezero -70.92 m, from the spike).
- Cesium 1.146.0 pinned (engine 26.4.0, widgets 16.3.0); Cesium ion credit shown; token in `app/.env.local`, restricted to deploy origins before deploy.
- Licences recorded per source; SWIM ice has no stated licence (credit PSI, licence note).

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| Stay on MapLibre | Works today; flat, Earth-assuming, no globe, no real horizon, Trek unusable | Rejected by Dev |
| CesiumJS on Cesium Mars, keep planner, data and panels | Real globe and horizon, Trek-style tiles usable, hosted global terrain; new renderer work | **Chosen** |
| Cesium for the Visor only | Least work | Rejected: Dev wants the globe as the base |

Site-finder precision: global score only (fast, no walk planning at new sites) vs **global score plus full 1 m bundles for the best 3 HiRISE elevation-model locations (chosen, later)** vs CTX for many candidates (more downloads, coarse terrain).

## The design

### Globe and layers
- Globe: Cesium Mars tileset (asset 3644333), Mars ellipsoid, fly-in on load. Our PMTiles site layers drape on the tileset (`tileset.imageryLayers`). Offline: our basemap and site terrain on the bare ellipsoid.
- Global layers: `data/globe/layers.json` (geographic tiles z0–4, values grids for hover). Palette, approved by Dev: ice blue-to-white, radiation yellow (reserved), dust and storms ochre-to-rust, thermal inertia magenta, minerals teal-green, site score green, caves violet, terrain grey, temperature cool-to-warm (charts and its own layer only), others in distinct ramps. Low values fade to transparent so layers stack. Minerals (CRISM) exist only at site level today (1.9 µm hydration, 2.3 µm Mg-OH clays); no global mineral layer until a source is found.
- Annotations: IAU place names, rover and landing sites, candidates, caves (violet, labelled "unexplored, from orbit").
- Coordinates: cursor readout (lat, lon to 4 decimals with N/S/E/W, elevation); lat/lon on every stop and the drop-off; toggleable graticule (10° on the globe, finer in a site).

### Clock, history, current conditions
- Time slider across Mars Years 24–36 drives the dust layer (`data/globe/dust/`) and the Gale weather panel (`data/globe/weather/gale.json`, glitches filtered).
- Conditions panel: latest Gale weather (sol 4995, 25 Aug 2026 at time of writing), last Jezero reading (Apr 2024), DONKI space-weather alerts (live in the browser), dust season; every value shows its age.

### Site-finder
- Hard landing vetoes and weighted scoring from sourced criteria; ranked list with reasons and adjustable weights; filter chips (score, ice, radiation, dust, caves); site cards with a photo and key numbers; "detail available" badge where a 1 m bundle exists.
- Caves raise long-term base potential, never walk safety.

### Route planning
- Walker: existing planner. Rover: second cost model from sourced rover limits. Walker/rover picker in the stats bar.
- Route look (Strava-like): bold line in the route colour with a light dashed core and arrowheads; one line where legs share ground, arrows each direction walked; a fork marker where the line splits or merges, labelled with each branch's destination; start and finish markers.
- Hover: small route on screen (under ~400 px) highlights the whole route; larger highlights the section under the cursor (stop to stop plus any out-and-back detour, continuous through the fork), with its label ("Drop-off → 3 via 2 · 2.4 km · 55 min"); linked to the stop list.
- Slopes: route draped on 3D terrain; optional colour-by-gradient (single hue family, no red/green); high, low and steepest markers; elevation profile shaded by gradient with linked hover; summary row (climb, descent, high, low, steepest).
- Detours are detected automatically from the stop order (a stop whose way in and way out share a path).

### Time, pace and daylight
- Sunrise, sunset and Sun elevation from the Mars24 algorithm (Allison & McEwen 2000), tested against published anchors and REMS sunrise/sunset.
- Deadline = earlier of (sunset − reserve, default 30 min) and the suit/time limit. No night walking.
- Start window: earliest = sunrise + 30 min; latest = deadline − total estimated time. Recommended start centres the walk on the warmest hours (from REMS min/max and local time), inside the window. Default departure: the recommended start.
- Pace: required average pace = walking distance ÷ (deadline − departure − stop time), in min/km; compared with the expected pace from the slope-aware speed model; verdict with spare time or the fix.
- Temperature along the timeline (estimated from that sol's min/max), cold warning if the plan runs into the evening drop; thresholds from sourced suit limits.

### Warnings and shelter
- Ladder in Walk and Visor: behind pace → turn back now (re-plan to drop-off) → return to shelter (with time to shelter and to sunset).
- Shelter by hazard: daylight/pace → habitat, drop-off or pressurised rover; radiation alert → nearest of habitat/rover, a surveyed accessible cave (none today), or a terrain-shielded spot (cliff or crater wall; sky blocked share from the elevation data); dust storm or low visibility → habitat along the planned route.

### Night contingency
- Triggers when the crew is still out at the back-by time or the projected arrival is after sunset (early warning: "At this pace you arrive 25 min after sunset").
- Alerts the habitat automatically (position, heading, pace, suit time left); help comes from the habitat crew, not Earth.
- Re-plans the way back for darkness: prefers the track already walked, tighter slope and roughness limits, wider hazard radius.
- Night display: dark, route corridor, distance and bearing to shelter, next hazard in large type; the Visor shows the corridor.
- Suit time left (oxygen, power, heating) against time to shelter and falling temperature; when it will not cover the walk, points to the nearest safe spot to wait and calls the pressurised rover with its arrival time.
- Pair tracking: both astronauts on screen, warning if they separate.
- Pre-planning: every plan checks consumables cover the walk plus a night return from the farthest point at night pace plus a margin; a night return path from every point is saved in the plan file (offline); rover rescue reach is checked along the whole route.
- Assumption stated on screen: a pressurised rover at the habitat can drive out. Suit numbers come from sourced EVA limits; missing ones are labelled, editable assumptions.

### Daylight beeper
- Audible countdown as nightfall approaches, played in the helmet audio and on the tablet (Mars air is too thin to carry an outside buzzer far).
- Steps: 60 min to back-by (single soft tone), 30 min (two tones), back-by time (repeating tone with the turn-back message), sunset (urgent tone until acknowledged), plus the same tones for pace and radiation warnings at their levels.
- Each tone matches the on-screen warning level and colour; tablet vibration where supported. Advisory tones can be muted; turn-back and sunset tones can only be acknowledged, not muted.

### SOS and relay scheduler
- SOS button (hold 2 s, cancel within 10 s): goes instantly to the habitat over the local link and is queued for Earth via the next orbiter pass or the habitat's direct-to-Earth link, whichever is sooner. Shows each link's state (received, queued with next pass and estimated Earth arrival). Starts the night-contingency rescue flow and the urgent tone.
- Packet: reason (injury, suit fault, lost, radiation), position and heading, suit status and vitals, the plan file, last 2 km of track; photos only if bandwidth remains. Built and stored on the device; resent until each link confirms.
- Pass prediction: pipeline script computes every pass of MRO, MAVEN, Mars Odyssey, Mars Express and TGO over each site from NASA NAIF SPICE ephemerides (spiceypy): rise, set, peak elevation, duration. Output `data/sites/<site>/passes.json`, static and offline. Exact for past dates; future dates only as far as published predicted ephemerides reach.
- Store-and-forward queue on the device, by priority: SOS, warnings, crew positions and track (one fix per 30 s per astronaut, compressed), suit status and vitals, photos and notes. When a pass opens above a usable elevation, the queue transmits in priority order; what does not fit waits for the next pass. Each item shows queued, sent or delivered.
- Science data uplink: the crew logs images, samples (sample ID, location, depth, description, photo, instrument readings), and short voice or text field notes at each stop. These join the queue as science items, after safety items and positions:
  - Images go up as small previews first, full resolution in later passes; the crew can star items to send them first.
  - Each sample record is small and self-contained (ID, time, position, notes, photo preview), so mission control can follow the science even when the full images wait.
  - The app estimates what fits in the next pass from sourced relay capacity and shows "fits in next pass" or "needs 3 passes" per item.
  - Items are never deleted on the device until delivery is confirmed; the habitat keeps full copies over the local link.
- The habitat receives everything live over the local link; the relay to Earth is the second path for mission control.
- Status strip in Walk and Visor: "Habitat ● live · Earth ○ next pass MRO 14:32 (11 min) · 38 points queued". Plan view shows the sol's passes on the timeline so the riskiest stretch can be covered by a pass.
- Demo honesty: pass times are real (SPICE); transmission is simulated and labelled so. Relay capacity per pass comes from sourced figures (research), not invented.

### Hardware links
- One telemetry adapter interface between the app and all hardware: positions, suit status, rover status, habitat link, relay status, and commands to the rover. Screens depend only on this interface.
- Adapters:
  - Simulated (demo): replays the plan with realistic suit readings and a moving rover; every simulated value is labelled "simulated".
  - Bridge (real path): WebSocket to a habitat bridge service that speaks CCSDS packets and NASA flight software (cFS or F Prime) to suits and habitat, and ROS 2 / Space ROS to rovers. Documented as the integration path; not built this weekend.
  - Local device: sensors paired to the tablet through Web Bluetooth or Web Serial where the browser supports them.
- Data and commands:
  - Suits (read-only): oxygen, power, suit temperature, heart rate, position estimate.
  - Pressurised rover: position, heading, battery, cabin status, crew aboard, arrival time to the crew; commands "come to me", "drive to point", "send planned rover route", "follow walkers".
  - Habitat: live link state, alert acknowledgements, relay queue state; receives SOS, track and science data.
  - Relay: pass windows and delivery receipts; carries the uplink queue.
- Rover command safety: hold-to-send confirmation showing the effect ("Rover drives 1.8 km, arrives 18:22"); the rover's own hazard checks always win (the app requests, the rover decides); every command is logged and copied to the habitat and the relay queue.
- Positioning without GPS: position fused from suit motion sensors (dead reckoning), radio ranging to habitat and rover, and camera-to-orbital-map matching. Shown with an uncertainty circle; hazard margins widen as uncertainty grows. Methods and accuracy figures come from research.
- This weekend: the adapter interface, the simulated adapter, the rover on the map with its arrival time, "come to me" in the rescue flow, and suit readings feeding the warnings.

### Earth and Mars modes
- A mode switch in the header: Earth (pre-mission planning: full globe, layers, history, site-finder, side-by-side comparison) and Mars (at the site: current position, next stop, budgets, warnings in large type, minimal chrome). Same data and plan file in both; the plan file is the hand-over.

### Theme
- Day: light, high contrast. Twilight and night: dark, low glare. Visor has its own day/night HUD look.
- Mars mode follows the Sun's elevation at the crew's site (stepped day/twilight/night with a delay, never switching while a warning is shown); Earth mode follows the device's light/dark setting; manual override always.
- Interface, route and warning colours get a day and a night variant; text contrast at least 4.5:1; red and amber stay distinct in both. Map layer colours checked over both.

### Later (after the core)
Best 3 precision sites from HiRISE coverage; 360° rover panoramas at photo sites (official panoramas, then our own stitching); multi-sol timeline with sleep blocks; global temperature layer (source from research); CTX imagery for candidates.

## Build order (who)

1. Mac: Cesium Tasks 2–4 (frame and height maths, layers on the globe from `layers.json`, overlays with the route look, hover, coordinates).
2. This laptop: finish data (layers palette fix, history), then the sunrise/sunset and pace module (pure, tested), then orbiter pass prediction (SPICE), then rover cost model once research lands.
3. Mac: Plan, Walk and Visor on the globe; conditions panel; time slider; site-finder UI; theme.
4. Visual review at 1440x900 and 1024x768, both sites, both themes; cut-over with Dev's approval.

## Left to the builders

Exact chevron spacing, label collision handling, animation timings, the specific ramps for "other" layers, tile request throttling, and any value research marks as "not found" (they flag it instead of inventing).
