# Sol-48 feature audit, 15 Nov 2026

Scope: every user-facing feature on Plan (`/`), Walk, Visor and the Globe page (`?globe=1`), checked against the approved design (`docs/superpowers/specs/2026-11-14-sol48-globe-design.md`), the globe plan (tracks A and B), the Cesium migration plan, the PRD and the design system. Report only; no app code was changed.

## How it was tested

- Code: `main` at `3105f8a`, then fast-forwarded to `8deb574` (PR #62, zoom and pan anchored to the ground). Zoom, pan and the Mars-mode crash were re-checked on `8deb574`.
- Data: `VITE_TILES_BASE=/sample`. The sample is a 500 by 500 m Gale corner. It has **no Jezero bundle, no rover traverse or photos inside the site, and no chemistry layer**, so those features could not be exercised (see "Not tested").
- Browser: installed Chrome through Playwright (`channel: "chrome"`, headless, ANGLE d3d11, SwiftShader), 20 to 25 s settle after load. Sizes: 1440x900 and 1024x768.
- Online: with the Cesium ion token (Cesium Mars tileset streaming).
- Offline: `context.setOffline(true)` before load also blocks `localhost`, and the app has no service worker, so the page cannot load at all that way. Offline was therefore emulated: every non-localhost request aborted and `navigator.onLine` forced to `false` before load. On Mars the app must be served from a local server (or gain a service worker) for a cold start.
- Checks: `npx tsc -b` passes; `npx vitest run` passes (62 files, 506 tests); `npm run build` passes (main chunk 5.2 MB, 1.45 MB gzipped; `dist/` 69 MB including the 32 MB sample and 22 MB source map).
- Screenshots: `.shots/audit/` (git-ignored, not committed). File names are given in the evidence column.

## Work already in progress elsewhere (not re-diagnosed here)

| Stream | Covers | Findings below that it should absorb |
|---|---|---|
| Plan polish | Route line, marker positions, pace text, MapLibre removal | P-12 pace text, P-15 fork labels under markers, X-4 `maplibre-gl` still in `package.json` and `src/components/mapSetup.ts` |
| Site terrain (PR #63 open) | 1 m terrain mesh, tile-load bug | P-6 blurry HiRISE online, P-7 coarse site layers invisible online |
| Route shape | Shared stretches, forks | P-15 |
| Camera controls (PR #62 merged) | Zoom stall above Gale, pan below datum | P-18 zoom-out still goes black on `8deb574` |
| Stop snapping | Snap stops to reachable cells; keep the route when one stop fails | P-4 (not reproducible on the sample) |
| Sharper globe (`dev/sharp-render`) | Device pixel ratio, Cesium Mars `maximumScreenSpaceError` 4 | P-6 partly |

Known issues confirmed (as briefed): whole-planet heatmaps exist only on `?globe=1` (P-2); offline Walk is black and offline Visor shows no terrain (W-1, V-1); flat lines do not render offline (G-15); the Walk top bar stays in the day theme at night (W-12).

---

## 1. Feature tables

Status: **works**, **partial**, **broken**, **missing**. Size: S under 30 min, M under 2 h, L more.

### Plan (`/`)

| ID | Feature | What it does | Status | Evidence | Plan or design says | Fix needed, size |
|---|---|---|---|---|---|---|
| P-1 | Site switcher | Lists Gale and Jezero; reloads site, layers, grid, plan | works (Gale); Jezero not testable | `plan-1440-online-jezero.png`: Jezero falls back to "Stub specification" with a yellow banner, PMTiles "Wrong magic number" warnings | Design 8: loading and failed states with "Try again" | No loading dim or failed state; the stub banner is the only signal. **Production builds default `TILES_BASE` to `/sample`**, so a deploy without `VITE_TILES_BASE` shows Jezero as a stub. Set the deploy env (S); add the failed state (M) |
| P-2 | Layer panel: site layers | Toggle, opacity, legend, resolution and source note, info popover | works offline; partial online | `plan-1440-online-layer-*.png`, `plan-1440-offline-layer-thermal.png`, `plan-1440-online-info.png`, `plan-1440-online-opacity30.png` | Spec: site and global layers grouped, legends, hover readouts | Toggle, opacity (0 to 100 %), legend ramp and info popover all work. No hover readout of the value under the cursor. Whole-planet layers missing (known): `LayerPanel` already accepts `globalLayers`, `caves`, `temperature`; only `App.tsx` does not pass them, and `GlobePlanMap` has no `GlobeGlobalLayers`. M |
| P-3 | Legend colours | Ramp per layer | partial | `plan-1440-online-layer-slope.png`, `-walkability.png` | Design principle 2: green means feasible, pink-red means impassable; spec: no red/green ramps | Slope and walkability use red-to-green ramps, which collide with the feasible/impassable colour jobs. S per ramp (pipeline palette) |
| P-4 | Add stop (click) | Click inside the site adds a numbered stop; route recomputes in a worker | works | `plan-1440-online-3stops.png`; click outside the site adds nothing | Phase 3 | Works. Seen once: three clicks made shortly after load were wiped when the route grid finished loading (the plan is re-initialised once per site). Not reproduced on rerun. S to guard |
| P-5 | Drag stop / drag drop-off | Drag a marker; camera input locks; route recomputes on release | works | `plan-1440-online-after-drags.png`, `plan-1440-online-start-drag.png`; export shows the new start and distance 1.3 km to 1.22 km | Cesium plan Task 5 | Works. The profile-hover dot stays on the map after the pointer leaves the profile (stray blue dot). S |
| P-6 | Orbital image online | HiRISE 0.25 m drape on Cesium Mars | partial | `plan-1440-online-initial.png` vs `plan-1440-offline-initial.png` | Spec: our PMTiles drape on the tileset | Online the 0.25 m image is far blurrier than the Cesium Mars base under it, with warped edges; offline it is sharp. In progress (site terrain, sharp render) |
| P-7 | Coarse site layers online | CRISM 1.9 µm, CRISM 2.3 µm, THEMIS | broken online | `plan-1440-online-layer-hydration.png`, `-thermal.png` vs `plan-1440-offline-layer-thermal.png` | Phase 3: every layer toggles | Ticking them online changes nothing on the map; offline THEMIS draws correctly. Likely the same tileset-imagery issue as P-6. Check with PR #63; M if separate |
| P-8 | Delete and reorder stops | ↑ ↓ × per row; HTML drag to reorder | partial | CSS `src/plan/plan.css:49-51` | Design 8: drag handle, remove button; Walk/tablet needs no hover | Controls are `opacity: 0; pointer-events: none` until `:hover` or `:focus-within`, so on a touch tablet they cannot be seen or tapped. Work with a mouse. S |
| P-9 | Stop rows | Number, editable name, dwell minutes | partial | `plan-1440-online-3stops.png` | Design 8: per-leg values (`2.4 km · ≈ 58 min · +64 m`), fixed "Rover drop-off" and "Back to Rover drop-off" rows, unreachable state; spec: lat/lon on every stop | No per-leg values, no fixed first/last rows, no lat/lon in the row (only in the marker hover), no unreachable glyph. M |
| P-10 | Route line | Bold line, chevrons, high/low/steepest labels, fork diamonds | works | `plan-1440-online-3stops.png` | Spec route look | Works. Empty plan offline shows a doubled "High −4,053 m" label at the drop-off (`plan-1440-offline-initial.png`). S |
| P-11 | Route hover / section label | Hover highlights the section and links to the profile | partial | hover on a leg returned no label at 1440 | Spec: section label "Drop-off → 3 via 2 · 2.4 km · 55 min", linked to stop list | Map-to-profile link works (dot appears on profile). No section label seen on Plan; the section list exists only on the Globe page. M |
| P-12 | Pace panel | Depart slider over sunrise–sunset, needed vs expected, back-by | partial | `plan-1440-online-3stops.png`, `plan-1024-online-overlimit.png` | Spec: pace in min/km, verdict with spare time or the fix | Shows "Needed 0.2 km/h, Expected 2.5 km/h"; "Needed" is an average over the whole window, which reads as nonsense. Verdicts "Fits / Late / Open / Dark" with no spare time or fix. In progress (Plan polish) |
| P-13 | Budgets | Distance, time rail, climb/descent, energy, dose, turn-back | partial | `plan-1024-online-overlimit.png` | Design 8: rails with reserve hatch, turn-back notch, "Inside reserve" and "Over limit" chips and copy, "≈" on estimates | Values correct and recompute; solar event raises dose 0.018 to 0.09 mGy. Over the limit the time turns red but there is no "Over limit" chip or copy, no reserve hatch, no notch, no "≈". Turn-back "Not needed" in Plan while Walk says "Before turn-back point - time limit". M |
| P-14 | Mover picker | Walker, crew rover, science rover | partial | text: walker 1 h 30, crew 1 h 05, science 14 h 37 | Spec 6: rover route planning on the same grid with a rover cost model | Only re-times the walker's route (`moverBudget`, roughness fixed at 0). No rover route, no explanation of the 14 h science-rover figure. Label as "time on the walker's route" (S) or route per mover (L, skip) |
| P-15 | Fork labels | "to Stop 3", "back to drop-off" | partial | `plan-1440-online-3stops.png` ("o Stop 3" under marker 3) | Spec route look | Label collides with the stop marker. In progress (route shape) |
| P-16 | Elevation profile | Shaded by gradient, hover links to map | works | `plan-1440-online-profile-hover.png` | Spec slopes | Works. Axis labels use hyphen-minus ("-4044 m"), map uses "−4,055 m" with a comma; design: U+2212, no comma below 10 000. S |
| P-17 | Parameters | Crew, time limit, suit and body mass, dwell, energy limit, solar event | works | `plan-1440-online-params.png` | Phase 3 | Works and recomputes. S polish only |
| P-18 | Zoom and pan | Wheel, drag | partial | `plan-1440-online-zoomin.png`, `-pan.png`, `-zoomout.png` on `8deb574` | Cesium plan | Zoom in and pan work after #62. Zooming out with the wheel (40 notches) ends on a black view with the scale bar at "1 m". S to M (camera worker) |
| P-19 | 3D relief toggle | Top-down vs 45° tilt | works | `plan-1440-online-relief.png` | Cesium plan Task 5 | Works. |
| P-20 | Scale bar | Metres from two ground picks | broken | `plan-1440-online-3stops.png` shows "500 m" over about 100 px on a 1 km site; offline shows "1 km" | Phase 3 rule: custom scale bar from grid metres | Label jumps between 100 m, 500 m and 1 km for the same view. S to M |
| P-21 | Export / import plan.json | Download; file input | partial | Export 36.6 kB, three stops; import restores them; `{"nope":1}` import is ignored | Phase 3 | Works. Invalid or wrong-site files fail silently. S |
| P-22 | Cursor readout and graticule | Lat/lon/elevation under cursor; grid | missing in Plan | GlobePlanMap has neither | Spec: cursor readout and graticule (finer in a site) | Exists only on the Globe page. M |
| P-23 | Conditions, suggested stops, chemistry add-as-stop, "Walk this route" | Season conditions, suggestions, primary action | missing in Plan | not rendered by `App.tsx` | Phase 3 additions; design 7 layout | ConditionsPanel is only on the Globe page; no suggested stops; no "Walk this route" button. M each; skip suggestions |
| P-24 | Layer drawer at 1024 | Panel collapses to a drawer | broken layout | `plan-1024-online-layers-drawer.png` | Design 7: 320 px drawer over the map's left edge | Opening the drawer shrinks the map to a strip of about 190 px instead of overlaying it. S (CSS) |
| P-25 | Rover traverse and photo dots | Overlays | not testable | no traverse point or photo inside the sample site | Phase 4 | Test on full Gale data |

### Walk

| ID | Feature | What it does | Status | Evidence | Plan or design says | Fix needed, size |
|---|---|---|---|---|---|---|
| W-1 | Walk map | Chase camera, route, stops, crew | works online; broken offline | `walk-1440-online-start.png`, `walk-1440-offline-start.png` (black), page error `Cannot read properties of undefined (reading 'add')` | Spec: offline from the local bundle | Known. Cause: `WalkGlobe.tsx:60` and `VisorGlobe.tsx:91` call `initCesium(token)` without `navigator.onLine`; the viewer is built with `globe: false`; when the tileset fails, `createMarsViewer` switches to offline but never adds a globe, so `viewer.imageryLayers` is undefined. Same fallback breaks Plan when the browser says online but ion is unreachable (habitat LAN). M |
| W-2 | Playback | Play/pause, speed x60, time and sunset countdown, temperature | works | `walk-1440-online-playing.png`; after 6 s: 463 m to 192 m | Design 8 scrubber | Works. |
| W-3 | Keyboard | Space plays; arrows | partial | 110 ArrowRight presses stop at Stop 3 dwell | Design 8: arrows step 1 %, Page Up/Down move a stop | Arrows jump stop to stop and never reach the return to the drop-off; the walk cannot be finished by keyboard. S |
| W-4 | Timeline | Click/drag seeks | works | click at 50 % moved to Stop 3 approach | Design 8 | No stop ticks or turn-back notch on the track. S to M |
| W-5 | Next stop and budgets | Distance, time to stop, time/energy/dose left | works | sheet text | Design 7 Walk | Numbers group "2 350 kJ" (design: group from 10 000); no "≈". S |
| W-6 | Warning ladder | On pace, behind pace, turn back now, return to shelter | works | `walk-1440-online-safety_*-start.png` via dev `?safety=` | Spec warnings | All four rungs render with shelter, glyph and colour. Sheet still says "Before turn-back point" while the ladder says "Turn back now" (dev scenario only drives the ladder). S |
| W-7 | Daylight beeper | Steps, mute advisory, acknowledge at sunset | works (visual) | scenario shots | Spec beeper | Audio not verifiable headless. Controls and acknowledge-only at sunset present. |
| W-8 | Relay strip | Habitat live, Earth next pass, queue | works | "next pass MEX 08:04 (7 min) · 3 queued · Transmission simulated" | Spec relay | Works with real pass list. |
| W-9 | SOS | Reason chips, hold 2 s, 10 s cancel | works | `walk-1440-online-sos.png` | Spec SOS | Works: "SOS armed, Sending in 8 s, Cancel". |
| W-10 | Night contingency and return to shelter | Way back, next hazard, habitat alerted | works | `walk-1440-online-safety_return_to_shelter-start.png` | Spec night | Panel renders; no darkened corridor on the Walk map in the shot. S to M |
| W-11 | Stop details | Photos, conditions, chemistry | partial | "No rover photo near this stop (none within 150 m)" | Design: no-photo copy with nearest photo distance and direction | Temperatures use hyphen-minus ("-71 to -5 °C"). Photos not testable on the sample. S |
| W-12 | Night theme | Sheet goes dark at night | partial | `walk-1440-online-safety_turn_back-start.png` | Spec theme | Known: top bar stays in day theme. S |
| W-13 | Safety stack over the map | Ladder, beeper, relay, SOS on the left | partial | all Walk shots | Design 7: map plus 400 to 440 px side column | Stack covers a third of the map; route and marker often sit under it. M |
| W-14 | Hook order | `WalkView` calls `useSiteFeeds` after an early return | latent bug | `src/components/WalkView.tsx:38-58` | React rules | Crashes if the plan goes from zero stops to some while Walk is mounted. S |

### Visor

| ID | Feature | What it does | Status | Evidence | Plan or design says | Fix needed, size |
|---|---|---|---|---|---|---|
| V-1 | Horizon view | Eye-height camera on Cesium Mars | works online; broken offline | `visor-1440-online.png`; `visor-1440-offline.png` (tan field, white ring, no terrain) | Cesium plan Task 7 | Offline: same cause as W-1. Online near the route end a flat beige mass fills the lower half (`visor-1440-online-mid.png`): eye likely inside the tileset. M |
| V-2 | Heading tape, next stop, remaining | Four readouts on plates | works | `visor-1024-online.png` | Design 7 Visor | Works and readable. |
| V-3 | Route ahead | Route drawn in the view | missing | no route line in any Visor shot | Cesium plan Task 7; spec night corridor in Visor | M |
| V-4 | Hazard cue | Plate when steep ground ahead | not triggered | sample route avoids steep ground | Design 8 | Untested; needs a route near impassable ground on full data |
| V-5 | Minimal chrome | Only heading, distance, budget, hazard | broken against design | every Visor shot shows top bar, full safety stack (ladder, beeper, relay, SOS) and the playback bar | Design 7: no top bar; four readouts only | Hide the top bar, collapse the safety stack to the ladder headline and SOS. M |
| V-6 | Sky and overlays | Atmosphere, fog | works online | `visor-1440-online.png` | Task 7 | Lower half reads as a dark blue-grey band at 1440 (fog/sky colour). S |

### Globe page (`?globe=1`)

| ID | Feature | What it does | Status | Evidence | Plan or design says | Fix needed, size |
|---|---|---|---|---|---|---|
| G-1 | Whole-planet layers | Ice, radiation, dust, thermal inertia, temperature, caves | works | `globe-1440-online-layer-6..11-*.png`, offline equivalents | Spec 2 | All render online and offline in the palette. Minerals and site score have no global layer (spec says minerals none until a source is found). |
| G-2 | Hover values | Value under the cursor | partial | radiation 302 µGy/day, dust 0.39 τIR, temperature −97 °C; ice and thermal inertia none | Spec 2 | Sample has no `values.bin` for `SWIM4MIM_Ci_0_1` and `tes_ti_night_2007`. Check the full set; S if only data |
| G-3 | Layer stacking | Low values fade | works | `globe-1440-offline-stack.png` (ice plus dust) | Spec 2 | Works. |
| G-4 | Temperature layer | Night low / afternoon high by Ls | partial | `globe-1440-online-layer-10-surfacetemperature.png` | Spec 2 | Online it draws as blocky grey patches over part of the globe. Sample only has levels 0 to 3; check full set. S to M |
| G-5 | Legends | Ramp with ends and units | works | layer shots | Design 8 | Works. |
| G-6 | Earth/Mars mode | Earth: planning chrome; Mars: safety layer | broken online | `pageerror: Cannot read properties of undefined (reading 'show')` in `<SafetyLayer>`, whole page unmounts | Spec Earth/Mars modes | `GlobePage.tsx:279` reads `viewer.scene.globe.show`; online the viewer has no globe. `viewer.scene.globe?.show`. Add an error boundary. S. Offline Mars mode works (`globe-1440-offline-mars.png`) |
| G-7 | Day/night theme | Auto, Day, Night override | works | `globe-1440-offline-night.png` | Spec theme | Works on the Globe page only; Plan/Walk/Visor have no theme control. |
| G-8 | Clock and time slider | MY 24 to 36 slider, play, ±1 | works | `globe-1440-online-time80.png` (MY 34 sol 543, Ls 288, air and pressure update) | Spec 3 | Sample has MY 34 only. |
| G-9 | Dust and weather history | Dust frames and Gale readout follow the clock | works | as above | Spec 3 | Works on sample. |
| G-10 | Conditions panel ("Now") | Gale, Jezero, DONKI, dust season, ages | works | initial shots | Spec 4 | Live Gale feed is blocked by CORS on every load (console error), falls back to the bundled snapshot correctly; DONKI live loads. Offline DONKI row hides. Drop the live Gale fetch or silence it. S |
| G-11 | Site finder | 253 ranked candidates, chips, weights | works | `globe-1440-online-sites.png` | Spec 5 | Works. Names are "Candidate 001" with a region; no photo on the card (spec: photo). |
| G-12 | Site card | Scores, evidence, detail note | partial | `globe-1440-offline-sitecard.png` | Spec 5 | Elevation uses hyphen-minus and a comma ("-5,183 m"). The card stays open after switching to Mars mode and covers the safety column (`globe-1440-offline-mars.png`). S |
| G-13 | Crew and rover markers, uncertainty circles | Simulated adapter | works offline | `globe-1440-offline-mars.png` | Spec hardware links | Online not testable because of G-6. |
| G-14 | Pair tracking | Warning when the pair separates | not tested | dev `?pair=` exists | Spec night | Run once with `?pair=300`. |
| G-15 | Graticule and cursor readout | Lat/lon grid with edge labels; cursor lat/lon/elevation | works online; partial offline | `globe-1440-offline-corner.png` | Spec coordinates | Online: works. Offline: edge labels draw, grid and route lines do not (known: flat lines offline). Cursor reads "0 m" elevation offline. M |
| G-16 | Route on the globe | Corner loop and Boxwork sample plans, section list, "Show route", slopes | partial | `globe-1440-online-site-route.png`, offline corner | Spec: same plan file in both modes | Uses two built-in plans, not the user's Plan. M to wire `plan` through |
| G-17 | Place names | IAU annotations | missing | `public/data/globe/names.geojson` is loaded by no code | Spec 1, B6 | M |
| G-18 | Offline basemap | Planet surface without ion | missing | `globe-1440-offline-*.png`: black planet, site image with smeared edge pixels | Spec: offline basemap | M to L; skip today unless cheap |
| G-19 | Layout at 1024 | Panels around the globe | partial | `globe-1024-online-initial.png` | Spec: works at 1024x768 | Route panel and "Now" panel cover most of the globe. S to M |
| G-20 | Discoverability | Reaching the Globe page | missing | no link from `/` | Spec: the globe is the base | Add an entry from the Plan header. S |

### Cross-cutting

| ID | Item | Status | Evidence | Fix, size |
|---|---|---|---|---|
| X-1 | Offline cold start | broken | `setOffline` before load cannot reach `localhost`; no service worker | Document "serve locally"; a service worker is L, skip |
| X-2 | Height offset | works | "Height offset at gale measured 71.05 m, spike value 73.76 m (2.71 m apart)" warning | Threshold is 2 m; decide if 2.7 m is acceptable. S |
| X-3 | Number formatting | partial | hyphen-minus, comma grouping and missing "≈" across Plan, Walk and site card | Design 2. S per surface |
| X-4 | MapLibre removal | partial | `maplibre-gl` in `package.json`, `src/components/mapSetup.ts`, `VITE_RENDERER` in `vite-env.d.ts`; README still says "Vite + React + MapLibre GL" | In progress (Plan polish); README S |
| X-5 | Tests and build | works | tsc, vitest 506/506, build | none |

---

## 2. Plan coverage

### Track B (logic and data)

| Task | Status | Gap |
|---|---|---|
| B1 Mars sun times | done | none seen; sunrise/sunset drive pace and beeper |
| B2 Pace, window, temperature | partial | Functions exist and are used; recommended start (warmest hours) and the "no daylight window" text are not shown in the UI |
| B3 Route shape | done | Labels collide (in progress) |
| B4 Passes and relay queue | done | Passes in `sample/gale/passes.json`; Plan view does not show the sol's passes on a timeline |
| B5 Site-finder data | done | 253 candidates, vetoes, detail flag |
| B6 Names and rover cost | partial | `names.geojson` produced but unused; `roverCost` used only to re-time the walker route |
| B7 Telemetry adapter (simulated) | done | Bridge and Web Bluetooth adapters are documented-only by design |
| B8 Global temperature | done | Patchy rendering on the sample (G-4) |

### Track A (Cesium app)

| Task | Status | Gap |
|---|---|---|
| A1 Frame, camera, height offsets | done | Offset warning fires at 2.7 m |
| A2 Layers on the globe | partial | Plan panel lacks global layers; no hover readout in Plan; coarse site layers invisible online |
| A3 Overlays, route look, coordinates | partial | Route look done; cursor readout and graticule only on the Globe page; section hover label missing on Plan; gradient always on in Plan (no toggle) |
| A4 Plan globe | partial | Scale bar wrong; MapLibre files and dependency still present; pace text |
| A5 Walk and Visor globe | partial | Offline black; Visor route missing; `maplibre-gl` gate fails; sunset countdown and temperature on the timeline done |
| A6 Clock, history, conditions | done on Globe page | Conditions not in Plan |
| A7 Site-finder UI | done | Card photo missing; card persists into Mars mode |
| A8 Modes and theme | partial | Only on the Globe page; Walk top bar stays day; Visor has no separate day/night HUD |
| A9 Safety and links | done in Walk, Visor and Globe Mars | Online Globe Mars crashes; pair tracking untested |
| A10 Review and cut-over | not started | This audit is the review; offline check fails |

### Design requirements (spec)

| Requirement | Status | Gap |
|---|---|---|
| 3D globe, annotations, lat/lon readout, graticule | partial | No place names; readout and graticule only on Globe page |
| Science layers stackable with legends and hover | partial | Hover missing for ice and thermal inertia (sample data); not in Plan |
| Clock, dust history, Gale weather, sunrise/sunset | done | Sample has one Mars year |
| Current conditions with age | done | Globe page only |
| Site-finder with vetoes, weights, chips, cards | done | No card photo |
| Walker routing on 1 m terrain | done | Stop snapping in progress |
| Rover routing with rover cost model | partial | Re-timing only, same route |
| Route look (line, chevrons, forks, start/finish) | done | Label collisions |
| Section hover with label, linked to stop list | partial | Globe page list only |
| Slopes: gradient, high/low/steepest, profile | done | |
| Pace and daylight window, recommended start | partial | No recommended start; confusing text |
| Temperature along the timeline, cold warning | partial | Temperature shown; no cold warning seen |
| Warning ladder with shelter by hazard | done | |
| Night contingency, habitat alert, way back | done | No darkened corridor seen in Walk |
| Suit time vs time to shelter, rover call | done | Rover panel on Globe Mars mode; Walk shows rover only inside the night panel |
| Pair tracking | not tested | |
| Pre-planning night return check in the plan file | not started | Not in `plan.json` |
| Daylight beeper | done | Audio not verifiable headless |
| SOS and relay scheduler | done | Science uplink items not in the UI |
| Hardware links: simulated adapter, rover "come to me" | done | |
| Earth and Mars modes, plan file as hand-over | partial | Globe page only; Globe uses built-in plans |
| Theme: day/night, sun-following, override | partial | Globe page only |
| 1440x900 and 1024x768, Gale and Jezero | partial | 1024 layouts broken (P-24, G-19); Jezero not in sample |
| Offline mode | broken | W-1, V-1, G-15, G-18, X-1 |

---

## 3. Usability: ten things that most stop a first-time user

1. **The globe is hidden.** The default page shows a 1 km square of Gale; the planet, its layers, the site finder and the Mars mode are only at `?globe=1`, with no link. A judge never sees the best work (G-20, P-2).
2. **Mars mode blanks the page** on the Globe page when online (G-6).
3. **Layers that do nothing.** Online, ticking CRISM or THEMIS changes nothing, and the 0.25 m image looks blurrier than the base map under it (P-6, P-7).
4. **The scale bar lies** ("500 m" across 100 px on a 1 km site), and a long zoom-out goes black (P-20, P-18).
5. **Pace reads as noise:** "Needed 0.2 km/h, Expected 2.5 km/h, Fits" with no sentence saying what to do (P-12).
6. **Stop controls are invisible** until the pointer hovers a row; on a tablet they never appear (P-8).
7. **Walk and Visor are crowded.** The safety stack covers a third of the Walk map, and the Visor shows the top bar, six panels and the playback bar, against the four-readout rule (W-13, V-5).
8. **Messages disagree:** Plan says "Turn-back: Not needed", Walk says "Before turn-back point - time limit"; the mover picker shows a 14 h science-rover time with no explanation (P-13, P-14).
9. **Silent failures:** a bad `plan.json` import does nothing; Jezero shows "Stub specification" on a sample deploy; offline Walk is black with no notice (P-21, P-1, W-1).
10. **Typography and copy drift from the design system:** hyphen-minus instead of U+2212, "−4,055 m" and "2 350 kJ" grouping, no "≈" on estimates, a hyphen instead of a dash in "Before turn-back point - time limit" (X-3).

---

## 4. Prioritised fix list for today (submission 18:00 IST)

Groups touch disjoint files so they can go to parallel workers. Where a group overlaps a stream already in progress, it says so; hand the item to that stream instead of a new worker.

### Must-fix

| # | Item | IDs | Files | Size | Group |
|---|---|---|---|---|---|
| 1 | Online Mars mode crash: `viewer.scene.globe?.show`, plus an error boundary around `SafetyLayer` | G-6 | `src/globe/GlobePage.tsx` | S | A |
| 2 | Site card closes (or hides) when switching to Mars mode | G-12 | `src/globe/GlobePage.tsx`, `src/globe/sites/SiteFinder.tsx` | S | A |
| 3 | Link to the Globe page from the Plan header (and back) | G-20 | `src/App.tsx` header, `src/globe/GlobePage.tsx` header | S | A (header lines only) |
| 4 | Offline and ion-unreachable fallback: pass `navigator.onLine` in Walk and Visor; when the tileset fails, give the viewer a `Globe(Ellipsoid.MARS)` before returning | W-1, V-1 | `src/globe/cesiumSetup.ts`, `src/globe/walk/WalkGlobe.tsx`, `src/globe/walk/VisorGlobe.tsx` | M | B |
| 5 | Whole-planet layers in the Plan layer panel (props already exist on `LayerPanel`; add `GlobeGlobalLayers` to `GlobePlanMap`) | P-2 | `src/App.tsx`, `src/globe/GlobePlanMap.tsx` | M | C (overlaps Plan polish: coordinate) |
| 6 | Scale bar: stable metres per pixel (pick at the canvas centre row, ignore failed picks, round to 1-2-5) | P-20 | `src/globe/GlobePlanMap.tsx`, `src/components/ScaleBar.tsx` | S | C |
| 7 | Wheel zoom-out ends on a black view (still on `8deb574`): clamp maximum zoom distance | P-18 | camera worker's files (`src/globe/groundPan.ts`, `GlobePlanMap.tsx`) | S | Camera stream |
| 8 | Coarse site layers and HiRISE sharpness online | P-6, P-7 | imagery files | M | Site terrain / sharp render streams |
| 9 | Stop row controls always visible (drop the hover-only CSS) | P-8 | `src/plan/plan.css` | S | D |
| 10 | Layer drawer at 1024 overlays the map instead of shrinking it | P-24 | `src/plan/plan.css` or `src/styles/visualReview.css` | S | D |
| 11 | Deploy env: set `VITE_TILES_BASE` (and `VITE_GLOBE_BASE`) so Jezero and full Gale load, not the sample stub | P-1 | deploy settings, `docs/deploy.md` | S | E (no code) |

### Should-fix

| Item | IDs | Files | Size | Group |
|---|---|---|---|---|
| Visor minimal chrome: hide top bar and collapse the safety stack to ladder headline plus SOS | V-5 | `src/components/VisorView.tsx`, `src/safety/SafetyCompact.tsx`, `src/safety/safety.css` | M | F |
| Visor route line ahead; eye height near route end | V-1, V-3 | `src/globe/walk/VisorGlobe.tsx` | M | B (after item 4) |
| Walk top bar night theme | W-12 | `src/App.tsx` (`data-theme` on the root when Walk is at night) | S | C |
| Arrow keys step 1 %, Page Up/Down by stop, reach the finish | W-3 | `src/walk/usePlaybackKeys.ts`, `src/walk/playbackKeys.ts` | S | F |
| Hook order in WalkView | W-14 | `src/components/WalkView.tsx` | S | F |
| Over-limit chip and copy, "≈" on estimates, one turn-back message across Plan and Walk | P-13, W-6 | `src/plan/PlanRail.tsx`, `src/components/WalkView.tsx` | M | D (PlanRail) and F (WalkView) |
| Import failure message | P-21 | `src/plan/PlanRail.tsx` | S | D |
| Mover picker note: "Rover time on the walking route" | P-14 | `src/globe/plan/MoverPicker.tsx` | S | D |
| Number formatting pass (U+2212, grouping, "≈") | X-3, P-16, G-12, W-11 | `src/globe/plan/PlanProfile.tsx`, `src/walk/format.ts`, `src/globe/sites/SiteCard.tsx`, `src/components/StopDetails.tsx` | S | G |
| Stray profile-hover dot; doubled "High" label on an empty plan | P-5, P-10 | `src/globe/GlobePlanMap.tsx`, `src/globe/overlays.ts` | S | C |
| Globe 1024 layout | G-19 | `src/globe/globe.css` | S | A |
| Drop or silence the CORS-blocked live Gale fetch | G-10 | `src/components/ConditionsPanel.tsx` | S | G |
| README: remove "MapLibre GL" | X-4 | `README.md` | S | E |

### Skip today

Per-mover route planning (P-14 L); suggested stops and chemistry add-as-stop (P-23); conditions panel in Plan (P-23); cursor readout and graticule in Plan (P-22); per-leg values and fixed rows in the stop list (P-9); place names (G-17); offline whole-planet basemap (G-18); offline flat lines (G-15); Globe route from the user's plan (G-16); service worker for offline cold start (X-1); night-return check in the plan file; science uplink UI; red/green ramp palette change (P-3, pipeline rebake).

### Parallel groups (no shared files)

- **A** `GlobePage.tsx`, `SiteFinder.tsx`, `globe.css`: items 1, 2, 3 (Globe side), G-19.
- **B** `cesiumSetup.ts`, `WalkGlobe.tsx`, `VisorGlobe.tsx`: item 4, then Visor route and eye height.
- **C** `App.tsx`, `GlobePlanMap.tsx`, `ScaleBar.tsx`, `overlays.ts`: items 3 (Plan header), 5, 6, Walk top bar theme, stray dot. Overlaps the Plan polish stream; give C to that worker or sequence after it.
- **D** `PlanRail.tsx`, `plan.css`, `MoverPicker.tsx`: items 9, 10, over-limit chip, import message, mover note. Pace text stays with Plan polish.
- **E** deploy settings, `docs/deploy.md`, `README.md`: item 11, README.
- **F** `VisorView.tsx`, `SafetyCompact.tsx`, `safety.css`, `WalkView.tsx`, `usePlaybackKeys.ts`: Visor chrome, keys, hook order, WalkView turn-back text.
- **G** `format.ts`, `PlanProfile.tsx`, `SiteCard.tsx`, `StopDetails.tsx`, `ConditionsPanel.tsx`: formatting pass, Gale fetch.
- Items 7 and 8 belong to the camera, site terrain and sharp-render streams already running.

## Not tested

- Jezero (no Jezero bundle in the sample), rover traverse and photo dots, stop photos and the photo card, chemistry layer and chemistry at stops: the sample site contains none of them.
- Stop snapping on impassable cells (the sample has no impassable cell near the test stops).
- Visor hazard cue (no steep ground on the test route).
- Pair-separation warning (`?pair=`), beeper audio and tablet vibration (headless).
- True offline cold start (blocked by `setOffline`; emulated instead).
- PR #63 (site terrain mesh) and `dev/sharp-render`: not merged when tested.
