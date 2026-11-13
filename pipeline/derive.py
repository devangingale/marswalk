"""Crop a site's DEM and image to its walk area and derive terrain layers.

Written with AI assistance (Claude), directed and reviewed by the team.

Usage:  python pipeline/derive.py gale [--area train_area]

Outputs (in <out>/<area-key>/): dem.tif, slope.tif (degrees), rough.tif
(metres, std-dev of elevation after removing the local 5 m mean), curv.tif
(1/m, Laplacian of 3 m-smoothed elevation), image.tif, and quicklook.png with
the rover path drawn over the image to check georeferencing.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

from common import describe, load_poses, load_site, read_window, true_dx, write_tif


def terrain_layers(dem: np.ma.MaskedArray, res: float, dx: float):
    """Slope (deg), roughness (m) and curvature (1/m) from a masked DEM."""
    mask = np.ma.getmaskarray(dem)
    z = dem.filled(np.nan).astype("float32")
    # Fill holes with the nearest valid value so filters do not smear NaN.
    if mask.any():
        idx = ndi.distance_transform_edt(mask, return_distances=False, return_indices=True)
        z = z[tuple(idx)]
    dzdy, dzdx = np.gradient(z, res, dx)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype("float32")
    mean5 = ndi.uniform_filter(z, 5)
    sq5 = ndi.uniform_filter((z - mean5) ** 2, 5)
    rough = np.sqrt(np.maximum(sq5, 0)).astype("float32")
    curv = ndi.laplace(ndi.gaussian_filter(z, 1.5)).astype("float32") / (res * dx)
    for a in (slope, rough, curv):
        a[mask] = np.nan
    return slope, rough, curv


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site")
    ap.add_argument("--area", default="area", help="config key holding the bounds")
    ap.add_argument("--no-image", action="store_true")
    args = ap.parse_args()

    cfg = load_site(args.site)
    bounds = cfg[args.area]
    out = Path(cfg["out"]) / args.area
    with rasterio.open(cfg["dem"]) as src:
        crs = src.crs

    dem, tf, _ = read_window(cfg["dem"], bounds)
    dem = dem[0]
    res = tf.a
    dx = true_dx(res, (bounds[1] + bounds[3]) / 2)
    print(f"site {cfg['name']} / {args.area}: bounds {bounds}, true x spacing {dx:.4f} m")
    describe("dem", dem, tf)

    slope, rough, curv = terrain_layers(dem, res, dx)
    write_tif(out / "dem.tif", dem.filled(np.nan).astype("float32"), tf, crs, nodata=np.nan)
    for name, a in (("slope", slope), ("rough", rough), ("curv", curv)):
        write_tif(out / f"{name}.tif", a, tf, crs, nodata=np.nan)
        describe(name, a, tf)
    for lim in (10, 15, 20, 25, 30):
        print(f"  slope > {lim} deg: {100 * np.nanmean(slope > lim):.1f}% of area")

    if args.no_image:
        return
    img, itf, _ = read_window(cfg["image"], bounds, masked=False)
    write_tif(out / "image.tif", img, itf, crs, dtype="uint8")
    describe("image", img, itf)

    # Quicklook: image at ~4 m/px with the rover path on top.
    step = max(1, int(round(4 / itf.a)))
    small = img[:, ::step, ::step]
    rgb = np.repeat(small, 3, axis=0) if small.shape[0] == 1 else small[:3]
    pic = Image.fromarray(np.moveaxis(rgb, 0, -1))
    poses = load_poses(cfg)
    px = (poses["x"].to_numpy() - itf.c) / itf.a / step
    py = (poses["y"].to_numpy() - itf.f) / itf.e / step
    inside = (px >= 0) & (px < pic.width) & (py >= 0) & (py < pic.height)
    draw = ImageDraw.Draw(pic)
    pts = list(zip(px[inside].tolist(), py[inside].tolist()))
    for x, y in pts:
        draw.point((x, y), fill=(0, 255, 255))
    pic.save(out / "quicklook.png")
    print(f"quicklook: {pic.width}x{pic.height}, {int(inside.sum())} of {len(poses)} poses inside the area")


if __name__ == "__main__":
    main()
