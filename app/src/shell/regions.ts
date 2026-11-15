// Written with AI assistance, directed and reviewed by the team.
// Open/closed state of the two side panels, remembered per tab in this browser only.

export type Side = 'left' | 'right';
export interface PanelState { left: boolean; right: boolean }

/** Below this width an open panel slides over the map instead of narrowing it. */
export const OVERLAY_BELOW_PX = 1200;

const KEY = 's48.panels.';

export function defaultPanels(viewportWidth: number): PanelState {
  // Narrow screens start with the map clear; the right panel holds the task, so it opens first.
  return viewportWidth < OVERLAY_BELOW_PX ? { left: false, right: true } : { left: true, right: true };
}

export function readPanels(id: string, viewportWidth: number, storage: Pick<Storage, 'getItem'> | null): PanelState {
  const fallback = defaultPanels(viewportWidth);
  try {
    const raw = storage?.getItem(KEY + id);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      left: typeof parsed.left === 'boolean' ? parsed.left : fallback.left,
      right: typeof parsed.right === 'boolean' ? parsed.right : fallback.right,
    };
  } catch {
    return fallback;
  }
}

export function writePanels(id: string, state: PanelState, storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(KEY + id, JSON.stringify(state));
  } catch {
    // Private windows and blocked storage: the panels still work, they just are not remembered.
  }
}

/** In overlay mode two open panels would cover the map, so opening one closes the other. */
export function togglePanel(state: PanelState, side: Side, overlay: boolean): PanelState {
  const open = !state[side];
  const next = { ...state, [side]: open };
  if (overlay && open) next[side === 'left' ? 'right' : 'left'] = false;
  return next;
}
