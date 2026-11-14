export type ByteRange = { start: number; end: number } | null;

export function parseByteRange(value: string | undefined, size: number): ByteRange {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0 || (!match[1] && !match[2])) throw new RangeError('Invalid byte range');
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw new RangeError('Unsatisfiable byte range');
  return { start, end };
}
