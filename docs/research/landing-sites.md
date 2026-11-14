# Landing sites and Exploration Zones

## What the app should use

- Hard vetoes for a human landing site: latitude within ±50°, elevation below +2 km (MOLA datum), and a landing area of about 25 km² with slopes under ~10°. These are the only numeric engineering limits NASA published for the 2015 call.
- The Exploration Zone (EZ) is a circle of ~100 km radius around the landing site. Habitat and infrastructure zone within 5 km of the landing site. Water feedstock within 3 km of the ISRU plant, ideally no deeper than 1 m.
- Score, don't veto: water resource size (>100 t, ~20,000 kg per crew), latitude band 40–45° for ice vs. <40° N for solar power and climate, dust cover (low thermal inertia + high albedo is bad), rock size <30 cm on excavation ground, science ROI diversity.
- NASA never published a human landing-ellipse size, rock-abundance percentage or radiation threshold for site choice. Robotic-mission limits (MSL) are listed below only as a reference, not as human rules.

## Findings

| # | Value | Meaning | Source | Quote / location | Status | Use |
|---|---|---|---|---|---|---|
| 1 | ±50° latitude | Landing site must lie between 50° N and 50° S | Bussey & Davis, *First Landing Site/Exploration Zone Workshop – Second Announcement*, NASA HEOMD/SMD, 2015. https://www.nasa.gov/wp-content/uploads/2015/06/hls2-2nd-announcement-7-8.pdf | p. 3: "Located between +/- 50 degrees latitude" | confirmed | Hard veto |
| 2 | < +2 km | Landing site altitude, MOLA reference | Same, p. 3 | "Less than +2 km altitude (Mars Orbiter Laser Altimeter (MOLA) reference)" | confirmed | Hard veto |
| 3 | ~25 km², slopes < ~10° | Generally level landing area, "significantly devoid of landing hazards (e.g., large and/or closely concentrated craters, mountainous terrain, broken/jumbled/chaotic terrain, extensive dune fields)" | Same, p. 3 | "An area of approximately 25 km2 within which the terrain is generally level (slopes less than ~10 degrees)" | confirmed | Hard veto: find a 25 km² patch (e.g. ≈5 × 5 km or r ≈ 2.8 km) with slope < 10° |
| 4 | No thick fine dust | Landing site must not sit on thick fine-grained dust; proxy is "extremely low thermal inertia and high albedo" | Same, p. 3 | "Does not contain thick deposits of fine-grained dust (e.g., extremely low thermal inertia and high albedo)" | confirmed (no numeric threshold) | Score or soft veto; thresholds are ours to choose and must be labelled as such |
| 5 | ~100 km | EZ radius: Regions of Interest within ~100 km of a central landing site | Same, p. 1; Workshop Statement v7-3, NASA 2015, https://www.nasa.gov/wp-content/uploads/2015/06/hls220workshop20statement.pdf | Statement p. 3: "no more than 100 km from a central landing site (the 100 km value having been based on previous engineering studies indicating that small pressurized rovers could reach these distances … this was not intended to be a constraint)" | confirmed | Search radius for ROIs |
| 6 | < 5 km | Infrastructure/construction region from central landing site, "flat, stable terrain", cobble-sized or smaller rocks and loose regolith | Second Announcement p. 4; Bussey & Hoffman, *Human Mars Landing Site and Impacts on Mars Surface Operations*, IEEE Aerospace 2016, NTRS 20160001040, https://ntrs.nasa.gov/citations/20160001040 | p. 17: "This region must be less than 5 kilometers from a central landing site and contain flat, stable terrain." Cobbles = 64–256 mm | confirmed | Habitat flat-area search must be inside 5 km of landing point |
| 7 | > 100 t water | Water ISRU feedstock must be able to yield >100 metric tons | Second Announcement p. 4; Bussey & Hoffman 2016 p. 15 | "yield significant quantities (>100MT) of water" | confirmed | Resource score |
| 8 | ~20,000 kg per crew | Water needed per crew for shielding, life support, EVA and propulsion | Bussey & Hoffman 2016, p. 16 | "a quantity of water approaching 20,000 kg must be produced for each crew" | confirmed | Context for resource score |
| 9 | > 5 wt% | Minimum concentration if water source is hydrated minerals | Bussey & Hoffman 2016, p. 16 | "a high concentration (greater that 5% by weight)" | confirmed | Resource score |
| 10 | < 3 km; ≤ 1 m deep | Raw water material distance from ISRU plant and power; ideal maximum burial depth | Bussey & Hoffman 2016, p. 16 | "The raw material must be located less than 3 kilometers from the ISRU processing plant…ideally no more than 1 meter beneath the surface" | confirmed | Distance-to-ice score; 3 km can be a soft veto for the primary resource |
| 11 | < ~10°; rocks < 30 cm | Excavation ground slope and rock size (both TBD in source) | Bussey & Hoffman 2016, p. 16 | "sufficiently flat (TBD …, but less than approximately 10°)…Rock size must be <30 cm (TBD based on rover clearance)" | confirmed (TBD values) | Score for the resource site |
| 12 | < 1000 m (desired < 100 m) | Data resolution needed to assess resource potential | Bussey & Hoffman 2016, p. 16 | "should be <1000 meters in scale, with a desired resolution <100 meters" | confirmed | Data-quality flag |
| 13 | 40–45° N/S | Belt where ice is most continuous and overburden thinnest | Workshop Statement, Finding #2, p. 4 | "Within these belts, ice is going to be the most continuous, and the overburden that needs to be removed will be thinnest." | confirmed | Ice score |
| 14 | < 40° N preferred | Northern sites below 40° preferred for climate and solar flux | Bussey & Hoffman 2016, p. 17 | "Northern latitude sites below 40 degrees latitude are somewhat preferential due to less extreme climate variations and higher solar flux." | confirmed | Solar/climate score |
| 15 | Higher latitude = more ascent propellant | Why few sites were proposed poleward of 45° | Bussey & Hoffman 2016, p. 13 | "higher latitudes put additional propulsive requirements on the ascent vehicle" | confirmed | Score, not veto |
| 16 | 100 m | Landing precision assumed with ALHAT | Bussey & Hoffman 2016, p. 4 | "will allow a lander to be landed within 100 meters of a designated location on Mars" | confirmed | Use as landing target uncertainty (not an ellipse) |
| 17 | 2 crew, ≥ 200 km, 1–2 weeks | Small pressurised rover assumption behind the 100 km EZ | Bussey & Hoffman 2016, p. 4 | "notionally a crew of two, at least 200 kilometers total distance before being re-supplied, and 1- to 2-week duration" | confirmed | Context for EZ radius |
| 18 | Food production: low latitude, no shadowing terrain | Enhancement criteria | Bussey & Hoffman 2016, p. 17 | "(a) a low latitude…(b) no local terrain feature(s) that could shadow light collection facilities" | confirmed | Solar score (horizon shading) |
| 19 | Natural terrain for radiation protection | Shallow depressions, narrow valleys, lava tubes near infrastructure are an enhancement | Bussey & Hoffman 2016, p. 17 | "Examples include shallow depressions, narrow (but accessible) valleys, and lava tubes." | confirmed | Shelter score (see radiation-shelter.md) |
| 20 | 47 EZs; top votes Melas, Jezero, Gale | Workshop outcome | Workshop Statement p. 1; Planetary Society coverage (secondary) | "A total of 47 EZs were proposed in 45 abstracts" | confirmed (count); secondary (vote ranking) | Demo sites |
| 21 | MSL robotic limits: ±30° lat, < −1 km elevation, slopes < 30° at 2–5 m baseline, "moderate rock abundance" | Robotic EDL constraints for Curiosity, **not** human rules | Golombek et al., *Selection of the Mars Science Laboratory Landing Site*, Space Sci. Rev. 170, 641–737, 2012, doi:10.1007/s11214-012-9916-y | Abstract, as reported in search summaries | secondary | Reference only; do not use as human vetoes |

### Human landing-ellipse size, rock abundance and radiation criteria

- Landing ellipse for humans: **not found**. The 2015 documents use a 25 km² level area and 100 m precision instead. Searched the second announcement, workshop statement, Bussey & Hoffman 2016 and NASA HLS2 overview slides.
- Rock-abundance limit (%) for human landing: **not found**. Only the hazard list in row 3 and the 30 cm rock size for excavation (row 11).
- Radiation as a site criterion: **not found** as a number. Lower elevation gives more atmospheric shielding (see radiation-shelter.md, Zhang et al. 2022); use as a score.

## Licences and attribution

- NASA documents above: US Government works, no copyright in the US. Cite "NASA HEOMD/SMD Human Landing Sites Study (2015)".
- MOLA elevation for the ±50°/+2 km test: NASA PDS, public domain.

## Open questions

- Should "dust" be a veto? We need our own thermal-inertia/albedo threshold, clearly marked as Sol-48's choice, because NASA gives none.
- No NASA update after 2016 changed these numbers in what we found. A later HLS2 or Moon-to-Mars architecture update may exist; we did not find one with new thresholds.
- 25 km² flat-area test: decide the slope baseline (1 m DEM vs. 20 m) before coding; the source does not say.
