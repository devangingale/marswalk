"""Convert the PDS Geosciences Spirit traverse into shared/poses/gusev_poses.csv.

Written with AI assistance (Claude), directed and reviewed by the team.

Source: MER Analyst's Notebook, "Traverse Data", MERA_traverse.csv (PDS Geosciences Node,
interpolated from the science team's corrected rover positions; traverse by Tim Parker):
https://an.rsl.wustl.edu/mera/AN/pages/mer/mer_traverse.htm

Its label defines CORRECTED_X / CORRECTED_Y as metres "in the Mars Equirectangular projection
centered at 175.5 longitude and 0 latitude", so on the Mars sphere (R = 3396190 m):

    lat = deg(y / R),   lon_east = 175.5 + deg(x / R)

Check: the sol 1 record gives 14.5660 S, 175.4758 E against the published landing site
14.5692 S, 175.4729 E (MOLA IAU 2000), about 0.003 degrees apart.

The table has no elevation (RAW_Z is 0) and no rover yaw, so those columns are left empty.
Each row's sol is START_SOL, the sol the rover arrived at that site/drive position.

Opportunity's MERB_traverse_5130.csv is not converted: its label does not state the frame of
CORRECTED_X / CORRECTED_Y, so positions cannot be placed without assuming one.

    python pipeline/mer_poses.py            # downloads MERA_traverse.csv into .cache/mer/

Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://an.rsl.wustl.edu/mera/AN/meri/MER/traverse/MERA_traverse.csv"
CACHE = ROOT / ".cache" / "mer" / "MERA_traverse.csv"
OUT = ROOT / "shared" / "poses" / "gusev_poses.csv"
MARS_R = 3396190.0
LON0 = 175.5


def to_lonlat(x: float, y: float) -> tuple[float, float]:
    return LON0 + math.degrees(x / MARS_R), math.degrees(y / MARS_R)


def convert(source: Path, out: Path) -> int:
    rows = []
    with open(source, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lon, lat = to_lonlat(float(r["CORRECTED_X"]), float(r["CORRECTED_Y"]))
            rows.append({
                "site": int(r["SITE"]), "drive": int(r["DRIVE"]), "sol": int(r["START_SOL"]),
                "lon": f"{lon:.7f}", "lat": f"{lat:.7f}", "elev_m": "", "heading_deg": "",
            })
    rows.sort(key=lambda r: (r["sol"], r["site"], r["drive"]))
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["site", "drive", "sol", "lon", "lat", "elev_m", "heading_deg"])
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--source", type=Path, default=CACHE)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args(argv)
    if not args.source.exists():
        args.source.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {SOURCE_URL}")
        request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "marswalk-pipeline"})
        with urllib.request.urlopen(request, timeout=120) as response:
            args.source.write_bytes(response.read())
    n = convert(args.source, args.out)
    print(f"wrote {args.out} ({n} poses)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
