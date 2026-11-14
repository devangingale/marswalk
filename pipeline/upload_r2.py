#!/usr/bin/env python3
"""Upload a published site bundle to a Cloudflare R2 bucket with Wrangler."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SITES_DIR = ROOT / "data" / "sites"
CONTENT_TYPES = {
    ".json": "application/json",
    ".pmtiles": "application/vnd.pmtiles",
    ".bin": "application/octet-stream",
    ".jpg": "image/jpeg",
    ".png": "image/png",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", choices=("gale", "jezero", "all"), required=True)
    parser.add_argument("--dry-run", action="store_true", help="list uploads without calling Wrangler")
    args = parser.parse_args()

    bucket = os.environ.get("R2_BUCKET")
    if not args.dry_run and not bucket:
        parser.error("set R2_BUCKET to the destination bucket name")

    sites = ("gale", "jezero") if args.site == "all" else (args.site,)
    files: list[tuple[str, Path, str]] = []
    for site in sites:
        bundle = SITES_DIR / site / "bundle"
        if not bundle.is_dir():
            parser.error(f"bundle directory not found: {bundle}")
        for path in sorted(item for item in bundle.iterdir() if item.is_file()):
            content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
            files.append((site, path, content_type))

    if not files:
        parser.error("no files found in selected bundle(s)")

    for site, path, content_type in files:
        key = f"{site}/{path.name}"
        target = f"{bucket or '<R2_BUCKET>'}/{key}"
        command = [
            "npx", "wrangler", "r2", "object", "put", target,
            "--file", str(path), "--content-type", content_type,
        ]
        if args.dry_run:
            print(f"{key}  {content_type}  ({path.stat().st_size} bytes)")
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
