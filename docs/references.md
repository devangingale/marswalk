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
| candidate001_hirise_dtm | `data/raw/candidate001_hirise_dtm` | HiRISE DTM DTEEC_007205_1660_024505_1660_A01 (https://hirise-pds.lpl.arizona.edu/PDS/DTM/PSP/ORB_007200_007299/PSP_007205_1660_ESP_024505_1660/); free to use with credit NASA/JPL/University of Arizona |
| candidate001_hirise_ortho | `data/raw/candidate001_hirise_ortho` | HiRISE orthoimage PSP_007205_1660_RED_B_01_ORTHO (same folder); free to use with credit NASA/JPL/University of Arizona |
| candidate001_mola_hrsc | `data/raw/candidate001_mola_hrsc` | Crop of the USGS MOLA/HRSC BlendDEM v2 (https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/); MOLA part public domain, HRSC part CC BY-SA 3.0 IGO |
| pds_places | `data/raw/pds_places` | NASA PDS public domain (US Government work) |
| localized_rover_poses | `shared/poses/gale_poses.csv`, `shared/poses/jezero_poses.csv` | NASA/JPL PDS Places rover-position records, public domain (US Government work) |
| rover_images | `data/raw/rover_images` | Raw images from NASA are not copyrighted (#55); retain each feed credit and check third-party assets. |
| naif_spice | `data/raw/naif_spice` | NASA PDS / ESA — public domain (US Government work / ESA open access) |
| rems | `data/raw/rems` | Public domain / NASA content; credit NASA/JPL-Caltech/CAB(CSIC-INTA) |
| mcs_ddr_v62 | `data/raw/mcs_ddr_v62` | NASA PDS MRO-M-MCS-5-DDR-V6.2; NASA government data, public domain; no separate product-specific licence text stated |
| mocaas | `data/raw/mocaas` | Not stated by MOCAAS or PSUP; credit Carter et al. (2023), the MOCAAS team (IAS) and PSUP in full; removed on request |
| tes_bandfield2002 | `data/raw/tes_bandfield2002` | NASA PDS — public domain |

## Site-finder criteria

- Human landing limits and the exploration-zone resource context: Bussey & Davis, NASA HEOMD/SMD, [First Landing Site/Exploration Zone Workshop – Second Announcement](https://www.nasa.gov/wp-content/uploads/2015/06/hls2-2nd-announcement-7-8.pdf) (2015), pp. 3–4; Bussey & Hoffman, [Human Mars Landing Site and Impacts on Mars Surface Operations](https://ntrs.nasa.gov/citations/20160001040) (2016), pp. 16–17. The site-finder treats water and habitat distances as scored criteria; its hard vetoes are latitude, MOLA elevation, and the approximately 25 km² low-slope area.
- Input layer credits and licence notes are copied into `data/globe/sites.json` from the source manifests under `data/raw/` for MOLA, SWIM, RAD, dust climatology, cave candidates, geologic diversity, TES thermal inertia, and the HiRISE/CTX DEM index.

Also on disk, not in the manifest: Gale 1 m DEM mosaic and HiRISE colour mosaic (`gale_dem`), Jezero HiRISE DTM and orthoimages, Jezero CTX DEM and mosaic, Curiosity RAD records (`msl_rad_rdr`), rover location tables (`pds_places`), rover raw-image metadata (`rover_images`), OMNI solar wind data, solar-cycle forecasts. Licences and sources to be confirmed and added above.

## Space Agency Partner data

- ESA Mars Express HRSC, as part of the HRSC–MOLA blended global DEM (`mola_hrsc_blend`). HRSC portion CC BY-SA 3.0 IGO.
- REMS, Curiosity / Gale: daily weather reports (sol, Ls, air-temperature extrema, pressure, and UV category) downloaded from NASA/JPL's [`weather` feed](https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json), which identifies Centro de Astrobiología (CAB/CSIC-INTA, Spain) as the data provider. The certified [PDS Atmospheres REMS archive](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html) is the scientific archive; the NASA feed's own disclaimer says its daily report file is for outreach use and points scientific users to PDS. Feed cache: `data/raw/rems/nasa_weather.json`. No separate licence is stated for the feed; credit CAB/CSIC-INTA, NASA/JPL-Caltech, and the PDS Atmospheres Node.
- Curiosity APXS reduced oxide abundances: [PDS Geosciences Node MSL APXS archive](https://pds-geosciences.wustl.edu/missions/msl/apxs.htm), including its [RDR data inventory](https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data/collection_data_inventory.csv) and CSV products under `https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data/`. PDS/NASA data are public domain; credit the APXS Science Team at the University of Guelph and the Canadian Space Agency (instrument funder).
- Curiosity RAD absorbed-dose records: [MSL RAD Dose rates, Zenodo](https://doi.org/10.5281/zenodo.20536564), cached in `data/raw/msl_rad_dose/`. CC BY 4.0; cite Heber & Löwe, “MSL/RAD Dose rates”. The radiation layer uses the per-sol median of filtered RAD E-dose rate; its elevated-rate proxy uses the highest per-sol mean from those same data.
- Gale dust climatology: [Montabone et al. Mars Climate Database column dust optical depth v2](https://www-mars.lmd.jussieu.fr/mars/dust_climatology/index.html), direct archive [`krigedcdod_v2.tar.gz`](https://www-mars.lmd.jussieu.fr/mars/dust_climatology/dataset_v2/krigedcdod_v2.tar.gz), cached in `data/raw/montabone_dust/`. CC BY-SA 3.0; cite Montabone et al. (2015), Icarus, doi:10.1016/j.icarus.2014.12.034, and Montabone et al. (2020), JGR Planets, doi:10.1029/2019JE006111.
- ESA Mars Express and ExoMars Trace Gas Orbiter SPICE kernels: reconstructed and forward predicted orbit ephemerides from the ESA SPICE Service (`https://spiftp.esac.esa.int/data/SPICE/`). Open access; cite ESA SPICE Service and the respective mission operations teams.
- Global water-ice consistency: [SWIM4MIM global products](https://swim.psi.edu/SWIM4MIMProducts.php), cached in `data/raw/swim_ice/`. Morgan & Putzig et al. (2025), Planetary Science Journal; the product page does not state a licence, so retain source credit and check with PSI before redistribution.
- Mars Global Cave Candidate Catalog: [USGS Astrogeology catalog page](https://astrogeology.usgs.gov/search/map/mars_global_cave_candidate_catalog_v1_cushing) and [PDS Imaging Node archive bundle](https://doi.org/10.17189/1519222), cached in `data/raw/mgc3_caves/`. Cushing (2015); public domain per the data.gov listing, though the USGS page does not state a licence.
- MRO Mars Climate Sounder surface temperature: [PDS Atmospheres Node MCS archive](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/mcs.html), subset of DDR V6.2 profiles cached in `data/raw/mcs_ddr_v62/`. McCleese and Schofield, *MRO Mars Climate Sounder Level 5 DDR V6.2*, NASA PDS, doi:10.17189/6khc-s052. The archive page does not state a separate product licence; credit the PDS archive and MCS team.
- Hydrated minerals (whole-planet layers `hydrated_clays`, `hydrated_all`, `hydrated_sulfates`, `hydrated_carbonates`): MOCAAS, the Mars Orbital Catalog of Aqueous Alteration Signatures, November 2023 release, built from ESA Mars Express OMEGA and NASA MRO CRISM data. Read from the PSUP OGC WFS [`https://ows.psup.univ-lyon1.fr/mocaas`](https://ows.psup.univ-lyon1.fr/mocaas?SERVICE=WFS&REQUEST=GetCapabilities) (10 feature types, OMEGA and CRISM x 5 spectral-mineral classes) by `pipeline/globe_hydrated.py`, cached in `data/raw/mocaas/`. The project page's zip download (https://www.ias.u-psud.fr/moccas/) returned 410 Gone. Cite Carter, J. et al. (2023), A Mars orbital catalog of aqueous alteration signatures (MOCAAS), Icarus 389, 115164, doi:10.1016/j.icarus.2022.115164. No licence is stated; credit Carter et al. (2023), the MOCAAS team (IAS, Universite Paris-Saclay) and PSUP in full, and remove on request.

## Scientific models and literature

| Model / Paper | Used for | Citation / Licence |
|---|---|---|
| Pandolf load-carriage equation | Walking metabolic power on level and uphill terrain | Pandolf, K. B., Givoni, B., & Goldman, R. F. (1977). *Predicting energy expenditure with loads while standing or walking very slowly to moderate walking speeds.* Journal of Applied Physiology, 43(4), 577–581. doi:10.1152/jappl.1977.43.4.577. Simplified with uniform Mars gravity scaling (3.71 m/s²). |
| Santee et al. 2003 (USARIEM TN03-3) correction to Pandolf 1977 | Downhill metabolic energy expenditure and eccentric braking correction | Santee, W. R., Blanchard, L. A., Speckman, K. L., Gonzalez, J. A., & Wallace, R. F. (2003). *Load carriage model development and testing with field data.* USARIEM Technical Note TN03-3 (DTIC ADA415788). Form as restated in Potter, A. W., et al. (2013). *Comparative analysis of metabolic cost equations: a review.* Journal of Sport and Human Performance, 1(3), 34–42. doi:10.12922/jshp.0009.2013. The operator before V² is unverified in the review PDF (see `docs/research/eva-limits.md`, row 3). |
| NASA NAIF SPICE ephemerides | Orbiter pass prediction (MRO, 2001 Mars Odyssey, ExoMars TGO, Mars Express) | Acton, C. H. (1996). *Ancillary Data Services of NASA's Navigation and Ancillary Information Facility.* Planetary and Space Science, 44(1), 65–70; Public domain. |
| Martian calendar (Clancy / Piqueux) | Martian year and sol to Earth date calculation | Clancy, R. T., et al. (2000). *An intercomparison of ground-based millimeter, MGS TES, and Viking atmospheric temperature measurements: Seasonal and interannual variability of temperatures and dust loading in the global Mars atmosphere.* Journal of Geophysical Research: Planets, 105(E4), 9553–9571. doi:10.1029/1999JE001089. Piqueux, S., et al. (2015). *Calculation of Mars solar longitude (Ls) and Martian calendar.* Icarus, 251, 332–339. doi:10.1016/j.icarus.2014.12.014. |
| Tanaka et al. 2014 (SIM 3292) | USGS global geologic map of Mars (1:20M scale) unit classifications, ages, and boundaries | Tanaka, K.L., et al. (2014). *Geologic map of Mars.* USGS Scientific Investigations Map 3292, doi:10.3133/sim3292; Public domain. |
| Bandfield 2002 TES mineral maps | Global olivine and mineral abundance heatmaps | Bandfield, J.L. (2002). *Global mineral distributions on Mars.* Journal of Geophysical Research: Planets, 107(E6), 5042, doi:10.1029/2001JE001510; NASA PDS / ASU Mars Global Data Sets, public domain. |

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
| spiceypy (`spiceypy==8.4.0`) | Python wrapper for CSPICE (NAIF SPICE toolkit N0067) for orbiter pass prediction | MIT |
| pyshp (`pyshp==2.3.1`) | Pure-Python ESRI Shapefile reader for SIM 3292 geology rasterisation | MIT |

## Images, fonts, icons, text

| Item | Source | Licence / credit |
|---|---|---|
| Perseverance Navcam and Mastcam-Z raw images at Jezero stops, hot-linked in `app/public/data/jezero/photos.json` | NASA Mars raw-image RSS feed (`https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json`); positions joined by site and drive to `shared/poses/jezero_poses.csv` | NASA/JPL-Caltech and instrument-team credits retained per image; NASA raw images are not copyrighted |
| Eight Curiosity Navcam images (sols 4861 and 4865) listed in `app/src/fixtures/photos.sample.json`, hot-linked, not copied | Metadata from NASA's raw-image API, `https://mars.nasa.gov/api/v1/raw_image_items/` (filtered by mission `msl` and sol); positions from joining each image's `site` and `drive` to `shared/poses/gale_poses.csv`; `heading_deg` is the pose heading plus the image's mast azimuth | Shown with the feed's credit line, NASA/JPL-Caltech |
| Curiosity raw images at Gale stops (Navcam, Hazcam, Mastcam), hot-linked, listed in `app/public/data/gale/photos.json` by `pipeline/fetch_photos.py` | mars.nasa.gov/api/v1/raw_image_items (feed behind mars.nasa.gov/msl/multimedia/raw-images) | NASA raw images, not copyrighted; credit shown with each photo: NASA/JPL-Caltech (Navcam, Hazcam), NASA/JPL-Caltech/MSSS (Mastcam) |
| 40 NASA Photojournal 360° rover mosaics (Curiosity 31, Perseverance 6, Spirit 2, Opportunity 1), padded to 2:1 at 2048 × 1024 by `pipeline/build_panoramas.py` into `app/public/panos/`; the full list with PIA ids, sols and captions is `app/public/panoramas.json` | Discovered through the NASA Image and Video Library API (`https://images-api.nasa.gov`) and curated in `pipeline/panoramas.sources.json`; captions, titles and images from each PIA's Photojournal page (`https://photojournal.jpl.nasa.gov/catalog/<PIA>`). Positions from `shared/poses/` (PDS PLACES for Curiosity and Perseverance; the PDS Geosciences Spirit traverse below); Opportunity's Eagle Crater stop at the published landing site | Credits as published per image (e.g. NASA/JPL-Caltech/MSSS, NASA/JPL-Caltech/ASU/MSSS, NASA/JPL/Cornell), shown in the app's metadata card; NASA images and captions, not copyrighted |
| Spirit traverse, `MERA_traverse.csv`, converted to `shared/poses/gusev_poses.csv` by `pipeline/mer_poses.py` | PDS Geosciences Node, MER Analyst's Notebook traverse data (`https://an.rsl.wustl.edu/mera/AN/pages/mer/mer_traverse.htm`); corrected positions provided by science team member Tim Parker | NASA PDS data; equirectangular projection centred at 175.5° E per its label |
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
