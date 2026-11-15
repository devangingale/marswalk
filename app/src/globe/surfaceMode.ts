// Written with AI assistance, directed and reviewed by the team.
import { useSyncExternalStore } from 'react';

/**
 * Which surface the globes draw: Cesium Mars ('online', always the default) or our tiles on a
 * plain Mars globe ('offline'). Offline is used only when the user picks it: the top bar
 * switch (remembered in localStorage) or ?offline=1 in the URL.
 */
export type SurfaceMode = 'online' | 'offline';

export const SURFACE_MODE_KEY = 's48.surfaceMode';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** ?offline=1 (or true) selects offline, ?offline=0 (or false) online; otherwise null. */
function urlChoice(search: string): SurfaceMode | null {
  const value = new URLSearchParams(search).get('offline');
  if (value === '1' || value === 'true') return 'offline';
  if (value === '0' || value === 'false') return 'online';
  return null;
}

/** URL first, then the remembered choice, then online. A storage that throws counts as empty. */
export function initialSurfaceMode(search: string, storage: () => ReadableStorage | null | undefined): SurfaceMode {
  const fromUrl = urlChoice(search);
  if (fromUrl) return fromUrl;
  try {
    return storage()?.getItem(SURFACE_MODE_KEY) === 'offline' ? 'offline' : 'online';
  } catch {
    return 'online';
  }
}

/** Remembers the choice; false when storage is unavailable (the choice then lasts this page only). */
export function rememberSurfaceMode(mode: SurfaceMode, storage: () => WritableStorage | null | undefined): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(SURFACE_MODE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

const browserStorage = () => (typeof window === 'undefined' ? null : window.localStorage);

let current: SurfaceMode = initialSurfaceMode(typeof window === 'undefined' ? '' : window.location.search, browserStorage);
const listeners = new Set<() => void>();

export function getSurfaceMode(): SurfaceMode {
  return current;
}

export function setSurfaceMode(mode: SurfaceMode): void {
  rememberSurfaceMode(mode, browserStorage);
  // The stored choice now wins; drop ?offline= so a reload does not undo the switch.
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('offline')) {
        url.searchParams.delete('offline');
        window.history.replaceState(window.history.state, '', url);
      }
    } catch { /* the URL stays as it is */ }
  }
  if (mode === current) return;
  current = mode;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen surface mode; components re-render (and globes rebuild) when it changes. */
export function useSurfaceMode(): SurfaceMode {
  return useSyncExternalStore(subscribe, getSurfaceMode, getSurfaceMode);
}
