import { describe, expect, it } from 'vitest';
import { speedLabel } from './PlanPace';

describe('speedLabel', () => {
  it('formats allowable and expected speeds in km/h', () => {
    expect(speedLabel(153.25 * 60)).toBe('0.4 km/h');
    expect(speedLabel(27.35 * 60)).toBe('2.2 km/h');
  });

  it('shows speeds below 0.1 km/h without rounding them to zero', () => {
    expect(speedLabel(36_001)).toBe('< 0.1 km/h');
    expect(speedLabel(36_000)).toBe('0.1 km/h');
  });

  it('returns a dash for non-finite or non-positive pace', () => {
    expect(speedLabel(0)).toBe('—');
    expect(speedLabel(-1)).toBe('—');
    expect(speedLabel(Number.NaN)).toBe('—');
  });
});
