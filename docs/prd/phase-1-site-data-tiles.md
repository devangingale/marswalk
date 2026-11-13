# Phase 1 — Site data and tiles (Gale)

> Read [`00-contracts.md`](00-contracts.md) first. File formats, coordinates and units are defined there and override anything below.

**Owner:** Dev's machine (needs `data/`). **Window:** hours 1–6. **Branch:** `dev/p1-site-data`.

## Goal

Turn the raw Gale rasters into a small, web-ready bundle for one walk area on Mount Sharp, through scripts that take a site config so Jezero later needs no new code.

## Inputs (all under `data/raw/`)

- `gale_dem/MSL_Gale_DEM_Mosaic_1m_v3.tif` — 1 m elevation
- `gale_dem/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif` — colour image mosaic
- `themis_ti_quant/` — thermal inertia, 100 m
- `crism_mrdr_su_bands/` via `data/processed/crism_vrt/` — mineral summary indices
- `montabone_dust/`, `data/processed/global-layers/` — dust and pressure context
- `mola_hrsc_blend/` — ESA/NASA regional elevation for the context view
- `pds_places/localized_interp.csv` — Curiosity's path, to choose and check the area

## Deliverables

1. `pipeline/sites/gale.yaml`: area bounds (about 4 × 4 km covering the boxwork region and a stretch of Curiosity's path), source paths, output names.
2. `pipeline/crop.py`, `pipeline/derive.py`: cropped DEM and image; slope, roughness, curvature at 1 m.
3. `pipeline/coarse.py`: thermal, mineral, dust layers resampled to the area, each with its true resolution recorded in metadata.
4. `pipeline/bake.py`: image and overlay tiles as PMTiles, elevation as terrain-RGB tiles, in Web Mercator at true lat/lon; plus `site.json` (bounds, layer list, resolutions, units, colour ramps).
5. A 2 m cost-grid placeholder (slope-only) as a flat binary + JSON header, so phase 3 is unblocked before the model lands.
6. Outputs published where the app can fetch them (release asset or static host), and a ~5 MB sample committed under `app/public/sample/`.

## Done when

- The Gale area opens in a bare MapLibre page with the image, slope and one coarse layer, correctly aligned.
- Curiosity's path plotted on top follows the visible tracks/terrain, proving georeferencing.
- Each script prints output extent, resolution and value range.
- Running the same scripts with a different site file needs no code edits.

## Watch out for

- Mars radius is 3,396,190 m. Compute every distance and slope in the source projection in true metres, before reprojecting for display.
- Do not let 100 m thermal or ~200 m mineral data look like 1 m data: no smoothing that hides the pixel size, and the resolution goes in `site.json`.
- Check DEM nodata and mosaic seams before deriving slope.

## Additions (contracts v1)

- Publish the bundle exactly as laid out in contracts section 4, to the R2 bucket; `site.json` per section 5.
- Route grids per section 6: resample to 2 m true ground metres, write `elev.bin`, `cost.bin`, `grid.json`. Default `cost.bin` comes from the slope-and-roughness rule; cells above 20° are impassable.
- **Sample bundle first:** a 500 × 500 m corner of Gale under 5 MB at `app/public/sample/gale/`, merged to `main` before anything else, so phases 3 and 4 are unblocked.
- **Partner data:** download Curiosity weather (REMS, Spain) and chemistry (APXS, Canada) and write `conditions.json` and `chemistry.geojson` per section 9. Radiation numbers from the RAD records on disk. Record the method beside each number.
- Regional `fallback.jpg` from the ESA/NASA blended elevation map.

## Reviewer check (someone other than the author)

1. Open the sample bundle in the app shell: image, slope and one coarse layer line up with each other.
2. Pick three points on Curiosity's path from `shared/poses/gale_poses.csv`; each lands on the visible track or valley floor in the image.
3. `grid.json` dimensions × cell size equal `site.json` `size_m` within one cell.
4. Every layer in `site.json` has `kind`, `resolution_m`, `source`, `agency`.
