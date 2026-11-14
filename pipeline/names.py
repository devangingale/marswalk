"""Build app/public/data/globe/names.geojson from the IAU Mars gazetteer.

Written with AI assistance (Claude), directed and reviewed by the team.

Source: IAU/USGS Gazetteer of Planetary Nomenclature, Mars nomenclature
center-point shapefile, downloaded from the official GIS Downloads page:
    page: https://planetarynames.wr.usgs.gov/GIS_Downloads
    file: https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip
    downloaded: 2026-11-14
Licence: public domain. "Everything in the Gazetteer of Planetary Nomenclature
is in the public domain." Suggested citation: International Astronomical Union
Working Group for Planetary System Nomenclature, "Gazetteer of Planetary
Nomenclature" (accessed 2026-11-14), https://planetarynames.wr.usgs.gov/
(docs/research/licences.md row 23, confirmed.)

The shapefile stores longitude east-positive in 0..360 and diameter in km. We
keep IAU-approved features (every row in this download is "Adopted by IAU"),
convert longitude to -180..180, and write GeoJSON points with the properties
name, type and diameter_km. The file is kept under 1 MB by dropping the smallest
features (by diameter) if needed; the diameter floor actually used is reported.

Dependencies: geopandas (already installed on this machine) reads the shapefile;
the download uses only the Python standard library (urllib, zipfile).
"""
from __future__ import annotations

import argparse
import json
import math
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]

GAZETTEER_PAGE = "https://planetarynames.wr.usgs.gov/GIS_Downloads"
GAZETTEER_ZIP_URL = (
    "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/"
    "MARS_nomenclature_center_pts.zip"
)
DOWNLOADED = "2026-11-14"
LICENCE = "Public domain (IAU/USGS Gazetteer of Planetary Nomenclature)"
CITATION = (
    "IAU Working Group for Planetary System Nomenclature, "
    "'Gazetteer of Planetary Nomenclature' (accessed 2026-11-14), "
    "https://planetarynames.wr.usgs.gov/"
)

DEFAULT_OUT = ROOT / "app" / "public" / "data" / "globe" / "names.geojson"
DEFAULT_MAX_BYTES = 1_000_000

# Coordinate / size precision (0.0001 deg ~ 6 m at the Mars equator).
LONLAT_DECIMALS = 4
DIAMETER_DECIMALS = 3


def lon_east_to_180(lon_east: float) -> float:
    """Convert east-positive longitude (0..360) to the -180..180 range.

    350 E -> -10, 10 E -> 10, 360 E -> 0, 190 E -> -170.
    """
    return ((lon_east + 180.0) % 360.0) - 180.0


def is_approved(approval: str) -> bool:
    """True when the IAU approval status is an adopted/approved name."""
    return "adopt" in str(approval).lower()


def keep_feature(approval: str, diameter_km: float, min_diameter_km: float) -> bool:
    """Filtering rule: keep IAU-approved features at or above the diameter floor."""
    if not is_approved(approval):
        return False
    if diameter_km is None or (isinstance(diameter_km, float) and math.isnan(diameter_km)):
        diameter_km = 0.0
    return float(diameter_km) >= float(min_diameter_km)


def build_feature(name: str, ftype: str, diameter_km: float, lat: float, lon_east: float) -> dict:
    """Build one GeoJSON point Feature with name/type/diameter_km properties."""
    lon = round(lon_east_to_180(float(lon_east)), LONLAT_DECIMALS)
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, round(float(lat), LONLAT_DECIMALS)],
        },
        "properties": {
            "name": name,
            "type": ftype,
            "diameter_km": round(float(diameter_km), DIAMETER_DECIMALS),
        },
    }


def build_feature_collection(
    records: Iterable[dict], min_diameter_km: float = 0.0, metadata: dict | None = None
) -> dict:
    """Filter records and assemble a GeoJSON FeatureCollection.

    Each record is a dict with keys: name, type, diameter_km, lat, lon_east,
    approval. Records are kept per `keep_feature`.
    """
    features = []
    for r in records:
        if not keep_feature(r["approval"], r["diameter_km"], min_diameter_km):
            continue
        features.append(
            build_feature(r["name"], r["type"], r["diameter_km"], r["lat"], r["lon_east"])
        )
    fc: dict = {"type": "FeatureCollection", "features": features}
    if metadata is not None:
        fc["metadata"] = metadata
    return fc


def download_gazetteer(cache_dir: Path) -> Path:
    """Download and extract the Mars gazetteer zip; return the .shp path."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / "MARS_nomenclature_center_pts.zip"
    if not zip_path.exists():
        with urllib.request.urlopen(GAZETTEER_ZIP_URL, timeout=120) as resp:
            zip_path.write_bytes(resp.read())
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(cache_dir)
    shp = cache_dir / "MARS_nomenclature_center_pts.shp"
    if not shp.exists():
        raise FileNotFoundError(f"Shapefile not found after extraction: {shp}")
    return shp


def load_records(shp_path: Path) -> list[dict]:
    """Read the gazetteer shapefile into plain record dicts (needs geopandas)."""
    import geopandas as gpd  # imported lazily so the pure helpers need no GIS stack

    gdf = gpd.read_file(shp_path)
    records = []
    for row in gdf.itertuples(index=False):
        records.append(
            {
                "name": getattr(row, "name"),
                "type": getattr(row, "type"),
                "diameter_km": float(getattr(row, "diameter")),
                "lat": float(getattr(row, "center_lat")),
                "lon_east": float(getattr(row, "center_lon")),
                "approval": getattr(row, "approval"),
            }
        )
    return records


def write_names_geojson(
    records: list[dict],
    out_path: Path,
    min_diameter_km: float = 0.0,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> dict:
    """Write names.geojson, raising the diameter floor until it fits max_bytes.

    Returns a report dict (feature_count, bytes, min_diameter_km, source).
    """
    # Candidate diameter floors to try, smallest first, until the file fits.
    diameters = sorted({r["diameter_km"] for r in records if is_approved(r["approval"])})
    floors = [min_diameter_km] + [d for d in diameters if d > min_diameter_km]

    chosen_floor = min_diameter_km
    payload = b""
    count = 0
    for floor in floors:
        meta = {
            "source": GAZETTEER_PAGE,
            "download_url": GAZETTEER_ZIP_URL,
            "downloaded": DOWNLOADED,
            "licence": LICENCE,
            "citation": CITATION,
            "min_diameter_km": floor,
        }
        fc = build_feature_collection(records, min_diameter_km=floor, metadata=meta)
        count = len(fc["features"])
        meta["feature_count"] = count
        payload = (json.dumps(fc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        chosen_floor = floor
        if len(payload) <= max_bytes:
            break

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(payload)
    return {
        "feature_count": count,
        "bytes": len(payload),
        "min_diameter_km": chosen_floor,
        "out": str(out_path),
        "source": GAZETTEER_ZIP_URL,
        "downloaded": DOWNLOADED,
        "licence": LICENCE,
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Build names.geojson from the IAU Mars gazetteer.")
    ap.add_argument("--shapefile", type=Path, default=None, help="use a local .shp instead of downloading")
    ap.add_argument("--cache-dir", type=Path, default=None, help="download/extract directory")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--min-diameter-km", type=float, default=0.0)
    ap.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    args = ap.parse_args(argv)

    if args.shapefile is not None:
        shp = args.shapefile
    else:
        cache_dir = args.cache_dir or Path(tempfile.mkdtemp(prefix="iau_gazetteer_"))
        shp = download_gazetteer(cache_dir)

    records = load_records(shp)
    report = write_names_geojson(
        records, args.out, min_diameter_km=args.min_diameter_km, max_bytes=args.max_bytes
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
