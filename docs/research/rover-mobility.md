# Rover mobility constraints for route planning

## What the app should use

- Slope: plan rover routes at ≤ 20° (Perseverance AutoNav planning limit since sol 1124; raised to 24° only for the crater-rim climb). Hard cap 25° (Perseverance reactive tilt fault) and 30° (Curiosity nominal tilt fault; drivers avoid terrain that tilts the rover more than 30°).
- Obstacles: Perseverance is designed to drive over rocks up to 40 cm; AutoNav keeps 20 cm belly-pan clearance. Treat rocks > 25 cm (Curiosity wheel radius) as hazards that can wedge between wheels. Keep out of megaripple fields and sharp-rock terrain.
- Speed: top wheel speed 4.2 cm/s ≈ 152 m/h. Effective autonomous rate ≈ 92 m/h (Perseverance AVOIDALL average). Use ~130 m/sol for an AutoNav sol and ~43 m/sol for human-planned driving in complex terrain; record is 411.7 m in one sol.
- Planning: rovers drive between human-drawn waypoints with keep-in/keep-out zones on HiRISE maps (25 cm/pixel); position uncertainty resets to 1–2 m with orbital-map matching.

## Findings

| # | Value | Meaning | Source | Quote / location | Status |
|---|---|---|---|---|---|
| 1 | 30° | Curiosity nominal flight tilt fault limit; lowered per drive to just above the simulated max | Rankin et al., *Mars Curiosity Rover Mobility Trends During the First Seven Years*, J. Field Robotics 38(5), 2021, doi:10.1002/rob.22011. Preprint: https://robotics.jpl.nasa.gov/media/documents/ROB-20-0040_R3.pdf | "Tilt fault protection is enabled by default, and the nominal flight tilt limit is 30°. However, the tilt limit is typically lowered for each drive, based on the max predicted tilt…" | confirmed |
| 2 | 25.34° | Max tilt Curiosity reached in first 7 years (sol 2477) | Rankin et al. 2021, Table 1 | "Max rover tilt 2477 25.34°" | confirmed |
| 3 | 17° / 7° | Curiosity nominal bogie / differential suspension limits | Rankin et al. 2021 | "The nominal flight bogie and differential angle limits are 17 and 7°, respectively." | confirmed |
| 4 | > 25 cm | Rock height that can wedge between Curiosity wheels (wheel radius); 50 cm wheel diameter, 40 cm width | Rankin et al. 2021 | "A rock would need to have a height greater than the wheel radius (25 cm) to become wedged between two wheels." | confirmed |
| 5 | 4.2 cm/s | Curiosity max wheel linear speed (0.168 rad/s) | Rankin et al. 2021, Table 2 and §4.3 | "The maximum rate is 0.168 radians/s, which translates into a maximum linear wheel speed of 4.2 cm/s." | confirmed |
| 6 | 21.3 km; avg 28.9 m/drive; max 142.5 m | Curiosity first 7 years: total odometry, mean and longest single-sol drive | Rankin et al. 2021, abstract | "drive distances…ranged from…2.6 centimeters to its longest drive of 142.5 meters, with an average drive distance of 28.9 meters" | confirmed |
| 7 | Slip check every 20 m | VO slip check interval in "Slip Check" mode, sized to how deep the team would accept embedding | Rankin et al. 2021, §3 | "every 20 meters, a pair of stereo images is collected…set to 20 meters based on analysis of how deep we'd be willing to bury the wheels" | confirmed |
| 8 | Sharp rocks / megaripples avoided | Curiosity route to Mount Sharp planned to avoid megaripple fields and sharp-rock regions; wheel damage from small sharp embedded rocks | Arvidson et al., LPSC 2016 (JPL robotics site) https://www-robotics.jpl.nasa.gov/media/documents/lpsc_2016_arvidson_ripple_crossing.pdf; Rankin et al. 2021 | Rankin: "unseen terrain exhibiting small, sharp embedded rocks…" | secondary (LPSC slide summary); confirmed (Rankin) |
| 9 | Terrain-adaptive wheel speed reduces wheel forces 19% (leading) / 11% (middle) | Curiosity TRCTL software, used since sol 1678 | Toupet et al., J. Field Robotics 37, 699–728, 2020, doi:10.1002/rob.21903 | Abstract | confirmed |
| 10 | 45° / 30° | Perseverance design tilt without tipping / drivers avoid > 30° | NASA, *Mars 2020 Perseverance – Rover Components*, https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/ | "designed to withstand a 45-degree tilt in any direction without tipping over" … "rover drivers avoid terrains that would tilt the rover more than 30 degrees" | confirmed (via fetch of NASA page) |
| 11 | 40 cm | Rocks Perseverance can drive over; wheel diameter 52.5 cm | Same NASA page | "drive over knee-high rocks up to 15.75 inches (40 centimeters)" | confirmed |
| 12 | 152 m/h | Perseverance top speed on flat hard ground | Same NASA page | "just under 0.1 mph (152 meters per hour)" | confirmed |
| 13 | 16° → 20° → 24° | Perseverance AutoNav planning tilt limit: 16° first 3 years, 20° from sol 1124 (18 Apr 2024), 24° from sol 1246 | Verma, Maimone et al., *Robotic Operations During Perseverance's First Extended Mission*, IEEE Aerospace 2025, https://robotics.jpl.nasa.gov/media/documents/2025_IEEE_Aero_RO_ops.pdf | "maximum Tilt angle that Autonav would allow was set conservatively to 16 degrees…increased to 20 degrees on sol 1124…raised to 24 degrees on sol 1246" | confirmed |
| 14 | 25° | Perseverance reactive tilt fault limit (8 Hz IMU check) | Verma et al. 2025 | "A separate parameter defines the maximum tilt the vehicle is allowed to reach during drives, and remained set at 25 degrees" | confirmed |
| 15 | 25.4° | Highest Perseverance tilt to sol ~1265 (sol 700) | Verma et al. 2025 | "our highest tilt to date of 25.4 degrees at the base of the fan on sol 700" | confirmed |
| 16 | 20 cm | AutoNav belly-pan clearance (reduced from 25 cm) | Verma et al. 2025 | "reduced the clearance required under the belly pan from 25 cm to 20 cm" | confirmed |
| 17 | 91.83 m/h | Perseverance effective AVOIDALL (full autonomy) rate; 22,332 m in 243.18 h, 75% of odometry, to sol 1265 | Verma et al. 2025, Table 1 | Row "AVOIDALL 22332.00 243.18 91.83 75.08 753 331.00" | confirmed |
| 18 | 82.74 m/h | Perseverance effective UNGUARDED (human-directed) rate | Verma et al. 2025, Table 1 | Row "UNGUARDED (overall) 7274.86 87.93 82.74…" | confirmed |
| 19 | 129.59 ± 81.01 m/sol | Mean of 143 AutoNav drives | Verma et al. 2025 | "all 143 Autonav drives which averaged 129.59 meters/sol with σ = 81.01" | confirmed |
| 20 | 42.89 ± 22.63 m/sol | Human-planned drives in complex terrain (sols 1096–1159) | Verma et al. 2025 | "35 drives averaged only 42.89 meters/sol" | confirmed |
| 21 | 170 m/sol | 4.4 km to Emerald Lake in 26 drives over 70 sols | Verma et al. 2025 | "averaging 170 m/sol (sigma = 87.9 m/sol)" | confirmed |
| 22 | 411.7 m | Record single-sol drive, sol 1540 (19 Jun 2025), 403 m autonomous; previous record 347.7 m (sol 753) | Maimone, Verma et al., *Roving on the Edge*, AAS 2026, https://robotics.jpl.nasa.gov/media/documents/2026_RO_AAS_final.pdf | "On sol 1540 (19 June 2025), Perseverance drove 411.7 meters." | confirmed |
| 23 | 4 h 24 min | Duration of the 411.7 m drive (≈ 94 m/h, our arithmetic) | NASA/JPL PIA26645 (via news summaries) | "covered about 411.7 meters over about 4 hours and 24 minutes" | secondary |
| 24 | 100 km | Perseverance mobility being re-qualified for up to 100 km total; original requirement 20 km | Maimone et al. 2026 | "re-qualify the rover for an extended lifetime, up to 100 km of total travel" | confirmed |
| 25 | ~110 W | Perseverance MMRTG output at launch, declining a few % per year | NASA rover components page | "About 110 watts at launch, declining a few percent per year" | confirmed |
| 26 | ~1000 Wh ≈ 40% SOC; ~12% SOC ≈ 2 h / 200 m driving | Perseverance battery energy scale and driving energy; implies ~2.5 kWh battery and ~150 W while driving (**our derivation**) | Verma et al. 2025, §10 | "OBP saved ~1000W-h, or nearly 40% SOC" … "more than 12% higher… That is equivalent to almost two hours of driving, or more than 200 meters" | confirmed (quotes); derived (kWh, W) |
| 27 | Weekend plans 3 sols | Perseverance plans ahead for 3-sol weekends; "much more than a kilometer of driving in a weekend plan is possible" | Verma et al. 2025, §10 | quoted | confirmed |
| 28 | Waypoints + keep-in/keep-out zones on HiRISE (≤ 25 cm/px); uncertainty reset to 1–2 m | How long drives are planned; Global Localization matches NavCam panoramas to HiRISE | Verma et al. 2025, §4 | "humans draw a series of waypoints along with 'Keep-in' and 'Keep-out' zones…reset our current uncertainty back to the scale of the orbital map (typically 1-2 meters)" | confirmed |
| 29 | Per-drive simulation | Curiosity planners simulate each drive on terrain and set min/max suspension and tilt bounds; any excursion stops the drive | Rankin et al. 2021, suspension and tilt sections | "every drive sol includes an updated set of min/max suspension angles that are anticipated" | confirmed |
| 30 | 2 crew, ≥ 200 km, 1–2 weeks | NASA small pressurised rover assumption (EZ studies) | Bussey & Hoffman 2016, NTRS 20160001040 | see landing-sites.md row 17 | confirmed |
| 31 | 15 km/h, ±20°, 30 cm obstacle (7 cm at 20°), 26 km/day | JAXA/Toyota pressurised rover (lunar) notional requirements | JAXA, *Pressurized Rover Mission Concepts and Expected Capabilities*, https://humans-in-space.jaxa.jp/en/biz-lab/news/item/004354/Appendix.pdf | Table "Mission Concept and System Requirements"; marked "still notional and reference only" | confirmed (lunar, notional) |

## Licences and attribution

- JPL papers: copyright of the authors/Caltech; cite, do not copy figures. NASA web pages: public domain US Government content; credit NASA/JPL-Caltech.
- JAXA document: © TOYOTA on the slides; cite only.

## Open questions

- No published per-sol energy budget in Wh for Perseverance driving was found; row 26 is derived. Curiosity drive rates per mode are only in figures (Rankin 2021 Fig. 20–21), not text.
- Sand rules: no published numeric threshold (e.g. ripple height) was found; JPL uses slip limits and keep-out zones per drive.
- NASA has no current published Mars pressurised-rover speed/slope numbers; the JAXA lunar figures are the best published concept numbers.
