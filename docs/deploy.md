# Production deploy

The live app is a static site on **Cloudflare Pages**. Its data lives in a **Cloudflare R2**
bucket that the app reads directly:

| What | Produced by | Where it runs | R2 key |
|---|---|---|---|
| Site bundles: tiles, `site.json`, route grids (`grid.json`, `elev.bin`, `cost.bin`) | `derive.py`, `coarse.py`, `walkability.py`, `bake.py` | Coordinator machine (needs the 45 GB datasets in `data/raw`) | `gale/…`, `jezero/…` |
| Relay passes (MRO, Mars Odyssey) | `fetch_spice.py`, `passes.py` | GitHub Actions, daily | `gale/passes.json`, `jezero/passes.json`, `passes/<site>.json` |
| 360° panoramas: `panoramas.json`, 2:1 textures | `build_panoramas.py` | GitHub Actions, daily | `panoramas.json`, `panos/*.jpg` |
| The app | `npm run build` | GitHub Actions, every push to `main` | (Cloudflare Pages) |

Two workflows keep it running:

- `.github/workflows/deploy-pages.yml` builds, tests and deploys the app on every push to `main`.
- `.github/workflows/refresh-data.yml` runs daily at 06:17 UTC (or on demand). It fetches the current NAIF kernels, recomputes 30 days of passes, rebuilds the panoramas and syncs them to R2. The app picks the new data up without a redeploy.

The 3D Mars terrain is the **Cesium Mars 3D Tiles** asset (Cesium ion asset 3644333), streamed by the app when `VITE_CESIUM_ION_TOKEN` is set. It covers the whole planet, so every one of the 60 known sites gets real relief in the globe and in the eye-level orbital view. (`Cesium.createWorldTerrainAsync` is Earth terrain and is not used.)

## One-time setup

Run from the repository root. Wrangler is used through `npx` at a pinned version.

### 1. R2 bucket with public read and CORS

```sh
npx --yes wrangler@4.162.0 login
npx --yes wrangler@4.162.0 r2 bucket create sol48-mars-tiles
npx --yes wrangler@4.162.0 r2 bucket cors set sol48-mars-tiles --file pipeline/r2-cors.json
npx --yes wrangler@4.162.0 r2 bucket dev-url enable sol48-mars-tiles
```

`pipeline/r2-cors.json` allows `GET` and `HEAD` from any origin with the `Range` header, which PMTiles needs, and exposes `ETag`, `Content-Range` and `Content-Length`. The panorama textures are loaded with `crossOrigin="anonymous"` and depend on this rule; without it the 360° view reports that the photo did not load.

The `dev-url enable` command prints the public `https://pub-<hash>.r2.dev` URL. That URL is rate-limited by Cloudflare. For sustained production traffic, connect a custom domain to the bucket in the Cloudflare dashboard (R2 → bucket → Settings → Custom Domains) and use that URL instead. Either way, it is the value of `VITE_R2_BASE_URL`, with no trailing slash.

### 2. Cesium ion token

1. Create a token at <https://ion.cesium.com/tokens> with the `assets:read` scope.
2. Under **Allowed URLs**, list the production domain.
3. Restrict it to asset 3644333.

The token is compiled into the public JavaScript, as every `VITE_` value is. These restrictions are what protect it.

### 3. Cloudflare Pages project and API token

```sh
npx --yes wrangler@4.162.0 pages project create marswalk --production-branch main
```

Then create a Cloudflare API token (dashboard → My Profile → API Tokens) with **Account → Cloudflare Pages → Edit** and **Account → Workers R2 Storage → Edit**. Note the account ID from the dashboard sidebar.

### 4. GitHub repository settings

Create an environment named `production` (Settings → Environments) and add the following:

| Name | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | the API token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | secret | the Cloudflare account ID |
| `VITE_CESIUM_ION_TOKEN` | secret | the ion token from step 2 |
| `VITE_R2_BASE_URL` | variable | the public R2 URL, no trailing slash |
| `R2_BUCKET` | variable | `sol48-mars-tiles` |
| `CF_PAGES_PROJECT` | variable | `marswalk` |
| `VITE_GLOBE_BASE` | variable, optional | URL of the whole-planet layer set, if hosted outside the app |

The deploy workflow refuses to run without `VITE_R2_BASE_URL`. It also checks that the URL already serves a valid `panoramas.json`, so run the data refresh (step 6) before the first deploy.

### 5. Site bundles from the coordinator machine

These steps need the raw datasets in `data/raw` and the `gdal-env` environment, so they do not run in CI. Rerun them whenever the terrain or layer inputs change.

```sh
python pipeline/derive.py gale          # crop DEM and image, slope, roughness, curvature
python pipeline/coarse.py gale          # thermal, mineral, dust layers at true resolution
python pipeline/walkability.py train gale
python pipeline/walkability.py apply gale
python pipeline/bake.py gale            # PMTiles, site.json, route grids -> data/sites/gale/bundle
python pipeline/derive.py jezero
python pipeline/walkability.py apply jezero
python pipeline/bake.py jezero

python pipeline/build_panoramas.py      # now samples walkability and slope from the full grids
R2_BUCKET=sol48-mars-tiles python pipeline/upload_r2.py --site all --surface360
```

Only a coordinator run fills in each stop's walkability and slope, because the CI job has no grids. The daily refresh keeps those values: it builds with `--previous <R2 URL>/panoramas.json` and carries forward the published walkability for every stop that has not moved. A stop whose pose changes is recomputed on the next coordinator run, never reused.

### 6. First data refresh and first deploy

1. Run **Refresh orbiter passes and panoramas** from the Actions tab (Run workflow). On its first run it downloads about 290 MB of SPICE kernels and about 1 GB of full-resolution Photojournal mosaics (into `.cache/nasa_panos/`). Both are cached, so later runs fetch only what is new.
2. Check that `https://<R2 URL>/panoramas.json` returns its stops (40 at the time of writing).
3. Push to `main`, or run **Deploy app** from the Actions tab.

## Running continuously

- **Passes:** NAIF refreshes `mro_psp.bsp` and `m01_map.bsp` every few days with a short prediction. The daily job re-downloads only kernels whose `Last-Modified` or size changed (`data/raw/naif_spice/kernels.meta.json`), and clamps each window to the kernels' coverage, recorded in each bundle's `source.coverage`. If the job stops, the HUD reports when the clock leaves the computed window rather than showing a stale pass.
- **Panoramas:** each refresh searches the NASA Images API for newly published 360° Curiosity and Perseverance mosaics. A new one is published automatically if its caption states a sol inside the rover's pose table and the image is at least 2.2:1. To add a mosaic discovery misses, add a caption-verified entry under `curated` in `pipeline/panoramas.sources.json`; to drop one, add it under `exclude` with the reason.
- **App:** every merge to `main` redeploys.

## Local development

```sh
cd app
cp .env.example .env.local   # optional: add VITE_CESIUM_ION_TOKEN for 3D terrain
npm ci
npm run dev                  # http://localhost:5173/?globe=1
```

In development, the app reads `app/public/panoramas.json`, `app/public/panos/` and `app/public/passes/` from the dev server, and site bundles from `/local-bundles` (`data/sites/<site>/bundle`). To refresh those local copies, run the same pipeline commands as in "Running continuously" without the upload. Python 3.12 and `pip install -r pipeline/requirements-ci.txt` are enough for everything but the DEM steps.

## Manual uploads

```sh
python pipeline/upload_r2.py --site all --surface360 --dry-run   # list keys, types, cache headers
R2_BUCKET=sol48-mars-tiles python pipeline/upload_r2.py --site gale
```

Every put passes `--remote`. Wrangler 4 otherwise writes to its local development store, and nothing reaches the bucket. JSON uploads get `Cache-Control: public, max-age=300`; images and tiles get one day.

## Deployment artifacts

Vite builds hidden source maps for local debugging (`sourcemap: 'hidden'`). The deploy workflow deletes all `*.map` files before uploading; the JavaScript bundles do not reference them.
