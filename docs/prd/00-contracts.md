# Shared contracts

**Read this before any phase brief.** Three machines build in parallel and meet only through the files defined here. If a brief and this document disagree, this document wins. Changing anything here needs a pull request that all three owners see.

Status: **draft for Dev's approval.** Items marked ⚠ are proposals awaiting a decision.

## 1. Product in one paragraph

A static web app. An astronaut stacks data layers over a 4 × 4 km area, drops science stops, and gets a safe walking route with budgets and a turn-back limit (Plan). The same plan is then walked in a tablet view and a helmet-visor view with real rover photos at stops (Walk, Visor). Mount Sharp in Gale crater is the full site; Jezero crater runs through the identical pipeline as the second site.

## 2. Decisions

| Topic | Decision |
|---|---|
| Sites | Gale / Mount Sharp (full), Jezero (second site, same pipeline, no site-specific code) |
| Travel mode | On foot. The walk starts and ends at a movable "rover / habitat" marker, so a rover drop-off is represented without building a vehicle model |
| Default walk | Two astronauts, 8-hour limit, all parameters editable ⚠ |
| Route cost | A cost grid (section 6). What produces it is swappable: the slope-and-roughness rule is the default; the learned walkability model replaces it only if it passes its gate (phase 2) |
| App hosting | Vercel, personal account |
| Tile hosting | Cloudflare R2 public bucket, personal account |
| Small data (weather, chemistry, radiation, photo index) | Bundled in the app as JSON. No live dependency during judging |
| Regional basemap | Mars Trek tiles, live, with a baked fallback image |
| Partner data | ESA (Mars Express elevation), Spain (rover weather stations), Canada (Curiosity chemistry). UAE Hope orbiter is a stretch item: phase 5, only if time remains |
| Backend | None |

## 3. Coordinates and units

- **Geographic:** `lon` = east longitude in degrees (0–360 not used; Gale ≈ 137.4, Jezero ≈ 77.4), `lat` = planetocentric latitude in degrees. Mars sphere radius `R = 3396190` m.
- **Display:** MapLibre shows tiles in Web Mercator at their true `lon`/`lat`. The map library believes it is on Earth, so **never take a distance, area or slope from the map library.**
- **Local metres** (everything that is measured): each site has an origin at the south-west corner of its area, `(lon0, lat0)`, and a centre latitude `lat_c`.
  - `x_m = R · cos(lat_c) · radians(lon − lon0)` (east)
  - `y_m = R · radians(lat − lat0)` (north)
- **Grids** are row-major, **row 0 is the northern edge**, column 0 the western edge. Cell `(row, col)` centre is at `x_m = (col + 0.5) · cell_x_m`, `y_m = height_m − (row + 0.5) · cell_y_m`.
- **Units:** metres, seconds, degrees, kilojoules, milligray (mGy) for dose, kelvin→shown as °C, pascals.
- **Time on Mars:** `sol` = mission day number for the named rover; `ls` = solar longitude in degrees (season).

## 4. Published bundle per site

Everything the app needs for a site sits under one base URL: `<TILES_BASE>/<site>/`.

```
<site>/site.json          site description (section 5)
<site>/image.pmtiles      colour or grey image, raster tiles
<site>/terrain.pmtiles    elevation as terrain-RGB tiles (Mapbox encoding), exaggeration handled in the app
<site>/<layer>.pmtiles    one per raster overlay (slope, walkability, thermal, mineral, ...)
<site>/grid.json          header for the route grids (section 6)
<site>/elev.bin           elevation grid
<site>/cost.bin           terrain cost grid
<site>/fallback.jpg       regional context image used if Mars Trek does not answer
```

Bundled inside the app instead (small, no hosting): `app/public/data/<site>/photos.json`, `conditions.json`, `chemistry.geojson`, `stops.json`.

A **sample bundle** (a 500 × 500 m corner of Gale, under 5 MB, same file names) is committed at `app/public/sample/gale/` so phases 3 and 4 can start before real tiles exist. The app reads `TILES_BASE` from one config value.

## 5. `site.json`

```json
{
  "id": "gale",
  "title": "Mount Sharp, Gale crater",
  "rover": "Curiosity",
  "origin": { "lon0": 137.3628, "lat0": -4.8250, "lat_c": -4.7913 },
  "size_m": { "width": 3986, "height": 4000 },
  "bounds_lonlat": [137.3628, -4.8250, 137.4303, -4.7575],
  "default_start": { "lon": 137.3900, "lat": -4.7800, "label": "Rover drop-off" },
  "terrain": { "url": "terrain.pmtiles", "encoding": "mapbox", "min_m": -4082, "max_m": -3277 },
  "layers": [
    {
      "id": "image",
      "title": "Orbital image",
      "kind": "optical",
      "type": "raster",
      "url": "image.pmtiles",
      "resolution_m": 0.25,
      "source": "MRO HiRISE colour mosaic",
      "agency": "NASA",
      "units": null,
      "legend": null,
      "default_on": true
    },
    {
      "id": "slope",
      "title": "Slope",
      "kind": "topographic",
      "type": "raster",
      "url": "slope.pmtiles",
      "resolution_m": 1,
      "source": "MRO HiRISE stereo elevation",
      "agency": "NASA",
      "units": "degrees",
      "legend": { "stops": [[0, "#1a9850"], [10, "#fee08b"], [20, "#d73027"], [30, "#4d004b"]] },
      "default_on": false
    }
  ],
  "conditions_url": "/data/gale/conditions.json",
  "photos_url": "/data/gale/photos.json",
  "chemistry_url": "/data/gale/chemistry.geojson",
  "stops_url": "/data/gale/stops.json",
  "validation": { "text": null, "model_auc": null, "baseline_auc": null }
}
```

Rules:
- `kind` is one of `optical`, `topographic`, `thermal`, `spectral`, `radiation`, `atmospheric`, `chemical`, `geologic`. The layer panel groups by it; the challenge asks for at least three kinds.
- `resolution_m` is the **true** resolution of the source, and the layer panel shows it. A 100 m layer is never presented as if it were 1 m.
- `type` is `raster` (PMTiles) or `points` (GeoJSON).
- Numbers in the example are illustrative; phase 1 writes the real ones.

## 6. Route grids: `grid.json`, `elev.bin`, `cost.bin`

```json
{
  "width": 1993, "height": 2000,
  "cell_x_m": 2.0, "cell_y_m": 2.0,
  "elev": { "file": "elev.bin", "dtype": "uint16", "scale_m": 0.1, "offset_m": -4082.2, "nodata": 65535 },
  "cost": { "file": "cost.bin", "dtype": "uint8", "impassable": 255, "multiplier": "1 + value / 50" },
  "limits": { "max_slope_deg": 20 },
  "cost_source": "slope-roughness-rule-v1"
}
```

- Both files are raw little-endian arrays, `width × height`, row 0 = north.
- `elev`: metres = `offset_m + value · scale_m`. The planner uses it for signed grade (uphill and downhill cost differently) and for climb totals.
- `cost`: a terrain difficulty multiplier from 1.0 (firm, smooth) to about 6, applied to the energy of each step. `255` means never enter. Phase 1 or 2 already marks cells above `max_slope_deg` as 255; the planner does not re-derive slope limits.
- `cost_source` names what produced the grid, and the app shows it. Swapping the rule for the model changes this file and nothing in the app.
- Cells are 2 m in **true ground metres** in both directions (the pipeline resamples to make this so).

## 7. `plan.json` (app state; Plan writes it, Walk and Visor read it)

```json
{
  "version": 1,
  "site": "gale",
  "params": { "crew": 2, "time_limit_s": 28800, "suit_mass_kg": 120, "body_mass_kg": 80, "stop_time_s": 1200, "solar_event": false },
  "start": { "lon": 137.3900, "lat": -4.7800, "label": "Rover drop-off" },
  "stops": [
    { "id": "s1", "name": "Boxwork ridge", "lon": 137.3795, "lat": -4.8120, "note": "Mineral veins standing as ridges", "dwell_s": 1200 }
  ],
  "route": {
    "legs": [
      {
        "from": "start", "to": "s1",
        "line": [[137.3900, -4.7800], [137.3898, -4.7803]],
        "distance_m": 1840, "time_s": 2950, "climb_m": 62, "descent_m": 18, "energy_kj": 1450, "max_slope_deg": 14.2
      }
    ],
    "returns_to_start": true,
    "totals": { "distance_m": 5200, "time_s": 14300, "climb_m": 140, "descent_m": 140, "energy_kj": 4300, "dose_mgy": 0.09 },
    "turn_back": { "leg": 1, "lon": 137.3812, "lat": -4.8090, "reason": "time" },
    "feasible": true,
    "warnings": []
  }
}
```

- `line` is `[lon, lat]` pairs, densified so no two points are more than 4 m apart. Walk and Visor animate along it.
- The route always returns to `start`.
- `turn_back` is the last point from which walking home still fits the binding limit; `reason` names that limit (`time` or `energy`).
- A stop that cannot be reached sets `feasible: false` and adds a plain-language entry to `warnings`; the app never draws a line through impassable ground.
- A committed example lives at `app/src/fixtures/plan.sample.json`.

## 8. `photos.json`

```json
[
  {
    "id": "NLB_847851928EDR_F1252490NCAM00302M_",
    "lon": 137.3791, "lat": -4.8124, "heading_deg": 212,
    "sol": 5073, "camera": "Navcam Left",
    "url": "https://mars.nasa.gov/msl-raw-images/...JPG",
    "thumb": "https://mars.nasa.gov/msl-raw-images/...JPG",
    "credit": "NASA/JPL-Caltech"
  }
]
```

- Position comes from joining the image's `site` and `drive` to `shared/poses/<site>_poses.csv`.
- `heading_deg` is the compass direction the camera faced, or `null` if unknown.
- Only images inside the site's `bounds_lonlat`; at most about 20 per 50 m of rover path, preferring mast cameras over hazard cameras.
- `credit` is shown with every photo. Images stay on NASA's servers.

## 9. `conditions.json`, `chemistry.geojson`, `stops.json`

```json
{
  "weather": {
    "source": "REMS, Curiosity (Spain: Centro de Astrobiología / INTA)",
    "by_season": [ { "ls_from": 0, "ls_to": 30, "air_temp_min_c": -80, "air_temp_max_c": -12, "pressure_pa": 870, "uv": "high", "n_sols": 310 } ],
    "latest": { "sol": 4868, "terrestrial_date": "2026-04-12", "air_temp_min_c": -78, "air_temp_max_c": -9, "pressure_pa": 842 }
  },
  "radiation": {
    "source": "RAD, Curiosity (NASA / SwRI)",
    "surface_dose_mgy_per_day": 0.21,
    "solar_event_mgy_per_day": 1.0,
    "note": "Measured at Gale. At Jezero these values are carried over, not measured there."
  },
  "dust": { "source": "Mars Climate Database dust climatology (Montabone et al.)", "by_season": [ { "ls_from": 0, "ls_to": 30, "opacity": 0.4, "storm_fraction": 0.02 } ] }
}
```

- Numbers above are placeholders showing shape and units. Phase 1 computes the real ones and records the method next to each.
- `chemistry.geojson`: GeoJSON points, properties `target`, `sol`, and oxide weight-percent fields (`SiO2`, `FeO`, `SO3`, ...), `source`. Gale only.
- `stops.json`: suggested science stops, `[{ "id", "name", "lon", "lat", "why", "source" }]`. Shown as suggestions the user accepts; never added automatically.

## 10. Budgets ⚠

One file, `app/src/lib/energy.ts`, owns the walking model. Proposal:

- **Energy per step:** the Pandolf load-carriage equation, with body-plus-suit weight scaled to Mars gravity (3.71 m/s²), a downhill correction, and the cell's terrain multiplier from `cost.bin`. The owner of phase 3 confirms the published form of the equation, cites it in code and in `docs/references.md`, and states the gravity scaling as our simplification.
- **Speed:** 0.8 m/s on flat firm ground, reduced with slope; impassable above the slope limit.
- **Dose:** `surface_dose_mgy_per_day × walk_hours / 24.66`; the solar-event toggle swaps the rate.
- **Turn-back:** computed against time and energy with a 15 % reserve.

These are planning-grade estimates and the app says so. They are not validated against suited human trials.

## 11. Git and review

- `main` is always deployable. Branches are the ones already created, one per phase.
- One pull request per deliverable. The pull request description lists what was run to check it.
- **Review:** someone other than the author runs the brief's reviewer check before merge (section at the end of each brief).
- Anything taken from outside goes in `docs/references.md` in the same pull request.
- Public repository: no secrets, no employer names, no NASA logos or mission insignia.

## 12. Open decisions

1. Default walk limits (section 2 and 10).
2. Whether the learned model replaces the rule (decided at the phase 2 gate).
3. Project name.
4. Clock times for the schedule, against the Sunday 23:59 deadline.
