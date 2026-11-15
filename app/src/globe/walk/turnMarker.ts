// Written with AI assistance, directed and reviewed by the team.
// The Walk map's next-turn marker: a hollow ring drawn like markerImages (2x canvas, token colours).

import { readToken, type MarkerImage, type TokenReader } from '../markerImages';

const SCALE = 2;
const SIZE = 22;

let cached: MarkerImage | null = null;

export function turnMarkerImage(token: TokenReader = readToken): MarkerImage {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = SIZE * SCALE;
  c.height = SIZE * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  // Dark casing under a light ring, so it reads on bright dust and on the route line.
  for (const [colour, width] of [[token('--map-turn-ring'), 6], [token('--map-turn'), 3]] as const) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 7, 0, Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  cached = { image: c, width: SIZE, height: SIZE };
  return cached;
}
