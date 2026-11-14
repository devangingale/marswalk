// Written with AI assistance, directed and reviewed by the team.
// The astronaut mark on the globe: a hollow sunset-blue position ring with a dark edge, wider
// than a stop disc (28 px), so a crew member standing on a stop reads as a ring around the
// stop's number whichever of the two Cesium draws last. Colours come from design tokens.

import type { MarkerImage, TokenReader } from '../globe/markerImages';

/** Outer diameter, CSS pixels: wider than --map-stop-size so the ring clears a stop disc. */
export const CREW_RING_PX = 36;

export function crewRingImage(token: TokenReader): MarkerImage {
  const scale = 2;
  const size = CREW_RING_PX;
  const c = document.createElement('canvas');
  c.width = size * scale;
  c.height = size * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  const r = size / 2 - 3;
  for (const [colour, width] of [[token('--map-route-casing'), 6], [token('--map-position-ring'), 3]] as const) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }
  return { image: c, width: size, height: size };
}
