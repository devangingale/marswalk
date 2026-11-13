// Contrast check for app/src/styles/tokens.css.
// Run: node docs/design/check-contrast.mjs
// WCAG 2.x relative luminance and contrast ratio. Semi-transparent colours are composited
// over the background they sit on before measuring. Exits 1 if any pair is below its target
// or if the two copies of the dark theme have drifted apart.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../app/src/styles/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function block(selectorRe) {
  const m = css.match(selectorRe);
  if (!m) throw new Error("block not found: " + selectorRe);
  let depth = 0, i = m.index + m[0].length - 1, start = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }
  const out = {};
  for (const d of css.slice(start, i).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

const base = block(/:root\s*\{/);
const light = block(/:root,\s*\[data-theme="light"\]\s*\{/);
const dark = block(/\n\[data-theme="dark"\]\s*\{/);
const darkMedia = block(/:root:not\(\[data-theme="light"\]\)\s*\{/);

let failures = 0;
for (const k of new Set([...Object.keys(dark), ...Object.keys(darkMedia)])) {
  if (dark[k] !== darkMedia[k]) { console.log(`DRIFT ${k}: ${dark[k]} vs ${darkMedia[k]}`); failures++; }
}

function parse(c) {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(",").map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error("cannot parse colour " + c);
}
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Terrain samples for the map and visor. HiRISE colour at Mount Sharp spans pale dust to dark sand;
// pure white and black bracket anything the imagery can show.
const terrain = {
  "white (worst case)": "#ffffff",
  "bright dust": "#e6c9a3",
  "mid ochre": "#b4875e",
  "dark sand": "#3b2e26",
  "black (worst case)": "#000000",
};

const rows = [];
function check(group, label, fg, bg, target, bgUnder) {
  let f = parse(fg), b = parse(bg);
  if (b[3] < 1) b = over(b, parse(bgUnder));
  if (f[3] < 1) f = over(f, b);
  const r = ratio(f, b);
  const ok = r >= target;
  if (!ok) failures++;
  rows.push([group, label, r.toFixed(2), target, ok ? "pass" : "FAIL"]);
}

for (const [name, t] of [["light", light], ["dark", dark]]) {
  const surfaces = ["--color-bg", "--color-surface", "--color-surface-raised"];
  for (const s of surfaces) {
    check(name, `text on ${s}`, t["--color-text"], t[s], 4.5);
    check(name, `text-muted on ${s}`, t["--color-text-muted"], t[s], 4.5);
    check(name, `control-border on ${s}`, t["--color-control-border"], t[s], 3);
    check(name, `accent on ${s}`, t["--color-accent"], t[s], 4.5);
    for (const st of ["ok", "caution", "danger"]) check(name, `${st} text on ${s}`, t[`--color-${st}`], t[s], 4.5);
    check(name, `focus-inner on ${s}`, t["--color-focus-inner"], t[s], 3);
  }
  check(name, "text on surface-sunken", t["--color-text"], t["--color-surface-sunken"], 4.5);
  check(name, "text-muted on surface-sunken", t["--color-text-muted"], t["--color-surface-sunken"], 4.5);
  check(name, "accent-text on accent", t["--color-accent-text"], t["--color-accent"], 4.5);
  check(name, "text on accent-subtle", t["--color-text"], t["--color-accent-subtle"], 4.5);
  check(name, "accent on accent-subtle", t["--color-accent"], t["--color-accent-subtle"], 4.5);
  for (const st of ["ok", "caution", "danger"]) check(name, `${st} on ${st}-subtle`, t[`--color-${st}`], t[`--color-${st}-subtle`], 4.5);
  // Status colours must also differ from each other in lightness, not only hue.
  check(name, "lightness: caution vs ok", t["--color-caution"], t["--color-ok"], 1.4);
  check(name, "lightness: ok vs danger", t["--color-ok"], t["--color-danger"], 1.4);
  check(name, "lightness: caution vs danger", t["--color-caution"], t["--color-danger"], 2);
}

// Map: every mark has a two-tone edge, so on any ground at least one of its edges reaches 3:1.
for (const [tn, tc] of Object.entries(terrain)) {
  const casing = ratio(parse(base["--map-route-casing"]), parse(tc));
  const core = ratio(parse(base["--map-route-core"]), parse(tc));
  const best = Math.max(casing, core);
  rows.push(["map", `route edge on ${tn} (best of core ${core.toFixed(2)}, casing ${casing.toFixed(2)})`, best.toFixed(2), 3, best >= 3 ? "pass" : "FAIL"]);
  if (best < 3) failures++;
}
check("map", "route core vs casing", base["--map-route-core"], base["--map-route-casing"], 3);
check("map", "walked vs casing", base["--map-route-walked"], base["--map-route-casing"], 3);
check("map", "lightness: route ahead vs walked", base["--map-route-walked"], base["--map-route-core"], 1.3);
check("map", "stop number on stop fill", base["--map-stop-text"], base["--map-stop-fill"], 4.5);
check("map", "selected stop number", base["--map-stop-selected-text"], base["--map-stop-selected-fill"], 4.5);
check("map", "turn-back notch vs ring", base["--map-turnback"], base["--map-turnback-ring"], 3);
for (const [tn, tc] of Object.entries(terrain)) check("map", `impassable stripe vs gap over ${tn}`, base["--map-impassable"], base["--map-impassable-gap"], 3, tc);
check("map", "label text vs halo", base["--map-label-text"], base["--map-label-halo"], 4.5);

// Visor: plates sit over the terrain; measure text on the plate composited over each ground.
for (const [tn, tc] of Object.entries(terrain)) {
  check("visor", `text on plate over ${tn}`, base["--visor-text"], base["--visor-plate"], 7, tc);
  check("visor", `muted on plate over ${tn}`, base["--visor-text-muted"], base["--visor-plate"], 4.5, tc);
  check("visor", `accent on plate over ${tn}`, base["--visor-accent"], base["--visor-plate"], 4.5, tc);
  check("visor", `caution on plate over ${tn}`, base["--visor-caution"], base["--visor-plate"], 4.5, tc);
  check("visor", `hazard on plate over ${tn}`, base["--visor-hazard"], base["--visor-plate"], 3, tc);
}
check("visor", "hazard-text on hazard fill", base["--visor-hazard-text"], base["--visor-hazard"], 4.5);

const w = [8, 72, 7, 7];
console.log(["group", "pair", "ratio", "target", "result"].map((s, i) => String(s).padEnd(w[i] ?? 0)).join(" "));
for (const r of rows) console.log(r.map((s, i) => String(s).padEnd(w[i] ?? 0)).join(" "));
console.log(failures ? `\n${failures} failure(s)` : "\nAll pairs pass.");
process.exit(failures ? 1 : 0);
