// Written with AI assistance, directed and reviewed by the team.
// Marker images for the globe, drawn on canvases so numerals use the app's data font.
// Every colour comes from a design token. Sizes are CSS pixels; canvases are drawn at 2x.

import type { ShelterType } from '../lib/plan';

export type TokenReader = (name: string) => string;

export const readToken: TokenReader = (name) =>
  typeof document !== 'undefined' && typeof getComputedStyle !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    : '';

export interface MarkerImage {
  image: HTMLCanvasElement | string;
  width: number;
  height: number;
}

/** Everything the overlays draw as a billboard. Swapped for stubs in tests. */
export interface MarkerImages {
  stop(label: string, selected: boolean): MarkerImage;
  /** The plan shelter (start and finish): a hexagon with the type's glyph. Default 'rover'. */
  dropOff(kind?: ShelterType): MarkerImage;
  finish(): MarkerImage;
  fork(): MarkerImage;
  chevron(): MarkerImage;
  cave(): MarkerImage;
  high(): MarkerImage;
  low(): MarkerImage;
  steepest(): MarkerImage;
  photo(count: number): MarkerImage;
  walker(): MarkerImage;
}

const SCALE = 2;

/** Stroked glyphs inside the 30 px shelter hexagon, one per type. */
export const SHELTER_GLYPHS: Record<ShelterType, string> = {
  // Pressurised rover: body on a chassis with a mast.
  rover: 'M10 18.5 12.4 12h5.2l2.4 6.5M9.5 19.5h11M12.4 12l2.6-3 2.6 3M15 9v9.5',
  // Habitat: a dome with a door.
  habitat: 'M8.5 19.5h13M10 19.5v-3a5 5 0 0 1 10 0v3M13.5 19.5v-2.6h3v2.6',
  // Radiation shelter: a doorway under layered berms of regolith.
  radiation_shelter: 'M8 19.5h14M9 19.5c1.2-6.4 10.8-6.4 12 0M11.2 14.6c1.8-3.4 5.8-3.4 7.6 0M13.6 19.5v-2.4h2.8v2.4',
};

function canvas(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): MarkerImage {
  const c = document.createElement('canvas');
  c.width = width * SCALE;
  c.height = height * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  draw(ctx);
  return { image: c, width, height };
}

function path(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export function canvasMarkerImages(token: TokenReader = readToken): MarkerImages {
  const cache = new Map<string, MarkerImage>();
  const once = (key: string, make: () => MarkerImage) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key)!;
  };
  const px = (name: string, fallback: number) => parseFloat(token(name)) || fallback;
  const dataFont = token('--font-data') || 'sans-serif';
  const halo = token('--map-label-halo');
  const text = token('--map-label-text');

  // Up or down caret for the high and low points, stroked so it reads apart from filled shapes.
  const caret = (up: boolean) =>
    canvas(16, 16, (ctx) => {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const pts: [number, number][] = up ? [[3, 11], [8, 5], [13, 11]] : [[3, 5], [8, 11], [13, 5]];
      for (const [colour, width] of [[halo, 5], [text, 2.2]] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    });

  return {
    stop: (label, selected) =>
      once(`stop:${label}:${selected}`, () => {
        const size = px('--map-stop-size', 28);
        return canvas(size, size, (ctx) => {
          const r = size / 2 - 1;
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
          ctx.fillStyle = token(selected ? '--map-stop-selected-fill' : '--map-stop-fill');
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = token('--map-stop-ring');
          ctx.stroke();
          ctx.fillStyle = token(selected ? '--map-stop-selected-text' : '--map-stop-text');
          ctx.font = `600 15px ${dataFont}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, size / 2, size / 2 + 1);
        });
      }),
    // The shelter: a hexagon (stops are circles) with a glyph for its type, all from tokens.
    dropOff: (kind = 'rover') =>
      once(`shelter:${kind}`, () =>
        canvas(30, 30, (ctx) => {
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.fillStyle = token('--map-start-fill');
          ctx.strokeStyle = token('--map-start-ring');
          ctx.lineWidth = 2;
          const body = new Path2D('M15 1.8 27.8 9.2 27.8 20.8 15 28.2 2.2 20.8 2.2 9.2Z');
          ctx.fill(body);
          ctx.stroke(body);
          ctx.lineWidth = 1.6;
          ctx.stroke(new Path2D(SHELTER_GLYPHS[kind] ?? SHELTER_GLYPHS.rover));
        }),
      ),
    // A square with a dark ring: the end of a route that does not return to the shelter.
    finish: () =>
      once('finish', () =>
        canvas(22, 22, (ctx) => {
          ctx.fillStyle = token('--map-start-fill');
          ctx.strokeStyle = token('--map-start-ring');
          ctx.lineWidth = 2;
          ctx.fillRect(3, 3, 16, 16);
          ctx.strokeRect(3, 3, 16, 16);
          ctx.fillStyle = token('--map-start-ring');
          ctx.fillRect(8, 8, 6, 6);
        }),
      ),
    fork: () =>
      once('fork', () =>
        canvas(18, 18, (ctx) => {
          path(ctx, [[9, 1.5], [16.5, 9], [9, 16.5], [1.5, 9]]);
          ctx.fillStyle = token('--map-fork');
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = token('--map-fork-ring');
          ctx.stroke();
        }),
      ),
    // Pointing up (north) at rotation 0; the overlay rotates it to the bearing.
    chevron: () =>
      once('chevron', () =>
        canvas(18, 18, (ctx) => {
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          const pts: [number, number][] = [[4, 12], [9, 6], [14, 12]];
          for (const [colour, width] of [[token('--map-route-casing'), 5], [token('--map-chevron'), 2.4]] as const) {
            ctx.strokeStyle = colour;
            ctx.lineWidth = width;
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
          }
        }),
      ),
    cave: () =>
      once('cave', () =>
        canvas(12, 12, (ctx) => {
          path(ctx, [[6, 1.5], [11, 10.5], [1, 10.5]]);
          ctx.fillStyle = token('--map-cave');
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = halo;
          ctx.stroke();
        }),
      ),
    high: () => once('high', () => caret(true)),
    low: () => once('low', () => caret(false)),
    // A stroked right-angled wedge for the steepest point.
    steepest: () =>
      once('steepest', () =>
        canvas(16, 16, (ctx) => {
          ctx.lineJoin = 'round';
          for (const [colour, width] of [[halo, 4.5], [text, 2]] as const) {
            ctx.strokeStyle = colour;
            ctx.lineWidth = width;
            path(ctx, [[2.5, 12.5], [13.5, 12.5], [13.5, 3.5]]);
            ctx.stroke();
          }
        }),
      ),
    photo: (count) => {
      const d = count >= 100 ? 8 : count >= 20 ? 6 : 4;
      return once(`photo:${d}`, () =>
        canvas(d, d, (ctx) => {
          ctx.beginPath();
          ctx.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
          ctx.fillStyle = token('--ramp-seq-2');
          ctx.fill();
        }),
      );
    },
    walker: () =>
      once('walker', () =>
        canvas(20, 20, (ctx) => {
          ctx.beginPath();
          ctx.arc(10, 10, 7, 0, Math.PI * 2);
          ctx.fillStyle = token('--map-position');
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = token('--map-position-ring');
          ctx.stroke();
        }),
      ),
  };
}
