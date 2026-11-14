# Mars relay orbiters, passes and SPICE kernels

Researched 2026-11-14 (directory listings read that day). Status tags: **confirmed** = primary source read; **secondary**; **unverified**.

## Summary: what the app should use

- Active relay fleet: **MRO, Odyssey, TGO** (NASA/ESA Mars Relay Network), with **Mars Express** as backup. **MAVEN is gone** (no signal since 6 Dec 2025; NASA ended the mission). Do not model MAVEN passes after that date.
- Planning numbers for the UI (NASA, Jun 2026): MRO 2–4 passes/day (1–3 used), TGO 2–4 (2–4 used), Odyssey 2–4 (0–1 used). Average return Feb–May 2026: TGO 2,228.1 Mb/day, MRO 850.6 Mb/day, Odyssey 107.3 Mb/day. Link rate up to 2 Mbps (Electra); Odyssey max 256 kbps.
- One-way light time: about 3 min (closest) to 22.4 min (farthest). Rovers have no direct Earth view for about 12 h per sol.
- Pass prediction: spiceypy 8.4.0 (MIT) + NAIF kernels. Load LSK `naif0012.tls`, PCK `pck00011.tpc`, planets `de442s.bsp`, Mars system `mar099s.bsp`, and per orbiter the newest reconstructed + predicted SPKs listed below. Compute elevation of the orbiter from the site (topocentric, IAU_MARS frame) every 10–30 s; a pass is the interval above a chosen mask.
- Not found: a published minimum elevation mask, typical pass length in minutes, and any published pass-time table to test against. Choose a mask as an explicit app setting (and say it is an assumption).

## Findings: relay performance

| # | Item | Value | Meaning | Source | Status |
|---|---|---|---|---|---|
| 1 | Network members | Odyssey, Mars Express, MRO, TGO (MAVEN until Dec 2025) | Orbiters that relay rover data | NASA, "Mars Relay Network", https://science.nasa.gov/mars/mars-relay-network/ (last updated 5 Jun 2026) | confirmed |
| 2 | Odyssey | 385–450 km; 2–4 passes/day (0–1 used for MRN); 170.4 Mb/day through 2025; 107.3 Mb/day Feb–May 2026 | — | same, table "Relay Sessions and Data Volume" | confirmed |
| 3 | Mars Express | 298–10,107 km; 1–3 passes/day (0 used); "backup orbiter" | — | same | confirmed |
| 4 | MRO | 255–320 km; 2–4 passes/day (1–3 used); 447.5 Mb/day through 2025; 850.6 Mb/day Feb–May 2026 | — | same | confirmed |
| 5 | MAVEN | 200–4,500 km; 897.5 Mb/day through 2025; 0 in Feb–May 2026; "not recoverable" | — | same | confirmed |
| 6 | TGO | ~400 km; 2–4 passes/day (2–4 used); 1,562.7 Mb/day through 2025; 2,228.1 Mb/day Feb–May 2026 | Biggest relay contributor | same | confirmed |
| 7 | Relay rate | "data rates up to 2 Mbps, two million bits of data per second" | Peak UHF return | same | confirmed |
| 8 | Earth line of sight | "The rovers lack line-of-sight to the Earth for about 12 hours per day" | Direct-to-Earth not always possible | same | confirmed |
| 9 | Earth–Mars distance and light time | 54.6 million km ("about 3 minutes light time") to 400.2 million km ("about 22.4 minutes") | One-way light time range | same | confirmed |
| 10 | MRO orbit and radio | 255 × 320 km sun-synchronous, 93° inclination, ~3 PM LMST ascending node; Electra UHF, "1, 2, 4, …, 2048 kbps", CCSDS Prox-1, frequency-agile, adaptive data rates | — | Edwards et al., "Relay Support for the Mars Science Laboratory Mission", 2013 IEEE Aerospace Conference (JPL slides), https://pdfs.semanticscholar.org/a277/f981c56f44ce1e25e4151e5fd08f54396965.pdf | confirmed |
| 11 | Odyssey orbit and radio | 400 km sun-synchronous, 93°, ~4 AM LMST ascending node; CE-505 UHF, "8, 32, 128, 256 kbps", Prox-1, fixed frequency | — | same | confirmed |
| 12 | Mars Express orbit | 250 × 10,142 km elliptical, 86°, non-sun-synchronous | Pass geometry varies a lot | same | confirmed |
| 13 | MSL relay requirement (design) | "250 Mb/sol via MRO", "75 Mb/sol via ODY" ("Average return assuming two passes per sol") | Old design baseline, per sol | same | confirmed |
| 14 | Mars Express demo passes for MSL | 4 passes over first 90 sols, returning 7, 55, 110 and 105 Mb | Example per-pass volumes | same | confirmed |
| 15 | Per-pass volume via TGO | "with TGO, for example, we regularly get over a gigabit of data per pass"; Perseverance has "four to five passes a day"; via Odyssey "we have to choose either 128 or 256 Kbps" | Per-pass scale today | IEEE Spectrum interview with a JPL telecom lead, https://spectrum.ieee.org/how-nasa-is-adapting-radios-to-a-noisier-mars | secondary |
| 16 | Pass duration (minutes) | not found | Searched NASA MRN page, Edwards 2013 slides, ESA blog, NTRS records | — | not found |
| 17 | Usable minimum elevation | not found | Same searches | — | not found |
| 18 | MAVEN loss | Last contact 6 Dec 2025; NASA formally ended the mission (3 Jun 2026 media call) | Exclude MAVEN | Space.com / Astronomy.com reports; NASA MRN page states "not recoverable" | confirmed (NASA page) |
| 19 | Solar conjunction 2025–26 | Command moratorium ~29 Dec 2025 to ~9 Jan 2026; contact restored mid-January | Blackout example | News reports summarising NASA/JPL statements | secondary |
| 20 | Solar conjunction 2023 | Command pause 11–25 Nov 2023 | Typical ~2 weeks every ~2 years | News reports of JPL announcement | secondary |
| 21 | Conjunction angle threshold | not found | Searched for the Sun–Earth–Mars angle that triggers the moratorium | — | not found |

## Findings: SPICE kernels

All NAIF paths under https://naif.jpl.nasa.gov/pub/naif/. ESA kernels under https://spiftp.esac.esa.int/data/SPICE/. Sizes and dates from directory listings on 2026-11-14.

| # | Orbiter / kernel | Location and newest files | Size | Coverage | Status |
|---|---|---|---|---|---|
| K1 | MRO SPK, reconstructed | `MRO/kernels/spk/spk_psp_rec95090_95000_95090_r-v1.bsp` | 8.3 MB | 2026-11-01T19:05 → 2026-11-08T19:34 (one week; label) | confirmed |
| K2 | MRO SPK, predicted | `MRO/kernels/spk/spk_psp_rec95123_95117_95906_p-v1.bsp` (created 2026-11-12) | 64 MB | 2026-11-10T21:40 → 2027-01-11T10:00 (about 2 months ahead; label) | confirmed |
| K3 | MRO SPK, merged | `mro_psp.bsp` 107 MB; `mro_psp_rec.bsp` 45 MB | — | rolling | confirmed (coverage not read) |
| K4 | MRO FK | `MRO/kernels/fk/mro_v17.tf` | 118 KB | — | confirmed |
| K5 | Odyssey SPK | NAIF dir is `M01/` (not `ODY/`); newest `spk_m_od110409-110497_rec_v1.bsp` 6.0 MB; merged `m01_map_rec.bsp` 22 MB, `m01_map.bsp` 74 MB | — | Predicted-only file not identified | confirmed (listing) |
| K6 | TGO SPK | NAIF `EXOMARS2016/kernels/spk/` and ESA `ExoMars2016/kernels/spk/`: `em16_tgo_fsp_463_01_20260706_20261219_v01.bsp` 78 MB; `em16_tgo_cog_463_01_20260630_20261121_v01.bsp` 5.4 MB | — | Filename dates run to 2026-12-19 (fsp) and 2026-11-21 (cog) | confirmed (listing; file types not read) |
| K7 | Mars Express SPK | ESA `MARS-EXPRESS/kernels/spk/`: monthly `ORMM_T19_261101000000_01981.BSP` 6.0 MB (Oct file 7.1 MB); long-term `ORMF_T19_260611_330101_01965.BSP` 448 MB | — | Monthly files; ORMF name runs 2026-06-11 → 2033-01-01 | confirmed (listing) |
| K8 | MAVEN SPK | `MAVEN/kernels/spk/maven_orb_rec_251001_251206_v1.bsp` 40 MB | — | Ends 2025-12-06 (filename) | confirmed |
| K9 | Rover positions | `MSL/kernels/spk/msl_surf_rover_loc.bsp` 5.7 MB; `MARS2020/kernels/spk/m2020_surf_rover_loc.bsp` 3.3 MB (both updated 2026-11-13) | Site coordinates for pass tests | — | confirmed |
| K10 | Generic LSK | `generic_kernels/lsk/naif0012.tls` | 5.1 KB | Leap seconds | confirmed |
| K11 | Generic PCK | `generic_kernels/pck/pck00011.tpc` | 128 KB | Mars orientation/radii | confirmed |
| K12 | Planet ephemeris | `generic_kernels/spk/planets/de442s.bsp` | 31 MB | Sun/Earth/Mars | confirmed |
| K13 | Mars satellites | `generic_kernels/spk/satellites/mar099s.bsp` | 64 MB | Mars system (optional for passes) | confirmed |
| K14 | NAIF usage rule | Acknowledge SPICE use; SPICE is "Publicly Available" for export control | — | https://naif.jpl.nasa.gov/naif/rules.html | confirmed |
| K15 | spiceypy | Version 8.4.0 (uploaded 2026-11-11), MIT licence, requires Python ≥ 3.10 | Python wrapper for CSPICE | PyPI JSON https://pypi.org/pypi/spiceypy/json ; LICENSE in AndrewAnnex/SpiceyPy | confirmed |

Size for a 1–3 month window (arithmetic from the files above, not a published figure): MRO ≈ 64 MB predicted (covers ~2 months) + ~8 MB per week of reconstruction; TGO ≈ 78 MB; MEX ≈ 6–7 MB per month; Odyssey ≈ 6 MB per recon file. Add ~100 MB of generic kernels (or ~36 MB without `mar099s.bsp`).

## Worked pass example

Not found: no published table of relay pass times over Curiosity or Perseverance (MaROS schedules are not public). Searched NASA MRN page, Edwards 2013, NTRS, JPL news.

Suggested self-test instead (no published expected values): with K1, K9–K12, compute MRO elevation over the MSL site for 2026-11-02 and check (a) passes cluster near the MRO ascending-node local time (~3 PM LMST, row 10) and roughly 12 h later on the opposite node (inferred from the sun-synchronous orbit, not stated in the source), (b) 2–4 passes per sol (row 4).

## Open questions

- Minimum elevation and typical pass length: ask the coordinator whether a team member has access to MaROS or a JPL relay paper with these numbers; otherwise make the mask a user setting (e.g. default stated as an assumption).
- Exact meaning of TGO `fsp` vs `cog` SPK file types (read the ExoMars2016 `aareadme.txt`).
- Which Odyssey file is the forward prediction.
