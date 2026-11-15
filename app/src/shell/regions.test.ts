// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { defaultPanels, readPanels, togglePanel, writePanels } from './regions';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

describe('panel state', () => {
  it('opens both panels on wide screens and only the right one on narrow screens', () => {
    expect(defaultPanels(1440)).toEqual({ left: true, right: true });
    expect(defaultPanels(1024)).toEqual({ left: false, right: true });
  });

  it('remembers each tab separately', () => {
    const storage = memory();
    writePanels('plan', { left: false, right: true }, storage);
    expect(readPanels('plan', 1440, storage)).toEqual({ left: false, right: true });
    expect(readPanels('walk', 1440, storage)).toEqual({ left: true, right: true });
  });

  it('falls back to the default on unreadable storage', () => {
    const broken = { getItem: () => { throw new Error('blocked'); } };
    expect(readPanels('plan', 1024, broken)).toEqual({ left: false, right: true });
    expect(readPanels('plan', 1024, { getItem: () => '{not json' })).toEqual({ left: false, right: true });
    expect(readPanels('plan', 1440, null)).toEqual({ left: true, right: true });
  });

  it('closes the other panel when one opens in overlay mode', () => {
    expect(togglePanel({ left: false, right: true }, 'left', true)).toEqual({ left: true, right: false });
    expect(togglePanel({ left: false, right: true }, 'left', false)).toEqual({ left: true, right: true });
    expect(togglePanel({ left: true, right: true }, 'right', true)).toEqual({ left: true, right: false });
  });
});
