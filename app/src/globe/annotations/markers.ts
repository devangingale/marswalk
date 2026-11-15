// Written with AI assistance, directed and reviewed by the team.
// Billboard images for the annotations, drawn on canvases from design tokens at 2x.

import { readToken, type MarkerImage, type TokenReader } from '../markerImages';
import { scoreBucket } from '../sites/format';

const SCALE = 2;

function canvas(size: number, draw: (ctx: CanvasRenderingContext2D) => void): MarkerImage {
  const c = document.createElement('canvas');
  c.width = size * SCALE;
  c.height = size * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  draw(ctx);
  return { image: c, width: size, height: size };
}

export interface AnnotationImages {
  /** Openings (skylights, pits) are larger and carry a dark centre. */
  cave(entry: boolean): MarkerImage;
  /** Numbered disc in the site-score green for the score's band. */
  rank(rank: number, score: number): MarkerImage;
  /** Numbered dark disc with a light ring for a layer's highest values. */
  hotspot(n: number): MarkerImage;
}

export function annotationImages(token: TokenReader = readToken): AnnotationImages {
  const cache = new Map<string, MarkerImage>();
  const once = (key: string, make: () => MarkerImage) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key)!;
  };
  const font = token('--font-data') || 'sans-serif';
  const halo = token('--map-label-halo');

  const disc = (size: number, label: string, fill: string, ring: string, text: string) =>
    canvas(size, (ctx) => {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ring;
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.font = `600 ${Math.round(size * 0.6)}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, size / 2, size / 2 + 1);
    });

  return {
    cave: (entry) =>
      once(`cave:${entry}`, () => {
        const size = entry ? 16 : 10;
        return canvas(size, (ctx) => {
          const pad = entry ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(size / 2, pad);
          ctx.lineTo(size - pad, size - pad);
          ctx.lineTo(pad, size - pad);
          ctx.closePath();
          ctx.fillStyle = token('--map-cave');
          ctx.fill();
          ctx.lineWidth = entry ? 1.5 : 1;
          ctx.strokeStyle = halo;
          ctx.stroke();
          if (entry) {
            ctx.beginPath();
            ctx.arc(size / 2, size * 0.64, size * 0.14, 0, Math.PI * 2);
            ctx.fillStyle = halo;
            ctx.fill();
          }
        });
      }),
    rank: (rank, score) =>
      once(`rank:${rank}:${scoreBucket(score)}`, () =>
        disc(20, String(rank), token(`--map-site-score-${scoreBucket(score)}`), halo, halo),
      ),
    hotspot: (n) =>
      once(`hotspot:${n}`, () =>
        disc(18, String(n), token('--map-stop-fill'), token('--map-stop-ring'), token('--map-stop-text')),
      ),
  };
}
