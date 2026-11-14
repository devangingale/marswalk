# Mars cave candidates

## What the app should use

- Show MGC3 entries as "cave-entrance **candidates**", never "caves". USGS: none can be verified from orbit, and most CTX candidates have turned out to be false positives.
- Show type code, priority (1 = highest, 0 = already imaged by HiRISE) and, for APCs only, diameter and shadow-derived depth (17–345 m). Depths marked "deep" are minimums.
- Treat every candidate as off-limits for walking routes. COSPAR: uncharacterised sites must be checked by robots before crew access, and samples from them are treated as restricted Earth return.
- Credit: "Cushing, G.E. (2015) Mars Global Cave Candidate Catalog PDS4 Archive Bundle, PDS IMG, doi:10.17189/1519222".

## Findings

| # | Value | Meaning | Source | Quote / location | Status |
|---|---|---|---|---|---|
| 1 | 1,062 rows | Entries in `data/Mars_Cave_Catalog.csv` of the archive bundle (description document says 1,036 at v1.0) | MGC3 bundle `mars_cave_catalog.zip`, USGS Astrogeology, https://astrogeology.usgs.gov/search/map/mars_global_cave_candidate_catalog_v1_cushing | Counted rows; Cushing & Okubo 2016 description: "The table currently contains 1036 rows" | confirmed |
| 2 | Columns | ID, longitude (0–360 E), latitude (planetocentric), type code, targeting priority, APC diameter (m, nearest 5), APC depth (m), comment. CSV header order is wrong (ID is first in data) | Cushing & Okubo, *Description of the MGC3 PDS Archive* v1.0, 2016 (in bundle) | §3 column list | confirmed |
| 3 | Type counts | sky 354, srp 218, APC 132, crk 87, pin 60, flr 42, pit 37, irr 36, rim 30, lat 27, end 21, pol 8, kst 7, con 2, smrp 1 (con/smrp not defined in the document) | Counted from bundle CSV | — | confirmed |
| 4 | Type meanings | APC atypical pit crater; crk crack/fracture; end end of channel/trough; flr floor of channel; irr irregular; kst karst/thermokarst; lat lateral (cliff) entrance; pin pinhole; pit generic collapse pit; pol polar ice; rim on rim of pit/trough; sky lava-tube skylight; srp small shallow rimless pit | Cushing & Okubo 2016, C-4 | verbatim list | confirmed |
| 5 | Priority 1/2/3/0 | 1 highest (≈25% of observed "1"s were not cave-like at HiRISE scale); 2 cave-like in CTX but "most likely not"; 3 ambiguous, 80–90% probably not cave-like; 0 already has HiRISE coverage (as of 03/2017). Counts: 1 = 247, 2 = 319, 3 = 304, 0 = 192 | Cushing & Okubo 2016, C-5; counts from CSV | "as many as 80-90% of candidates rated '3' will probably not show cave-like characteristics" | confirmed |
| 6 | Depth only for APCs: n = 132, 17–345 m, median 66 m; diameter 25–520 m, median 120 m | Shadow-derived: D = shadow length ÷ tan(incidence angle); "deep" = no sunlit floor, depth is a minimum; deep APCs often d/D > 1 | Cushing & Okubo 2016, C-6/C-7; stats computed from CSV | "Approximate value calculated from shadow measurements" | confirmed |
| 7 | 165 m wide, > 245 m deep, overhanging rim | Example APC in the description figure | Cushing & Okubo 2016, Fig. 2 caption | "an Atypical Pit Crater (APC) with a diameter of 165 m, a depth >245 m, and an overhanging rim of unknown extent" | confirmed |
| 8 | ~25 m | Smallest entrance CTX (~6 m/px) can detect; HiRISE ~0.25 m/px used to confirm overhangs | USGS Astropedia page | "sufficient to identify sky-facing, shadowed cave entrance candidates as small as ~25 m across" | confirmed |
| 9 | None confirmed | No candidate is a verified cave | USGS Astropedia page / description doc | "NONE can be verified as 'genuine' caves with void spaces extending into dark zones beneath the surface—such verification is not possible until they are physically visited" | confirmed |
| 10 | 1054 of 1062 within ±50° lat | Candidates inside the human landing latitude band | Computed from CSV | — | confirmed (our count) |
| 11 | Survey bias | APCs only identified in Tharsis and Elysium; "the vast majority of Mars has not been surveyed" | Cushing & Okubo 2016 §2 | quoted | confirmed |
| 12 | Special Region = where terrestrial organisms are likely to replicate; limits a_w > 0.5 and T > −28 °C | COSPAR definition and thresholds | COSPAR, *COSPAR Policy on Planetary Protection*, Space Research Today 224:17–39, 2026, doi:10.60970/012026SRT224/PPP, https://cosparhq.cnes.fr/assets/uploads/2026/01/SRT_224_Editorial_PPP-Nov-2025.pdf | "Lower limit of water activity (LLAw): 0.5 • Lower limit of temperature (LLT): -28°C" | confirmed |
| 13 | Category IVc: ≤ 30 spores | Robotic access to a Special Region needs the landed system (or contacting parts) at ≤ 30 spores | COSPAR 2026 §6.1.2.2.4 | "restricted to a surface bioburden level of ≤ 30* spores" | confirmed |
| 14 | Crewed rules | Robotic precursor before crew access to uncharacterised sites; samples from Special Regions treated as Category V restricted Earth return; quarantine capability; goals "should not be relaxed" for humans | COSPAR 2026 §4.6 and §6.6 | "Any uncharacterized Martian site should be evaluated by robotic precursors prior to crew access." | confirmed |
| 15 | Caves not named | The COSPAR 2026 policy text does not mention caves or lava tubes specifically | COSPAR 2026 (full-text search for "cave", "lava tube") | — | confirmed (absence) |
| 16 | No Special Regions identified on life grounds | Current status | COSPAR 2026 App. A | "In the absence of specific information, no Special Regions are currently identified on the basis of possible Martian life forms." | confirmed |
| 17 | Caves as shelter | Lava tubes listed by NASA as a site "enhancement" for radiation protection | Bussey & Hoffman 2016 (see landing-sites.md row 19) | — | confirmed |

## Risks of entering

- Published, sourced: vertical drops of tens to hundreds of metres with overhanging rims (rows 6–7); planetary-protection limits (rows 12–14).
- **Not found** in a primary source within this task: quantified hazards such as rockfall rates, loss of radio line of sight, or thermal/dust conditions inside Martian caves. Wynne et al. 2022 (JGR Planets, doi:10.1029/2022JE007194) and Titus et al. 2021 (Nature Astronomy 5:524) cover cave exploration questions but their full text was not read. Anything the app says about these must be labelled as general guidance, not a sourced number.

## Licences and attribution

- MGC3: PDS archive bundle, US Government work (USGS/NASA MDAP). The USGS page gives no licence text; treat as public domain and cite the DOI above.
- COSPAR policy: cite; do not reproduce.

## Open questions

- Newer MGC3 versions or other catalogues (e.g. regional lava-tube surveys) were not checked.
- Should the app also mark a buffer around candidates (rim collapse)? No published buffer distance was found.
