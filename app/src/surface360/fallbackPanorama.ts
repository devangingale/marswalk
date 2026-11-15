// Written with AI assistance, directed and reviewed by the team.
// A 2:1 equirectangular Martian horizon drawn on a canvas, shown while a stop's photo loads
// or when it fails. It is plainly synthetic: dusty sky, a far crater rim, scattered rocks and
// compass letters on the horizon at their true bearings, so orientation can be checked.
import { columnForBearing, type PanoramaStop } from './panoramas';

export const FALLBACK_WIDTH = 2048;
export const FALLBACK_HEIGHT = 1024;

/** Small deterministic generator so each stop gets the same horizon every time. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fallbackPanorama(stop: PanoramaStop, width = FALLBACK_WIDTH, height = FALLBACK_HEIGHT): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const rand = seeded(stop.id);
  const horizon = height / 2;

  // Sky: butterscotch near the horizon, darker toward the zenith.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#3b2a22');
  sky.addColorStop(0.55, '#a7764f');
  sky.addColorStop(1, '#d9a777');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  // Ground: lit rust toward the horizon, darker at the feet.
  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, '#9c5a35');
  ground.addColorStop(0.4, '#7a4128');
  ground.addColorStop(1, '#3d2014');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, width, height - horizon);

  // Far crater rim: a low ridge that wraps seamlessly at the image edges.
  const waves = Array.from({ length: 5 }, (_, i) => ({ k: i + 1 + Math.floor(rand() * 3), a: rand() * 14 + 4, p: rand() * Math.PI * 2 }));
  ctx.fillStyle = '#87553a';
  ctx.beginPath();
  ctx.moveTo(0, horizon + 2);
  for (let x = 0; x <= width; x += 4) {
    const t = (x / width) * Math.PI * 2;
    const y = waves.reduce((sum, w) => sum + w.a * Math.sin(w.k * t + w.p), 0);
    ctx.lineTo(x, horizon - 10 - Math.abs(y));
  }
  ctx.lineTo(width, horizon + 2);
  ctx.closePath();
  ctx.fill();

  // Dust grain.
  for (let i = 0; i < 9000; i++) {
    const y = horizon + rand() ** 1.6 * (height - horizon);
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,220,180,0.06)' : 'rgba(30,12,6,0.10)';
    ctx.fillRect(rand() * width, y, 2, 2);
  }

  // Rocks: larger and lower in the frame the closer they are.
  for (let i = 0; i < 160; i++) {
    const depth = rand();
    const y = horizon + 6 + depth ** 2 * (height - horizon - 40);
    const r = 1.5 + depth ** 2 * 26;
    const x = rand() * width;
    ctx.fillStyle = `rgba(${48 + rand() * 30}, ${24 + rand() * 12}, ${14 + rand() * 8}, 0.9)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * (1.2 + rand()), r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 210, 170, 0.18)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.2, r * 0.6, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Compass letters at their true bearings, and a ring of ticks every 30°.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (let bearing = 0; bearing < 360; bearing += 30) {
    const x = columnForBearing(stop.heading, bearing) * width;
    const cardinal = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[bearing];
    ctx.fillStyle = 'rgba(255, 244, 230, 0.55)';
    ctx.fillRect(x - 1, horizon - (cardinal ? 70 : 40), 2, cardinal ? 30 : 14);
    ctx.font = cardinal ? '600 34px Barlow, Arial, sans-serif' : '500 18px Barlow, Arial, sans-serif';
    ctx.fillText(cardinal ?? String(bearing), x, horizon - (cardinal ? 74 : 44));
  }

  ctx.font = '500 20px Barlow, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255, 244, 230, 0.6)';
  ctx.textBaseline = 'top';
  const caption = `Synthetic horizon · no photo loaded · ${stop.name}`;
  for (const bearing of [stop.heading, stop.heading + 120, stop.heading - 120]) {
    ctx.fillText(caption, columnForBearing(stop.heading, bearing) * width, horizon + 120);
  }
  return canvas;
}
