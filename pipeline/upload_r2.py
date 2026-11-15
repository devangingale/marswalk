#!/usr/bin/env python3
"""Upload published bundles to a Cloudflare R2 bucket with Wrangler.

Written with AI assistance, directed and reviewed by the team.

  --site gale|jezero|all   data/sites/<site>/bundle/* -> <site>/<file>   (tiles, grids, passes.json)
  --only NAME [NAME ...]   restrict --site uploads to these file names (CI pushes only passes.json)
  --surface360             app/public/panoramas.json, panos/*.jpg, passes/*.json -> same keys at the bucket root

Credentials: on a workstation, `npx wrangler login`; in CI, the CLOUDFLARE_API_TOKEN and
CLOUDFLARE_ACCOUNT_ID environment variables. Every put passes --remote: Wrangler 4 otherwise
writes to its local development store, not the bucket.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SITES_DIR = ROOT / "data" / "sites"
APP_PUBLIC = ROOT / "app" / "public"
# Pinned so a Wrangler release cannot change upload behaviour under a scheduled job.
WRANGLER = os.environ.get("WRANGLER", "wrangler@4.162.0")
CONTENT_TYPES = {
    ".json": "application/json",
    ".pmtiles": "application/vnd.pmtiles",
    ".bin": "application/octet-stream",
    ".jpg": "image/jpeg",
    ".png": "image/png",
}
# Manifests and passes change on every refresh; images and tiles rarely do.
SHORT_CACHE = "public, max-age=300"
LONG_CACHE = "public, max-age=86400"


def cache_control(path: Path) -> str:
    return SHORT_CACHE if path.suffix.lower() == ".json" else LONG_CACHE


def site_files(sites: tuple[str, ...], only: set[str] | None, parser: argparse.ArgumentParser) -> list[tuple[str, Path]]:
    files = []
    for site in sites:
        bundle = SITES_DIR / site / "bundle"
        if not bundle.is_dir():
            parser.error(f"bundle directory not found: {bundle}")
        for path in sorted(item for item in bundle.iterdir() if item.is_file()):
            if only is None or path.name in only:
                files.append((f"{site}/{path.name}", path))
    return files


def surface360_files(parser: argparse.ArgumentParser) -> list[tuple[str, Path]]:
    manifest = APP_PUBLIC / "panoramas.json"
    if not manifest.exists():
        parser.error(f"{manifest} not found; run pipeline/build_panoramas.py first")
    files = [("panoramas.json", manifest)]
    for folder in ("panos", "passes"):
        for path in sorted((APP_PUBLIC / folder).glob("*")):
            if path.is_file() and path.suffix.lower() in CONTENT_TYPES:
                files.append((f"{folder}/{path.name}", path))
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--site", choices=("gale", "jezero", "all"))
    parser.add_argument("--only", nargs="+", help="with --site: upload only these bundle file names")
    parser.add_argument("--surface360", action="store_true", help="upload panoramas.json, panos/ and passes/")
    parser.add_argument("--dry-run", action="store_true", help="list uploads without calling Wrangler")
    args = parser.parse_args()
    if not args.site and not args.surface360:
        parser.error("choose --site and/or --surface360")
    if args.only and not args.site:
        parser.error("--only applies to --site uploads")

    bucket = os.environ.get("R2_BUCKET")
    if not args.dry_run and not bucket:
        parser.error("set R2_BUCKET to the destination bucket name")

    files: list[tuple[str, Path]] = []
    if args.site:
        sites = ("gale", "jezero") if args.site == "all" else (args.site,)
        files += site_files(sites, set(args.only) if args.only else None, parser)
    if args.surface360:
        files += surface360_files(parser)
    if not files:
        parser.error("nothing to upload")

    for key, path in files:
        content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
        command = [
            "npx", "--yes", WRANGLER, "r2", "object", "put", f"{bucket or '<R2_BUCKET>'}/{key}",
            "--file", str(path), "--content-type", content_type,
            "--cache-control", cache_control(path), "--remote",
        ]
        if args.dry_run:
            print(f"{key}  {content_type}  {cache_control(path)}  ({path.stat().st_size} bytes)")
        else:
            print(f"Uploading {key} ({content_type})", flush=True)
            subprocess.run(command, cwd=ROOT, check=True)

    print(f"{'Would upload' if args.dry_run else 'Uploaded'} {len(files)} files")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        print(f"Wrangler upload failed with exit code {error.returncode}", file=sys.stderr)
        raise SystemExit(error.returncode)
