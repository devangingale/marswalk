// Written with AI assistance, directed and reviewed by the team.
// Pure parts of the guided tour: the step machine, the remembered first-visit start,
// where a step's spotlight goes, and where its popover sits. No DOM here, so all of it is tested.

import { stepsFor, type TourStep, type TourTab } from './steps';

export type TourScope = 'all' | TourTab;

export type TourState =
  | { open: false; finished?: 'done' | 'skipped' }
  | { open: 'welcome' }
  | { open: true; scope: TourScope; index: number };

export type TourAction =
  | { type: 'welcome' }
  | { type: 'start'; scope?: TourScope }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' };

export const CLOSED: TourState = { open: false };
export const WELCOME: TourState = { open: 'welcome' };

/** Next on the last step finishes the tour as done; Skip (and Esc) as skipped. */
export function tourReducer(state: TourState, action: TourAction): TourState {
  if (action.type === 'welcome') return { open: 'welcome' };
  if (action.type === 'start') return { open: true, scope: action.scope ?? 'all', index: 0 };
  if (!state.open) return state;
  if (state.open === 'welcome') {
    if (action.type === 'skip') return { open: false, finished: 'skipped' };
    return state;
  }
  const count = stepsFor(state.scope).length;
  switch (action.type) {
    case 'next':
      return state.index >= count - 1 ? { open: false, finished: 'done' } : { ...state, index: state.index + 1 };
    case 'back':
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'skip':
      return { open: false, finished: 'skipped' };
  }
}

export function currentStep(state: TourState): TourStep | null {
  return state.open === true ? stepsFor(state.scope)[state.index] ?? null : null;
}

/** Step count text, e.g. 3 of 18. */
export function stepCount(state: TourState): string {
  return state.open === true ? `${state.index + 1} of ${stepsFor(state.scope).length}` : '';
}

// ---- First visit ------------------------------------------------------------------------

export const STORAGE_KEY = 'sol48.tour';

/** Storage, or null where the browser blocks it. */
export function tourStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Kept for this page load when storage is blocked, so the tour still never restarts on its own. */
let finishedInMemory: string | null = null;

export function readFinished(storage: Pick<Storage, 'getItem'> | null): string | null {
  if (!storage) return finishedInMemory;
  try {
    return storage.getItem(STORAGE_KEY) ?? finishedInMemory;
  } catch {
    return finishedInMemory;
  }
}

export function rememberFinished(storage: Pick<Storage, 'setItem'> | null, how: 'done' | 'skipped'): void {
  finishedInMemory = how;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, how);
  } catch {
    /* private mode: the in-memory flag covers this page load */
  }
}

/** For tests: forget the in-memory flag. */
export function resetFinishedInMemory(): void {
  finishedInMemory = null;
}

/** ?tour=1 always starts the tour; ?tour=0 never does; otherwise only until it was skipped or done. */
export function shouldAutoStart(search: string, storage: Pick<Storage, 'getItem'> | null): boolean {
  const flag = new URLSearchParams(search).get('tour');
  if (flag === '1') return true;
  if (flag === '0') return false;
  return readFinished(storage) === null;
}

// ---- Anchors ----------------------------------------------------------------------------

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** What the page says about one data-tour name: null when no such element exists. */
export type AnchorProbe = (name: string) => { visible: boolean; rect: Rect } | null;

export type AnchorResult =
  | { kind: 'element'; rect: Rect }
  /** Hidden in a collapsed panel: press this handle, then look again. */
  | { kind: 'open'; handle: string }
  | { kind: 'centre'; missing: boolean };

const HANDLE_SUFFIX = '-handle';

export function resolveAnchor(step: TourStep, probe: AnchorProbe, triedOpen = false): AnchorResult {
  if (!step.anchor) return { kind: 'centre', missing: false };
  const found = probe(step.anchor);
  if (found && found.visible && found.rect.width > 0 && found.rect.height > 0) return { kind: 'element', rect: found.rect };
  const handle = `${step.anchor}${HANDLE_SUFFIX}`;
  if (!triedOpen && probe(handle)) return { kind: 'open', handle };
  return { kind: 'centre', missing: true };
}

// ---- Popover placement ------------------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

export type Side = 'right' | 'left' | 'below' | 'above' | 'inside' | 'centre';

/** Space kept between the spotlight and the popover, and from the window edge. */
export const GAP = 16;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Beside the spotlight where it fits (right, left, below, above, in that order);
 * over the lower part of a large spotlight otherwise; centred with no spotlight.
 */
export function placePopover(rect: Rect | null, viewport: Size, popover: Size): { top: number; left: number; side: Side } {
  const centreTop = Math.round((viewport.height - popover.height) / 2);
  const centreLeft = Math.round((viewport.width - popover.width) / 2);
  if (!rect) return { top: Math.max(GAP, centreTop), left: Math.max(GAP, centreLeft), side: 'centre' };

  const maxTop = viewport.height - popover.height - GAP;
  const maxLeft = viewport.width - popover.width - GAP;
  const besideTop = clamp(rect.top, GAP, maxTop);
  const stackedLeft = clamp(rect.left, GAP, maxLeft);
  const right = rect.left + rect.width + GAP;
  const left = rect.left - GAP - popover.width;
  const below = rect.top + rect.height + GAP;
  const above = rect.top - GAP - popover.height;

  if (right + popover.width + GAP <= viewport.width) return { top: besideTop, left: right, side: 'right' };
  if (left >= GAP) return { top: besideTop, left, side: 'left' };
  if (below + popover.height + GAP <= viewport.height) return { top: below, left: stackedLeft, side: 'below' };
  if (above >= GAP) return { top: above, left: stackedLeft, side: 'above' };
  return {
    top: clamp(rect.top + rect.height - popover.height - GAP, GAP, maxTop),
    left: clamp(rect.left + Math.round((rect.width - popover.width) / 2), GAP, maxLeft),
    side: 'inside',
  };
}

/** Spotlight cut-out: the anchor plus a little room for the ring, kept on screen. */
export const PAD = 6;

export function spotlightRect(rect: Rect, viewport: Size): Rect {
  const top = Math.max(0, rect.top - PAD);
  const left = Math.max(0, rect.left - PAD);
  const bottom = Math.min(viewport.height, rect.top + rect.height + PAD);
  const right = Math.min(viewport.width, rect.left + rect.width + PAD);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
