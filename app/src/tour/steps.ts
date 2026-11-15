// Written with AI assistance, directed and reviewed by the team.
// The guided tour's steps: one intro, the top bar, then each tab's panels in order.
// Each anchor names a data-tour attribute, so class names can change without breaking the tour.

export type TourTab = 'explore' | 'plan' | 'walk' | 'visor';

export interface TourLine {
  /** What, How or Why on a panel step; absent on the intro and closing cards. */
  label?: 'What' | 'How' | 'Why';
  text: string;
}

export interface TourStep {
  id: string;
  title: string;
  lines: TourLine[];
  /** Tab the step needs; the tour switches to it. */
  tab?: TourTab;
  /** data-tour value of the element to spotlight; absent for a centred card. */
  anchor?: string;
  /** Shown on the centred card when the anchor is not on screen. */
  missing?: string;
}

const panel = (what: string, how: string, why: string): TourLine[] => [
  { label: 'What', text: what },
  { label: 'How', text: how },
  { label: 'Why', text: why },
];

const NEEDS_STOPS = 'This panel appears once the plan has stops. Add a stop in Plan, then run Tour this tab here.';

export const INTRO: TourStep = {
  id: 'intro',
  title: 'Sol-48',
  lines: [
    { text: 'Sol-48 plans a safe walk on Mars, from choosing a site to walking the route and getting back to the Shelter.' },
    { text: 'Next and Back move through the tour. Skip or Esc closes it. Tour in the top bar replays it.' },
  ],
};

export const TOP_BAR: TourStep[] = [
  {
    id: 'tabs',
    title: 'Tabs',
    anchor: 'tabs',
    lines: panel(
      'The four stages of a walk: Explore, Plan, Walk and Visor.',
      'Explore finds a site, Plan builds the route, Walk replays it, Visor shows it in the helmet.',
      'One plan carries through every tab, so the walk you check is the walk you take.',
    ),
  },
  {
    id: 'surface',
    title: 'Online and Offline',
    anchor: 'surface',
    lines: panel(
      'Where the map comes from.',
      'Online streams Cesium Mars terrain. Offline uses the tiles that ship with the app.',
      'On Mars there is no internet, so the tool has to work from local data.',
    ),
  },
];

export const TAB_STEPS: Record<TourTab, TourStep[]> = {
  explore: [
    {
      id: 'explore-left',
      tab: 'explore',
      anchor: 'explore-left',
      title: 'Layers and Site finder',
      lines: panel(
        'Whole-planet heatmaps such as ice and radiation, and ranked candidate sites.',
        'Switch a layer on and read its highest values; open Site finder and pick a site. The edge arrow collapses the panel.',
        'Compare water, radiation and minerals across Mars before choosing where to walk.',
      ),
    },
    {
      id: 'explore-controls',
      tab: 'explore',
      anchor: 'explore-controls',
      title: 'Map controls',
      lines: panel(
        'Quick views of the globe.',
        'Whole planet zooms out, the heatmap buttons pick the main layer, the site button flies to the current site.',
        'Jump between the planet and the site without hunting with the mouse.',
      ),
    },
    {
      id: 'explore-right',
      tab: 'explore',
      anchor: 'explore-right',
      title: 'Details',
      lines: panel(
        'The selected site card, current conditions and a sample route.',
        'Pick a site to fill its card; read the latest weather and space-weather alerts. The edge arrow collapses the panel.',
        'Know the conditions at a site before sending a crew there.',
      ),
    },
    {
      id: 'explore-time',
      tab: 'explore',
      anchor: 'explore-time',
      title: 'Time bar',
      missing: 'The time bar appears once the dust history has loaded.',
      lines: panel(
        'Dust-storm history by Mars year.',
        'Turn on dust history, then play or drag the clock to watch storms grow and fade.',
        'Dust cuts sunlight and visibility, so plan for a clear season.',
      ),
    },
  ],
  plan: [
    {
      id: 'plan-left',
      tab: 'plan',
      anchor: 'plan-left',
      title: 'Layers',
      lines: panel(
        'Terrain, thermal, mineral and radiation layers at this site.',
        'Switch layers on and set their opacity to stack them. The arrow on the panel edge collapses it.',
        'See steep ground and science targets before placing stops.',
      ),
    },
    {
      id: 'plan-main',
      tab: 'plan',
      anchor: 'plan-main',
      title: 'Map and Shelter',
      lines: panel(
        'The site at walking scale, with the Shelter where the walk starts and ends.',
        'Click to add a stop; it snaps to walkable ground. Drag the square Shelter marker to move it.',
        'Every route returns to the Shelter, the crew safe place.',
      ),
    },
    {
      id: 'plan-right',
      tab: 'plan',
      anchor: 'plan-right',
      title: 'Plan',
      lines: panel(
        'Your stops, the Shelter and the budgets.',
        'Rename, reorder or remove stops; read time, energy, radiation dose and turn-back. The arrow on the map edge collapses it.',
        'Check the walk fits time, energy and radiation before you go.',
      ),
    },
    {
      id: 'plan-controls',
      tab: 'plan',
      anchor: 'plan-controls',
      title: '3D relief',
      lines: panel(
        'A switch between a flat map and terrain in relief.',
        'Press 3D relief to tilt the terrain; press again for the flat view.',
        'Slopes are easier to judge in relief.',
      ),
    },
  ],
  walk: [
    {
      id: 'walk-left',
      tab: 'walk',
      anchor: 'walk-left',
      title: 'Safety',
      missing: NEEDS_STOPS,
      lines: panel(
        'Warnings, SOS, the daylight beeper and relay links.',
        'Watch the warning ladder as the walk plays; hold SOS for 2 s to send. The edge arrow collapses the panel.',
        'The crew learns early when to turn back or return to the Shelter.',
      ),
    },
    {
      id: 'walk-right',
      tab: 'walk',
      anchor: 'walk-right',
      title: 'Stop',
      missing: NEEDS_STOPS,
      lines: panel(
        'The next stop, what remains of the budgets, and details of each stop.',
        'Read distance and time to the next stop and the time, energy and dose left. The edge arrow collapses it.',
        'Keep the walk on budget while it happens.',
      ),
    },
    {
      id: 'walk-time',
      tab: 'walk',
      anchor: 'walk-time',
      title: 'Playback',
      missing: NEEDS_STOPS,
      lines: panel(
        'A replay of the planned walk.',
        'Press play or drag the bar; the map, Safety and Stop panels follow.',
        'Rehearse the walk on Earth, then follow it live on Mars.',
      ),
    },
  ],
  visor: [
    {
      id: 'visor-readouts',
      tab: 'visor',
      anchor: 'visor-readouts',
      title: 'Visor readouts',
      missing: 'The readouts appear once the plan has stops. Add a stop in Plan first.',
      lines: panel(
        'Heading, next stop and time left over the helmet view.',
        'Play the walk below; the readouts update as you move.',
        'A helmet display must work at a glance, with hands busy.',
      ),
    },
    {
      id: 'visor-sos',
      tab: 'visor',
      anchor: 'visor-sos',
      title: 'SOS',
      missing: 'SOS appears once the plan has stops. Add a stop in Plan first.',
      lines: panel(
        'The emergency call.',
        'Pick a reason, then hold for 2 s to send; you can still cancel within 10 s.',
        'The habitat hears at once; Earth gets it on the next orbiter pass.',
      ),
    },
    {
      id: 'visor-time',
      tab: 'visor',
      anchor: 'visor-time',
      title: 'Playback',
      missing: 'Playback appears once the plan has stops. Add a stop in Plan first.',
      lines: panel(
        'The same walk as in Walk, in a compact bar.',
        'Play, pause and drag as in Walk.',
        'Walk and Visor share one playback, so both screens agree.',
      ),
    },
  ],
};

export const OUTRO: TourStep = {
  id: 'done',
  title: 'Ready',
  lines: [
    { text: 'Find a site in Explore, build the route in Plan, rehearse it in Walk and Visor.' },
    { text: 'Tour this tab gives a short tour of whichever view you are in.' },
  ],
};

export const TAB_ORDER: TourTab[] = ['explore', 'plan', 'walk', 'visor'];

/** The full tour, or one tab's panels. */
export function stepsFor(scope: 'all' | TourTab): TourStep[] {
  if (scope === 'all') return [INTRO, ...TOP_BAR, ...TAB_ORDER.flatMap((tab) => TAB_STEPS[tab]), OUTRO];
  return TAB_STEPS[scope];
}
