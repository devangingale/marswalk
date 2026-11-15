// Written with AI assistance, directed and reviewed by the team.
import { beforeEach, describe, expect, it } from 'vitest';
import { stepsFor, TAB_ORDER, TAB_STEPS } from './steps';
import {
  CLOSED,
  currentStep,
  placePopover,
  readFinished,
  rememberFinished,
  resetFinishedInMemory,
  resolveAnchor,
  shouldAutoStart,
  spotlightRect,
  STORAGE_KEY,
  stepCount,
  tourReducer,
  type AnchorProbe,
  type TourState,
} from './tourState';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

const throwingStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

beforeEach(() => resetFinishedInMemory());

describe('steps', () => {
  it('runs intro, top bar, each tab in order, then the closing card', () => {
    expect(stepsFor('all').map((s) => s.id)).toEqual([
      'intro', 'tabs', 'surface',
      'explore-left', 'explore-controls', 'explore-right', 'explore-time',
      'plan-left', 'plan-main', 'plan-right', 'plan-controls',
      'walk-left', 'walk-right', 'walk-time',
      'visor-readouts', 'visor-sos', 'visor-time',
      'done',
    ]);
  });

  it('gives each tab its own short tour of only that tab', () => {
    expect(stepsFor('walk').map((s) => s.id)).toEqual(['walk-left', 'walk-right', 'walk-time']);
    for (const tab of TAB_ORDER) expect(TAB_STEPS[tab].every((s) => s.tab === tab)).toBe(true);
  });

  it('keeps every line to 25 words or fewer, with no exclamation or quotation marks', () => {
    for (const step of stepsFor('all')) {
      for (const line of step.lines) {
        expect(line.text.split(/\s+/).length, line.text).toBeLessThanOrEqual(25);
        expect(line.text, line.text).not.toMatch(/[!"“”‘’]/);
      }
    }
  });

  it('gives every panel step a What, How and Why line', () => {
    for (const tab of TAB_ORDER) {
      for (const step of TAB_STEPS[tab]) expect(step.lines.map((l) => l.label)).toEqual(['What', 'How', 'Why']);
    }
  });

  it('names the Shelter, never the drop-off', () => {
    const text = stepsFor('all').flatMap((s) => s.lines.map((l) => l.text)).join(' ');
    expect(text).toContain('Shelter');
    expect(text.toLowerCase()).not.toContain('drop-off');
  });
});

describe('tourReducer', () => {
  const start: TourState = tourReducer(CLOSED, { type: 'start', scope: 'all' });

  it('starts at the first step', () => {
    expect(start).toEqual({ open: true, scope: 'all', index: 0 });
    expect(currentStep(start)?.id).toBe('intro');
    expect(stepCount(start)).toBe('1 of 18');
  });

  it('moves next and back, and Back stops at the first step', () => {
    const second = tourReducer(start, { type: 'next' });
    expect(second).toEqual({ open: true, scope: 'all', index: 1 });
    expect(currentStep(second)?.id).toBe('tabs');
    expect(tourReducer(second, { type: 'back' })).toEqual({ open: true, scope: 'all', index: 0 });
    expect(tourReducer(start, { type: 'back' })).toEqual({ open: true, scope: 'all', index: 0 });
  });

  it('finishes as done on Next from the last step', () => {
    const last: TourState = { open: true, scope: 'all', index: 17 };
    expect(currentStep(last)?.id).toBe('done');
    expect(tourReducer(last, { type: 'next' })).toEqual({ open: false, finished: 'done' });
  });

  it('finishes as skipped on Skip from any step', () => {
    expect(tourReducer({ open: true, scope: 'all', index: 5 }, { type: 'skip' })).toEqual({ open: false, finished: 'skipped' });
  });

  it('runs a tab tour of three steps and finishes it as done', () => {
    let state = tourReducer(CLOSED, { type: 'start', scope: 'visor' });
    expect(stepCount(state)).toBe('1 of 3');
    state = tourReducer(tourReducer(state, { type: 'next' }), { type: 'next' });
    expect(currentStep(state)?.id).toBe('visor-time');
    expect(tourReducer(state, { type: 'next' })).toEqual({ open: false, finished: 'done' });
  });

  it('ignores Next, Back and Skip while closed', () => {
    expect(tourReducer(CLOSED, { type: 'next' })).toBe(CLOSED);
    expect(tourReducer(CLOSED, { type: 'skip' })).toBe(CLOSED);
    expect(currentStep(CLOSED)).toBeNull();
    expect(stepCount(CLOSED)).toBe('');
  });
});

describe('first visit', () => {
  it('starts on a first visit', () => {
    expect(shouldAutoStart('', memoryStorage())).toBe(true);
  });

  it('never starts again after Skip or Done', () => {
    for (const how of ['skipped', 'done'] as const) {
      const storage = memoryStorage();
      rememberFinished(storage, how);
      expect(storage.data.get(STORAGE_KEY)).toBe(how);
      expect(shouldAutoStart('?tab=plan', storage)).toBe(false);
    }
  });

  it('starts with ?tour=1 even after it was finished, and never with ?tour=0', () => {
    const storage = memoryStorage();
    rememberFinished(storage, 'done');
    expect(shouldAutoStart('?tab=walk&tour=1', storage)).toBe(true);
    expect(shouldAutoStart('?tour=0', memoryStorage())).toBe(false);
  });

  it('remembers for the page load when storage throws or is missing', () => {
    expect(shouldAutoStart('', throwingStorage)).toBe(true);
    rememberFinished(throwingStorage, 'skipped');
    expect(readFinished(throwingStorage)).toBe('skipped');
    expect(shouldAutoStart('', throwingStorage)).toBe(false);
    expect(shouldAutoStart('', null)).toBe(false);
  });
});

describe('resolveAnchor', () => {
  const rect = { top: 48, left: 0, width: 320, height: 852 };
  const step = TAB_STEPS.plan[0]; // plan-left

  it('spotlights a visible anchor', () => {
    const probe: AnchorProbe = (name) => (name === 'plan-left' ? { visible: true, rect } : null);
    expect(resolveAnchor(step, probe)).toEqual({ kind: 'element', rect });
  });

  it('opens a collapsed panel by its handle, once', () => {
    const probe: AnchorProbe = (name) =>
      name === 'plan-left' ? { visible: false, rect: { top: 0, left: 0, width: 0, height: 0 } }
        : name === 'plan-left-handle' ? { visible: true, rect: { top: 400, left: 0, width: 24, height: 64 } }
          : null;
    expect(resolveAnchor(step, probe)).toEqual({ kind: 'open', handle: 'plan-left-handle' });
    expect(resolveAnchor(step, probe, true)).toEqual({ kind: 'centre', missing: true });
  });

  it('falls back to a centred card when the anchor is missing or has no size', () => {
    expect(resolveAnchor(TAB_STEPS.walk[0], () => null)).toEqual({ kind: 'centre', missing: true });
    const zero: AnchorProbe = (name) => (name === 'walk-time' ? { visible: true, rect: { top: 10, left: 10, width: 0, height: 40 } } : null);
    expect(resolveAnchor(TAB_STEPS.walk[2], zero)).toEqual({ kind: 'centre', missing: true });
  });

  it('centres the intro, which has no anchor', () => {
    expect(resolveAnchor(stepsFor('all')[0], () => null)).toEqual({ kind: 'centre', missing: false });
  });
});

describe('placePopover', () => {
  const popover = { width: 340, height: 220 };
  const wide = { width: 1440, height: 900 };

  it('centres with no spotlight', () => {
    expect(placePopover(null, wide, popover)).toEqual({ top: 340, left: 550, side: 'centre' });
  });

  it('sits right of a left panel', () => {
    expect(placePopover({ top: 48, left: 0, width: 320, height: 852 }, wide, popover)).toEqual({ top: 48, left: 336, side: 'right' });
  });

  it('sits left of a right panel', () => {
    expect(placePopover({ top: 48, left: 1080, width: 360, height: 852 }, wide, popover)).toEqual({ top: 48, left: 724, side: 'left' });
  });

  it('sits below the top bar tabs, kept inside the window', () => {
    expect(placePopover({ top: 8, left: 80, width: 1300, height: 32 }, wide, popover)).toEqual({ top: 56, left: 80, side: 'below' });
  });

  it('sits above a time bar at the bottom', () => {
    expect(placePopover({ top: 820, left: 0, width: 1440, height: 80 }, wide, popover)).toEqual({ top: 584, left: 16, side: 'above' });
  });

  it('sits inside a spotlight that fills the window, at 1024x768', () => {
    expect(placePopover({ top: 48, left: 0, width: 1024, height: 720 }, { width: 1024, height: 768 }, popover)).toEqual({ top: 532, left: 342, side: 'inside' });
  });
});

describe('spotlightRect', () => {
  it('pads the anchor and keeps it on screen', () => {
    expect(spotlightRect({ top: 48, left: 0, width: 320, height: 852 }, { width: 1440, height: 900 })).toEqual({ top: 42, left: 0, width: 326, height: 858 });
    expect(spotlightRect({ top: 100, left: 200, width: 50, height: 30 }, { width: 1440, height: 900 })).toEqual({ top: 94, left: 194, width: 62, height: 42 });
  });
});
