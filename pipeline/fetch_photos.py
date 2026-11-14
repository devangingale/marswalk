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
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
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
M2020_FEED = "https://mars.nasa.gov/rss/api/"
CURLEXE = shutil.which("curl.exe") or shutil.which("curl")
M2020_CAMERAS = {
    "MCZ_LEFT": ("Mastcam-Z Left", 0),
    "MCZ_RIGHT": ("Mastcam-Z Right", 0),
    "NAVCAM_LEFT": ("Navcam Left", 1),
    "NAVCAM_RIGHT": ("Navcam Right", 1),
}

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


def atomic_write_text(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(value, encoding="utf-8")
    tmp.replace(path)


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
            atomic_write_text(cache, json.dumps(data))
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


def fetch_jezero_page(page, sol_min, sol_max, cache_dir):
    cache = cache_dir / f"m2020_jezero_{sol_min}_{sol_max}_p{page:04d}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    query = urllib.parse.urlencode({
        "feed": "raw_images",
        "category": "mars2020",
        "feedtype": "json",
        "ver": "1.2",
        "num": 100,
        "page": page,
        "order": "sol asc",
        "condition_2": f"{sol_min}:sol:gte",
        "condition_3": f"{sol_max}:sol:lte",
        "search": "|NAVCAM_LEFT|NAVCAM_RIGHT|MCZ_LEFT|MCZ_RIGHT",
    })
    url = f"{M2020_FEED}?{query}"
    last_error = None
    for attempt in range(3):
        try:
            if CURLEXE:
                response = subprocess.run(
                    [CURLEXE, "--fail", "--silent", "--show-error", "--location", "--max-time", "45", "--user-agent", UA, url],
                    check=True, capture_output=True, text=True, timeout=50,
                )
                data = json.loads(response.stdout)
            else:
                request = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(request, timeout=45) as response:
                    data = json.loads(response.read().decode("utf-8"))
            atomic_write_text(cache, json.dumps(data, separators=(",", ":")))
            return data
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Perseverance feed page {page} failed: {last_error}")


def fetch_jezero(cache_only=False):
    """Fetch Perseverance images at Jezero poses and write the section 8 contract."""
    poses_path = ROOT / "shared" / "poses" / "jezero_poses.csv"
    output_path = ROOT / "app" / "public" / "data" / "jezero" / "photos.json"
    cache_dir = ROOT / "data" / "cache" / "rover_images"
    cache_dir.mkdir(parents=True, exist_ok=True)
    left, bottom, right, top = 4587000.0, 1092300.0, 4591000.0, 1096300.0
    margin_m = 150.0

    positions = {}
    path_distance = {}
    previous = None
    with poses_path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            key = (int(row["site"]), int(row["drive"]))
            lon, lat = float(row["lon"]), float(row["lat"])
            x = MARS_R * math.cos(math.radians(18.46)) * math.radians(lon)
            y = MARS_R * math.radians(lat)
            if previous is not None:
                path_distance[key] = path_distance.get(previous[0], 0.0) + math.hypot(x - previous[1], y - previous[2])
            else:
                path_distance[key] = 0.0
            previous = (key, x, y)
            if left - margin_m <= MARS_R * math.radians(lon) <= right + margin_m and bottom - margin_m <= y <= top + margin_m:
                positions[key] = {
                    "lon": lon,
                    "lat": lat,
                    "heading": to_float(row.get("heading_deg")),
                    "distance": path_distance[key],
                }
    if not positions:
        raise RuntimeError("no Perseverance poses inside the Jezero photo area")

    all_rows = []
    with poses_path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            key = (int(row["site"]), int(row["drive"]))
            if key in positions:
                all_rows.append((int(row["sol"]), key))
    sol_min = min(sol for sol, _ in all_rows)
    sol_max = max(sol for sol, _ in all_rows)
    cache_dir.mkdir(parents=True, exist_ok=True)
    first_cache = cache_dir / f"m2020_jezero_{sol_min}_{sol_max}_p0000.json"
    if cache_only:
        if not first_cache.exists():
            raise RuntimeError("no cached Perseverance feed pages are available")
        first = json.loads(first_cache.read_text(encoding="utf-8"))
    else:
        first = fetch_jezero_page(0, sol_min, sol_max, cache_dir)
    total = int(first.get("total_results", 0))
    per_page = int(first.get("per_page", 100))
    page_count = math.ceil(total / per_page)
    pages = {0: first}
    workers = min(48, max(4, (page_count + 34) // 35))
    print(f"Perseverance feed: sols {sol_min}-{sol_max}, {total:,} camera records, {page_count:,} pages", file=sys.stderr)
    if cache_only:
        pattern = f"m2020_jezero_{sol_min}_{sol_max}_p*.json"
        for cache in cache_dir.glob(pattern):
            match = cache.stem.rsplit("p", 1)
            if len(match) != 2:
                continue
            page = int(match[1])
            if page == 0:
                continue
            try:
                pages[page] = json.loads(cache.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
        print(f"using {len(pages):,}/{page_count:,} cached pages", file=sys.stderr)
    elif page_count > 1:
        print(f"fetching with {workers} workers", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(fetch_jezero_page, page, sol_min, sol_max, cache_dir): page for page in range(1, page_count)}
            for future in as_completed(futures):
                page = futures[future]
                pages[page] = future.result()
                if page % 100 == 0:
                    print(f"  fetched page {page}/{page_count - 1}", file=sys.stderr)

    candidates = []
    seen = set()
    for page in sorted(pages):
        for item in pages[page].get("images", []):
            try:
                key = (int(item["site"]), int(item["drive"]))
            except (KeyError, TypeError, ValueError):
                continue
            position = positions.get(key)
            instrument = (item.get("camera") or {}).get("instrument")
            if position is None or instrument not in M2020_CAMERAS or item.get("imageid") in seen:
                continue
            image_files = item.get("image_files") or {}
            url = image_files.get("large") or image_files.get("medium") or image_files.get("full_res")
            thumb = image_files.get("small") or image_files.get("medium") or url
            if not url or not thumb:
                continue
            extended = item.get("extended") or {}
            mast_az = to_float(extended.get("mastAz"))
            heading = (position["heading"] + mast_az) % 360 if position["heading"] is not None and mast_az is not None else None
            seen.add(item["imageid"])
            camera, priority = M2020_CAMERAS[instrument]
            candidates.append({
                "id": item["imageid"],
                "lon": round(position["lon"], 6),
                "lat": round(position["lat"], 6),
                "heading_deg": round(heading, 1) if heading is not None else None,
                "sol": int(item["sol"]),
                "camera": camera,
                "url": url,
                "thumb": thumb,
                "credit": item.get("credit") or "NASA/JPL-Caltech",
                "_distance": position["distance"],
                "_priority": priority,
            })

    bins = defaultdict(list)
    for candidate in candidates:
        bins[int(candidate["_distance"] // BIN_M)].append(candidate)
    balanced_bins = {}
    for path_bin in sorted(bins):
        ranked = sorted(bins[path_bin], key=lambda p: (p["_priority"], -p["sol"], p["id"]))
        sectors = defaultdict(list)
        sectors_order = []
        for candidate in ranked:
            heading = candidate["heading_deg"]
            sector = None if heading is None else int(heading // 45)
            if sector not in sectors:
                sectors_order.append(sector)
            sectors[sector].append(candidate)
        picked = []
        while len(picked) < PER_BIN and any(sectors[sector] for sector in sectors_order):
            for sector in sectors_order:
                if sectors[sector] and len(picked) < PER_BIN:
                    picked.append(sectors[sector].pop(0))
        balanced_bins[path_bin] = sorted(picked, key=lambda p: (p["_distance"], p["id"]))

    # Reapply direction-balanced thinning and enforce the published file budget.
    if candidates:
        photo_cap = PER_BIN
        while photo_cap >= 1:
            chosen = []
            for path_bin in sorted(bins):
                chosen.extend(balanced_bins[path_bin][:photo_cap])
            records = [{k: v for k, v in photo.items() if not k.startswith("_")} for photo in chosen]
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(records, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
            if output_path.stat().st_size <= 1_500_000:
                break
            photo_cap //= 2
        if photo_cap == 0:
            raise RuntimeError("Jezero photos exceed the 1.5 MB file budget")
        print(f"wrote {len(records):,} Jezero photos ({output_path.stat().st_size:,} bytes; {photo_cap} per 50 m bin)", file=sys.stderr)
    else:
        raise RuntimeError("no Perseverance photos matched Jezero poses in the area")


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
    ap.add_argument("--jezero", action="store_true", help="fetch Perseverance photos for Jezero instead of Curiosity photos for Gale")
    ap.add_argument("--jezero-cache-only", action="store_true", help="build Jezero photos from cached Perseverance feed pages only")
    args = ap.parse_args()

    if args.jezero or args.jezero_cache_only:
        fetch_jezero(cache_only=args.jezero_cache_only)
        return

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
    atomic_write_text(OUT, f"[\n{lines}\n]\n")
    by_cam = defaultdict(int)
    for p in photos:
        by_cam[p["camera"]] += 1
    print(f"wrote {len(photos)} photos to {OUT.relative_to(ROOT)}: "
          + ", ".join(f"{k} {v}" for k, v in sorted(by_cam.items())), file=sys.stderr)


if __name__ == "__main__":
    main()
