// Written with AI assistance, directed and reviewed by the team.
// Motion maths for walking between panorama stops: the ground cursor's ray-plane hit, picking the
// linked stop a pointer is aimed at, and the glide between stops: one continuous tween in which
// the outgoing panorama warps forward and fades out over the incoming one as it pulls in to rest,
// with a gentle directional motion blur peaking mid-glide.

/** The camera's height above the ground plane, metres (matches EYE_HEIGHT_M). */
export const GROUND_DROP_M = 1.8;
/** The ground cursor is shown only this far out; beyond it the plane is too oblique to aim at. */
export const CURSOR_MAX_M = 30;
/** A pointer within this many degrees of a linked stop's bearing walks to it. */
export const AIM_TOLERANCE_DEG = 35;
/** Furthest the camera travels through either sphere, metres (the spheres are 50 m in radius). */
export const GLIDE_MAX_M = 20;
/** Length of the whole glide, ms. */
export const GLIDE_MS = 850;
/** The incoming panorama starts this fraction of the glide distance behind its centre. */
export const ARRIVE_BACK = 0.7;
/** Peak motion-blur strength (0-1), reached at the middle of the glide. */
export const BLUR_PEAK = 0.45;

export const easeIn = (t: number) => t * t * t;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const wrap = (deg: number) => ((deg % 360) + 360) % 360;

/** Signed smallest turn from one bearing to another, degrees in (-180, 180]. */
export function turn(fromDeg: number, toDeg: number): number {
  const d = wrap(toDeg - fromDeg);
  return d > 180 ? d - 360 : d;
}

/** Bearing part-way from `from` to `to` along the shorter way round. */
export function turnToward(fromDeg: number, toDeg: number, t: number): number {
  return wrap(fromDeg + turn(fromDeg, toDeg) * Math.min(1, Math.max(0, t)));
}

/**
 * Where a view ray from the eye meets the ground plane GROUND_DROP_M below it, in east/north
 * metres, with its compass bearing and distance; null for rays at or above the horizon or beyond
 * CURSOR_MAX_M. `dir` is the ray direction in east-north-up components.
 */
export function groundHit(dir: readonly [number, number, number], maxM = CURSOR_MAX_M) {
  const [e, n, u] = dir;
  if (u >= -1e-3) return null;
  const s = GROUND_DROP_M / -u;
  const east = e * s;
  const north = n * s;
  const distanceM = Math.hypot(east, north);
  if (distanceM > maxM) return null;
  return { east, north, distanceM, bearingDeg: wrap((Math.atan2(east, north) * 180) / Math.PI) };
}

/** The candidate whose bearing is closest to `bearingDeg`, if within the aim tolerance. */
export function aimAt<T extends { bearingDeg: number }>(bearingDeg: number, candidates: T[], toleranceDeg = AIM_TOLERANCE_DEG): T | null {
  let best: T | null = null;
  let bestOff = Infinity;
  for (const c of candidates) {
    const off = Math.abs(turn(bearingDeg, c.bearingDeg));
    if (off <= toleranceDeg && off < bestOff) {
      best = c;
      bestOff = off;
    }
  }
  return best;
}

const smoothstep = (t: number) => {
  const p = Math.min(1, Math.max(0, t));
  return p * p * (3 - 2 * p);
};

export interface GlideMoment {
  /** Linear progress 0-1 and eased (easeInOutCubic) progress 0-1. */
  t: number;
  eased: number;
  /** Camera offset along the travel bearing from the incoming stop's eye, metres (negative: behind it). */
  incomingOffsetM: number;
  /** The camera's offset from the outgoing stop's eye, metres: that panorama warps forward. */
  outgoingOffsetM: number;
  /** Opacity of the outgoing panorama over the incoming one, 1 to 0. */
  outgoingAlpha: number;
  /** Motion-blur strength: 0 at take-off, BLUR_PEAK at mid-glide, 0 on landing. */
  blur: number;
  done: boolean;
}

/**
 * The glide `elapsedMs` after it starts. Both panoramas are drawn throughout: the camera moves
 * forward through the outgoing one (up to `outM`) while it fades out, and the incoming one pulls
 * in from ARRIVE_BACK x `inM` behind its centre to rest. One easeInOutCubic curve drives both.
 */
export function glideAt(elapsedMs: number, outM: number, inM: number, durationMs = GLIDE_MS): GlideMoment {
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const eased = easeInOut(t);
  return {
    t,
    eased,
    incomingOffsetM: -inM * ARRIVE_BACK * (1 - eased),
    outgoingOffsetM: outM * eased,
    outgoingAlpha: 1 - smoothstep(t),
    blur: BLUR_PEAK * Math.sin(Math.PI * t),
    done: t >= 1,
  };
}

/** Radial motion blur toward the screen point being travelled to; `strength` 0 is off. */
export const MOTION_BLUR_GLSL = `
uniform sampler2D colorTexture;
uniform float strength;
uniform vec2 focus;
in vec2 v_textureCoordinates;
void main() {
  vec2 toward = v_textureCoordinates - focus;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    float k = float(i) / 11.0;
    sum += texture(colorTexture, v_textureCoordinates - toward * strength * 0.12 * k);
  }
  out_FragColor = sum / 12.0;
}
`;
