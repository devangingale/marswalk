import { describe, expect, it } from 'vitest';
import samplePlanJson from '../fixtures/plan.sample.json';
import type { Plan } from '../lib/plan';
import { buildTrack } from '../walk/track';
import { planShelterKind, shelterSites } from './useSafetyModel';
import { shelterDisplayName, shelterKindName } from './WarningLadder';

const sample = samplePlanJson as unknown as Plan;
const origin = { lon0: sample.start.lon, lat0: sample.start.lat, lat_c: sample.start.lat };

describe('plan shelter in the safety model', () => {
  it('lists the plan shelter first, primary, with its type', () => {
    const plan = { ...sample, start: { ...sample.start, kind: 'habitat' as const, label: 'Shelter · Habitat' } };
    const sites = shelterSites(plan, buildTrack(plan, origin));
    expect(sites[0].candidate).toEqual({ id: 'plan-shelter', kind: 'habitat', primary: true, name: 'Shelter · Habitat' });
    expect(sites[0].alongM).toBe(0);
    expect(sites.some((s) => s.candidate.id === 'rover')).toBe(true);
  });

  it('an old plan is a pressurised rover, listed once', () => {
    const sites = shelterSites(sample, buildTrack(sample, origin));
    expect(sites[0].candidate.kind).toBe('rover');
    expect(sites.filter((s) => s.candidate.kind === 'rover')).toHaveLength(1);
    expect(planShelterKind({ ...sample.start, kind: 'radiation_shelter' })).toBe('radiation-shelter');
  });

  it('names the plan shelter with its type, others by kind', () => {
    expect(shelterDisplayName({ kind: 'habitat', primary: true, name: 'Shelter · Habitat' })).toBe('Shelter · Habitat');
    expect(shelterDisplayName({ kind: 'rover', primary: true, name: 'Base camp' })).toBe('Base camp · Pressurised rover');
    expect(shelterDisplayName({ kind: 'radiation-shelter' })).toBe('Radiation shelter');
    expect(shelterKindName('rover')).toBe('Pressurised rover');
  });
});
