// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { vetoLines } from './vetoInfo';
import { Veto } from './types';

const VETOES: Veto[] = [
  { id: 'latitude', rule: 'abs(latitude) <= 50', source: 'Bussey & Davis 2015, p. 3' },
  { id: 'elevation', rule: 'MOLA < +2000 m', source: 'Bussey & Davis 2015, p. 3 (MOLA)' },
  { id: 'flat_area', rule: '25 km2 under 10 deg', source: 'Bussey & Davis 2015, p. 3 (flat area)' },
];

describe('vetoLines', () => {
  it('labels a veto and cites its source', () => {
    expect(vetoLines(['flat_area'], VETOES)).toEqual([
      { label: 'No 25 km² patch below ~10° slope', source: 'Bussey & Davis 2015, p. 3 (flat area)' },
    ]);
  });

  it('cites the base rule for a "_no_data" reason', () => {
    expect(vetoLines(['flat_area_no_data'], VETOES)[0]).toEqual({
      label: 'Slope data missing for the flat-area test',
      source: 'Bussey & Davis 2015, p. 3 (flat area)',
    });
  });

  it('keeps an unknown id as its own label with no source', () => {
    expect(vetoLines(['mystery'], VETOES)).toEqual([{ label: 'mystery', source: undefined }]);
  });
});
