// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { formatClock, formatLatLon } from './visorFormat';

describe('visor formats', () => {
  it('formats a countdown clock and never goes negative', () => {
    expect(formatClock(6065.9)).toBe('01:41:05');
    expect(formatClock(-4)).toBe('00:00:00');
  });

  it('formats Martian coordinates with hemisphere and east longitude', () => {
    expect(formatLatLon(18.4447, 77.4508)).toBe('18.4447°N  77.4508°E');
    expect(formatLatLon(-4.7533886, 137.3952398)).toBe('4.7534°S  137.3952°E');
    expect(formatLatLon(0, -10)).toBe('0.0000°N  350.0000°E');
  });
});
