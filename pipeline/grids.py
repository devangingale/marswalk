"""Build the contract route grids from a site's cropped DEM.

Written with AI assistance, directed and reviewed by the team.

The cost rule combines slope and local roughness: score = round(6*slope_deg +
40*roughness_m), clipped to 0..250; cost is 1 + score/50 (rounded to an
integer), except slopes above 20 degrees and nodata are impassable (255).
Roughness is the standard deviation from a 5 m local mean. Distances and
resampling use Mars ground metres, including the latitude correction in x.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject
from scipy import ndimage as ndi

from common import MARS_R, describe, load_site, true_dx


def build_grid(dem_path: Path, out: Path, bounds=None) -> dict:
    with rasterio.open(dem_path) as src:
        tf, crs = src.transform, src.crs
        if bounds is None:
            left, bottom, right, top = src.bounds
        else:
            left, bottom, right, top = bounds
        lat_c = (bottom + top) / (2 * MARS_R)
        coslat = math.cos(lat_c)
        cell_x_src, cell_y_src = 2.0 / coslat, 2.0
        width = max(1, round((right - left) / cell_x_src))
        height = max(1, round((top - bottom) / cell_y_src))
        cell_x_src = (right - left) / width
        cell_y_src = (top - bottom) / height
        dst_tf = Affine(cell_x_src, 0, left, 0, -cell_y_src, top)
        elev = np.full((height, width), np.nan, dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1), destination=elev,
            src_transform=tf, src_crs=crs, src_nodata=src.nodata,
            dst_transform=dst_tf, dst_crs=crs, dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
    dx = true_dx(cell_x_src, (bottom + top) / 2)
    dzdy, dzdx = np.gradient(elev, cell_y_src, dx)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    # Equivalent 5 m window, odd-sized, to retain a centred local statistic.
    kx = max(3, int(round(5 / 2)) | 1)
    ky = max(3, int(round(5 / 2)) | 1)
    valid = np.isfinite(elev)
    safe = np.where(valid, elev, 0.0)
    weights = ndi.uniform_filter(valid.astype(np.float32), size=(ky, kx), mode="nearest")
    mean = ndi.uniform_filter(safe, size=(ky, kx), mode="nearest") / np.maximum(weights, 1e-6)
    mean_sq = ndi.uniform_filter(safe * safe, size=(ky, kx), mode="nearest") / np.maximum(weights, 1e-6)
    rough = np.sqrt(np.maximum(mean_sq - mean * mean, 0.0))
    score = np.clip(np.rint(6 * slope + 40 * rough), 0, 250)
    # The contract stores score bytes; the planner applies 1 + value / 50.
    cost = score.astype(np.uint8)
    cost[(slope > 20) | ~valid] = 255

    finite = elev[valid]
    offset = math.floor(float(finite.min()))
    encoded = np.full(elev.shape, 65535, dtype="<u2")
    vals = np.rint((elev[valid] - offset) / 0.1)
    if vals.max(initial=0) >= 65535:
        raise ValueError("elevation range cannot be encoded as uint16 at 0.1 m scale")
    encoded[valid] = vals.astype("<u2")
    out.mkdir(parents=True, exist_ok=True)
    encoded.tofile(out / "elev.bin")
    cost.tofile(out / "cost.bin")
    header = {
        "width": width, "height": height, "cell_x_m": 2.0, "cell_y_m": 2.0,
        "elev": {"file": "elev.bin", "dtype": "uint16", "scale_m": 0.1,
                 "offset_m": offset, "nodata": 65535},
        "cost": {"file": "cost.bin", "dtype": "uint8", "impassable": 255,
                 "multiplier": "1 + value / 50"},
        "limits": {"max_slope_deg": 20}, "cost_source": "slope-roughness-rule-v1",
    }
    (out / "grid.json").write_bytes((json.dumps(header, indent=2) + "\n").encode("utf-8"))
    grid_tf = Affine(cell_x_src, 0, left, 0, -cell_y_src, top)
    describe("grid elevation (m)", elev, grid_tf)
    describe("grid slope (degrees)", slope, grid_tf)
    describe("grid roughness (m)", rough, grid_tf)
    print(f"grid cost values: {int(cost.min())}..{int(cost.max())}; impassable {100 * np.count_nonzero(cost == 255) / cost.size:.2f}%")
    print(f"grid dimensions: {width}x{height}, true cell 2.000x2.000 m, size {width * 2:.2f} x {height * 2:.2f} m; elevation encoding {offset}..{float(finite.max()):.3f} m")
    return header


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site")
    ap.add_argument("--sample", action="store_true", help="build the 500 m NW corner grid")
    ap.add_argument("--output", help="output directory (defaults to data/sites/<site>/bundle or app sample)")
    args = ap.parse_args()
    cfg = load_site(args.site)
    source = Path(cfg["out"]) / "area" / "dem.tif"
    if args.sample:
        with rasterio.open(source) as ds:
            left, bottom, right, top = ds.bounds
        lat_c = (bottom + top) / (2 * MARS_R)
        bounds = [left, top - 500, left + 500 / math.cos(lat_c), top]
        output = Path(args.output) if args.output else Path("app/public/sample") / cfg["name"]
    else:
        bounds = None
        output = Path(args.output) if args.output else Path(cfg["out"]) / "bundle"
    print(f"site {cfg['name']} grid input={source}, sample={args.sample}, bounds={bounds or 'full cropped DEM'}")
    build_grid(source, output, bounds)


if __name__ == "__main__":
    main()
