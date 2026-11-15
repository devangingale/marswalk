"""Shared helpers for the Marswalk pipeline.

Written with AI assistance (Claude), directed and reviewed by the team.

All source rasters are equirectangular on a Mars sphere:
    x = R * lon_rad,  y = R * lat_rad   (lat_ts = 0, lon_0 = 0)
so x metres are stretched by 1/cos(lat) away from the equator. Anything that
measures ground distance (slope, path length) must use `true_dx`.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import yaml
from rasterio.windows import from_bounds

MARS_R = 3396190.0
ROOT = Path(__file__).resolve().parents[1]


def load_site(name_or_path: str) -> dict:
    p = Path(name_or_path)
    if not p.exists():
        p = ROOT / "pipeline" / "sites" / f"{name_or_path}.yaml"
    cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
    for k in ("dem", "image", "poses", "out"):
        if cfg.get(k):  # poses are optional: sites with no rover have none
            cfg[k] = str(ROOT / cfg[k])
    return cfg


def lonlat_to_xy(lon_deg, lat_deg):
    return MARS_R * np.radians(lon_deg), MARS_R * np.radians(lat_deg)


def xy_to_lonlat(x, y):
    return np.degrees(np.asarray(x) / MARS_R), np.degrees(np.asarray(y) / MARS_R)


def true_dx(res_x: float, y_center: float) -> float:
    """Ground metres per pixel in x at the given projected y."""
    return res_x * math.cos(y_center / MARS_R)


def read_window(path: str, bounds, masked: bool = True):
    """Read a bounding box [left, bottom, right, top]; return (array, transform, profile)."""
    with rasterio.open(path) as src:
        win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
        arr = src.read(window=win, masked=masked)
        transform = src.window_transform(win)
        prof = src.profile.copy()
        prof.update(height=arr.shape[-2], width=arr.shape[-1], transform=transform)
    return arr, transform, prof


def write_tif(path, arr, transform, crs, nodata=None, dtype=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if arr.ndim == 2:
        arr = arr[None]
    dtype = dtype or arr.dtype
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[1], width=arr.shape[2],
        count=arr.shape[0], dtype=dtype, crs=crs, transform=transform, nodata=nodata,
        tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=2 if np.issubdtype(np.dtype(dtype), np.integer) else 3,
    ) as dst:
        dst.write(arr.astype(dtype))


def load_poses(cfg: dict) -> pd.DataFrame:
    """Rover poses with x, y in the raster projection.

    Positions come from lon / planetocentric lat, not the file's own
    easting/northing columns, which use a different standard parallel per mission.
    """
    d = pd.read_csv(cfg["poses"])
    r = d[d["frame"] == "ROVER"].copy()
    r["x"], r["y"] = lonlat_to_xy(r["longitude"].to_numpy(), r["planetocentric_latitude"].to_numpy())
    return r[["site", "drive", "sol", "x", "y", "longitude", "planetocentric_latitude", "elevation", "yaw"]].reset_index(drop=True)


def describe(name: str, arr, transform) -> None:
    a = np.ma.masked_invalid(arr)
    h, w = a.shape[-2:]
    left, top = transform.c, transform.f
    print(f"{name}: {w}x{h} px, res {transform.a:g} m, "
          f"x {left:.0f}..{left + w * transform.a:.0f}, y {top + h * transform.e:.0f}..{top:.0f}, "
          f"range {float(a.min()):.3f}..{float(a.max()):.3f}, valid {100 * a.count() / a.size:.1f}%")
