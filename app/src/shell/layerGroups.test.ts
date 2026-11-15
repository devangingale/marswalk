// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import {
  buildGroups,
  gridText,
  groupSummary,
  isGroupOpen,
  readOpenGroups,
  shortCitation,
  writeOpenGroups,
} from './layerGroups';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
};

const item = (key: string, group: string, on = false) => ({ key, group, on });

describe('layer groups', () => {
  it('orders site groups optical, topographic, spectral, thermal, other kinds, rover', () => {
    const groups = buildGroups('site', [
      item('site:rover:traverse', 'rover', true),
      item('site:thermal', 'thermal'),
      item('site:chem', 'chemical'),
      item('site:bd1900_2', 'spectral', true),
      item('site:slope', 'topographic'),
      item('site:image', 'optical', true),
      item('site:d2300', 'spectral', true),
    ]);
    expect(groups.map((g) => g.id)).toEqual([
      'site:optical',
      'site:topographic',
      'site:spectral',
      'site:thermal',
      'site:chemical',
      'site:rover',
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Optical', 'Topographic', 'Spectral', 'Thermal inertia', 'Chemistry', 'Rover']);
    expect(groups.map((g) => g.onCount)).toEqual([1, 0, 2, 0, 0, 1]);
    expect(groups[2].items.map((i) => i.key)).toEqual(['site:bd1900_2', 'site:d2300']);
  });

  it('orders whole-planet groups ice to terrain, unlisted groups before other', () => {
    const groups = buildGroups('planet', [
      item('planet:SWIM4MIM_Ci_0_1', 'ice'),
      item('planet:cave_count_zone', 'caves'),
      item('planet:crustal_b_nt', 'other'),
      item('planet:dose_ugy_day', 'radiation', true),
      item('planet:dust_mean', 'dust'),
      item('planet:elevation_m', 'terrain'),
      item('planet:expert_likeness', 'habitability'),
      item('planet:geology', 'geology'),
      item('planet:ice_dist_km', 'ice', true),
      item('planet:tes_olivine', 'minerals'),
      item('planet:tes_ti_night_2007', 'thermal'),
      item('planet:temperature', 'temperature'),
      item('planet:dust_history', 'dust', true),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Ice',
      'Radiation',
      'Dust',
      'Thermal inertia',
      'Temperature',
      'Caves',
      'Geology',
      'Minerals',
      'Terrain',
      'Site score',
      'Other',
    ]);
    expect(groups.map((g) => g.onCount)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(groups[0].items.map((i) => i.key)).toEqual(['planet:SWIM4MIM_Ci_0_1', 'planet:ice_dist_km']);
    expect(groups.map((g) => groupSummary(g)).slice(0, 4)).toEqual(['Ice · 1 on', 'Radiation · 1 on', 'Dust · 1 on', 'Thermal inertia']);
  });

  it('keeps the two sections apart: a site thermal group and a planet thermal group have different ids', () => {
    const site = buildGroups('site', [item('site:thermal', 'thermal')]);
    const planet = buildGroups('planet', [item('planet:tes_ti_night_2007', 'thermal')]);
    expect(site[0].id).toBe('site:thermal');
    expect(planet[0].id).toBe('planet:thermal');
  });

  it('opens a group with a layer on, unless the user closed it', () => {
    expect(isGroupOpen({}, { id: 'planet:ice', onCount: 1 })).toBe(true);
    expect(isGroupOpen({}, { id: 'planet:ice', onCount: 0 })).toBe(false);
    expect(isGroupOpen({ 'planet:ice': false }, { id: 'planet:ice', onCount: 2 })).toBe(false);
    expect(isGroupOpen({ 'planet:ice': true }, { id: 'planet:ice', onCount: 0 })).toBe(true);
  });

  it('remembers open groups per tab', () => {
    const storage = memory();
    writeOpenGroups('explore', { 'planet:ice': true, 'site:optical': false }, storage);
    expect(storage.data.get('s48.layerGroups.explore')).toBe('{"planet:ice":true,"site:optical":false}');
    expect(readOpenGroups('explore', storage)).toEqual({ 'planet:ice': true, 'site:optical': false });
    expect(readOpenGroups('plan', storage)).toEqual({});
  });

  it('reads nothing from blocked or malformed storage, and never throws on write', () => {
    expect(readOpenGroups('plan', { getItem: () => { throw new Error('blocked'); } })).toEqual({});
    expect(readOpenGroups('plan', { getItem: () => '{not json' })).toEqual({});
    expect(readOpenGroups('plan', { getItem: () => '[true]' })).toEqual({});
    expect(readOpenGroups('plan', { getItem: () => '{"planet:ice":true,"x":"yes"}' })).toEqual({ 'planet:ice': true });
    expect(readOpenGroups('plan', null)).toEqual({});
    expect(() => writeOpenGroups('plan', {}, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });

  it('shortens whole-planet sources to one muted line', () => {
    expect(shortCitation('MOLA data (Mars Global Surveyor), Smith et al.')).toBe('MOLA');
    expect(shortCitation('Tanaka, K.L., et al., 2014, Geologic map of Mars')).toBe('Tanaka');
    expect(shortCitation('Derived global science layer; see source processing metadata.')).toBe('Derived global science layer');
    expect(shortCitation('MSL RAD data (Mars Science Laboratory), processed by Heber')).toBe('MSL RAD');
    expect(gridText(0.25)).toBe('0.25° grid');
    expect(gridText(undefined)).toBe('');
  });
});
