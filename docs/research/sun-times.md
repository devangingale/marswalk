# Mars time, Ls and sunrise/sunset (Mars24 algorithm)

Researched 2026-11-14. Status tags: **confirmed** = primary source read; **secondary** = reliable source citing a primary; **unverified** = not checked.

## Summary: what the app should use

- Implement the NASA GISS Mars24 algorithm exactly as written on https://www.giss.nasa.gov/tools/mars24/help/algorithm.html (updated 2025-01-07). It is Allison & McEwen (2000) with later corrections. Equations and constants are copied below.
- Sunrise/sunset = time when solar zenith angle Z crosses 90° (centre of the Sun, no refraction, flat horizon). Find it by stepping time and bisecting on Z(t) − 90°. Report it in **LMST**: the REMS and MEDA feeds publish sunrise/sunset in LMST and our test implementation reproduces them to within about 1 minute (Gale) and 7 seconds (Jezero).
- Unit tests: the two GISS worked examples (all intermediate values), plus the anchors in the test table below. A Python test implementation reproduced every GISS value to 5 decimals except δs and Z (differences ≤ 0.00025° and 0.00006°).
- Twilight: show "sky stays bright up to ~2 h after sunset / before sunrise" (Pathfinder), but note twilight deepens faster than on Earth. No sourced civil/nautical-style Mars twilight threshold was found.

## Equations (all from the GISS algorithm page; equation IDs as on that page)

Inputs: UTC instant, planetographic latitude φ, planetographic **west** longitude Λ (degrees). Angles in degrees.

| Step | Equation |
|---|---|
| A-2 | JD_UT = 2440587.5 + millis / 8.64×10⁷ (millis since 1970-01-01 UTC) |
| A-4 | TT − UTC = (TAI − UTC) + 32.184 s. Since 2017-01-01: 37 + 32.184 = **69.184 s**. (Formula 64.184 + 59T − 51.2T² − 67.1T³ − 16.4T⁴ s only for dates before 1972, T = (JD_UT − 2451545.0)/36525.) |
| A-5 | JD_TT = JD_UT + (TT − UTC)/86400 |
| A-6 | Δt_J2000 = JD_TT − 2451545.0 |
| B-1 | M = 19.3871 + 0.52402073 Δt_J2000 (mean anomaly) |
| B-2 | α_FMS = 270.3871 + 0.524038496 Δt_J2000 (fictitious mean sun) |
| B-3 | PBS = Σᵢ₌₁..₇ Aᵢ cos(0.985626 Δt_J2000 / τᵢ + φᵢ), with (Aᵢ, τᵢ, φᵢ) = (0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837), (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528), (0.0018, 32.8493, 49.095) |
| B-4 | ν − M = (10.691 + 3.0×10⁻⁷ Δt_J2000) sin M + 0.623 sin 2M + 0.050 sin 3M + 0.005 sin 4M + 0.0005 sin 5M + PBS |
| B-5 | Ls = α_FMS + (ν − M) (mod 360) |
| C-1 | EOT = 2.861 sin 2Ls − 0.071 sin 4Ls + 0.002 sin 6Ls − (ν − M) (degrees; ÷15 for hours) |
| C-2 | MST = mod24{ 24 h × ( (JD_TT − 2451549.5)/1.0274912517 + 44796.0 − 0.0009626 ) } (Airy Mean Time) |
| C-3 | LMST = mod24{ MST − Λ/15 } |
| C-4 | LTST = LMST + EOT/15 |
| C-5 | Λs = MST × 15 + EOT + 180 (subsolar west longitude) |
| D-1 | δs = arcsin(0.42565 sin Ls) + 0.25 sin Ls (planetographic solar declination) |
| D-2 | R_M = 1.52367934 × (1.00436 − 0.09309 cos M − 0.004336 cos 2M − 0.00031 cos 3M − 0.00003 cos 4M) AU |
| D-5 | Z = arccos(sin δs sin φ + cos δs cos φ cos H), H = Λ − Λs; elevation = 90° − Z |
| D-6 | A = atan2(sin H, cos φ tan δs − sin φ cos H) (azimuth from north) |
| — | Mars Sol Date: MSD = (JD_TT − 2451549.5)/1.0274912517 + 44796.0 − 0.0009626 (the bracket in C-2) |

Mission sol clocks: MSL mission clock is LMST for 137.42°E; Mars 2020 for 77.43°E (GISS technical notes). Use those longitudes, not the actual rover position, to reproduce mission LMST.

## Findings

| # | Item | Value | Meaning | Source | Status |
|---|---|---|---|---|---|
| 1 | Algorithm reference | Allison, M. & McEwen, M. 2000, *Planet. Space Sci.* 48, 215–235; Allison 1997, *GRL* 24, 1967–1970 | Basis of Mars24 | GISS algorithm page, "Reference" | confirmed |
| 2 | Sol length | 24 h 39 min 35.244 s (mean solar day) | Use for sol counters | GISS, "Technical Notes on Mars Solar Time", https://www.giss.nasa.gov/tools/mars24/help/notes.html | confirmed |
| 3 | Sidereal day | 24 h 37 min 22.663 s | — | same | confirmed |
| 4 | Tropical year | 686.9725 d = 668.5921 sol | — | same | confirmed |
| 5 | Perihelion Ls | Ls,p = 251.000° + 0.0064891° × (yr − 2000) | — | same | confirmed |
| 6 | EOT range | −51.1 min to +39.9 min | LTST − LMST bounds; use as a sanity check | same | confirmed |
| 7 | Algorithm accuracy | Ls error ≤ 0.008° over ±100 yr of J2000; TST error up to 3 s | — | same, "Mars24 Accuracy" | confirmed |
| 8 | Rise/set accuracy | "absent topographic and atmospheric effects, the error in calculating these times is less than 30 seconds" | Error budget before terrain and refraction | same | confirmed |
| 9 | REMS sunrise/sunset, Gale sol 4995 | sunrise 06:46, sunset 18:51; terrestrial_date 2026-08-25; Ls 341 | Published feed values | MSL weather feed, https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json (fetched 2026-11-14) | confirmed |
| 10 | Our Mars24 result for Gale, 2026-08-25 UTC (lat −4.6°, lon 137.4°E, geometric centre, Z = 90°) | sunrise LMST 06:47:03, sunset 18:52:07; LTST 05:57:36 / 18:02:44; Ls 341.39–341.67 | Agrees with REMS to ~1 min, so REMS times are LMST | Test implementation of the GISS equations (this research) | computed, not published |
| 11 | MEDA feed sunrise/sunset, Jezero sol 1133 (2024-04-27) | 06:18:07 / 17:13:51; Ls 244.106 | Second rise/set cross-check | Mars 2020 weather feed, https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json | confirmed |
| 12 | Our Mars24 result for Jezero (18.4447°N, 77.4508°E) that sol | sunrise LMST 06:18:14, sunset 17:13:48 | Matches MEDA within 7 s | Test implementation | computed, not published |
| 13 | Mars twilight length | "the sky stays bright for up to two hours after sunset, indicating that Martian dust extends very high into the atmosphere" | Use "up to ~2 h" as the outer limit of visible twilight | NASA, "Sunset over Twin Peaks" (Mars Pathfinder), 1997-08-06, https://science.nasa.gov/?p=336990 | confirmed (NASA caption; refers to Smith et al. 1997, *Science* 278, 1758) |
| 14 | Twilight deepens fast | Twilight flux at solar elevation −14° measured as ~4.2×10⁻⁴ W m⁻², "nearly three orders of magnitude dimmer than what would be expected for an Earth-like Atmosphere"; "An observer on the surface of Mars would thus find twilight becoming deeper much more rapidly than on the Earth." | Light falls off steeply after sunset despite the long faint glow | Kalucha, Smith, Kloos, Sapers & Moores 2020, "Atmospheric Dust Causes Darkness to Fall Rapidly on Mars", *RNAAS* 4, doi:10.3847/2515-5172/abc6ae (Curiosity Mastcam, sol 783) | confirmed |
| 15 | Twilight definition threshold (sun-depression angle) for Mars | not found | Searched GISS notes (no "twilight" text), RNAAS paper, NASA Pathfinder pages | — | not found |

## Test anchors (expected values)

| # | Input | Expected | Source | Status |
|---|---|---|---|---|
| T1 | 2000-01-06 00:00:00 UTC, 0°W 0°N, TT−UTC 64.184 s | JD_TT 2451549.50074; Δt 4.50074; M 21.74558°; α_FMS 272.74566°; PBS 0.00142°; ν−M 4.44193°; **Ls 277.18758°**; EOT −5.18774° (−00:20:45); **MST 23:59:39** (23.99425 h); LTST 23:38:54; Λs 174.72600°; δs −25.22825°; R 1.39358 AU; Z 154.26182°; A 191.03905° | GISS worked example 1 | confirmed |
| T2 | 2004-01-03 13:46:31 UTC (Spirit), 184.702°W −14.640°N | Δt 1463.07471; M 66.06858°; α_FMS 317.09457°; PBS 0.01614°; ν−M 10.22959°; **Ls 327.32416°**; EOT −12.77553°; MST 13:09:55; **LMST 00:51:07; LTST 00:00:00**; Λs 4.70500°; δs −13.42065°; R 1.47767 AU; Z 151.93895°; **A 179.99383°** | GISS worked example 2 | confirmed |
| T3 | 2000-01-06 00:00 TT | MSD ≈ 44796.0 | GISS notes: "MSD 44796.0 is approximately coincident with 2000 January 6.0" | confirmed |
| T4 | Mars Year 38 start | Ls = 0° on 2024-11-12 | Planetary Society table from Cantor, James & Calvin 2010 (Clancy et al. 2000 MY convention), https://www.planetary.org/articles/mars-calendar | secondary |
| T5 | Mars Year 39 start | Ls = 0° on 2026-09-30 | same | secondary |
| T6 | MY 37 northern summer solstice / MY 38 northern winter solstice | Ls = 90° on 2023-07-12; Ls = 270° on 2026-04-25 | same | secondary |
| T7 | Curiosity landing 2012-08-06; Perseverance landing 2021-02-18 | MY 31 / Ls 150; MY 36 / Ls 5 | same ("Martian Years and Seasons for Significant Mission Events") | secondary |
| T8 | Gale sol 4995 (2026-08-25) | REMS sunrise 06:46, sunset 18:51 LMST, Ls 341 | MSL weather feed | confirmed |
| T9 | Jezero sol 1133 (2024-04-27) | MEDA sunrise 06:18:07, sunset 17:13:51 LMST, Ls 244.106 | Mars 2020 weather feed | confirmed |

Our test implementation lands T4–T7 on the stated dates (Ls crosses 0°/90°/270° within that UTC day; landings give Ls 150.7° and 5.6°).

## Open questions

- Which latitude/longitude and horizon rule does CAB use for REMS sunrise? Our ~1 min offset at Gale is consistent with a slightly different rover position or a disc-edge vs disc-centre rule; not documented in the feed.
- No published sun-depression definitions of civil/nautical twilight for Mars were found. If the Visor needs a "dark" threshold, base it on measured sky brightness (Kalucha et al. 2020) rather than an Earth convention.
- Terrain horizon (crater rims) can move local sunrise by many minutes at Gale and Jezero; the 30 s error bound in row 8 excludes topography.
