# EVA limits for a Marswalk

## What the app should use

- EVA length: plan 6 h, never more than 8 h, plus 1 h secondary O2 reserve that is **not** planned into the walk (NASA xEVA ConOps). Mars EVAs are expected to be "at least" like sustained lunar missions: up to 4 EVA days per week, rest day after 3–4 EVA days. JAXA's rover concept caps EVA at 24 h/week/crew, max 3 EVAs/week.
- Walk-back: NASA plans lunar walking range with a 2 km/h pace, 2 km radius from the safe haven, 16 km total per EVA; unpressurised-rover range = < 5 h walk back (~10 km). Mars walk-back ranges are officially "forward work"; use the lunar rules and slow the pace for terrain. Turn-back point: when remaining consumables equal the cost of returning, keeping the 1 h secondary O2 untouched.
- Metabolic budget: design average 350 W, max 530 W for a Mars PLSS (NASA ICES 2025/2026). Keep sustained effort ≤ 35% VO2max for an 8 h day.
- Walking cost: Pandolf (1977) for level and uphill, plus the Santee downhill correction factor (USARIEM TN03-3, 2003) for negative grades. The model the app calls "Santee 2001" is a different equation — see rows 3–5.

## Findings

| # | Value | Meaning | Source | Quote / location | Status |
|---|---|---|---|---|---|
| 1 | M = 1.5W + 2.0(W+L)(L/W)² + η(W+L)(1.5V² + 0.35VG) | Pandolf equation. M in watts; W body mass kg; L load kg; V m/s; G grade in **percent**; η terrain factor | Pandolf, Givoni & Goldman, *Predicting energy expenditure with loads while standing or walking very slowly*, J. Appl. Physiol. 43(4):577–581, 1977. Form as given by Potter, Santee et al., *Comparative analysis of metabolic cost equations: a review*, J. Sport Hum. Perf. 1(3):34–42, 2013, doi:10.12922/jshp.0009.2013 | Potter et al. p. 36: "MW = 1.5•W + 2.0•(W + L)•(L / W)2 + ŋ•(W + L)•(1.5•V2 + 0.35•V•G)" | secondary (original 1977 paper not read; review is by USARIEM incl. Santee) |
| 2 | η = 1.0 treadmill/blacktop; 1.1 dirt road; 1.2 light brush; 1.5 heavy brush; 1.8 swampy bog; 2.1 loose sand; 2.5/3.3/4.1 soft snow 15/25/35 cm | Pandolf terrain factors | Potter et al. 2013, p. 36 (citing Pandolf 1977) | listed verbatim | secondary |
| 3 | CF = η[(G(W+L)V)/3.5 − ((W+L)(G+6)²)/W + (25 − V²)]; M_total = Pandolf − CF, only when G < 0 | Downhill correction factor. G in % (−8% → −8), V m/s | Santee, Blanchard, Speckman, Gonzalez & Wallace, *Load carriage model development and testing with field data*, USARIEM Technical Note TN03-3, 2003 (DTIC ADA415788). Form from Potter et al. 2013, p. 37 | Review text: "CF = η • [(G • (W + L) • V) / 3.5 - ((W + L) • (G + 6)2) / W) + (25V2)]" | secondary; **operator before V² is lost in the review PDF** ("25V2"). "25 − V²" appears in third-party calculators only → unverified. DTIC was down (maintenance page) when checked |
| 4 | W_L = 3.28·m_t + 71.1 [W]; W_UP = W_L + 3.5·(m_t·g·h/s) [W]; W_DOWN = W_L + 2.4·(m_t·g·h/s)·0.3^(α/7.65) [W] | The actual Santee et al. (2001) model: level cost from Passmore & Durnin, separate up/down terms. m_t total mass kg; g = 9.8 m/s²; h = vertical displacement per second **at 1.34 m/s**; α slope angle | Santee et al., *A proposed model for load carriage on sloped terrain*, Aviat. Space Environ. Med. 72(6):562–566, 2001; equations restated in Santee, Small & Blanchard, J. Human-Environment System 6(2):69–76, 2003, https://www.jstage.jst.go.jp/article/jhes/6/2/6_2_69/_article | JHES 2003 p. 70; the 0.3 term is set as a superscript (checked glyph positions in the PDF) | confirmed (2003 restatement); sign convention of α for downhill not stated in the excerpt |
| 5 | Lowest cost at −8% grade; data −12% to +12%, loads 0/9.1/18.1 kg, 16 subjects | Santee 2001 study range | Santee et al. 2001 abstract (via search summary) | "minimum VO2 values occurred at -8% grade" | secondary |
| 6 | Pandolf valid for steady state < 30 min; underestimates by ~10–16% over ≥ 2 h | Limits of the equation | Potter et al. 2013, p. 37 | "designed to predict the response to steady state exercise of less than 30 min" … "significantly underestimated (~10-16%)" | secondary |
| 7 | 8 h max (6 ± 2 h) + 1 h secondary O2 | xEVA suit EVA duration and reserve | NASA, *Exploration EVA System Concept of Operations*, EVA-EXP-0042 Rev B, 2020, NTRS 20205008200 | "Support EVAs of up to 8 hours in duration (6±2 hours), with an additional 1 hour of secondary/backup O2 for off-nominal operations" | confirmed |
| 8 | 2 km radius, 2 km/h, 16 km cumulative | Lunar walking range from safe haven | EVA-EXP-0042 §4.2.1.3.1 | "walking traverse of up to 2 km away from the lander…total cumulative distance of 16 km during an EVA" … "~2 km/hr walking pace over relatively level regolith" | confirmed |
| 9 | < 5 h walk back ≈ 10 km | Unpressurised rover range (rover failure → walk home) | EVA-EXP-0042 | "The rover will stay within less than a 5-hour walk back to the lander, which equates to approximately 10 km when walking at a pace of 2 km/hr" | confirmed |
| 10 | 8 h max walk back; 12 km with 6 h | Single pressurised rover range (crew rests and recharges suits first) | EVA-EXP-0042 | "a more conservative approach would be to use a more nominal EVA length of 6 hours, with an associated walk back distance of 12 km" | confirmed |
| 11 | Failures not stacked | Ranges assume suit OR vehicle fails, not both | EVA-EXP-0042 | "if the vehicle fails, the suit is presumed to function nominally, and vice-versa" | confirmed |
| 12 | Mars ranges TBD | Mars walk-back ranges not defined | EVA-EXP-0042 §4.2.1.3.1.2 | "Development of the mEMU and associated walk back ranges are forward work." | confirmed |
| 13 | 20° | xEVA suit design slope for walking up/down/across | EVA-EXP-0042 §4.1.2; NASA *Exploration EVA Integrated HITL Testing and Analogs*, 2021, NTRS 20210000827 | "Walking up/down/across a slope of up to 20°" | confirmed |
| 14 | Rest day after 3–4 EVA days; 4 days/week for long stays; EVA 2–8 h | EVA frequency | EVA-EXP-0042 §4.1.4 and Table D-9 (Mars) | "there may be a rest day after three or four days of EVA" ; Mars table: "Long Duration: 4 days per week" | confirmed |
| 15 | Two excursions per day count as one 8 h EVA | Split EVA rule | EVA-EXP-0042 §4.1.4.3.2 | "The total amount of planned EVA Phased Elapsed Time…will stay within the constraints of a single 8-hour EVA" | confirmed |
| 16 | 24 h EVA/week/crew; max 3 EVAs/week | JAXA pressurised rover concept | JAXA PR concept (see rover-mobility.md row 31) | "24hrs EVA/wk/crew, Max. 3 times EVA/wk" | confirmed (notional) |
| 17 | 350 W avg, 530 W max; secondary 295/350 W | Mars PLSS design metabolic rates for an 8 h EVA | Lobmeyer et al., *Martian Exploration PLSS Schematic Study*, ICES-2025-90, NTRS 20250003716; Oliver et al., ICES 2026 slides, NTRS 20260005204 | "Average and maximum metabolic rates were assumed to be 350 W (1194 BTU/hr) and 530 W (1810 BTU/hr)" | confirmed |
| 18 | Mars hot 299.8 K / nominal 212.0 K / cold 162.6 K surface; sky 139.8 K; wind 20.1/10.1/4.9 m/s; 0.087–0.145 psia | Mars PLSS thermal design environments | Oliver et al., ICES 2026, NTRS 20260005204, slide 8 | table "Mars Hot 299.8 139.8 0.145 20.12 173.5" etc. | confirmed |
| 19 | 4.3 psia suit; inner suit 294.3 K | Suit pressure and internal temperature used in sizing | Lobmeyer et al. 2025 | "Suit pressure was set at 4.3 psia and inner suit temperature was taken as 294.3 K" | confirmed |
| 20 | 1000 BTU/h (ISS req.) → 1200 BTU/h for future sizing | Average metabolic sizing | Ogilvie et al., *Mars Spacesuit Mass Requirements*, ICES-2026-127, NTRS 20260005410 | "leading to an expected 1200 BTU/hr for future mission sizing" | confirmed |
| 21 | VO2max ≥ 36 ml/min/kg flight rule; ≤ 35% VO2max for 8 h (50% if aerobically trained); ~43% expected for EVA | Fitness and work-intensity limits | Ogilvie et al. 2026, slide 6 | "VO2max (ml/min/kg) has a minimum flight rule set at 36 ml/min/kg for EVA" … "Nominal VO2 should not exceed 35% VO2max for an 8-hour workday" | confirmed |
| 22 | MetRate(BTU/h) = (0.961 + 0.275·RER)·VO2(ml/min/kg)·mass(kg) | Conversion used by NASA suit team | Ogilvie et al. 2026, slide 6 | equation on slide | confirmed |
| 23 | Mars suit + human weight ≈ 927 N (xEMU) vs 412 N on Moon | Mars-equivalent weight burden | Ogilvie et al. 2026, slide 2 table | "Mars equivalent (with human) … 208 (927)" | confirmed |
| 24 | VO2max reached at 3.5 mph (5.6 km/h) at Mars g | 10 km walkback study, Mars offload, fixed suit mass | Ogilvie et al. 2026, slide 5 | "Hits VO2max at 3.5mph on Mars" | confirmed (slide label) |
| 25 | Lunar 10 km walkback: 95.8 min, 3.94 mph, 2374 BTU/h (~10 kcal/min), max 15-min 2617 BTU/h; ~2000 kcal for a 4 h EVA + walkback | MKIII suit, 1/6 g, 6 subjects | Norcross et al., *The Walkback Test*, NASA JSC 2007, NTRS 20070016007 | "average time to completion was 95.8 minutes at an average velocity of 3.94 mph with an average metabolic rate of 2374 BTU/hr" | confirmed |
| 26 | Test stop if HR or VO2 > 85% VO2pk for ≥ 2 min | Walkback test termination criterion (lab, not flight) | NTRS 20070016007, App. A | "Subject's heart rate or measured VO2 at level > 85% VO2pk for 2 min or more" | confirmed |
| 27 | 2 h | xEVA design time in shadowed areas (lunar PSR) before returning to light to warm | EVA-EXP-0042 §4.2.1.4 | "Function for up to 2 hours of contiguous exposure in a shadowed area" | confirmed (lunar) |
| 28 | 24 h 39 min 35.244 s | Mean Mars solar day | NASA GISS Mars24 technical notes, https://www.giss.nasa.gov/tools/mars24/help/notes.html | "A Mars solar day has a mean period of 24 hours 39 minutes 35.244 seconds." | confirmed |
| 29 | 87% adapted; main sleep 5.98 h aligned vs 4.91 h misaligned | Phoenix mission staff on a 24.65 h Mars day for 78 days | Barger et al., *Learning to live on a Mars day*, Sleep 35(10):1423–1435, 2012 | abstract (via search) | secondary |

## Gravity scaling

- Pandolf and Santee were fitted at 1 g. Neither paper gives a gravity term. **Not found:** a validated Mars-g form of either equation. NASA's suited Mars-g data (rows 24, 17) are the best check for any scaling we apply.

## Licences and attribution

- NASA NTRS documents: US Government works. Cite title, author, NTRS ID.
- Journal papers (Pandolf, Santee, Potter, Barger): cite only; do not reproduce tables.

## Open questions

- The exact "25 ± V²" term needs the USARIEM TN03-3 PDF (DTIC ADA415788) — retry when DTIC is back.
- If the app currently labels the downhill correction "Santee 2001", rename it "Santee et al. 2003 (USARIEM TN03-3) correction to Pandolf 1977".
- No Mars-specific suit cold/heat *operating limit* was found beyond the PLSS design environments (row 18).
- No NASA standard for crew sleep on Mars time was found; the Phoenix study is the best reference.
