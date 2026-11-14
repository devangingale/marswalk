"""Build the in-area APXS oxide GeoJSON for Gale.

Written with AI assistance, directed and reviewed by the team.

Usage: python pipeline/chemistry.py gale
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "apxs"
OUT = ROOT / "app" / "public" / "data"
BASE = "https://pds-geosciences.wustl.edu/msl/msl-m-apxs-4_5-rdr-v1/mslapx_1xxx/data"
INDEX_URL = f"{BASE}/collection_data_inventory.csv"
BOUNDS = (137.36046, -4.82499, 137.42795, -4.75751)


def download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    request = urllib.request.Request(url, headers={"User-Agent": "Marswalk/1.0 data pipeline"})
    with urllib.request.urlopen(request, timeout=90) as response, tmp.open("wb") as dest:
        dest.write(response.read())
    tmp.replace(path)
    if not path.exists() or not path.stat().st_size:
        raise RuntimeError(f"Download produced no data: {url}")


def oxide_row(content: bytes) -> dict[str, float]:
    rows = csv.reader(io.StringIO(content.decode("utf-8-sig")))
    next(rows, None)
    result = {}
    for row in rows:
        if len(row) < 2:
            continue
        key = row[0].strip()
        try:
            value = float(row[1])
        except ValueError:
            continue
        if key:
            result[key] = value
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site", choices=["gale"])
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    index_path = RAW / "collection_data_inventory.csv"
    download(INDEX_URL, index_path)
    index = pd.read_csv(index_path, header=None, names=["record_type", "lidvid"])
    poses = pd.read_csv(ROOT / "shared" / "poses" / "gale_poses.csv")
    pose_by_key = {}
    for (site, drive), rows in poses.groupby(["site", "drive"]):
        pose_by_key[(int(site), int(drive))] = rows.sort_values("sol").iloc[-1]

    entries = []
    for lidvid in index["lidvid"].dropna().astype(str):
        if ":data:" not in lidvid or "rwp" not in lidvid.lower():
            continue
        # Product LIDVIDs end in ``::<version>``; the product filename is
        # the component immediately before that empty version separator.
        name = lidvid.split(":")[-3]
        match = re.search(r"rwp(\d{4})(\d{3})(\d{4})", name, re.IGNORECASE)
        if not match:
            continue
        sol, site, drive = map(int, match.groups())
        pose = pose_by_key.get((site, drive))
        if pose is None:
            continue
        lon, lat = float(pose.lon), float(pose.lat)
        inside = BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]
        distance2 = max(BOUNDS[0] - lon, 0, lon - BOUNDS[2]) ** 2 + max(BOUNDS[1] - lat, 0, lat - BOUNDS[3]) ** 2
        entries.append({"name": name, "sol": sol, "site": site, "drive": drive,
                        "pose_sol": int(pose.sol), "lon": lon, "lat": lat,
                        "inside": inside, "distance2": distance2})

    # Inventory entries identify individual APXS RWP observation products. A
    # repeated inventory row with the same product and sol is an exact duplicate;
    # different products at the same rover pose remain separate observations.
    unique_entries = {}
    for entry in entries:
        unique_entries.setdefault((entry["name"], entry["sol"]), entry)
    before_dedup = sum(e["inside"] for e in entries)
    features = []
    nearest = sorted((e for e in entries if not e["inside"]), key=lambda e: e["distance2"])[:5]
    in_area = [e for e in unique_entries.values() if e["inside"]]

    def cached_csv(entry):
        sol_dir = f"sol{entry['sol']:05d}"
        csv_path = RAW / sol_dir / f"{entry['name']}.csv"
        url = f"{BASE}/{sol_dir}/{entry['name']}.csv"
        download(url, csv_path)
        return entry, oxide_row(csv_path.read_bytes())

    # RWP tables are small but numerous; a bounded pool prevents hundreds of
    # sequential connections while keeping pressure low on the PDS archive.
    with ThreadPoolExecutor(max_workers=8) as pool:
        compositions = list(pool.map(cached_csv, in_area))
    for entry, oxides in compositions:
        properties = {
            "target": f"APXS {entry['name']}",
            "sol": entry["sol"],
            **oxides,
            "source": f"{BASE}/sol{entry['sol']:05d}/{entry['name']}.csv",
        }
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [entry["lon"], entry["lat"]]}, "properties": properties})

    target = OUT / args.site / "chemistry.geojson"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({"type": "FeatureCollection", "features": features}, indent=2, ensure_ascii=False) + "\n")
    print(f"{target}: {before_dedup} indexed in-area products before exact target+sol dedup; {len(features)} after; {len({f['properties']['target'] for f in features})} distinct observation targets")
    if not features:
        print("No APXS target fell inside the Gale walk area. Nearest indexed APXS locations (separate from GeoJSON):")
        for e in nearest:
            print(f"  sol {e['sol']} site {e['site']} drive {e['drive']}: {e['lon']:.6f}, {e['lat']:.6f}")


if __name__ == "__main__":
    main()
