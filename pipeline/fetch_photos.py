"""Build app/public/data/gale/photos.json from Curiosity's public raw-image feed.

Written with AI assistance (Claude), directed and reviewed by the team.
Python standard library only, so it runs on machines without the raw data.

    py pipeline/fetch_photos.py            # fetch (cached) and write photos.json
    py pipeline/fetch_photos.py --refresh  # ignore the page cache

Steps
1. Read shared/poses/gale_poses.csv; keep poses inside the walk area. Those poses,
   in (site, drive) order, are the rover path through the area.
2. Fetch feed metadata for the sols the rover spent there, per camera, in pages
   of 1000 (cached under data/cache/rover_images/, which git ignores).
3. Place each image:
   - Navcam / Hazcam records carry site and drive: join to the pose table.
   - Mastcam (MSSS) records carry neither, only a sol. Such an image is placed
     only when the rover did not move that sol (no pose has that sol), at the
     last pose reached before it. Images from driving sols are dropped.
4. Keep images inside the walk area; thin to at most PER_BIN per BIN_M metres of
   rover path, preferring mast cameras (Mastcam, Navcam) over hazard cameras and
   spreading picks across viewing directions.
5. heading_deg = rover yaw (pose table) + camera azimuth in the rover frame
   (feed field extended.mast_az). The pose table's yaw matches the yaw of the
   feed's own attitude quaternion. Null when the feed gives no azimuth (Mastcam).

Output shape: docs/prd/00-contracts.md section 8.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSES = ROOT / "shared" / "poses" / "gale_poses.csv"
OUT = ROOT / "app" / "public" / "data" / "gale" / "photos.json"
CACHE = ROOT / "data" / "cache" / "rover_images"

# Gale walk area, bounds_lonlat (east lon, planetocentric lat, degrees).
LON_MIN, LON_MAX = 137.36046, 137.42795
LAT_MIN, LAT_MAX = -4.82499, -4.75751

MARS_R = 3396190.0
BIN_M = 50.0
PER_BIN = 20

FEED = "https://mars.nasa.gov/api/v1/raw_image_items/"
PAGE = 1000
UA = "sol48-pipeline/0.1 (+python urllib)"

# instrument -> (display name, priority: lower is preferred, accepted sample types)
CAMERAS = {
    "MAST_LEFT": ("Mastcam Left", 0, {"full"}),
    "NAV_LEFT_B": ("Navcam Left", 1, {"full", "downsampled"}),
    "FHAZ_LEFT_B": ("Front Hazcam Left", 2, {"full", "downsampled"}),
    "RHAZ_LEFT_B": ("Rear Hazcam Left", 2, {"full", "downsampled"}),
}
SAMPLE_RANK = {"full": 0, "downsampled": 1}


def inside(lon: float, lat: float) -> bool:
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def load_poses():
    """All poses keyed by (site, drive), plus the in-area path with distance along it."""
    poses = {}
    with POSES.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            key = (int(r["site"]), int(r["drive"]))
            poses[key] = {
                "sol": int(r["sol"]),
                "lon": float(r["lon"]),
                "lat": float(r["lat"]),
                "heading": float(r["heading_deg"]) if r["heading_deg"] else None,
            }
    lat_c = math.radians((LAT_MIN + LAT_MAX) / 2)
    path, dist, prev = {}, 0.0, None
    for key in sorted(poses):
        p = poses[key]
        if not inside(p["lon"], p["lat"]):
            prev = None  # leaving the area breaks the path; distance carries on
            continue
        x = MARS_R * math.cos(lat_c) * math.radians(p["lon"] - LON_MIN)
        y = MARS_R * math.radians(p["lat"] - LAT_MIN)
        if prev is not None:
            dist += math.hypot(x - prev[0], y - prev[1])
        prev = (x, y)
        path[key] = dist
    return poses, path


def stationary_sols(poses, path):
    """sol -> pose key, for sols on which the rover did not move.

    A pose's sol is the sol the rover reached it. If no pose carries sol N,
    the rover sat all of sol N at the last pose reached before N.
    """
    by_sol = sorted((p["sol"], key) for key, p in poses.items())
    moved = {s for s, _ in by_sol}
    out = {}
    for (s, key), nxt in zip(by_sol, by_sol[1:] + [(None, None)]):
        if key not in path:
            continue
        end = nxt[0] if nxt[0] is not None else s + 1
        for n in range(s + 1, end):
            if n not in moved:
                out[n] = key
    return out


def fetch_pages(instrument, sol_min, sol_max, refresh):
    """Yield feed items for one instrument and sol range, page by page (cached)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    page = 0
    while True:
        cache = CACHE / f"msl_{instrument}_{sol_min}_{sol_max}_p{page:04d}.json"
        if cache.exists() and not refresh:
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            q = urllib.parse.urlencode({
                "order": "sol desc",
                "per_page": PAGE,
                "page": page,
                "condition_1": "msl:mission",
                "condition_2": f"{sol_min}:sol:gte",
                "condition_3": f"{sol_max}:sol:lte",
                "condition_4": f"{instrument}:instrument",
            })
            data = get_json(f"{FEED}?{q}")
            cache.write_text(json.dumps(data), encoding="utf-8")
        items = data.get("items") or []
        if page == 0:
            print(f"  {instrument}: {data.get('total', 0)} records", file=sys.stderr)
        yield from items
        if not data.get("more") or not items:
            return
        page += 1


def get_json(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # network hiccups: back off and retry
            if i == tries - 1:
                raise
            print(f"  retry {i + 1} after {e}", file=sys.stderr)
            time.sleep(2 ** i * 3)


def thumb_url(url, instrument):
    # JPL-processed engineering-camera images publish a "-thm" thumbnail beside
    # the full image. MSSS Mastcam images do not, so use the image itself.
    if instrument.startswith("MAST"):
        return url
    stem, dot, ext = url.rpartition(".")
    return f"{stem}-thm.{ext}" if dot else url


def to_float(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def place(item, poses, path, still):
    """Return (pose key, heading or None), or None if the image cannot be placed."""
    site, drive = item.get("site"), item.get("drive")
    if site is not None and drive is not None:
        key = (int(site), int(drive))
        if key not in path:
            return None
        yaw, az = poses[key]["heading"], to_float(item["extended"].get("mast_az"))
        heading = round((yaw + az) % 360, 1) if yaw is not None and az is not None else None
        return key, heading
    key = still.get(item["sol"])
    return (key, None) if key else None


def thin(cands):
    """At most PER_BIN per BIN_M of path: best camera first, spread over directions."""
    bins = defaultdict(list)
    for c in cands:
        bins[int(c["_dist"] // BIN_M)].append(c)
    keep = []
    for b in sorted(bins):
        group = sorted(bins[b], key=lambda c: (c["_prio"], c["_sample"], -c["sol"], c["id"]))
        # Round-robin over 8 direction sectors (unknown heading is its own sector)
        # so a bin is not filled by one panorama facing one way.
        sectors = defaultdict(list)
        order = []
        for c in group:
            s = None if c["heading_deg"] is None else int(c["heading_deg"] // 45)
            if s not in sectors:
                order.append(s)
            sectors[s].append(c)
        picked = []
        while len(picked) < PER_BIN and any(sectors[s] for s in order):
            for s in order:
                if sectors[s] and len(picked) < PER_BIN:
                    picked.append(sectors[s].pop(0))
        keep.extend(sorted(picked, key=lambda c: (c["_dist"], c["id"])))
    return keep


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--refresh", action="store_true", help="ignore cached feed pages")
    args = ap.parse_args()

    poses, path = load_poses()
    if not path:
        sys.exit("no poses inside the walk area")
    sols = [poses[k]["sol"] for k in path]
    sol_min, sol_max = min(sols), max(sols)
    still = stationary_sols(poses, path)
    print(f"{len(path)} poses in area, sols {sol_min}-{sol_max}, "
          f"path {max(path.values()):.0f} m, {len(still)} stationary sols", file=sys.stderr)

    cands, seen, counts = [], set(), defaultdict(int)
    for inst, (name, prio, samples) in CAMERAS.items():
        # A stationary sol can run one past the last arrival sol.
        hi = sol_max + 1 if inst.startswith("MAST") else sol_max
        for it in fetch_pages(inst, sol_min, hi, args.refresh):
            counts["records"] += 1
            sample = (it.get("extended") or {}).get("sample_type")
            if sample not in samples or it.get("imageid") in seen:
                continue
            placed = place(it, poses, path, still)
            if not placed:
                continue
            key, heading = placed
            p = poses[key]
            if not inside(p["lon"], p["lat"]):
                continue
            url = it.get("https_url") or it.get("url")
            if not url:
                continue
            seen.add(it["imageid"])
            counts[inst] += 1
            cands.append({
                "id": it["imageid"],
                "lon": round(p["lon"], 6),
                "lat": round(p["lat"], 6),
                "heading_deg": heading,
                "sol": it["sol"],
                "camera": name,
                "url": url,
                "thumb": thumb_url(url, inst),
                "credit": it.get("image_credit") or "NASA/JPL-Caltech",
                "_dist": path[key],
                "_prio": prio,
                "_sample": SAMPLE_RANK.get(sample, 9),
            })

    print(f"{counts['records']} records read; placed in area: "
          + ", ".join(f"{k} {counts[k]}" for k in CAMERAS), file=sys.stderr)
    if not cands:
        sys.exit("feed returned no usable records; photos.json not written")

    photos = [{k: v for k, v in c.items() if not k.startswith("_")} for c in thin(cands)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # One photo per line: compact for the app bundle, readable in diffs.
    lines = ",\n".join(json.dumps(p, separators=(",", ":")) for p in photos)
    OUT.write_text(f"[\n{lines}\n]\n", encoding="utf-8")
    by_cam = defaultdict(int)
    for p in photos:
        by_cam[p["camera"]] += 1
    print(f"wrote {len(photos)} photos to {OUT.relative_to(ROOT)}: "
          + ", ".join(f"{k} {v}" for k, v in sorted(by_cam.items())), file=sys.stderr)


if __name__ == "__main__":
    main()
