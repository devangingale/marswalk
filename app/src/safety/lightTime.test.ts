// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { oneWayLightMinutes, earthMarsDistanceAu } from './lightTime';

describe('oneWayLightMinutes', () => {
  it('stays inside the physical band (about 3 to 22.4 min; relay.md row 9)', () => {
    for (let month = 0; month < 12; month++) {
      const t = Date.UTC(2026, month, 14, 0, 0);
      const m = oneWayLightMinutes(t);
      expect(m).toBeGreaterThan(2.5);
      expect(m).toBeLessThan(23);
    }
  });

  it('is much shorter near opposition than near conjunction', () => {
    // Mars opposition ~2027-02-19 (close approach); conjunction region late 2025.
    const nearOpposition = earthMarsDistanceAu(Date.UTC(2027, 1, 19));
    const nearConjunction = earthMarsDistanceAu(Date.UTC(2025, 11, 20));
    expect(nearOpposition).toBeLessThan(0.8);
    expect(nearConjunction).toBeGreaterThan(2.2);
    expect(oneWayLightMinutes(Date.UTC(2027, 1, 19))).toBeLessThan(
      oneWayLightMinutes(Date.UTC(2025, 11, 20)),
    );
  });

  it('is steady across a single sol (slow geometry)', () => {
    const a = oneWayLightMinutes(Date.UTC(2026, 10, 14, 0));
    const b = oneWayLightMinutes(Date.UTC(2026, 10, 14, 23));
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });
});
