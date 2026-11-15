// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { chooseHeatmap, defaultGlobalOn } from './heatmaps';

describe('defaultGlobalOn', () => {
  it('opens with shallow ice unless the URL names layers', () => {
    expect(defaultGlobalOn(null)).toEqual(['SWIM4MIM_Ci_0_1']);
    expect(defaultGlobalOn(['dust_p95'])).toEqual(['dust_p95']);
    expect(defaultGlobalOn([])).toEqual([]);
  });
});

describe('chooseHeatmap', () => {
  const states = {
    SWIM4MIM_Ci_0_1: { enabled: true, opacity: 0.7 },
    dose_ugy_day: { enabled: false, opacity: 0.5 },
    dust_p95: { enabled: true, opacity: 0.7 },
  };

  it('swaps ice for radiation and leaves other layers alone', () => {
    expect(chooseHeatmap(states, 'dose_ugy_day')).toEqual({
      SWIM4MIM_Ci_0_1: { enabled: false, opacity: 0.7 },
      dose_ugy_day: { enabled: true, opacity: 0.5 },
      dust_p95: { enabled: true, opacity: 0.7 },
    });
  });

  it('turns the active heatmap off when chosen again', () => {
    expect(chooseHeatmap(states, 'SWIM4MIM_Ci_0_1').SWIM4MIM_Ci_0_1.enabled).toBe(false);
    expect(chooseHeatmap(states, 'SWIM4MIM_Ci_0_1').dose_ugy_day.enabled).toBe(false);
  });
});
