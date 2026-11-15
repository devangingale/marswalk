// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { SURFACE_MODE_KEY, initialSurfaceMode, rememberSurfaceMode } from './surfaceMode';

const stored = (value: string | null) => () => ({ getItem: (key: string) => (key === SURFACE_MODE_KEY ? value : null) });
const throwing = () => {
  throw new Error('SecurityError: storage is disabled');
};

describe('initialSurfaceMode', () => {
  it('defaults to online', () => {
    expect(initialSurfaceMode('', stored(null))).toBe('online');
    expect(initialSurfaceMode('?tab=plan', () => null)).toBe('online');
  });

  it('uses the remembered choice', () => {
    expect(initialSurfaceMode('', stored('offline'))).toBe('offline');
    expect(initialSurfaceMode('', stored('online'))).toBe('online');
    expect(initialSurfaceMode('', stored('garbage'))).toBe('online');
  });

  it('lets ?offline=1 select offline over the remembered choice', () => {
    expect(initialSurfaceMode('?offline=1', stored('online'))).toBe('offline');
    expect(initialSurfaceMode('?tab=walk&offline=true', stored(null))).toBe('offline');
    expect(initialSurfaceMode('?offline=0', stored('offline'))).toBe('online');
  });

  it('falls back to online when storage throws', () => {
    expect(initialSurfaceMode('', throwing)).toBe('online');
    expect(initialSurfaceMode('', () => ({ getItem: throwing }))).toBe('online');
    expect(initialSurfaceMode('?offline=1', throwing)).toBe('offline');
  });
});

describe('rememberSurfaceMode', () => {
  it('stores the choice', () => {
    const items = new Map<string, string>();
    expect(rememberSurfaceMode('offline', () => ({ setItem: (k: string, v: string) => void items.set(k, v) }))).toBe(true);
    expect(items.get(SURFACE_MODE_KEY)).toBe('offline');
  });

  it('reports a storage that fails instead of throwing', () => {
    expect(rememberSurfaceMode('offline', throwing)).toBe(false);
    expect(rememberSurfaceMode('offline', () => ({ setItem: throwing }))).toBe(false);
    expect(rememberSurfaceMode('offline', () => null)).toBe(false);
  });
});
