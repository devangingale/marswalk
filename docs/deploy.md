# Production deploy

Run these commands from the repository root in PowerShell. Wrangler and Vercel must be available through `npx`.

```powershell
npx wrangler login
npx wrangler r2 bucket create sol48-mars-tiles
npx wrangler r2 bucket cors set sol48-mars-tiles --file pipeline/r2-cors.json
npx wrangler r2 bucket dev-url enable sol48-mars-tiles
$env:R2_BUCKET = "sol48-mars-tiles"
python pipeline/upload_r2.py --site all
```

Copy the public `r2.dev` URL reported by Wrangler. From `app/`, link Vercel under the personal account, set the production tile base to that URL, then deploy:

Replace `PERSONAL_ACCOUNT_SLUG` with Dev's personal Vercel account slug.

```powershell
Set-Location app
npx vercel link --scope "PERSONAL_ACCOUNT_SLUG"
npx vercel env add VITE_TILES_BASE production
npx vercel --prod
```

When prompted for `VITE_TILES_BASE`, paste the public `r2.dev` URL without a trailing slash. Confirm the linked Vercel scope is the personal account before deploying.
