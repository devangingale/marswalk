# Dust storms and visibility

## What the app should use

- Storm classes: local < 1.6 × 10⁶ km², regional above that, global/planet-encircling when it wraps the planet (Cantor et al. 2001 area rule). Large storms are most likely in northern fall/winter (Ls ~180°–360°).
- Growth: the 2018 global storm went from northern precursor storms (mid-May, Ls ~181°) to covering much of the north and tropics in ~2 weeks, and peaked at Gale ~3 weeks later. Opportunity's opacity went from normal to 10.8 in about two weeks.
- Visibility from line-of-sight extinction (Koschmieder): D = −ln(C_T)/β ≈ 3.9/β km with C_T = 0.02. At Gale, normal visibility reaches the crater rim (~30 km); in 2018 it fell to 2.7 km (β > 1.1 km⁻¹).
- Power: solar systems lose most output in a storm (Opportunity needed τ < 2 to recharge); NASA crew systems need ≥ 15 kW keep-alive, so treat solar-only sites as high risk in the dust season.
- There is **no published NASA optical-depth limit for EVA**. Any "stop EVA at τ = X" rule in the app is Sol-48's own and must say so.

## Findings

| # | Value | Meaning | Source | Quote / location | Status |
|---|---|---|---|---|---|
| 1 | 1.6 × 10⁶ km² | Area separating local from regional storms in MOC images | Cantor, James, Caplinger & Wolff, JGR 2001 (via Wang & Richardson and Mars Express review) | "local when their area is below 1.6 × 10^6 km² and regional when it is above" | secondary |
| 2 | Long axis 2000 km | Older Martin & Zurek (1993) rule: regional > 2000 km but not encircling | Martin & Zurek, JGR 1993 (via search summary) | quoted | secondary |
| 3 | Northern fall/winter | Season of large dust storms; large storms grow by merging smaller ones from several lifting centres | Cantor 2007, Icarus (via Wang & Richardson 2015) | "most active during the northern fall and winter dust storm season" | secondary |
| 4 | Mid-May 2018, Ls ~181° → ~2 weeks | 2018 global storm began as frontal storms in Acidalia and Utopia (30–60° N) and spread over the north and tropics in about 2 weeks | Guzewich et al., *MSL Observations of the 2018/MY34 Global Dust Storm*, GRL 46:71–79, 2019, NTRS 20190001691 | "Precursor storms formed in mid-May 2018, Ls ~181° … before expanding to cover much of the northern hemisphere and tropics over the next 2 weeks" | confirmed |
| 5 | τ 0.57–0.7 → 8.5 | Gale optical depth before the storm reached it, and Mastcam 880 nm peak | Guzewich et al. 2019 | "values as low as 0.57 on Sol 2073" … "Mast Camera 880-nm optical depth reached 8.5" | confirmed |
| 6 | 2.7 km | Horizontal visibility minimum at Gale (sol 2094), 9 sols after peak column opacity | Guzewich et al. 2019 | "That value fell to approximately 2.7 km on Sol 2094." | confirmed |
| 7 | −97% UV; −30 K diurnal range; 40 Pa tide | Surface effects at peak | Guzewich et al. 2019, abstract | "97% reduction in incident total ultraviolet solar radiation…30K reduction in diurnal range of air temperature" | confirmed |
| 8 | β = −ln(C_T)/D; C_T ≈ 0.02 | Koschmieder law used on Mars rover images (β extinction km⁻¹, D farthest dark feature km) | Smith et al., *Visibility and line-of-sight extinction estimates in Gale crater during the 2018/MY34 global dust storm*, GRL 2019, arXiv:1910.00986 | "β [km−1] = − ln(CT)/D [km] … For the average human eye under typical lab conditions, CT ≈ 0.02" | confirmed |
| 9 | > 1.1 km⁻¹; < 3 km; rim ~30 km | Peak extinction (sols 2086–2090); visibility at peak; normal view to the crater rim | Smith et al. 2019 | "Peak extinction of > 1.1 km−1 … visibility was reduced to less than 3 km - for comparison the crater rim, which sits approximately 30 km away, is visible at most times of year" | confirmed |
| 10 | Morning extinction > afternoon | Diurnal pattern in line-of-sight extinction | Smith et al. 2019 | via search summary | secondary |
| 11 | τ 10.8 (10 Jun 2018); 2007 storm > 5.5; site average ~0.5 | Opportunity, Perseverance Valley | NASA/JPL, *Opportunity Hunkers Down During Dust Storm*, June 2018, https://www.jpl.nasa.gov/news/opportunity-hunkers-down-during-dust-storm/ | "The previous storm had an opacity level, or tau, somewhere above 5.5; this new storm had an estimated tau of 10.8" | confirmed (10.8, 5.5); secondary (0.5 average) |
| 12 | τ < 2.0 | Opacity Opportunity needed before it could recharge | JPL engineers, reported by Planetary Society 2018 | "will need a tau of less than 2.0" | secondary |
| 13 | ≥ 15 kW | Keep-alive power for a crewed Mars surface mission; solar arrays must be oversized or nuclear used | Rucker, *Dust Storm Impacts on Human Mars Mission Equipment and Operations*, NASA JSC 2017, NTRS 20170002600 | "human Mars missions are estimated to require at least 15 kW 'keep-alive' power" | confirmed |
| 14 | Dust on radiators, windows, connectors | Equipment effects needing mitigation | Rucker 2017 | "provisions for clearing accumulated dust from thermal radiators must be considered" | confirmed |
| 15 | 0.1 mg/m³ (30-day) | NASA Mars dust permissible exposure limit for crew (from lunar 0.4 mg/m³ ÷ 3) | NASA OCHMO, *Establishing Crew Exposure Limits of Martian Dust*, https://www.nasa.gov/general/establishing-crew-exposure-limits-of-martian-dust/ | "a 30‑day continuous PEL of 0.1 mg/m³ is reasonable and appropriately conservative" | confirmed |
| 16 | Dust hazard to suits | Mars dust "less abrasive than lunar soil but more reactive"; atmosphere brings dust into the suit | Oliver et al., ICES 2026 Mars PLSS slides, NTRS 20260005204, slide 3 | "Atmosphere introduces dust as a major hazard which could enter the space suit and expose CM to toxic particles" | confirmed |
| 17 | ~273 images/week, 7 daily global maps | How MRO MARCI weather reports are built | MSSS Captioned Image Release MSSS-608, 9 Feb 2022, https://www.msss.com/msss_images/latest_weather.html | "a total of about 273 MARCI images…to produce seven false-color daily global maps" | confirmed |
| 18 | Last public report Feb 2022 | The "latest weather" page still points to MSSS-608 (31 Jan–6 Feb 2022) as of 14 Nov 2026 | Same page, fetched 14 Nov 2026 | — | confirmed |
| 19 | Credit line | "NASA/JPL-Caltech/Malin Space Science Systems" | MSSS releases | as printed | confirmed |

## Forecasting and tracking

- Tracking: MARCI daily global maps (row 17); rover opacity (Mastcam τ, Navcam line-of-sight extinction) at Gale and Jezero.
- Forecasting: **not found** — no operational NASA Mars dust-storm forecast product. NASA lists "better storm prediction" only as a mitigation idea (Rucker 2017).

## Licences and attribution

- MSSS/MARCI images: credit "NASA/JPL-Caltech/MSSS" on screen.
- Guzewich 2019 (NTRS copy) and NASA pages: US Government works; cite. Smith 2019 arXiv preprint: cite.
- Dust climatology used elsewhere in the repo (Montabone): licence recorded in docs/references.md, not re-checked here.

## Open questions

- Converting column τ to horizontal visibility needs a dust scale height; we found no published Mars relation, only direct line-of-sight measurements. Use measured β where possible.
- No sourced visibility threshold for safe walking; decide our own and label it.
- No sourced storm duration statistics for local storms (sols) were read in the original papers.
