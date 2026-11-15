import { describe, expect, it } from 'vitest';
import samplePlanJson from '../fixtures/plan.sample.json';
import {
  defaultShelterLabel,
  isDefaultShelterLabel,
  normalizeShelter,
  setShelterType,
  SHELTER_TYPE_HINTS,
  shelterType,
  validatePlan,
  type Plan,
} from './plan';

const sample = samplePlanJson as unknown as Plan;

describe('plan shelter (start.kind)', () => {
  it('reads a plan without kind as a pressurised rover', () => {
    expect(sample.start.kind).toBeUndefined();
    expect(shelterType(sample.start)).toBe('rover');
    expect(shelterType({ kind: 'habitat' })).toBe('habitat');
  });

  it('loads an old "Rover drop-off" start as Shelter · Pressurised rover', () => {
    expect(normalizeShelter(sample.start)).toEqual({ ...sample.start, kind: 'rover', label: 'Shelter · Pressurised rover' });
  });

  it('keeps a name the user gave and an explicit type', () => {
    const start = { lon: 1, lat: 2, label: 'Base camp', kind: 'radiation_shelter' as const };
    expect(normalizeShelter(start)).toEqual(start);
  });

  it('names each type', () => {
    expect(defaultShelterLabel('habitat')).toBe('Shelter · Habitat');
    expect(defaultShelterLabel('rover')).toBe('Shelter · Pressurised rover');
    expect(defaultShelterLabel('radiation_shelter')).toBe('Shelter · Radiation shelter');
    expect(SHELTER_TYPE_HINTS.rover).toBe('Pressurised rover: the crew drove here and the rover waits as their shelter.');
    expect(SHELTER_TYPE_HINTS.habitat).toBe('The base the crew lives in.');
    expect(SHELTER_TYPE_HINTS.radiation_shelter).toBe('A shielded refuge for solar storms.');
  });

  it('a type change moves a default label with it but keeps a custom one', () => {
    const start = { lon: 0, lat: 0, label: 'Shelter · Habitat', kind: 'habitat' as const };
    expect(setShelterType(start, 'rover').label).toBe('Shelter · Pressurised rover');
    expect(setShelterType({ ...start, label: 'Base camp' }, 'rover')).toEqual({ ...start, label: 'Base camp', kind: 'rover' });
    expect(isDefaultShelterLabel('Rover drop-off')).toBe(true);
    expect(isDefaultShelterLabel('  ')).toBe(true);
    expect(isDefaultShelterLabel('Base camp')).toBe(false);
  });

  it('validates with or without kind and rejects an unknown kind', () => {
    expect(validatePlan(sample).valid).toBe(true);
    for (const kind of ['habitat', 'rover', 'radiation_shelter'] as const) {
      expect(validatePlan({ ...sample, start: { ...sample.start, kind } }).valid).toBe(true);
    }
    const bad = validatePlan({ ...sample, start: { ...sample.start, kind: 'cave' } });
    expect(bad.valid).toBe(false);
    expect(bad.errors).toContain('start.kind must be one of habitat, rover, radiation_shelter');
  });

  it('still requires the walk to return to the shelter', () => {
    expect(validatePlan({ ...sample, route: { ...sample.route, returns_to_start: false } }).errors).toContain('route.returns_to_start must be true');
  });
});
