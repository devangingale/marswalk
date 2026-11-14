# Radiation, SPE response and shelter

## What the app should use

- Background (GCR) dose at Gale: 0.21 mGy/day absorbed (Hassler et al. 2014); ~0.64–0.67 mSv/day dose equivalent. Show walk dose = daily rate × walk hours / 24.
- SPE warning: particles can reach Mars "in just tens of minutes" after a flare. NASA's rule for EVA: real-time alert dosimetry protects the crew "if EVA termination occurs within 2 hrs". So the walk planner should keep the safe haven within 2 h (better: well under) at all times when an SPE scenario is on.
- Worst measured surface event: 8,100 µGy (May 2024). NASA limit: 250 mSv per SPE, 600 mSv career.
- Terrain shielding: dose ≈ albedo part (18–24% of flat-ground dose, not blocked) + sky part × (1 − weighted obstructed-sky fraction). Use Guo et al. (2026) Eq. 2 with flux ∝ cos^1.18(θ). Measured drops at Curiosity were 4–19%.
- Regolith: ~0.9–1.1 m (solar max) to 1.5–1.6 m (solar min) to keep a year under 100 mSv; less than ~40 cm can be worse than none.

## Findings

| # | Value | Meaning | Source | Quote / location | Status |
|---|---|---|---|---|---|
| 1 | 0.210 ± 0.040 mGy/day | GCR absorbed dose rate, Gale crater (−4.4 km), 300 sols near solar max | Hassler et al., *Mars' Surface Radiation Environment Measured with the MSL Curiosity Rover*, Science 343, 2014, doi:10.1126/science.1244797 | abstract (via search summary) | secondary |
| 2 | 0.64 ± 0.12 mSv/day (paper) / 0.67 mSv/day (press release) | GCR dose equivalent rate at Gale | Hassler et al. 2014; SwRI press release Dec 2013 | SwRI: "average GCR dose equivalent rate of 0.67 millisieverts per day" | secondary (0.67); unverified (0.64 ± 0.12) |
| 3 | 8,100 µGy | Dose an astronaut beside Curiosity would have received in the May 20, 2024 event (X12 flare); largest RAD surge since 2012 | NASA, *NASA Watches Mars Light Up During Epic Solar Storm*, June 2024, https://www.nasa.gov/missions/maven/nasa-watches-mars-light-up-during-epic-solar-storm/ | "they would have received a radiation dose of 8,100 micrograys — equivalent to 30 chest X-rays" | confirmed |
| 4 | Tens of minutes | Arrival time of charged particles at Mars after the May 2024 flare | Same NASA page | "the charged particles trailed slightly behind, reaching Mars in just tens of minutes" | confirmed |
| 5 | Cliffs and lava tubes shield | NASA/RAD PI guidance | Same NASA page (Hassler quote) | "Cliffsides or lava tubes would provide additional shielding for an astronaut from such an event." | confirmed |
| 6 | 2–3 × GCR; −15% at shock | Sept 2017 SPE at Gale: dose rate rise, then drop at shock arrival | Zeitlin et al., *Analysis of the Radiation Hazard Observed by RAD on the Surface of Mars During the September 2017 Solar Particle Event*, GRL 2018 (abstract via search; DOI not checked) | "dose rates rose above background GCR levels by factors of two to three" | secondary |
| 7 | 418 µGy (Si) | Total surface dose for the Sept 2017 event | Reported in ISS SPE papers (Berger et al., Space Weather) citing MSL-RAD | as quoted | secondary |
| 8 | 600 mSv career; 250 mSv per SPE | NASA crew limits | NASA OCHMO, *Design for Ionizing Radiation Protection*, Technical Brief OCHMO-TB-020 Rev E, 2022, https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf | "not to exceed 600 millisieverts (mSv)" … "limited to an effective dose of 250 mSv per event" | confirmed |
| 9 | EVA termination within 2 h | Real-time alert dosimetry gives high protection if the EVA ends within 2 h | Same brief | "Real-time alert dosimetry provides a very high level of protection if EVA termination occurs within 2 hrs." | confirmed |
| 10 | < 1 in a million | Probability of EVA organ dose > 100 mSv from SPEs | Same brief | "The probability of EVA organs doses >100 mSv is less than one in a million based on SPE statistics" | confirmed (spacecraft/lunar context) |
| 11 | +10 cm water equivalent (centennial SPE); ~20 cm (1000-year SPE) | Storm-shelter shielding (vehicle with 20 g/cm² Al) | Same brief | "Additional Storm Shelter with an added 10 cm water equivalent…Protection for a 1000-year SPE event would require ~20 cm water equivalent" | confirmed |
| 12 | ~95% of SPEs need only ALARA | Share of SPEs that do not approach limits | Same brief | "Large majority (~95%) of SPEs require only ALARA considerations" | confirmed |
| 13 | Crew alerting required | System must alert crew locally and remotely | NASA-STD-3001 V2 6100, quoted in same brief | "alert all crewmembers…when radiation levels are expected to exceed acceptable levels" | confirmed |
| 14 | 1–1.6 m regolith | Depth for < 100 mSv/yr effective dose; 1.5–1.6 m solar min, 0.9–1.1 m solar max; 50 mSv/yr needs 2.1–2.2 m (min) / 1.7–1.9 m (max) | Zhang, Guo et al., *From the top of Martian Olympus to deep craters and beneath*, JGR Planets 127, e2021JE007157, 2022 | "To reduce the annual effective dose to be below 100 mSv, the required shielding is 1.5–1.6 m during solar minimum and 0.9–1.1 m during solar maximum." | confirmed |
| 15 | Dose peaks 30–40 cm below surface | Secondary neutrons make thin cover worse than none | Zhang et al. 2022 | "both neutron flux and effective dose peak at around 30 cm below the surface" | confirmed |
| 16 | 10–20 cm less in deep craters | High-pressure sites need slightly less regolith than mountain tops (< 100 Pa) | Zhang et al. 2022 | "required subsurface shielding is about 10–20 cm less than at the top of high mountains" | confirmed |
| 17 | 1.79 g/cm³ | Regolith density assumed in that model | Zhang et al. 2022 §2.2 | "a density of 1.79 g cm−3" | confirmed |
| 18 | D = Σθ (1 − ROS(θ))·d(θ)·δθ | Downward dose under a partly blocked sky; ROS(θ) = obstructed fraction of sky ring at zenith angle θ; d(θ) modelled dose per θ | Guo et al., *Influence of Mars Topography on Radiation Dose Detected by MSL…*, JGR Planets 131, e2026JE009704, 2026 (open access, CC BY) | Eq. 2–3: "DGCRH = Σ…(1 − ROS(θ))⋅dGCRH(θ)⋅δθ" | confirmed |
| 19 | flux ∝ cos^γ(θ), γ = 1.18 ± 0.07 | Zenith dependence of surface radiation (rover tilt ≤ 15°) | Guo et al. 2026, citing Guo et al. 2021 | "the flux is determined to be ∝cosγ(θ) with γ=1.18±0.07" | confirmed |
| 20 | 18–24% | Upward (albedo) share of total dose on flat ground — not removed by sky blocking | Guo et al. 2026, abstract | "on a flat surface the albedo radiation is between ∼18% and 24% of the total surface dose" | confirmed |
| 21 | −4 to −5% at 19% sky blocked; up to −19% elsewhere | Measured dose drops near Murray Buttes and later sites; obstructed sky 5.4%–37.9% | Guo et al. 2026 | "decreases in the dose rate reaching 19%" | confirmed |
| 22 | Model over-predicts the drop | Blocking terrain adds albedo, so measured drops are smaller than sky-only model | Guo et al. 2026 §5 | "the predicted decrease of modeled dose rate from the sky is almost always larger than the dose reduction measured by RAD" | confirmed |
| 23 | 21 g/cm², ~800 Pa | Vertical atmospheric column used for Gale in the model | Guo et al. 2026 §2.1 | "The vertical atmospheric mass (zenith angle θ=0°) is set as 21 g/cm2" | confirmed |

## DONKI API (space weather)

| # | Item | Detail | Source | Status |
|---|---|---|---|---|
| D1 | Endpoints | `https://api.nasa.gov/DONKI/{CME, CMEAnalysis, GST, IPS, FLR, SEP, MPC, RBE, HSS, WSAEnlilSimulations, notifications}` with `startDate`, `endDate` (yyyy-MM-dd) and `api_key` | api.nasa.gov docs (apis.json content, fetched Nov 2026) | confirmed |
| D2 | Defaults / limits | Most endpoints default to the last 30 days; ENLIL and notifications to 7 days; notifications range capped at 30 days. IPS `location` choices: Earth, MESSENGER, STEREO A, STEREO B (no Mars) | same | confirmed |
| D3 | How Mars shows up | `WSAEnlilSimulations[].impactList[]` entries with `"location": "Mars"`, `arrivalTime`, `isGlancingBlow`, `isMinorImpact`. Example: WSA-ENLIL/30726/1 predicted Mars arrival 2024-05-13T17:42Z | Live query to api.nasa.gov, 14 Nov 2026 | confirmed |
| D4 | SEP records | Earth-side instruments (GOES, SOHO); `linkedEvents` to FLR/CME/IPS; no Mars instrument seen in Sept 2017 sample | Live query, SEP 2017-09-01..15 | confirmed |
| D5 | Rate limits | Personal key: 1,000 requests/hour. DEMO_KEY: 30/hour and 50/day per IP. Over limit → blocked for an hour (HTTP 429). Live DEMO_KEY response on 14 Nov 2026 showed `x-ratelimit-limit: 10` — lower than documented | https://api.nasa.gov/assets/html/authentication.html; live headers | confirmed |
| D6 | CORS | `access-control-allow-origin: *` on api.nasa.gov DONKI responses → callable from the browser | Live response headers | confirmed |
| D7 | Direct CCMC endpoint | `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/...` timed out from our network (40 s) | Live test | unverified |

## Licences and attribution

- MSL RAD data (PDS): public domain; credit "NASA/JPL-Caltech/SwRI". Guo et al. 2026 and Zhang et al. 2022: CC BY 4.0 — cite authors.
- DONKI: NASA CCMC/M2M SWAO; US Government data. Show "Space weather data: NASA CCMC DONKI". Do not ship a personal API key in the client bundle; a key in a public web page is visible to everyone.

## Open questions

- Hassler 2014 dose-equivalent uncertainty (row 2) not read in the original.
- No published crew-response *timeline* for a Mars surface SPE (minutes to shelter) beyond NASA's 2 h EVA statement.
- DONKI gives no Mars-surface SEP measurement; Mars impact comes only from ENLIL CME predictions.
