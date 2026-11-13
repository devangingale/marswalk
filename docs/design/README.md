# Sol-48 design system

One system for three surfaces: **Plan** (habitat console), **Walk** (tablet, gloved, at arm's length) and **Visor** (helmet display over pitched terrain). The reasoning behind it is in [`brainstorm.md`](brainstorm.md).

| File | What it is |
|---|---|
| `app/src/styles/tokens.css` | Every token as a CSS custom property. Import it once at the app root. |
| `docs/design/preview.html` | Tokens, every component in its states, and a mock of each surface. Open it by double-clicking. |
| `docs/design/check-contrast.mjs` | `node docs/design/check-contrast.mjs` measures every colour pair listed below and fails on a miss. |

The component CSS in `preview.html` (classes starting `s48-`) is the reference implementation. Lift it into the app's own stylesheet and keep the class names, so the preview and the app stay comparable.

**Outside this folder:** the fonts need a line in `docs/references.md` ("Barlow, Barlow Semi Condensed, Barlow Condensed · Jeremy Tribby · SIL Open Font License 1.1 · Google Fonts"). That file isn't in this task's allowed files, so whoever merges this should add the line.

---

## 1. Principles

1. **The map is the instrument.** Chrome is flat basalt slate docked at the edges, separated by 1 px rules rather than shadows. Panels hold no imagery and no decoration.
2. **Every colour has one job.** Sunset blue means the route or the current selection. Amber means reserve and turn-back. Pink-red means unreachable or impassable. Green means feasible. A colour that turns up somewhere else is a bug.
3. **Colour is never alone.** Every state also has a shape and a word: a check in a circle for feasible, a downward notch for turn-back, a crossed square for unreachable, a hatch for impassable ground, and "≈" for an estimate.
4. **Say what is known and how well.** Modelled values carry "≈" and are rounded to the precision the model supports. Every layer shows its true resolution and source. Values carried over from another site say so.
5. **Small numbers look small.** A 0.038 mGy dose is set in the same neutral style as distance. Caution and danger styling are earned by a limit being at risk, never by the subject sounding dangerous.
6. **Glance first.** Walk shows a few large numbers; Visor shows four things and nothing else. If a readout needs a caption to be understood, it doesn't belong in the Visor.

## 2. Voice and copy

- **Sentence case everywhere:** buttons, headings, chips, menu items. No all-caps labels, and no letter-spaced eyebrow text above headings.
- **Name things the same way every time:** "Rover drop-off", "Stop 2", "Turn-back point", "Reserve", "Impassable ground", "Unreachable".
- **Buttons are verbs:** "Add stop", "Walk this route", "Remove stop", "Show nearest photo". Never "OK" or "Submit".
- **No exclamation marks, no "Oops", no apology.** State what happened and what to do next.
- **Sources are text:** "Source: REMS, Curiosity · Spain (CAB/INTA)". No logos, patches or insignia.

### Numbers and units

A no-break space (U+00A0) always separates a number from its unit. Use the real minus sign (U+2212) and the real multiplication sign (×). Figures are always tabular (`font-variant-numeric: var(--numeric)`).

| Quantity | Format | Examples | Notes |
|---|---|---|---|
| Distance | under 1 km: whole metres; from 1 km: one decimal | `840 m`, `8.6 km` | Measured along the planned line: no "≈" |
| Distance in Walk, close | nearest 5 m under 100 m | `40 m` | |
| Climb / descent | signed, whole metres | `+212 m`, `−212 m` | |
| Time (estimate) | `h` and `min`, rounded to 5 min above 1 h | `≈ 4 h 25 min`, `≈ 52 min` | Under a minute: `under 1 min` |
| Energy (estimate) | kJ, rounded to 50 kJ; group digits from 10 000 | `≈ 5300 kJ`, `≈ 12 450 kJ` | |
| Dose (estimate) | mGy, two significant figures, never rounded to zero | `≈ 0.038 mGy`, `< 0.001 mGy` | Rate: `0.21 mGy per sol` |
| Slope | whole degrees | `14°` | |
| Heading | three digits plus cardinal | `214° SW`, `032° NE` | |
| Temperature | °C with a space | `−79 °C` | Stored in kelvin, always shown in °C |
| Pressure | whole pascals | `760 Pa` | |
| Percentage | whole number, space | `15 % reserve` | |
| Resolution | metres per pixel | `0.25 m`, `100 m` | `Points` for point layers |
| Coordinates | four decimals, hemisphere letters | `4.7800° S, 137.3900° E` | About 6 m precision |
| Mission time | `Sol` + number; season as `Ls` | `Sol 5073`, `Ls 150–180°` | Earth date only next to a sol: `Sol 4868 · 12 Apr 2026` |

What counts as an estimate: time, energy and dose come from the walking model in `energy.ts`, so they get "≈". Distance, climb, descent and slope are measured on the planned line over the elevation grid, so they don't. Season values are averages, and are labelled "typical for Ls 150–180°".

### States in words

| Situation | Copy |
|---|---|
| No stops | "No stops yet. Click the map to drop one, or add a suggested stop." |
| Unreachable stop | "Can't reach Stop 4. Every path to it crosses ground steeper than 20°. Move the stop or remove it." |
| Plan inside reserve | "This plan dips into the reserve: ≈ 7 h 05 min of 8 h. Remove a stop or shorten a dwell time." |
| Over a limit | "This plan needs ≈ 9200 kJ; the energy budget is 8000 kJ. Remove a stop to fit it." |
| Turn-back (Plan) | "Turn back by ≈ 2 h 50 min. Energy is the binding budget." |
| Turn-back passed (Walk) | "Past the turn-back point. The rest of the route is the way home." |
| No photo | "No rover photo within 50 m of this stop. Nearest: 180 m north-east, Sol 4790, Navcam." |
| Photo failed | "This photo didn't load from NASA's image server." (credit stays visible) |
| Tiles failed | "Map tiles didn't load. Showing the regional image instead; data layers are unavailable until they load." |
| Carried-over data | "Carried over from Gale; not measured at Jezero." |
| Experimental layer | "Experimental. Learned from Curiosity's path; not yet validated on Jezero." (swap in the validation number once it exists) |
| Walk unavailable | "Plan a reachable route first." (shown beside the disabled Walk and Visor options) |

---

## 3. Colour

The neutrals are basalt slate, with the hue pulled to about 212° so panels separate from the warm imagery. Dark ("habitat") is the default when the OS asks for it, light ("daylight") is for bright rooms, and the Visor is always dark.

### Theme mechanics

- No attribute: `:root` follows `prefers-color-scheme`.
- `data-theme="dark"` or `data-theme="light"` on any element forces that theme for its whole subtree. Put it on `<html>` for a user override. The Visor container always carries `data-theme="dark"`.
- `--map-*` and `--visor-*` are the same in both themes.

### Theme tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#e9edf1` | `#0d1115` | App background behind panels |
| `--color-surface` | `#f6f8fa` | `#141a20` | Panels |
| `--color-surface-raised` | `#ffffff` | `#1b232b` | Inputs, popovers, the photo card |
| `--color-surface-sunken` | `#dde3e9` | `#090c0f` | Rail tracks, scrubber track; muted text at most, no status text |
| `--color-rule` | `#c9d1d9` | `#27313b` | Dividers between sections. Never a control boundary |
| `--color-control-border` | `#6e7b88` | `#6b7885` | Edges of inputs, checkboxes, secondary buttons |
| `--color-text` | `#121820` | `#e4e9ee` | Body text, values, primary button fill |
| `--color-text-muted` | `#47525e` | `#a0aab5` | Labels, sources, units |
| `--color-text-disabled` | `#8a949e` | `#5d6772` | Disabled controls only |
| `--color-accent` | `#1e5c9e` | `#8db7e6` | Sunset blue: the route, the selected stop, the selected mode/site/option |
| `--color-accent-text` | `#ffffff` | `#0a1520` | Text on an accent fill |
| `--color-accent-subtle` | `#dce8f5` | `#1c2e42` | Background of a selected row |
| `--color-ok` / `-subtle` | `#125f34` / `#e1f0e7` | `#4ab986` / `#14281f` | Feasible |
| `--color-caution` / `-subtle` | `#9a5c00` / `#fcf3e4` | `#ffc152` / `#2c2413` | Reserve, turn-back, plan inside reserve |
| `--color-danger` / `-subtle` | `#6b082f` / `#f8e1e9` | `#eb517c` / `#2e1520` | Unreachable, over a limit, impassable |
| `--color-focus-inner` / `-outer` | `#121820` / `#ffffff` | `#e4e9ee` / `#0d1115` | Two-tone focus ring |

Pink-red (`#eb517c`, hue about 344°) is deliberately bluer than the terrain reds and the reds in the slope legend, so "impassable" is never mistaken for "steep but allowed".

### Contrast (measured)

Every pair below was measured with `check-contrast.mjs` (the WCAG 2.x relative-luminance formula; semi-transparent colours are composited over their real background first). Ratios are given as light / dark.

| Pair | Target | Light | Dark |
|---|---|---|---|
| Text on bg / surface / raised | 4.5 | 15.16 / 16.76 / 17.84 | 15.51 / 14.34 / 13.00 |
| Muted text on bg / surface / raised | 4.5 | 6.77 / 7.48 / 7.97 | 8.04 / 7.44 / 6.74 |
| Muted text on sunken | 4.5 | 6.16 | 8.32 |
| Control border on bg / surface / raised | 3 | 3.68 / 4.07 / 4.33 | 4.20 / 3.88 / 3.52 |
| Accent as text on bg / surface / raised | 4.5 | 5.80 / 6.40 / 6.82 | 9.07 / 8.39 / 7.60 |
| Accent-text on accent fill | 4.5 | 6.82 | 8.81 |
| Ok / caution / danger text on surface | 4.5 | 7.27 / 5.05 / 11.60 | 7.16 / 10.85 / 5.01 |
| Ok / caution / danger text on raised | 4.5 | 7.74 / 5.38 / 12.35 | 6.49 / 9.84 / 4.54 |
| Caution text on bg (tightest pair) | 4.5 | 4.57 | 11.73 |
| Ok / caution / danger on own subtle fill | 4.5 | 6.57 / 4.89 / 9.96 | 6.34 / 9.50 / 4.82 |
| Focus ring (inner) on any surface | 3 | ≥ 15.16 | ≥ 13.00 |
| **Lightness separation** caution vs ok | 1.4 | 1.44 | 1.52 |
| **Lightness separation** ok vs danger | 1.4 | 1.59 | 1.43 |
| **Lightness separation** caution vs danger | 2 | 2.30 | 2.17 |

The status colours have to work as body text, which leaves only a narrow band of lightness. The order is fixed so they never swap: in both themes caution is lightest, then ok, then danger. The shape and the word carry the rest.

Run `node docs/design/check-contrast.mjs` for the full list, including map and visor pairs (sections 6 and 8). It exits non-zero if any pair misses its target or the two copies of the dark theme drift apart.

---

## 4. Type

Barlow is a low-contrast grotesk whose design draws on California's highway signs and licence plates. It's set in three widths, all from Google Fonts. The fallbacks are real faces: Bahnschrift ships with Windows and is DIN 1451, another road-sign face, so a failed font load still looks right.

| Token | Family | Use |
|---|---|---|
| `--font-ui` | Barlow 400/500/600 | Plan UI text, controls, headings |
| `--font-data` | Barlow Semi Condensed 400/500/600 | Every number in Plan, tables, legends, chips |
| `--font-readout` | Barlow Condensed 500/600/700 | Walk and Visor readouts, the wordmark |

| Token | Size / line | Where |
|---|---|---|
| `--text-xs` | 12 / 16 | Credits, attribution, scale bar. Nothing else |
| `--text-sm` | 13 / 18 | Resolution and source notes, secondary labels |
| `--text-md` | 14 / 20 | Plan body and controls |
| `--text-lg` | 16 / 22 | Panel headings, stop names |
| `--text-xl` | 20 / 26 | Budget totals |
| `--text-2xl` | 24 / 30 | Walk headings, next stop name |
| `--text-walk-label` / `--text-walk-body` | 16 / 20, 18 / 24 | Walk labels and body |
| `--text-readout-md` / `-lg` | 36 / 40, 56 / 56 | Walk readouts |
| `--text-visor-label` / `-value` / `-unit` | 20, 48, 24 | Visor |

Headings use weight 600; nothing is set heavier than 700. Units in readouts are set at about half the size of the value, in muted colour, so the number reads first.

---

## 5. Space, shape, touch, motion

- **Spacing:** a 4 px base: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-6` 24, `-8` 32, `-12` 48, `-16` 64. Plan rows are 8 px apart; Walk blocks are 24 px apart.
- **Radius:** `--radius-1` (2 px) for chips, inputs and rows, and `--radius-2` (4 px) for buttons, the photo card and visor plates. Circles (`--radius-round`) are reserved for stop markers and the scrubber thumb, because a circle means "a stop" on the map.
- **Hit sizes:**

| Token | Size | Rule |
|---|---|---|
| `--hit-plan` | 32 px | Default Plan control height |
| `--hit-plan-min` | 24 px | Inline icon buttons in dense rows (WCAG 2.5.8 minimum), with 8 px gaps |
| `--hit-walk` | 64 px | Every Walk control, about 12 mm on a 10–11 in tablet: sized for a gloved thumb |
| `--hit-walk-primary` | 80 px | Play / pause |
| `--hit-walk-gap` | 12 px | Minimum space between Walk targets |

  Walk never relies on hover, long-press, drag precision or a double tap. The scrubber thumb is 32 px to look at but 64 px to hit, and "Previous stop" and "Next stop" buttons are always present, so nobody has to drag.
- **Lines:** `--border-width` is 1 px. Separation comes from a change of surface, a rule or space, never from a drop shadow.
- **Focus:** `outline: var(--focus-width) solid var(--color-focus-inner); outline-offset: var(--focus-offset); box-shadow: 0 0 0 var(--focus-offset) var(--color-focus-outer);`. The outer colour fills the gap, so the ring reads on panels and on bright or dark imagery. Use it on every interactive element under `:focus-visible`.
- **Motion:** `--motion-fast` (120 ms) for state changes, `--motion-base` (200 ms) for panels and sheets, both eased with `--motion-ease`. Under `prefers-reduced-motion` both are 0. Camera fly-tos become jumps, Walk playback steps the marker once per second instead of gliding, and the hazard cue just appears. Nothing ever blinks or pulses.

---

## 6. Map styling

Map colours are hex literals, so MapLibre can read them:

```ts
const css = getComputedStyle(document.documentElement);
const t = (name: string) => css.getPropertyValue(name).trim();
map.addLayer({ id: "route-casing", type: "line", source: "route",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": t("--map-route-casing"), "line-width": 8 } });
map.addLayer({ id: "route-core", type: "line", source: "route",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": t("--map-route-core"), "line-width": 4 } });
```

| Mark | Drawing | Tokens |
|---|---|---|
| **Route ahead** | 4 px sunset-blue core over an 8 px dark casing, round caps and joins. The casing carries it on bright dust, the core on dark sand | `--map-route-core`, `--map-route-casing`, `-width` tokens |
| **Route walked** (Walk, Visor) | Same widths, grey core | `--map-route-walked` |
| **Route being computed** | Casing only, no core, until the worker returns. No spinner on the map | `--map-route-casing` |
| **Stop** | 28 px circle, dark fill, 2 px light ring, white number (Barlow Semi Condensed 600, 14 px). Name label beside it with a 2 px dark halo | `--map-stop-*`, `--map-label-*` |
| **Selected stop** | Fill becomes sunset blue, number dark | `--map-stop-selected-*` |
| **Suggested stop** | Same circle, dashed ring, no number; label "Suggested: Boxwork ridge" | `--map-stop-ring` |
| **Unreachable stop** | Rounded square instead of a circle, pink-red with a diagonal cross; no route line is drawn to it | `--map-impassable`, `--map-stop-fill` |
| **Rover drop-off** (start and end) | 24 px light square with a dark ring, label "Rover drop-off". It's the only square marker on the map | `--map-start-*` |
| **Turn-back point** | Amber downward triangle (the notch), 20 px, dark 2 px ring, centred on the route; label "Turn back by ≈ 2 h 50 min" | `--map-turnback*` |
| **Impassable ground** | 45° hatch with a 6 px period: pink-red stripe and a dark gap (80 % opacity), plus a 1 px pink-red edge. Hatching means "don't go there" anywhere in the system. If it's baked as a raster mask, bake it in these colours; if it's vectorised, use a `fill-pattern` drawn from the tokens | `--map-impassable*` |
| **Walk position** | 20 px light disc with a 3 px sunset-blue ring and a heading wedge | `--map-position*` |
| **Data overlay** | Starts at 70 % opacity over the imagery | `--map-overlay-opacity` |

Measured (best edge on each ground, target 3:1): route on white 17.88, bright dust 11.28, mid ochre 5.59, dark sand 6.91, black 11.10. Core against casing is 9.45, and the walked core against casing 6.90. Ahead and walked differ in lightness by 1.37:1 as well as by hue. Hatch stripe against its gap: 3.21 over white, 3.72 over dust, 4.39 over ochre, 5.36 over sand.

**Recommended overlay ramp (for phase 1).** The draft slope legend in the contracts runs green → yellow → red → purple. That collides with the feasible and impassable colours and fails for red–green colour blindness. Use cividis (`--ramp-seq-0` … `--ramp-seq-6`, dark navy to yellow) for slope, thermal inertia and mineral indices. It's perceptually even, readable with colour blindness, and has no red or green. Impassable cells are hatched rather than coloured, so slope only needs to cover 0–20°. This is a proposal, since `site.json` belongs to phase 1.

**Scale bar.** Custom, computed from local metres (never from MapLibre, which thinks the map is on Earth). It's a 4 px bar in alternating light and dark segments with a 1 px dark edge, labelled in `--text-xs` data type with a halo (`200 m`, `1 km`), at the bottom left, 16 px from the edges. It picks the largest of 50 / 100 / 200 / 500 m / 1 / 2 km that fits in 120 px.

**Attribution** at the bottom right, `--text-xs`: "HiRISE: NASA/JPL/University of Arizona".

---

## 7. Layouts

Breakpoints: **laptop** ≥ 1280 px wide; **tablet landscape** 1024–1279; **tablet portrait** 768–1023 (portrait orientation). Below 768 the Plan collapses to the portrait layout.

### Plan

Laptop (1440 × 900):

```
+-------------------------------------------------------------------------------------------+
| Sol-48   [ Plan | Walk | Visor ]   Mount Sharp, Gale  v   Season Ls 150-180  v   Theme  v |  48 px
+------------------+------------------------------------------------+-----------------------+
| Layers           |                                                | Route   (ok) Feasible |
|  Optical         |                                                |  8.6 km  ~4 h 25 min  |
|   [x] Orbital    |                 map                            |-----------------------|
|       0.25 m     |      [] Rover drop-off                         | Budgets               |
|  Topographic     |         \__ (1) Boxwork ridge                  |  Time   ====|-----/// |
|   [ ] Slope 1 m  |               \__ (2) ...                      |  Energy =====|----/// |
|  Thermal         |                v turn back                     |  Distance, climb, dose|
|   [ ] TI 100 m   |                                                |-----------------------|
|  Spectral ...    |                                                | Stops                 |
|  Chemical ...    |                                                |  1 Boxwork ridge  ... |
|  Experimental    |                                                |  2 ...                |
|   [ ] Walkability| [scale 500 m]                     attribution  |-----------------------|
|                  |                                                | Conditions  (season)  |
+------------------+------------------------------------------------+ [ Walk this route ]   |
      320 px                        fluid                                 360 px
```

The right panel scrolls; the route summary at its top and "Walk this route" at its foot stay pinned.

Tablet landscape (1180 × 820): the layers panel becomes a 320 px drawer over the map's left edge, opened from a "Layers (3 on)" button at the top left of the map. The right panel narrows to 340 px.

```
+------------------------------------------------------------------------+
| Sol-48  [Plan|Walk|Visor]  Mount Sharp, Gale v   Ls 150-180 v          |
+----------------------------------------------------+-------------------+
| [Layers (3 on)]                                    | Route summary     |
|                                                    | Budgets           |
|                     map                            | Stops             |
|                                                    | Conditions        |
| [scale]                                            | [Walk this route] |
+----------------------------------------------------+-------------------+
```

Tablet portrait (820 × 1180): the map takes the top 55 %, and a bottom sheet with tabs takes the rest. The route summary stays visible as the sheet's header.

```
+--------------------------------------+
| Sol-48  [Plan|Walk|Visor]   Gale v   |
+--------------------------------------+
|                                      |
|                map                   |
|                                      |
| [scale]                              |
+--------------------------------------+
| (ok) Feasible  8.6 km  ~4 h 25 min   |  route summary
| [Stops] [Budgets] [Layers] [Conditions]
| ...active tab content...             |
| [ Walk this route ]                  |
+--------------------------------------+
```

### Walk

Tablet landscape (1180 × 820), the primary target:

```
+------------------------------------------------------------------------+
| Sol-48  [Plan|Walk|Visor]          Mount Sharp, Gale     Sol 5073      |
+------------------------------------------+-----------------------------+
|                                          | Next   (2) Sulfate bench    |
|                                          |   640 m      ~17 min        |
|             map, follows marker          |-----------------------------|
|          (o)> you                        | Energy left  ~5900 kJ      |
|                                          |   ======|-----v-----///     |
|                                          | Time left    ~6 h 25 min    |
|                                          |   ===|------v--------///    |
|                                          | Before turn-back . 1.3 km   |
|                                          |-----------------------------|
|                                          | Photo at stop 2             |
|                                          | [ image ]  Sol 4790 Navcam  |
+------------------------------------------+-----------------------------+
| [ |< ]  [  > play  ]  [ >| ]   ===1=====o====2======3====v===  1 h 35 |  112 px
+------------------------------------------------------------------------+
                                                  400 px side
```

When the marker reaches a stop, playback pauses. The side column swaps to that stop: name, why it matters, the photo, conditions, and chemistry if a point lies within 30 m. "Continue" (64 px) resumes.

Laptop: the same layout with a 440 px side column. Tablet portrait (820 × 1180):

```
+-------------------------------+
| Sol-48 [Plan|Walk|Visor]      |
+-------------------------------+
|        map (40 %)             |
+-------------------------------+
| Next (2) Sulfate bench        |
| 640 m          ~17 min        |
| Energy left ~5900 kJ  rail   |
| Time left   ~6 h 25 min rail  |
| Before turn-back . 1.3 km     |
| [ photo card ]                |
+-------------------------------+
| [|<] [ > ] [>|]  scrubber     |
+-------------------------------+
```

### Visor

Always dark and always full-bleed. Four readouts sit on solid plates. There's no top bar; the mode switch appears only when a key is pressed or the screen is tapped, and hides again after 4 s (immediately under reduced motion).

16:9 (laptop or tablet landscape):

```
+------------------------------------------------------------------------+
|                         [ 200  210 |214 SW| 220  230 ]                 |  heading tape
|                       [ /// Steep ground 40 m ahead, left ]            |  hazard (only when present)
|                                                                        |
|                       pitched terrain, route ahead                     |
|                                                                        |
| [ (2) Next stop  ]                                 [ Energy left      ]|
| [ 640 m          ]                                 [ ~5900 kJ  rail  ]|
+------------------------------------------------------------------------+
```

Tablet portrait: the heading tape and hazard stay at the top; the two readouts sit side by side across the bottom, each half the width. Readouts keep 24 px from every edge: the safe area of a helmet display is smaller than the panel.

---

## 8. Components

The preview shows every state listed here.

**Mode switch.** A three-way segmented control: Plan, Walk, Visor. It's 32 px high in Plan and 64 px in Walk.
- *Selected:* accent fill, accent-text label.
- *Default:* surface with a control border.
- *Hover:* raised surface.
- *Focus:* the ring.
- *Disabled* (no reachable route): disabled text, with "Plan a reachable route first." shown beside it. Not a tooltip, because there's no hover on a gloved tablet.

**Site switcher.** A button showing "Mount Sharp, Gale · Curiosity" that opens a listbox. Options show the site and rover, and the current one is marked with the accent and a check.
- *Loading:* "Loading Jezero…" replaces the label. The map dims to 60 % and the controls are disabled.
- *Failed:* "Jezero didn't load. Still showing Gale." in danger text, with "Try again".

**Layer row.** Grouped under a heading per `kind` (Optical, Topographic, Thermal, Spectral, Chemical, Experimental), in sentence case.
- *Contents:* a checkbox and the title; when the layer is on, an opacity slider (0–100 %, default 70) and a legend appear. The legend is a ramp bar with min and max in data type plus the unit, for example `0°` … `20°`, "degrees".
- *Margin note:* every row has a note line with the true resolution and source, for example `100 m · THEMIS, Mars Odyssey · NASA`. Point layers say `Points` and draw their marker shape in the legend.
- *Coarse:* layers at 50 m or coarser get a "Coarse · 100 m" chip, so a 100 m layer never passes for 1 m.
- *Experimental:* the walkability layer has an "Experimental" chip and its validation line.
- *Loading:* the note reads "Loading tiles…".
- *Failed:* "Tiles didn't load" in danger text, and the checkbox is disabled.

**Stop list.** An ordered, numbered list, like an EVA cuff checklist.
- *Row contents:* a drag handle (24 px), a number disc matching the map marker, the name (editable on double-click or Enter), and per-leg values for the leg arriving at that stop (`2.4 km · ≈ 58 min · +64 m`), with a remove button (24 px).
- *Fixed rows:* the first row is always "Rover drop-off" with its square, and the last is "Back to Rover drop-off" with the return leg.
- *Selected:* accent-subtle background and an accent disc, linked to the map.
- *Dragging:* the row lifts onto the raised surface with a 1 px control border, and the drop slot shows as a 2 px accent line.
- *Unreachable:* a pink-red crossed square replaces the disc, there are no leg values, and the line "Can't reach. Every path crosses ground steeper than 20°." follows.
- *Suggested stops:* listed below in muted text, each with "Add stop" and its reason ("Mineral veins standing as ridges · source: mission team").
- *Empty:* the "No stops yet…" copy.

**Budget display.** The signature component.
- *Rail:* time and energy each get one, because only they have limits (time from `params.time_limit_s`; energy from an energy budget parameter). One line shows:
  - the planned use as a solid bar in `--color-text`;
  - the reserve as the last 15 % of the track, hatched in caution;
  - the turn-back notch, a caution downward triangle above the track at the value reached at the turn-back point;
  - a "now" tick in Walk;
  - the limit as the end of the track.

  Labels: `Time  ≈ 4 h 25 min of 8 h` on top, and `Turn back by ≈ 2 h 50 min` under it.
- *Figures:* distance, climb / descent and dose are shown as plain figures in a two-column grid. A rail with no limit would invent one.
- *Within:* the bar is in text colour and the figure is neutral.
- *Inside reserve:* the part of the bar inside the reserve turns caution, and a "Inside reserve" chip appears.
- *Over limit:* the bar runs past the end of the track, which shows a break mark and a danger segment. A "Over limit" chip and the over-limit copy appear.
- *Binding budget:* the rail whose limit sets the turn-back point is marked "binds turn-back".
- *Solar-event scenario:* the dose figure switches to the event rate with a "Scenario: solar event" chip. It stays neutral unless the user has set a dose limit and the plan comes within its reserve.
- *Gap to resolve:* `plan.json` params has `time_limit_s` but no energy limit. Phase 3 needs to add `energy_limit_kj` (or name the source of the energy limit) for the energy rail to have an end.

**Status chips.** 24 px high, 2 px radius, with an icon and a word. Most are outline style in their colour; only "Unreachable" and "Over limit" are filled with their subtle colour, because they need action.

| Chip | Glyph |
|---|---|
| Feasible | Check in a circle |
| Inside reserve | Notch |
| Before turn-back / Past turn-back | Notch |
| Unreachable | Crossed square |
| Over limit | Crossed square |
| Estimate | ≈ |
| Coarse · 100 m | Grid |
| Experimental | Dashed outline |
| Carried over | Arrow |
| Scenario: solar event | No glyph; neutral outline |

**Conditions panel.**
- *Season selector:* a select of `Ls 0–30°` … `Ls 330–360°`, each with its northern-season name ("Ls 150–180° · late northern summer").
- *Three blocks:* Weather (air temperature range, pressure), Dust (opacity τ, share of sols with storms) and Radiation (dose rate per sol, plus the solar-event toggle). Each block ends with a source line, for example "Source: REMS, Curiosity · Spain (CAB/INTA)", and the number of sols averaged.
- *Carried over:* the "Carried over" chip and copy at Jezero.
- *No data for the season:* "No REMS data for Ls 150–180°."

**Photo card.** A raised surface with a 4 px radius.
- *Contents:* the image at 4:3 in a sunken frame, then a caption in data type: `Sol 4790 · Navcam Left · 14 m south-west of the stop, facing 212°`. The credit `NASA/JPL-Caltech` is always visible, never truncated, and never only in a tooltip.
- *Several photos:* "1 of 3" with Previous / Next buttons (64 px in Walk).
- *Loading:* the sunken frame with "Loading photo…".
- *No photo here:* the frame shows a crossed-square glyph and the no-photo copy with the nearest photo's distance and direction. It's not a broken-image icon.
- *Failed:* the failure copy, with the credit and sol still shown.

**Walk scrubber.**
- *Controls:* a full-width track (8 px, sunken) with the walked part in `--map-route-walked` and the part ahead in sunset blue. Numbered stop ticks are 20 px discs on the track, and the turn-back notch sits above it. The thumb is 32 px to look at and 64 px to hit. Beside it: Previous stop (64), Play/Pause (80), Next stop (64), and elapsed / total time in readout type.
- *States:* playing, paused, at a stop (paused automatically, side column shows the stop), past turn-back (the notch passed and the chip changes), and finished ("Back at Rover drop-off. Walk complete.").
- *Keyboard:* arrows step 1 %, Page Up / Page Down move a stop, Space plays or pauses.

**Visor readouts.** Solid plates (`--visor-plate`, 80 % black, no blur, 4 px radius). Labels use `--text-visor-label` in muted type, and values `--text-visor-value` in condensed 600.
- *Heading:* a tape showing ±20° of ticks, with the current heading boxed (`214° SW`).
- *Distance to next stop:* the stop disc and `640 m`.
- *Budget remaining:* the binding budget only (`Energy left ≈ 5900 kJ`), with a 6 px rail.
- *Hazard cue:* hidden when the route ahead is clear. When it isn't: a pink-red plate with a hatch edge and dark text, "Steep ground 40 m ahead, left". Under 20 m it fills the full plate width. It never flashes.
- *Caution:* the budget readout turns caution after the turn-back point is passed, and the tape is unchanged.

**Scale bar.** See section 6. It looks the same in all surfaces.

**Buttons.**

| Variant | Look | Use |
|---|---|---|
| Primary | Text-colour fill, bg-colour label | One per view: "Walk this route", "Continue" |
| Secondary | Surface with a control border | Most actions |
| Quiet | Text only, underlined on hover | Inline actions: "Add stop" in suggestions |
| Danger | Danger-coloured border and label | "Remove stop" |

- *Sizes:* 32 px in Plan, 64 px in Walk, 80 px for play.
- *States:* hover (raised surface or 90 % fill), active (sunken), focus (ring) and disabled (disabled text, no border change, with a reason shown nearby).
- *Primary isn't blue:* the accent stays for the route and the selection.

---

## 9. Checklist for a new screen

- [ ] Every colour use matches its one job (section 3).
- [ ] Every state has a word and a shape as well as a colour.
- [ ] Modelled values carry "≈" and are rounded as in section 2.
- [ ] Every layer and condition names its source; coarse data says how coarse.
- [ ] Walk targets are at least 64 px, with 12 px gaps, and need no hover.
- [ ] Visor shows only heading, distance to next stop, budget remaining and hazard.
- [ ] Focus is visible on every control; reduced motion removes all movement except data updates.
- [ ] `node docs/design/check-contrast.mjs` passes if tokens changed.
