// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import type { DustYear } from './dustLayer';
import { openingYearIndex, type GaleDay } from './clockYear';

const year = (my: number, first: string, last: string): DustYear => ({
  my,
  url: `MY${my}.bin`,
  frames: 2,
  sols: [
    { sol: 1, ls: 0, earth_date: first },
    { sol: 2, ls: 1, earth_date: last },
  ],
});

const day = (earth_date: string, reading: boolean): GaleDay => ({
  sol: 1,
  earth_date,
  t_min_c: reading ? -70 : null,
  t_max_c: null,
  pressure_pa: null,
});

const years = [year(24, '1998-07-14', '2000-05-30'), year(34, '2017-05-05', '2019-03-22'), year(36, '2021-02-06', '2022-12-25')];

describe('openingYearIndex', () => {
  it('opens on the latest year with a weather reading, not the first year', () => {
    expect(openingYearIndex(years, [day('2018-05-08', true), day('2022-02-10', true)])).toBe(2);
  });

  it('skips a later year whose days carry no reading', () => {
    expect(openingYearIndex(years, [day('2018-05-08', true), day('2022-02-10', false), day('2024-01-01', true)])).toBe(1);
  });

  it('falls back to the latest year without weather', () => {
    expect(openingYearIndex(years, [])).toBe(2);
  });

  it('counts readings on a year boundary date', () => {
    expect(openingYearIndex(years.slice(0, 2), [day('2019-03-22', true)])).toBe(1);
  });
});
