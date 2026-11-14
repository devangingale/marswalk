# Positioning without GPS, flight software and telemetry

## What the app should use

- Position on Mars: there is no navigation satellite system. Use what rovers use: visual odometry plus matching camera panoramas to HiRISE orbital maps (Perseverance resets to 1–2 m uncertainty). For a walker, suit IMU dead reckoning drifts ~1.5–2.3% of distance walked, so the app must show a growing uncertainty circle and prompt re-fixes on landmarks or a beacon.
- NASA's EVA rule: crew must always be able to find the lander, even out of line of sight; within 2 km a transponder-type aid is the baseline; beyond 2 km navigation must not depend on the rover.
- Habitat bridge: speak CCSDS Space Packets (6-octet header, 11-bit APID). NASA cFS (Apache-2.0) ships `ci_lab`/`to_lab` that send/receive CCSDS packets over UDP; F´ (Apache-2.0) has CCSDS Space Packet, TM, TC and AOS framers. ROS 2 core packages are Apache-2.0; Space ROS docs are CC BY 4.0.
- Telemetry fields for the suit and rover panels: copy the NASA SUITS telemetry server names and ranges (training values, not flight specs).

## Findings — positioning

| # | Value | Meaning | Source | Quote / location | Status |
|---|---|---|---|---|---|
| 1 | 1–2 m | Perseverance position uncertainty after Global Localization (NavCam panorama matched to HiRISE) | Verma et al., IEEE Aerospace 2025, https://robotics.jpl.nasa.gov/media/documents/2025_IEEE_Aero_RO_ops.pdf | "reset our current uncertainty back to the scale of the orbital map (typically 1-2 meters)" | confirmed |
| 2 | 50 × 50 cm map, ~1 km² | Orbital map uploaded to Perseverance for Global Localization (2026 campaign) | Maimone et al., AAS 2026, https://robotics.jpl.nasa.gov/media/documents/2026_RO_AAS_final.pdf | "The uploaded map has 50×50 cm2 resolution per pixel" | confirmed |
| 3 | > 1 km drives | Global Localization enables very long drives, limited only by orbital map size | Verma et al. 2025 | "enabling capability for very-long-range drives (over 1km)" | confirmed |
| 4 | VO step ~1 m; < 1 mm per update in ideal conditions | Curiosity visual odometry | Rankin et al., J. Field Robotics 2021 (preprint ROB-20-0040_R3) | "Curiosity VO position accuracy is better than 1 mm when the NavCams are pointed in the default VO direction" | confirmed (ideal case only) |
| 5 | 1.5–2.3% of distance | Foot-mounted IMU zero-velocity-update dead reckoning error | ISPRS Archives XL-4/239, 2014, https://isprs-archives.copernicus.org/articles/XL-4/239/2014/isprsarchives-XL-4-239-2014.pdf | "positioning accuracy of the developed ZUPT based dead-reckoning is 1.5%-2.3%" | secondary (search summary) |
| 6 | Within 100 m | Suited analog crew fixing position by angles to landmarks (protractor + phone azimuth app), MDRS | IAC-24 B3.8.8 (paper 82217), 2024 | "estimates within 100m of the true positions" | secondary |
| 7 | Comparable to GPS (short tests) | AMADEE-24 analog: rover SLAM and astronaut IMU motion capture; IMU needed periodic GPS recalibration | Sensors 25(15):4615, 2025 | via search summary | secondary |
| 8 | Transponder within 2 km; independent nav beyond 2 km | NASA xEVA safety-navigation requirements | NASA EVA-EXP-0042 Rev B, 2020, NTRS 20205008200 §4.3.1.2.1 | "Crew will require a system/method for ensured safe return within 2 km of the lander (e.g., a transponder)" … "not fully dependent on the rover for navigation" | confirmed |
| 9 | Lighting for 12,000 m | Contingency walk-back lighting requirement | EVA-EXP-0042 | "Lighting to support up to a 12,000 m contingency walk-back from a failed [rover]" | confirmed |
| 10 | UHF for voice + suit telemetry; Wi-Fi for non-critical | Suit comms concept | EVA-EXP-0042 §4.2.1.6 | "Critical services, such as voice communication and suit telemetry, will be transmitted over UHF. Non-critical services will be transmitted primarily over Wi-Fi." | confirmed |
| 11 | Two areostationary relays; relative positioning 200–400× better than absolute | Proposed in-situ navigation and timing for a human Mars landing site (simulation) | Lightsey, Lee & Cheung, *In-Situ Navigation and Timing Services for a Human Mars Landing Site Part 2*, 2018, NTRS 20210008406 | via search summary | secondary |
| 12 | Meter-level orbit determination | Notional 5-satellite Mars constellation (2 areostationary + 3 others) | Stanford/JPL paper, https://www-robotics.jpl.nasa.gov/media/documents/Orbit_Determination_and_Time_Synchronization_CkKKSdk.pdf | via search summary | secondary |
| 13 | No operational Mars navigation satellites | None found in service | — | searched NASA/ESA/JPL sources | not found (absence) |

## Findings — software and message formats

| # | Item | Detail | Source | Status |
|---|---|---|---|---|
| S1 | CCSDS Space Packet Protocol | CCSDS 133.0-B-2, Blue Book Issue 2, June 2020. Primary header 6 octets: version (3 bits, '000'), type (1), secondary-header flag (1), APID (11 bits), sequence flags (2), sequence count (14), data length (16). Packet 7–65,542 octets; data field 1–65,536 octets | https://public.ccsds.org/Pubs/133x0b2e2.pdf §4.1 | confirmed |
| S2 | cFS / cFE | NASA Core Flight System; GitHub `nasa/cFS`, `nasa/cFE`: Apache-2.0 | GitHub API, 14 Nov 2026 | confirmed |
| S3 | cFS ground I/O | `ci_lab` "accepts CCSDS telecommand packets over a UDP/IP port"; `to_lab` sends packets over UDP; both "non-flight" lab apps | nasa/ci_lab and nasa/to_lab READMEs | confirmed |
| S4 | F´ (F Prime) | JPL flight software framework, `nasa/fprime`: Apache-2.0. `Svc/Ccsds` has SpacePacketFramer/Deframer, TmFramer, TcDeframer, AosFramer/Deframer, CFDP manager, SDLS | GitHub repo tree, branch devel | confirmed |
| S5 | ROS 2 | Core packages (e.g. `ros2/rclcpp`) Apache-2.0; the `ros2/ros2` meta-repo has no licence file | GitHub API | confirmed |
| S6 | Space ROS | `space-ros/space-ros` meta-repo: no licence file at root; `space-ros/docs`: CC BY 4.0 | GitHub API | confirmed; check each package licence before use |
| S7 | Open MCT | NASA web mission-control framework, Apache-2.0 | nasa/openmct LICENSE.md | confirmed |
| S8 | Yamcs | Mission control framework, AGPL-3.0 (copyleft — affects distribution) | GitHub API `yamcs/yamcs` | confirmed |

## Findings — suit and rover telemetry, pressurised rovers

| # | Value | Meaning | Source | Status |
|---|---|---|---|---|
| T1 | Suit fields and nominal ranges: batteries 20–100%; O2 storage 20–100%; O2 tank 600–3000 psi; suit O2 3.5–4.1 psi; suit CO2 0–0.1 psi; helmet CO2 0–0.15 psi; total 3.5–4.5 psi; fans 29,000–31,000 rpm; scrubbers 0–60%; temperature 10–32 °C; heart rate 50–160 bpm; O2 use and CO2 production 0.05–0.15 psi/min; coolant 80–100% | NASA SUITS student challenge Telemetry Stream Server, *EVA Telemetry Ranges* (TSS2026), https://github.com/SUITS-Techteam/TSS2026 (documents/telemetry_ranges/eva-telemetry-ranges.pdf, data/EVA.json) | confirmed — **training/simulator values, not xEMU/AxEMU flight limits**; repo has no licence file |
| T2 | Rover fields: pitch/roll, speed 0–18 m/s (sim), surface incline ±50°, distance from base ≤ 2500 m, O2, cabin pressure 3.5–4.1 psi (nominal 4.0), cabin temp 10–21 °C, battery ≥ 30%, lidar array | SUITS TSS2026 *Rover Telemetry Ranges*, data/ROVER.json | confirmed (simulator) |
| T3 | IV display contents | Suit telemetry incl. limiting consumables, crew locations, planned routes, sample locations | EVA-EXP-0042 §4.3 | confirmed |
| T4 | Flight xEMU/AxEMU telemetry list | **Not found** in public NTRS papers | searched NTRS for xEMU/AxEMU telemetry, suit information system | not found |
| T5 | NASA small pressurised rover: 2 crew, ≥ 200 km, 1–2 weeks | EZ-sizing assumption | Bussey & Hoffman 2016, NTRS 20160001040 | confirmed |
| T6 | Dual pressurised rovers ~100 km; rescue rover within 8 h drive | NASA lunar excursion ranges | EVA-EXP-0042 §4.2.1.3.1.1 | confirmed |
| T7 | JAXA/Toyota PR: 2 crew, 15 km/h max, ±20° slope, 30 cm obstacle (7 cm at 20°), 26 km/day crewed, 10,000 km life, 31-day crewed missions | Lunar, notional | JAXA, *Pressurized Rover Mission Concepts and Expected Capabilities*, https://humans-in-space.jaxa.jp/en/biz-lab/news/item/004354/Appendix.pdf | confirmed (notional) |
| T8 | NASA SEV / Lunar Electric Rover speed and range | **Not found** in a NASA primary source; a 1994 NASA pressurised-rover study used 10 km/h, 14 days, crew of 4 (NTRS 19940021211, via search) | secondary |

## Licences and attribution

- cFS, cFE, F´, Open MCT, ROS 2 core: Apache-2.0 — keep LICENSE and NOTICE files if we ship code. Yamcs is AGPL-3.0: avoid linking it into the app unless we accept AGPL.
- CCSDS standards: free to use; cite the Blue Book number.
- SUITS TSS repository: no licence → we may read and cite field names, but should not copy its code.

## Open questions

- Which transport the habitat bridge uses (UDP like `to_lab`, or ROS 2 DDS) is a design choice; no NASA Mars habitat interface spec was found.
- Real accuracy of a suit IMU over a multi-km Mars walk is unknown; analog numbers above are short tests.
