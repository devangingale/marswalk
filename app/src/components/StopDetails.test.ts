import { describe, expect, it } from 'vitest';
import { isSafePhotoUrl } from './StopDetails';

describe('isSafePhotoUrl', () => {
  it('allows HTTPS and root-relative URLs only', () => {
    expect(isSafePhotoUrl('https://example.com/photo')).toBe(true);
    expect(isSafePhotoUrl('/photo.jpg')).toBe(true);
    expect(isSafePhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePhotoUrl('http://example.com')).toBe(false);
  });
});
