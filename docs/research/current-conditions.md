# Live and near-live condition feeds

Researched 2026-11-14 (feeds fetched that day). Status tags: **confirmed** = primary source read or fetched; **secondary** = reliable source citing a primary; **unverified**.

## Summary: what the app should use

- **Gale:** fetch the MSL REMS JSON feed directly from the browser. It sends `access-control-allow-origin: *`, so a static app can call it. Show it as "latest REMS report", with its sol and Earth date, because it lags: on 2026-11-14 the newest entry was sol 4995 (2026-08-25) while Curiosity raw images were already at sol 5073. Show CAB's credit and "outreach use only" note.
- **Jezero:** the Mars 2020 feed is frozen (7 sols, last 2024-04-27). Do not present it as live. For Jezero numbers, pre-compute daily min/max air temperature and pressure from the MEDA PDS archive (newest sol in PDS: 1859, files dated 2026-08-11) and ship them as a static table.
- MEDA records only 12 h per sol (even hours on even sols, odd hours on odd sols), so a full diurnal min/max needs a 2-sol window.
- No official Mars dust forecast exists. MARCI weekly weather reports stopped after the 31 Jan–6 Feb 2022 report. Use the dust-storm history layer, not a forecast.
- Space weather: DONKI (covered by the other researcher): https://kauai.ccmc.gsfc.nasa.gov/DONKI/

## Findings

| # | Item | Value | Meaning | Source | Status |
|---|---|---|---|---|---|
| 1 | MSL feed URL | https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json | Returns HTTP 200, `application/json`, no redirect | Fetched 2026-11-14 | confirmed |
| 2 | MSL feed CORS | `access-control-allow-origin: *`; methods `POST, GET, OPTIONS, DELETE, PUT` | Browser `fetch()` works from any origin | Response headers, 2026-11-14 | confirmed |
| 3 | MSL feed caching | `cache-control: max-age=60`; served via CloudFront | Re-fetch at most every minute; data changes far slower | Response headers | confirmed |
| 4 | MSL feed size | 1,730,689 bytes; 4,745 entries, sol 1 (2012-08-07) to sol 4995 (2026-08-25) | Fetch once per session, cache locally | Fetched file | confirmed |
| 5 | MSL feed fields | `id, terrestrial_date, sol, ls, season, min_temp, max_temp, pressure, pressure_string, abs_humidity, wind_speed, wind_direction, atmo_opacity, sunrise, sunset, local_uv_irradiance_index, min_gts_temp, max_gts_temp` | Temperatures °C (air and ground, "gts"), pressure Pa, sunrise/sunset LMST "HH:MM"; missing values are the string `"--"` (28 entries lack `min_temp`) | Fetched file | confirmed (units: °C and Pa inferred from values, e.g. pressure "777", min_temp "-71"; not stated in file) |
| 6 | Latest MSL entry | sol 4995, 2026-08-25, Ls 341, air −71/−5 °C, ground −84/4 °C, 777 Pa, "Sunny", UV "Moderate", sunrise 06:46, sunset 18:51 | Example values | Fetched file | confirmed |
| 7 | MSL feed latency | Newest entry 2026-08-25 vs fetch 2026-11-14 = 81 Earth days; Curiosity raw images already at sol 5073 (2026-11-13) | Feed is weeks to months behind; label it | MSL feed + MSL raw image API `https://mars.nasa.gov/api/v1/raw_image_items/` (fetched 2026-11-14) | confirmed (single observation) |
| 8 | MSL feed terms | "provided by Centro de Astrobiologia (CAB) and is intended for outreach purposes only. Any other use is discouraged. CAB will take no responsibility for any result or publication made base on the content of this file. To access REMS scientific data, visit PDS" | Show CAB credit and outreach note; use PDS for analysis | `descriptions.disclaimer_en` inside the feed | confirmed |
| 9 | MSL feed caveat | "MSL rover influences those magnitudes (rover position, rover temperature, rover orientation, rover shade, dust depositions…)"; "REMS does not take measurements continuously" | Day-to-day noise is partly instrumental | same disclaimer | confirmed |
| 10 | Mars 2020 feed URL | https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json | 1,368 bytes; CORS `*` | Fetched 2026-11-14 | confirmed |
| 11 | Mars 2020 feed contents | 7 sols, 1127–1133 (2024-04-21 to 2024-04-27); fields `terrestrial_date, sol, ls, season, min_temp, max_temp, pressure, sunrise, sunset`; last entry −79.3/−24.7 °C, 778.9 Pa | Frozen snapshot | Fetched file | confirmed |
| 12 | Why the Mars 2020 feed stops in April 2024 | not found | Searched NASA/JPL news and MEDA PDS release notes; only wind-sensor damage (2022) found, which does not explain temperature/pressure stopping | — | not found |
| 13 | MEDA PDS bundle | `mars2020_meda`, https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ ; collections `data_raw_env`, `data_partially_processed_env`, `data_calibrated_env`, `data_derived_env`, `data_skycam` | Full archive | PDS Atmospheres Node MEDA page, https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html | confirmed |
| 14 | MEDA coverage | "Feb 19, 2021 (Ls 6.1 MY 36) to [ongoing]"; calibrated folders up to `sol_1740_1859`, sol 1859 files dated 2026-08-11 | Archive lags operations by months | Same page; directory listing 2026-11-14 | confirmed |
| 15 | MEDA DOI / citation | doi:10.17189/1522849 (Rodriguez-Manfredi et al., 2021); instrument paper doi:10.1007/s11214-021-00816-9 | Cite in app credits | MEDA PDS page | confirmed |
| 16 | MEDA sizes | Annual: CALIBRATED 10 GB, DERIVED 2.9 GB, PROCESSED 15.3 GB, SKYCAM 35.2 GB | Download budget | MEDA PDS page | confirmed |
| 17 | MEDA file names | `WE__<sol>___________CAL_<SENSOR>_________________P01.CSV` + `.xml` label; sensors ATS, ENG, PS, RDS, RHS, TIRS (WIND in derived); e.g. sol 1859: ATS 3.7 MB, PS 4.3 MB | Use highest version (`P0n`) only | Directory listing `data_calibrated_env/sol_1740_1859/sol_1859/`; readme: "Only the file with the highest version number should be used" | confirmed |
| 18 | ATS CSV columns | `SCLK, LMST, LTST, ATS_LOCAL_TEMP1 … ATS_LOCAL_TEMP5` (K) | Air temperature, 5 sensors | Header of sol 1859 CAL_ATS CSV | confirmed |
| 19 | ATS sensor placement | ATS1–3 on the Remote Sensing Mast at azimuths 50°, 155°, 290°; ATS4–5 on the rover front body (port, starboard) | Use mast sensors (1–3) for "air temperature"; pick the one least affected by rover heat | MEDA RDR SIS (`document/meda_env_rdr_sis.pdf`), §ATS columns | confirmed |
| 20 | PS CSV columns | `SCLK, LMST, LTST, BAROCAP1..3_PRESSURE (+_UNCERTAINTY), THERMOCAP1..2_TEMP, PRESSURE_MEASUREMENT_MODE, TRANSDUCER` (Pa) | Pressure | Header of sol 1859 CAL_PS CSV | confirmed |
| 21 | Which pressure to use | Derived PS "is based on data from barocap 3"; if barocap 3 jumps, check barocap 2 (noisier). Prefer derived level when present | Rule for daily pressure | MEDA bundle readme.txt | confirmed |
| 22 | MEDA sampling | "measure 12 hours per sol at 1Hz all sensors, having even hours on even-numbered sols and odd hours on odd-numbered sols" | Daily min/max needs sol N and N+1 together | readme.txt "MEDA measurement strategy" | confirmed |
| 23 | MEDA wind | "wind data beyond sol 315 is not provided due to certain damage to some components of the wind sensor" | No Jezero wind after sol 315 | `document/meda_release_notes.txt` | confirmed |
| 24 | Recipe: Jezero daily min/max | For each sol pair: read CAL_ATS (cols 4–6) and derived/CAL PS (barocap 3); min/max over LMST 00–24 combining both sols; tag the result with the sol pair | Build-time script, ship JSON | Derived from rows 17–22 | recipe (not a published product) |
| 25 | MARCI weekly weather reports | Last report: "31 January 2022 – 6 February 2022 released: 9 February 2022"; earlier gap Sept 2019 – Nov 2021 | Not a live feed | MSSS, https://www.msss.com/msss_images/subject/weather_reports.html | confirmed |
| 26 | MARCI credit | "NASA/JPL-Caltech/Malin Space Science Systems" on reports; MSSS policy requests "NASA/JPL/Malin Space Science Systems" for news use | Credit if any MARCI image is shown | MSSS release MSSS-604; https://www.msss.com/policies/index.html | confirmed |
| 27 | Official Mars dust forecast | not found | Searched NASA, JPL, MCS and MSSS pages and news for an operational forecast; found only research models | — | not found |
| 28 | DONKI | https://kauai.ccmc.gsfc.nasa.gov/DONKI/ | Space weather notifications | Link only (other researcher) | — |

## Open questions

- Is there a newer official Perseverance weather page (e.g. on science.nasa.gov) that replaced the frozen feed? Not found.
- CAB's "outreach purposes only" wording: is showing REMS values in a planning tool "outreach"? Present it as informational and cite PDS for anything quantitative.
- Feed latency was observed once; sample it over several days before promising a number in the UI.
