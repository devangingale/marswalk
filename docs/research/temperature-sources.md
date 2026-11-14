# Global surface temperature sources

Researched 2026-11-14. Status tags: **confirmed** = primary source read; **secondary** = reliable source citing a primary; **unverified** = not checked against a primary.

## Summary: what the app should use

- Build the 12 seasonal bins from the **Mars Climate Database (MCD)**, "climatology" dust scenario (`clim_aveEUV`), variable `tsurf`, files `clim_01_me.nc` … `clim_12_me.nc`. Each file is one 30° Ls "month" and holds 12 local times (every 2 Mars hours). Min/max = min/max over those 12 values per grid cell. This maps directly onto 12 bins.
- Grid is coarse: 64 × 49 cells (5.625° lon × 3.75° lat). Label it "model climatology, ~330 km cells", not a measurement.
- **Licence blocker:** the MCD download form makes you agree "not to transmit the Mars Climate Database, either in part or totally, to a third party". Shipping derived tiles in a public, open-source app may break this, and Space Apps requires third-party material to be freely available or OSI-licensed. Email LMD (forget@lmd.jussieu.fr, millour@lmd.jussieu.fr) for written permission before publishing derived tiles.
- Fallback if LMD says no: EMIRS L3 (EMM SDC) is measured, covers all local times, but needs a free login, the data policy was not found, and it does not package itself into 12 Ls bins.
- MCS and TES are not good fits for a min/max climatology: they sample only near 3 am/3 pm (MCS) or 2 am/2 pm (TES).

## Findings

| # | Item | Value | What it means | Source | Status |
|---|---|---|---|---|---|
| 1 | MCD current version | 6.2 | Release offered on the LMD access page | LMD, "Mars Climate Database access", https://www-mars.lmd.jussieu.fr/mars/access.html: "The MCD 6.2 Full version" | confirmed |
| 2 | MCD access routes | Web interface (no registration) or full download (registration form) | Web interface "is intented for moderate use only"; full version is "freely downloadable" after registration and includes "all the datafiles (in netcdf format)" | same page | confirmed |
| 3 | MCD registration condition | "I agree not to transmit the Mars Climate Database, either in part or totally, to a third party, and not to make any business use of it, either directly or indirectly." | Checkbox on the download form | LMD, http://www-mars.lmd.jussieu.fr/MCD_pro/mcd_pro.html | confirmed |
| 4 | MCD copyright | Scientific use allowed "provided that the origin of the data is correctly quoted in all publications and that we are kept informed of usage"; "may not be put to any commercial use without specific authorization" | No named open licence | https://www-mars.lmd.jussieu.fr/mars/access.html ("COPYRIGHT") | confirmed |
| 5 | MCD citation | Cite Forget et al. 1999 and Millour et al. 2018 for general use | Required attribution text | LMD, https://www-mars.lmd.jussieu.fr/mars/info_web/index.html ("How to cite the Mars Climate Database") | confirmed |
| 6 | MCD format | NetCDF | Data directory files | Forget, Millour et al., *MCD v6.1 Detailed Design Document*, LMD, Oct 2022, §2.3, https://www-mars.lmd.jussieu.fr/mars/info_web/ddd_MCD_v6.1.pdf | confirmed |
| 7 | MCD horizontal grid | 64 × 49; lon −180° to 174.375° step 5.625°; lat 90° to −90° step 3.75° | Native GCM grid of the stored files | DDD v6.1 §2.4.1 | confirmed |
| 8 | MCD seasonal bins | 12 files per scenario, `mon` = 01 (Ls 0–30°) … 12 (Ls 330–360°) | One file per 30° Ls month | DDD v6.1 §2.3: "'mon' = '01' is month 1, Ls = 0◦ - 30◦" | confirmed |
| 9 | MCD local times | 12 values per file, every 2 Mars hours (2, 4, … 24 h), in **True Solar Time at longitude 0** | Local time at a cell: LTST = LTST0 + lon/15 (east lon, degrees) | DDD v6.1 §2.4.3: "data is stored every 2 martian hours, i.e. from 2 to 24 hours"; "all times are expressed in True Solar Time" | confirmed |
| 10 | MCD file naming | `scen_mon_type.nc`, type `me` = mean, `sd` = RMS, `eo` = EOF; e.g. `clim_01_me.nc` | Mean files are what we need | DDD v6.1 §2.3 | confirmed |
| 11 | MCD surface temperature variable | `tsurf` (K, 2-D); RMS counterpart `rmstsurf` | Variable to extract | DDD v6.1 Table 1 / Table 2 | confirmed |
| 12 | MCD dust scenarios | clim (ave/min/max EUV), cold, warm, strm, MY24–MY35 | "clim" = baseline climatology; cold = low dust/solar min; warm = high dust/solar max | DDD v6.1 §2.3, §3 | confirmed |
| 13 | MCD download size (full) | "about 45 Gb" for all 20 scenarios | Size of one baseline scenario alone not stated | *MCD v6.1 User Manual* §3.2, http://www-mars.lmd.jussieu.fr/mars/info_web/user_manual_6.1.pdf: "A full installation (all 20 scenarios) of the MCD takes about 45 Gb of disk space" | confirmed |
| 14 | MCD extremes caveat | Linear interpolation of 12 stored times "ensures that the maximum and minimum values generated in the model will not, in general, be reflected" | Our min/max from 12 samples will understate true diurnal extremes | access.html "DISCLAMER AND WORDS OF CAUTION" | confirmed |
| 15 | MCD month lengths | 46.1 to 66.7 sols per 30° Ls month (e.g. month 3 = 66.7 sols, month 9 = 46.1 sols) | Bins are unequal in sols | LMD, "Martian Seasons and Solar Longitude", https://www-mars.lmd.jussieu.fr/mars/time/solar_longitude.html | confirmed |
| 16 | EMIRS data home | EMM Science Data Center, https://sdc.emiratesmarsmission.ae/ ; API host `api.emiratedatacenter.com` (search needs a login token) | Free account needed to search/download | Site JS bundle (main.js) lists endpoints `/v1/science/files`, `/v1/science/files/download`; unauthenticated call returns `{"detail":"Error authenticating user token"}` (tested 2026-11-14) | confirmed |
| 17 | EMIRS product levels | L0 raw, L1 uncalibrated, L2 calibrated, L3 "derived physical parameters" | — | Edwards et al. 2021, "The EMM EMIRS Instrument", *Space Sci. Rev.* 217:77, doi:10.1007/s11214-021-00848-1, abbreviations list | confirmed |
| 18 | EMIRS L3 product names on SDC | L3 Atmospheric, L3 Emissivity and surface, L3 Grid, L3 Grid LT (plus quicklooks) | Level filter labels in the SDC app | SDC main.js `friendlyDataLevelName`: `l3emiss: 'L3 Emissivity and surface'`, `l3grid`, `l3gridLT` | confirmed (labels only; contents not inspected) |
| 19 | EMIRS L3 surface temperature | L3 includes "surface kinetic temperature"; L3 "re-gridded to 1 pixel per degree (ppd)"; selected products "binned into 8 local time groups over roughly 5° Ls" | 1°×1° gridded, 8 × 3-h local-time bins | Edwards et al. 2021 §7.1, §7.4 | confirmed |
| 20 | EMIRS footprint | "better than 300 km/px up to 70° emission angle, with the highest resolution data being ∼100 km" | Native spatial resolution | Edwards et al. 2021 | confirmed |
| 21 | EMIRS local-time coverage | "complete geographic coverage of all times of day in less than 10 days of observations" | All local times, most latitudes | Edwards et al. 2021 | confirmed |
| 22 | EMIRS polar gap | "data above 80° is scarce" | Poles poorly sampled | Atri et al. 2022, MNRAS Letters, doi:10.1093/mnrasl/slac094 (arXiv:2204.12850) | secondary |
| 23 | EMIRS licence / data policy | not found | Searched SDC site and app bundle for licence/terms/citation strings; none present | — | not found |
| 24 | EMIRS total size for a climatology | not found | Statistics endpoint requires login | — | not found |
| 25 | MCS DDR product | MRO MCS Derived Data Records, "LEVEL 5 DDR V6.2", ASCII `.TAB`, "each ASCII file contains 4 hours", coverage Sept 2006 → 31 Jul 2025 (volume MROM_2227); no data Sept–Nov 2009 | Atmospheric profiles; DDR v6.2 includes "improved surface brightness temperatures" | PDS Atmospheres Node, https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/mcs.html ; DOI 10.17189/6khc-s052 | confirmed |
| 26 | MCS volume size | "roughly 1 GB per month" | Size of DDR archive | NMSU MCS page (search-result snippet) | secondary |
| 27 | MCS local times | not found on the archive page (page labels "night"/"dayti" only) | MRO orbit is ~3 pm ascending node (see relay.md, row on MRO orbit) | — | not found on archive page |
| 28 | TES archive | Data set `MGS-M-TES-3-TSDR-V1.0`, volumes `mgst_0001` … (140 volume directories listed on pds.nasa.gov) | Time-sequential raw + derived tables | https://pds.nasa.gov/data/mgs-m-tes-3-tsdr-v1.0/ ; PDS Geosciences, https://pds-geosciences.wustl.edu/missions/mgs/tes.html | confirmed |
| 29 | TES local times | ~2 pm day side, ~2 am night side (sun-synchronous mapping orbit) | Only two local times sampled | Caltech E&S article and Smith & Pearl, via search; PIA02014 (2 am TES temperature map) | secondary |
| 30 | TES surface temperature method | Average brightness temperature in the 1285–1315 cm⁻¹ window | How TES derives surface T in atmospheric retrievals | Smith (TES water vapour paper), via search snippet | secondary |
| 31 | TES total size | not found | Searched PDS Geosciences TSDR page | — | not found |

## Exact files to download (recommended route)

1. Register at http://www-mars.lmd.jussieu.fr/MCD_pro/mcd_pro.html (state purpose: NASA Space Apps open-source app; ask about redistribution of derived 2-D maps).
2. From the baseline package, directory `data/clim_aveEUV/`: `clim_01_me.nc`, `clim_02_me.nc`, …, `clim_12_me.nc` (12 files). Read `tsurf` (dims: time-of-day 12 × lat 49 × lon 64).
3. Optional bounds: same 12 files from `data/cold/` and `data/warm/` to show a low/high envelope.
4. For each month: `tmin = min(tsurf over 12 times)`, `tmax = max(...)`. Remember times are LTST at lon 0; shift by lon/15 h if you also want "time of min/max".

## Open questions

- Will LMD allow redistribution of derived `tsurf` min/max grids under an open licence? Needs an email; until then treat as "do not publish".
- Size of `clim_aveEUV` alone (the 45 GB figure is for all 20 scenarios).
- EMIRS data policy and licence text; requires logging in to the SDC or asking MBRSC. MBRSC is a 2026 Space Apps partner agency, so EMIRS data would also count as partner data.
- Which EMIRS L3 product ("L3 Grid LT"?) is the gridded local-time product, and its file format, was not opened.
