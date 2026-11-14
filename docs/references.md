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
| rover_images | `data/raw/rover_images` | Raw images from NASA are not copyrighted (#55); retain each feed credit and check third-party assets. |

Also on disk, not in the manifest: Gale 1 m DEM mosaic and HiRISE colour mosaic (`gale_dem`), Jezero HiRISE DTM and orthoimages, Jezero CTX DEM and mosaic, Curiosity RAD records (`msl_rad_rdr`), rover location tables (`pds_places`), rover raw-image metadata (`rover_images`), OMNI solar wind data, solar-cycle forecasts. Licences and sources to be confirmed and added above.

## Space Agency Partner data

- ESA Mars Express HRSC, as part of the HRSC–MOLA blended global DEM (`mola_hrsc_blend`). HRSC portion CC BY-SA 3.0 IGO.
- REMS, Curiosity / Gale: daily weather reports (sol, Ls, air-temperature extrema, pressure, and UV category) downloaded from NASA/JPL's [`weather` feed](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json), which identifies Centro de Astrobiología (CAB/CSIC-INTA, Spain) as the data provider. The certified [PDS Atmospheres REMS archive](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html) is the scientific archive; the NASA feed's own disclaimer says its daily report file is for outreach use and points scientific users to PDS. Feed cache: `data/raw/rems/nasa_weather.json`. No separate licence is stated for the feed; credit CAB/CSIC-INTA, NASA/JPL-Caltech, and the PDS Atmospheres Node.
- Curiosity APXS reduced oxide abundances: [PDS Geosciences Node MSL APXS archive](https://pds-geosciences.wustl.edu/missions/msl/apxs.htm), including its [RDR data inventory](https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data/collection_data_inventory.csv) and CSV products under `https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data/`. PDS/NASA data are public domain; credit the APXS Science Team at the University of Guelph and the Canadian Space Agency (instrument funder).
- Curiosity RAD absorbed-dose records: [MSL RAD Dose rates, Zenodo](https://doi.org/10.5281/zenodo.20536564), cached in `data/raw/msl_rad_dose/`. CC BY 4.0; cite Heber & Löwe, “MSL/RAD Dose rates”. The radiation layer uses the per-sol median of filtered RAD E-dose rate; its elevated-rate proxy uses the highest per-sol mean from those same data.
- Gale dust climatology: [Montabone et al. Mars Climate Database column dust optical depth v2](https://www-mars.lmd.jussieu.fr/mars/dust_climatology/index.html), direct archive [`krigedcdod_v2.tar.gz`](https://www-mars.lmd.jussieu.fr/mars/dust_climatology/dataset_v2/krigedcdod_v2.tar.gz), cached in `data/raw/montabone_dust/`. CC BY-SA 3.0; cite Montabone et al. (2015), Icarus, doi:10.1016/j.icarus.2014.12.034, and Montabone et al. (2020), JGR Planets, doi:10.1029/2019JE006111.

## Software and libraries

| Name | Used for | Licence |
|---|---|---|
| _add as introduced_ | | |
| LightGBM (`lightgbm`) | Gradient-boosted tree walkability classifier | MIT |
| scikit-learn (`scikit-learn`) | ROC AUC metrics and model interfaces | BSD-3-Clause |

## Images, fonts, icons, text

| Item | Source | Licence / credit |
|---|---|---|
| _add as introduced_ | | |

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
