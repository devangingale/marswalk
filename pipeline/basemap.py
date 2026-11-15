"""Bake a muted local MOLA/HRSC hillshade into each site's PMTiles bundle."""
from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.windows import Window, from_bounds
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
PIPELINE_DIR = Path(__file__).resolve().parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from bake import bake_raster
from common import MARS_R

SOURCE = ROOT / "data/raw/mola_hrsc_blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
MIN_ZOOM, MAX_ZOOM = 5, 12
DEFAULT_RADIUS_DEG = 2.0
ATTRIBUTION = "MOLA/HRSC BlendDEM, USGS Astrogeology"


def crop_bounds(center_lon: float, center_lat: float, radius_deg: float = DEFAULT_RADIUS_DEG) -> tuple[float, float, float, float]:
    """Return a longitude/latitude crop window around a site's centre."""
    if not -90 <= center_lat <= 90:
        raise ValueError("center latitude must be between -90 and 90 degrees")
    if radius_deg <= 0:
        raise ValueError("crop radius must be positive")
    return (
        max(-180.0, center_lon - radius_deg),
        max(-90.0, center_lat - radius_deg),
        min(180.0, center_lon + radius_deg),
        min(90.0, center_lat + radius_deg),
    )


def make_hillshade(elevation: np.ndarray, valid: np.ndarray, x_resolution_m: float, y_resolution_m: float) -> np.ndarray:
    """Render an understated, warm-grey, single-hue hillshade as RGB."""
    if not valid.any():
        raise ValueError("source crop contains no valid elevation samples")
    nearest = ndi.distance_transform_edt(~valid, return_distances=False, return_indices=True)
    filled = elevation[tuple(nearest)].astype(np.float32, copy=False)
    dy, dx = np.gradient(filled * 3.0, y_resolution_m, x_resolution_m)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    altitude = math.radians(42)
    azimuth = math.radians(315)
    illumination = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect)
    shade = np.clip(0.54 + 0.46 * illumination, 0.28, 1.0)
    luminance = 42 + shade * 88
    rgb = np.stack((luminance, luminance * 0.96, luminance * 0.90), axis=0)
    rgb[:, ~valid] = 0
    return np.rint(rgb).astype(np.uint8)


def write_crop(source_path: Path, target_path: Path, bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """Write an RGB hillshade GeoTIFF in the Mars equirectangular metres expected by bake.py."""
    west, south, east, north = bounds
    with rasterio.open(source_path) as src:
        window = from_bounds(west, south, east, north, transform=src.transform).round_offsets().round_lengths()
        window = window.intersection(Window(0, 0, src.width, src.height))
        if window.width < 2 or window.height < 2:
            raise ValueError(f"empty or too small source crop for bounds {bounds}")
        elevation = src.read(1, window=window, masked=True)
        valid = ~np.ma.getmaskarray(elevation)
        elevation_data = np.asarray(elevation.filled(0), dtype=np.float32)
        source_tf = src.window_transform(window)
        center_lat = (south + north) / 2
        x_resolution_m = abs(source_tf.a) * math.pi / 180 * MARS_R * math.cos(math.radians(center_lat))
        y_resolution_m = abs(source_tf.e) * math.pi / 180 * MARS_R
        rgb = make_hillshade(elevation_data, valid, x_resolution_m, y_resolution_m)

        mars_tf = Affine(
            source_tf.a * math.pi / 180 * MARS_R,
            source_tf.b * math.pi / 180 * MARS_R,
            source_tf.c * math.pi / 180 * MARS_R,
            source_tf.d * math.pi / 180 * MARS_R,
            source_tf.e * math.pi / 180 * MARS_R,
            source_tf.f * math.pi / 180 * MARS_R,
        )
        profile = {
            "driver": "GTiff",
            "width": int(window.width),
            "height": int(window.height),
            "count": 3,
            "dtype": "uint8",
            "crs": "EPSG:4326",
            "transform": mars_tf,
            "tiled": True,
            "blockxsize": min(256, max(16, (int(window.width) // 16) * 16)),
            "blockysize": min(256, max(16, (int(window.height) // 16) * 16)),
        }
        target_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(target_path, "w", **profile) as dst:
            dst.write(rgb)

        return (
            MARS_R * math.radians(west),
            MARS_R * math.radians(south),
            MARS_R * math.radians(east),
            MARS_R * math.radians(north),
        )


def bake_site(site: str, source_path: Path = SOURCE, output: Path | None = None, radius_deg: float = DEFAULT_RADIUS_DEG) -> Path:
    site_dir = ROOT / "data/sites" / site / "bundle"
    manifest_path = site_dir / "site.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"site manifest not found: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bounds = manifest["bounds_lonlat"]
    center_lon = (bounds[0] + bounds[2]) / 2
    center_lat = (bounds[1] + bounds[3]) / 2
    crop = crop_bounds(center_lon, center_lat, radius_deg)
    target = output or site_dir / "basemap.pmtiles"

    with tempfile.TemporaryDirectory(prefix=f"{site}-basemap-") as temp_dir:
        hillshade = Path(temp_dir) / "hillshade.tif"
        bounds_xy = write_crop(source_path, hillshade, crop)
        bake_raster(hillshade, target, bounds_xy, "rgb", "basemap", MIN_ZOOM, MAX_ZOOM)

    manifest["basemap"] = {"url": target.name, "source": ATTRIBUTION}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    size = target.stat().st_size
    print(f"{site}: {target} ({size} bytes; {size / 1024 / 1024:.2f} MiB)")
    if size >= 15 * 1024 * 1024:
        raise ValueError(f"basemap exceeds 15 MiB: {size} bytes")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", choices=(*sorted(f.stem for f in (PIPELINE_DIR / "sites").glob("*.yaml")), "all"))
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--radius-deg", type=float, default=DEFAULT_RADIUS_DEG)
    args = parser.parse_args()
    sites = ("gale", "jezero") if args.site == "all" else (args.site,)
    for site in sites:
        bake_site(site, args.source, radius_deg=args.radius_deg)


if __name__ == "__main__":
    main()
