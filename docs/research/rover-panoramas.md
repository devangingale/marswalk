# Rover panoramas for a drop-in 360° view

Researched 2026-11-14. Status tags: **confirmed** = primary source read or fetched; **secondary**; **unverified**.

## Summary: what the app should use

- For a few fixed "stops", use official NASA Photojournal 360° panoramas (public domain, credit NASA/JPL-Caltech plus the camera team). Download the JPEG, re-tile it to an equirectangular or cube-map pyramid at build time. Full-resolution TIFFs run 0.4–3.2 GB, so never ship them raw.
- For any other stop, pull raw Navcam frames from the raw-image JSON APIs (both send `access-control-allow-origin: *`). Group frames by the **sequence ID** inside the image ID (e.g. `NCAM00518`) for one sol and one site/drive. Each record already includes the CAHVOR/CAHVORE camera model, so frames can be projected onto a sphere without PDS.
- Mars 2020 has PDS terrain meshes (OBJ + MTL + PNG texture, site frame) for Navcam, Mastcam-Z and Hazcam. The newest Navcam mesh in PDS is sol 658. No MSL mesh collection was found in PDS.
- Stitching: VICAR (NASA-AMMOS, Apache-2.0) contains the JPL Mars mosaic programs; Hugin (GPL v2+) is the common general stitcher.

## Official panoramas

| PIA | Rover / site | Taken | Size (pixels) | File | Status |
|---|---|---|---|---|---|
| PIA24264 "Mastcam-Z's First 360-Degree Panorama" | Perseverance, landing site | sol 3 (2021-02-21), 142 images | hi-res TIF 36952 × 11570 (640 MB) | https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia24/pia24264/PIA24264.jpg (2.60 MB); `.../PIA24264_hires.tif` | confirmed |
| PIA24663 "Mastcam-Z's 360-degree View of Van Zyl Overlook" | Perseverance | 2021 (Ingenuity flight zone) | full-res 93,060 × 20,652 (2.0 GB); JPEG 14.66 MB | `.../pia24/pia24663/PIA24663.jpg`, `.../PIA24663.tif` | confirmed |
| PIA26080 "Perseverance's 360-Degree View From 'Airey Hill'" | Perseverance | released 2023-12 | max 94000 × 25328 TIF (3.23 GB); half-res 47000 × 12664 JPG (171 MB) | `.../pia26/pia26080/PIA26080.jpg`, `PIA26080_Enhanced_Color.tif` | confirmed |
| PIA26369 "Perseverance Captures 'Bright Angel' in 360 Degrees" | Perseverance | released 2024-07 | 54000 × 13200 JPG (493 MB); TIF 1.48 GB | `.../pia26/pia26369/PIA26369.jpg`, `PIA26369_hires.tif` | confirmed |
| PIA16918 "Billion-Pixel View From Curiosity at Rock Nest, White-Balanced" | Curiosity, Rocknest | 2012, "nearly 900 images" | 1.3 billion px original; Photojournal files are reduced (TIF 151.74 MB) | `.../pia16/pia16918/PIA16918.tif` | confirmed |
| PIA20332 "Full-Circle Vista from 'Naukluft Plateau'" | Curiosity | 2016-04-04 (after sol 1301 drive) | TIF 559.21 MB, JPEG 105.44 MB (pixel size not stated) | `.../pia20/pia20332/PIA20332.tif` | confirmed |
| PIA23623 "Curiosity's 1.8-Billion-Pixel Panorama" | Curiosity, Glen Torridon | 2019, >1,000 images | 1.8 billion px (TIF 2.26 GB); version with rover ~650 million px | `.../pia23/pia23623/PIA23623_hires.tif` | confirmed |
| PIA25366 "Curiosity's 360-degree Panorama Near Sierra Maigualida" | Curiosity | sol 3481 (2022-05-22), 133 images | TIF 422.42 MB, JPEG 31.93 MB | `.../pia25/pia25366/PIA25366.tif` | confirmed |

All entries: Photojournal catalog page `https://photojournal.jpl.nasa.gov/catalog/<PIA>`, asset base `https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/`. Licence: see rows L1–L2 below.

## Findings

| # | Item | Value | Meaning | Source | Status |
|---|---|---|---|---|---|
| L1 | NASA imagery licence | NASA content "generally are not subject to copyright in the United States"; may be used for "computer graphical simulations and Internet Web pages"; "NASA should be acknowledged as the source"; must not imply endorsement | Public domain in the US; credit required | NASA Images and Media Usage Guidelines, https://www.nasa.gov/nasa-brand-center/images-and-media/ | confirmed |
| L2 | JPL credit line | "Unless otherwise noted in the caption information for an image, the credit line should be 'Courtesy NASA/JPL-Caltech.'"; NASA/JPL logos need prior written approval | Use the per-image credit (e.g. NASA/JPL-Caltech/ASU for Mastcam-Z, NASA/JPL-Caltech/MSSS for Mastcam) | JPL Image Use Policy (SPDX copy), https://spdx.org/licenses/JPL-image.html | confirmed |
| R1 | Mars 2020 raw API | `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=100&page=0&order=sol+desc&search=NAVCAM_LEFT&condition_1=<sol>:sol:gte&condition_2=<sol>:sol:lte` | Returns `images[]` with `imageid, sol, site, drive, camera{instrument, camera_model_type, camera_model_component_list, camera_position, camera_vector}, extended{mastAz, mastEl, sclk, dimension, subframeRect, scaleFactor}, image_files{full_res, large, medium, small}, credit, date_taken_utc, date_taken_mars` | Fetched 2026-11-14; header `access-control-allow-origin: *` | confirmed |
| R2 | Mars 2020 image ID layout | e.g. `NLG_2024_0846620381_164ECM_N0930000NCAM00518_00_2I3J`: camera `NL`, sol `2024`, SCLK, then `N` + site `093` + drive `0000` + sequence `NCAM00518` | Same site/drive + same sequence ID = one panorama | Observed in API records (sol 2024: 100 Navcam frames split into sequences NCAM00520 ×34, NCAM00518 ×16, NCAM00500 ×15, …) | confirmed (observed; layout per Mars 2020 naming SIS not opened) |
| R3 | Mars 2020 search by sequence | `search=NCAM00518` returns 0 results | Cannot query a sequence directly; filter by sol + instrument, then group client-side | Tested 2026-11-14 | confirmed |
| R4 | Mars 2020 camera model in API | `camera_model_type: "CAHVORE"`, `camera_model_component_list` = C;A;H;V;O;R;E;type;param | Ready-to-use model per frame, in rover nav frame | API record | confirmed |
| R5 | MSL raw API | `https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=50&page=0&condition_1=msl:mission&search=NAV_LEFT_B` | Returns `items[]` with `imageid, sol, site, drive, instrument, camera_model_type (CAHVOR), camera_model_component_list, url, image_credit, extended{lmst, mast_az, mast_el, sample_type}`; CORS `*` | Fetched 2026-11-14 | confirmed |
| R6 | MSL Navcam ID layout | e.g. `NLB_847853302EDR_F1252490NCAM00354M_`: site 1252, drive 490, sequence `NCAM00354` | Group as for Mars 2020 | Observed records (sol 5073) | confirmed (observed) |
| R7 | MSL Mastcam raw records | camera model fields are `null` for MSSS-hosted cameras (e.g. MAHLI record) | Mastcam frames need PDS labels or a separate model | Observed record | confirmed for MAHLI; Mastcam not checked |
| C1 | Camera model in Mars 2020 PDS4 labels | `<geom:Camera_Model_Parameters>` → `<geom:model_type>CAHVORE</geom:model_type>` → `<geom:CAHVORE_Model>` with `Vector_Center, Vector_Axis, Vector_Horizontal, Vector_Vertical, Vector_Optical`, `cahvore_model_type`, `cahvore_model_parameter` | XML path to parse | Label `NLF_0658_0725353173_848CWG_N0320274NCAM08111_0A0295J01.xml`, `mars2020_navcam_ops_calibrated` | confirmed |
| C2 | Camera model in MSL PDS3 labels | `GROUP = GEOMETRIC_CAMERA_MODEL_PARMS`, `MODEL_TYPE = CAHVOR`, `MODEL_COMPONENT_1..6` (C, A, H, V, O, R) | Keyword path to parse | Label `NLB_516623157EDR_F0540938NCAM00320M1.LBL`, `msl_navcam_raw/DATA/SOL01342/` | confirmed |
| M1 | Mars 2020 mesh collections | `mars2020_navcam_ops_mesh`, `mars2020_mastcamz_ops_mesh`, `mars2020_hazcam_ops_mesh` | Terrain meshes in PDS | PDS Imaging Node, https://planetarydata.jpl.nasa.gov/img/data/mars2020/ | confirmed |
| M2 | Mesh format | Title "Mars2020 Terrain Mesh in OBJ format"; files `.obj` (~52 MB), `.mtl`, `.png` texture (2–41 MB), `.obj.xml` label; vertices in `SITE_FRAME` | Load directly with three.js/Cesium glTF conversion | Sol 658 directory `.../mars2020_navcam_ops_mesh/data/sol/00658/ids/rdr/mesh/` and label | confirmed |
| M3 | Mesh coverage | Navcam mesh collection: newest sol folder 00658; collection notes "release 6, Sol range 540 - 659" | Meshes exist only for older sols | `collection_data.xml`, directory listing | confirmed |
| M4 | MSL mesh products | not found | MSL Imaging Node listing shows raw/processed/mosaic collections, no mesh | https://planetarydata.jpl.nasa.gov/img/data/msl/ | not found |
| M5 | Mars 2020 mosaics in PDS | `mars2020_navcam_ops_mosaic`, `mars2020_mastcamz_ops_mosaic`; MSL `msl_navcam_mosaic`, `MSLMOS_1XXX` | Official stitched mosaics as an alternative to stitching ourselves (contents not inspected) | Imaging Node listings | confirmed (existence only) |
| S1 | VICAR | NASA-AMMOS/VICAR on GitHub, Apache-2.0; includes VISOR Mars programs and MSAM (Mastcam stereo and mosaics) | JPL's own mosaic toolchain | https://github.com/NASA-AMMOS/VICAR (README) | confirmed |
| S2 | Hugin | GNU GPL v2 or later | General panorama stitcher | https://hugin.sourceforge.io/ | confirmed |

## Open questions

- Exact meaning of every field in the Mars 2020 image ID (needs the Mars 2020 camera SIS); grouping by site/drive/sequence works in practice.
- Coordinate frame of the API camera model (rover nav frame vs site frame) and how `attitude` combines with it; check against the PDS label for the same image.
- Pixel dimensions of PIA20332 and PIA25366 were not stated on their pages.
