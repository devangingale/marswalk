# References

Everything used in this project that we did not make ourselves. This file feeds the "NASA Data" and "Space Agency Partner Data and Other References" fields of the submission form. Add a line in the same pull request that introduces anything new.

## Datasets on disk

Not every dataset below ends up in the final product; trim this list to what is actually used before submitting. Source URLs still need adding per row.

| Dataset | Folder | Licence |
|---|---|---|
| crism_index | `data/raw/crism_index` | NASA PDS â€” public domain |
| crism_mrdr_su_bands | `data/raw/crism_mrdr_su_bands` | NASA PDS â€” public domain |
| hez_dem_index | `data/raw/hez_dem_index` | NASA PDS archive (doi:10.17189/ervc-mr85) |
| langlais2019 | `data/raw/langlais2019` | CC-BY-4.0 |
| mgc3_caves | `data/raw/mgc3_caves` | Public domain (PDS archive bundle, per data.gov listing); not stated on USGS page |
| mola_hrsc_blend | `data/raw/mola_hrsc_blend` | MOLA part public domain; HRSC part CC BY-SA 3.0 IGO |
| mola_megdr_128 | `data/raw/mola_megdr_128` | NASA PDS â€” public domain (US Government work) |
| montabone_dust | `data/raw/montabone_dust` | CC-BY-SA-3.0 |
| msl_rad_dose | `data/raw/msl_rad_dose` | CC-BY-4.0 |
| swim_ice | `data/raw/swim_ice` | Not stated on product page â€” check with PSI before redistribution |
| tanaka2014_geo | `data/raw/tanaka2014_geo` | USGS â€” public domain |
| tes_ti_2007 | `data/raw/tes_ti_2007` | NASA PDS â€” public domain |
| themis_ti_quant | `data/raw/themis_ti_quant` | USGS / NASA MDAP â€” public domain |
| jezero_ctx | `data/raw/jezero_ctx` | USGS Astrogeology / NASA PDS public domain (US Government work) |
| omni | `data/raw/omni` | NASA US Government work; public domain |
| solar_forecast | `data/raw/solar_forecast` | NASA and NOAA US Government public domain |
| donki | `data/raw/donki` | NASA CCMC / DONKI data; cite NASA source. |
| jezero_hirise_dtm | `data/raw/jezero_hirise_dtm` | USGS Astrogeology / NASA PDS public domain (US Government work) |
| msl_rad_rdr | `data/raw/msl_rad_rdr` | NASA PDS public domain (US Government work) |
| gale_ctx | `data/raw/gale_ctx` | USGS Astrogeology / NASA PDS public domain (US Government work) |
| gale_dem | `data/raw/gale_dem` | USGS Astrogeology / NASA PDS public domain (US Government work) |
| jezero_hirise_ortho | `data/raw/jezero_hirise_ortho` | USGS Astrogeology / NASA PDS public domain (US Government work) |
| pds_places | `data/raw/pds_places` | NASA PDS public domain (US Government work) |
| localized_rover_poses | `shared/poses/gale_poses.csv`, `shared/poses/jezero_poses.csv` | NASA/JPL PDS Places rover-position records, public domain (US Government work) |
| rover_images | `data/raw/rover_images` | Raw images from NASA are not copyrighted (#55); retain each feed credit and check third-party assets. |

Also on disk, not in the manifest: Gale 1 m DEM mosaic and HiRISE colour mosaic (`gale_dem`), Jezero HiRISE DTM and orthoimages, Jezero CTX DEM and mosaic, Curiosity RAD records (`msl_rad_rdr`), rover location tables (`pds_places`), rover raw-image metadata (`rover_images`), OMNI solar wind data, solar-cycle forecasts. Licences and sources to be confirmed and added above.

## Space Agency Partner data

- ESA Mars Express HRSC, as part of the HRSC–MOLA blended global DEM (`mola_hrsc_blend`). HRSC portion CC BY-SA 3.0 IGO.
- REMS, Curiosity / Gale: daily weather reports (sol, Ls, air-temperature extrema, pressure, and UV category) downloaded from NASA/JPL's [`weather` feed](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json), which identifies Centro de Astrobiología (CAB/CSIC-INTA, Spain) as the data provider. The certified [PDS Atmospheres REMS archive](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html) is the scientific archive; the NASA feed's own disclaimer says its daily report file is for outreach use and points scientific users to PDS. Feed cache: `data/raw/rems/nasa_weather.json`. No separate licence is stated for the feed; credit CAB/CSIC-INTA, NASA/JPL-Caltech, and the PDS Atmospheres Node.
- Curiosity APXS reduced oxide abundances: [PDS Geosciences Node MSL APXS archive](https://pds-geosciences.wustl.edu/missions/msl/apxs.htm), including its [RDR data inventory](https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data/collection_data_inventory.csv) and CSV products under `https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data/`. PDS/NASA data are public domain; credit the APXS Science Team at the University of Guelph and the Canadian Space Agency (instrument funder).
- Curiosity RAD absorbed-dose records: [MSL RAD Dose rates, Zenodo](https://doi.org/10.5281/zenodo.20536564), cached in `data/raw/msl_rad_dose/`. CC BY 4.0; cite Heber & Löwe, “MSL/RAD Dose rates”. The radiation layer uses the per-sol median of filtered RAD E-dose rate; its elevated-rate proxy uses the highest per-sol mean from those same data.
- Gale dust climatology: [Montabone et al. Mars Climate Database column dust optical depth v2](https://www-mars.lmd.jussieu.fr/mars/dust_climatology/index.html), direct archive [`krigedcdod_v2.tar.gz`](https://www-mars.lmd.jussieu.fr/mars/dust_climatology/dataset_v2/krigedcdod_v2.tar.gz), cached in `data/raw/montabone_dust/`. CC BY-SA 3.0; cite Montabone et al. (2015), Icarus, doi:10.1016/j.icarus.2014.12.034, and Montabone et al. (2020), JGR Planets, doi:10.1029/2019JE006111.
- Global water-ice consistency: [SWIM4MIM global products](https://swim.psi.edu/SWIM4MIMProducts.php), cached in `data/raw/swim_ice/`. Morgan & Putzig et al. (2025), Planetary Science Journal; the product page does not state a licence, so retain source credit and check with PSI before redistribution.
- Mars Global Cave Candidate Catalog: [USGS Astrogeology catalog page](https://astrogeology.usgs.gov/search/map/mars_global_cave_candidate_catalog_v1_cushing) and [PDS Imaging Node archive bundle](https://doi.org/10.17189/1519222), cached in `data/raw/mgc3_caves/`. Cushing (2015); public domain per the data.gov listing, though the USGS page does not state a licence.

## Scientific models and literature

| Model / Paper | Used for | Citation / Licence |
|---|---|---|
| Pandolf load-carriage equation | Walking metabolic power on level and uphill terrain | Pandolf, K. B., Givoni, B., & Goldman, R. F. (1977). *Predicting energy expenditure with loads while standing or walking very slowly to moderate walking speeds.* Journal of Applied Physiology, 43(4), 577–581. doi:10.1152/jappl.1977.43.4.577. Simplified with uniform Mars gravity scaling (3.71 m/s²). |
| Santee downhill correction | Downhill metabolic energy expenditure and eccentric braking correction | Santee, W. R., Allison, W. F., Blanchard, L. A., & Small, M. G. (2001). *A proposed model for load carriage on sloped terrain.* Aviation, Space, and Environmental Medicine, 72(6), 562–566. |

## Software and libraries

| Name | Used for | Licence |
|---|---|---|
| React | UI rendering and component architecture | MIT |
| MapLibre GL JS | Mars surface map rendering and 3D terrain relief | BSD-3-Clause |
| PMTiles | Cloud-native single-file tile archive reader | BSD-3-Clause |
| Vite | Frontend build tooling and static compilation | MIT |
| Vitest | Unit tests for the app shell and for the route planner, energy model, grid and plan libraries | MIT |
| TypeScript | Static type safety and data contract typing | Apache-2.0 |
| @types/node | Node type definitions for the planner test that writes the sample plan fixture | MIT |
| LightGBM (`lightgbm`) | Gradient-boosted tree walkability classifier | MIT |
| scikit-learn (`scikit-learn`) | ROC AUC metrics and model interfaces | BSD-3-Clause |

## Images, fonts, icons, text

| Item | Source | Licence / credit |
|---|---|---|
| Perseverance Navcam and Mastcam-Z raw images at Jezero stops, hot-linked in `app/public/data/jezero/photos.json` | NASA Mars raw-image RSS feed (`https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json`); positions joined by site and drive to `shared/poses/jezero_poses.csv` | NASA/JPL-Caltech and instrument-team credits retained per image; NASA raw images are not copyrighted |
| Eight Curiosity Navcam images (sols 4861 and 4865) listed in `app/src/fixtures/photos.sample.json`, hot-linked, not copied | Metadata from NASA's raw-image API, `https://mars.nasa.gov/api/v1/raw_image_items/` (filtered by mission `msl` and sol); positions from joining each image's `site` and `drive` to `shared/poses/gale_poses.csv`; `heading_deg` is the pose heading plus the image's mast azimuth | Shown with the feed's credit line, NASA/JPL-Caltech |
| Curiosity raw images at Gale stops (Navcam, Hazcam, Mastcam), hot-linked, listed in `app/public/data/gale/photos.json` by `pipeline/fetch_photos.py` | mars.nasa.gov/api/v1/raw_image_items (feed behind mars.nasa.gov/msl/multimedia/raw-images) | NASA raw images, not copyrighted; credit shown with each photo: NASA/JPL-Caltech (Navcam, Hazcam), NASA/JPL-Caltech/MSSS (Mastcam) |
| Barlow, Barlow Semi Condensed, Barlow Condensed | Google Fonts (Jeremy Tribby) | SIL Open Font License 1.1 |

## AI tools

- Claude (Anthropic) and Gemini (Google): writing code and documentation, directed and reviewed by the team.

## Challenge-listed NASA resources

| Resource | How we use it |
|---|---|
| Mars Perseverance Raw Images Gallery (mars.nasa.gov/mars2020/multimedia/raw-images) | Source of point-of-view photos at Jezero stops |
| Curiosity raw images feed (mars.nasa.gov/msl/multimedia/raw-images) | Source of point-of-view photos at Mount Sharp stops |
| NASA/JPL proposed-route map for Curiosity on lower Mount Sharp | Visual reference for how a science route map reads |
| JPL Mars Trek | Reference for regional layering; our tool works at walk scale instead |
| USGS–NASA Planetary Geologic Mapping Program | Geologic context (global map SIM 3292 on disk) |
| NASA Worldview | Reference for layered time-aware map interfaces |
