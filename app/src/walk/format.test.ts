import { describe, expect, it } from 'vitest';
import { formatDistance, formatDose, formatEnergy } from './format';

describe('Walk readout formatting', () => {
  it('rounds close distances to five metres and longer distances to one decimal kilometre', () => {
    expect(formatDistance(3)).toBe('5 m');
    expect(formatDistance(103)).toBe('103 m');
    expect(formatDistance(1250)).toBe('1.3 km');
  });

  it('rounds energy to 50 kJ and groups five digit values', () => {
    expect(formatEnergy(3)).toBe('0 kJ');
    expect(formatEnergy(1674)).toBe('1\u00a0650 kJ');
    expect(formatEnergy(12474)).toBe('12\u00a0450 kJ');
  });

  it('keeps dose estimates from rounding to zero', () => {
    expect(formatDose(0)).toBe('0 mGy');
    expect(formatDose(0.0004)).toBe('< 0.001 mGy');
    expect(formatDose(0.0134)).toBe('0.013 mGy');
  });
});
