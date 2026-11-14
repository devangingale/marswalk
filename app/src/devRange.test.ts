import { describe, expect, it } from 'vitest';
import { parseByteRange } from './devRange';

describe('parseByteRange', () => {
  it('parses suffix, prefix, and explicit byte ranges', () => {
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(parseByteRange('bytes=4-99', 10)).toEqual({ start: 4, end: 9 });
  });
  it('rejects unsatisfiable ranges', () => {
    expect(() => parseByteRange('bytes=10-', 10)).toThrow(RangeError);
  });
});
