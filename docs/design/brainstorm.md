# Sol-48 design brainstorm

Three surfaces share one system: **Plan** (habitat console, laptop or tablet), **Walk** (tablet at arm's length, gloved), **Visor** (helmet display over pitched terrain). The first audience is judges watching a 30-second video and seven slides of screenshots; the second is the fiction of a real crew.

## What the subject imposes

These come from the world the product sits in.

- **The ground is ochre, and it changes.** HiRISE colour at Mount Sharp runs from near-white dust (luminance about 0.6) to dark basaltic sand (about 0.04). Anything drawn on the map has to read against both. A single-colour route line can't do that, so it needs a casing.
- **The map's own colour ramps are data.** Slope, thermal inertia and mineral indices bring their own colours. UI colour has to stay out of their way, so it gets a few hues used rarely.
- **Glance distance and glare.** Walk is read at about 60 cm in sunlight; Visor is read in a quarter-second glance while walking. Large numerals, few of them, high contrast.
- **Gloves.** Fingertip precision is gone. Targets have to fit a thumb, with space between them, and nothing can depend on hover or a long-press.
- **Colour-blind crews and judges.** Feasible, reserve and unreachable must differ in lightness and shape, not only in hue. Red–green alone is out.
- **Honesty.** Every budget comes from a walking model, so the numbers are estimates and have to look like estimates. A 0.03 mGy dose is small and should look small.

## Direction A: "Instrument" (map is the instrument, chrome recedes)

- **Palette:** basalt slate neutrals with a slight cool bias (hue about 212°), so panels separate cleanly from warm imagery. One accent, sunset blue, used only for the route and the selected state: Martian sunsets are blue, and blue is the complement of the ochre ground, so the route is the most visible thing on the map. Amber for reserve and turn-back, pink-red for unreachable and impassable (bluer than any terrain or slope-ramp red), green for feasible.
- **Type:** Barlow in three widths. Regular for UI, Semi Condensed with tabular figures for data, Condensed for Walk and Visor readouts. Barlow was drawn after California highway signage, so it's built to be read at a distance and at a glance.
- **Layout:** the map fills the screen; panels are flat slabs docked at the edges, separated by a 1 px rule rather than a shadow. Dark "habitat" theme by default, a daylight theme for bright rooms, and a Visor that is always dark.
- **Memorable element:** the **budget rail**. One horizontal line per limited budget shows the planned use, the 15 % reserve and the turn-back notch together. In Walk a "now" tick moves along it.
- **Critique:**
  - *For:* everything comes from the subject. The ochre/blue complement is physical, the signage type answers the glance problem, and the rail turns the plan's central idea (turn back before the reserve) into a single glanceable mark.
  - *Against:* dark slate with one blue accent is close to the default look of every "space dashboard". What saves it is restraint and specificity: no glows, no neon, no HUD brackets. The colour comes from the terrain, and the only memorable shape is the rail. If the rail is weak, the direction turns generic.
  - *Risk:* sunset blue on dark slate can drift towards "tech blue". It has to be a paler, slightly greyed blue, not a saturated one.

## Direction B: "Cuff checklist" (the EVA wrist checklist as UI)

- **Palette:** warm off-white card stock, black ink, one rubricated red for cautions, a highlighter yellow for the current step. Light-first.
- **Type:** IBM Plex Mono for everything, set like a typed flight-data file. Numbered steps, ruled lines, tab dividers.
- **Layout:** the Plan is a stack of checklist pages beside the map; stops are numbered checklist steps; Walk is a single cuff page flipping stop by stop.
- **Memorable element:** the stop list as a numbered spiral-bound cuff checklist, with the current step highlighted.
- **Critique:**
  - *For:* it's grounded in real EVA practice, it's warm, and it would stand out among dark dashboards.
  - *Against:* cream on ochre is warm on warm, so the panels melt into the imagery. A paper metaphor makes no sense for a Visor that must be dark. Monospace numerals are wide, so the Walk readouts lose size at a fixed width. The look borrows Apollo-era nostalgia, which edges towards mission-insignia territory and reads as pastiche rather than as a 2040s crew tool.
  - *Keep:* numbered, ordered stops with a "you are here" step. That idea goes into the stop list.

## Direction C: "Survey sheet" (a geological map you can operate)

- **Palette:** print-map neutrals (paper white, hairline grey-brown), with UI colour drawn from geological unit conventions.
- **Type:** a serif for titles (Source Serif) and a humanist sans for labels, set like a USGS sheet legend.
- **Layout:** the layer panel is a map legend; each layer is a legend entry with its true resolution and source written in the margin, like a sheet's compilation note. Scale bar and north arrow get a cartographic finish.
- **Memorable element:** the legend-as-control panel, with the compilation note ("THEMIS, 100 m") on every layer.
- **Critique:**
  - *For:* it handles the honesty rule well, since the data's provenance is always visible, and it looks credible to scientists.
  - *Against:* hairlines and a serif fail at arm's length and in glare. The UI would be competing with the data: geological palettes are exactly the colours the overlays use. It has no answer for the Visor, and on slides it reads as a static map, not a tool someone operates.
  - *Keep:* provenance on every layer row ("· 100 m · THEMIS") and a proper custom scale bar.

## Rejected outright

- **Glass-cockpit green on black** (avionics HUD). It's the cliché sci-fi look, and green would collide with "feasible". The useful part, aviation's convention of one reserved colour for the active route, is already in A.

## Decision: Direction A, adapted

A wins because it's the only direction that works on all three surfaces with one set of rules. The cool neutrals separate panels from warm imagery, the blue complement makes the route the loudest thing on the map, and the signage type scales from a laptop panel to a visor glance. B fails the Visor and the imagery, and C fails glance and glare.

Adaptations to the coordinator's candidate:

1. **Rails only where there is a limit.** Time and energy have limits (8 h, and a per-walk energy budget), so they get rails with reserve and notch. Distance, climb, descent and dose have no limit in the plan, so they're shown as plain figures. A rail with no limit would invent one.
2. **Dose is a plain number.** It gets a rail and caution styling only if the user sets a dose limit and the plan comes within its reserve.
3. **Focus is not blue.** The accent stays reserved for route and selection. Keyboard focus is a two-tone ring (text colour over background colour) that reads on panels and on imagery alike.
4. **From B:** stops are numbered like a cuff checklist, and Walk highlights the current step.
5. **From C:** every layer row carries its true resolution and source as a margin note, and the scale bar is cartographic.
6. **Map styling is the same in both themes.** The imagery doesn't change with the theme, so the route, markers and hatching don't either. Only the chrome changes.
7. **Recommended data ramp.** The draft slope legend in the contracts runs green–yellow–red, which collides with the status colours and fails for red–green colour blindness. The system proposes a cividis-based sequential ramp for overlays (see the README, "Map styling").
