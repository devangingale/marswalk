# Performance task evidence — 15/11/2026

Build evidence: `npm run build` passed (`tsc` + Vite, 1,796 modules); `npm test -- --reporter=dot` passed (79 files, 653 tests). Vite reported the existing large-chunk warning. The branch was deployed to `https://sol48-git-dev-perf-pod5.vercel.app/` after pushes `0cd3832` and `77a8ba7`.

| Measure | Production before | Branch preview after |
|---|---|---|
| Black map after view change | Plan/Gale was still entirely black in the screenshot, taken after the page had loaded and Cesium tile requests had run. | The scene showed the colored Mars backdrop instead of black. Cesium then reported the preview token was not allowed, so tile-arrival behavior is unverified. |
| Time to first site imagery | UNKNOWN; no site imagery request/paint was observed. | UNKNOWN; Ion token restriction blocked online tile validation. |
| Time to first whole-planet tile | UNKNOWN in the application. | UNKNOWN in the application. |
| Idle main-thread use | UNKNOWN; no profiler measurement captured. | UNKNOWN; no profiler measurement captured. |
| Panel toggle click-to-paint | UNKNOWN; no stable timing captured. | UNKNOWN; no stable timing captured. |
| 16 KiB PMTiles Range request | Direct R2: 367 ms first / 405 ms repeat (206). | Vercel rewrite: 433 ms first (MISS) / 120 ms repeat (HIT), both 206. Range pass-through and cache HIT confirmed. |
| 32 KiB PNG tile request | Direct R2: 674 ms first / 569 ms repeat. | Vercel rewrite: 513 ms first (MISS) / 363 ms repeat (HIT). Response had `Cache-Control: public, max-age=31536000, immutable` on miss. |

Network timings are single curl samples from this machine in India, so they show the observed requests rather than a benchmark. Repeat-cache headers were also checked: the PMTiles range response was `X-Vercel-Cache: HIT`; JSON manifests returned the configured 300-second cache policy on miss.

Local Vite preview with `?offline=1` rendered Gale/Plan. Switching to Jezero no longer triggered the destroyed-viewer resize exception after the ResizeObserver guard, though Jezero fell back to the sample site specification. The production host still serves the old app: its `/r2/gale/site.json` URL returned the SPA HTML, so the production before/after comparison cannot be completed until a new production deployment. Branch preview online validation also remains blocked by the Cesium token's domain restriction.

Screenshots:

- Before: [production black map](perf-evidence/before-production-black.png)
- After: [preview Mars-colored backdrop](perf-evidence/after-preview-backdrop.png)
