"""Feature extraction and positive-versus-background sampling for walkability.

Written with AI assistance, directed and reviewed by the team.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from scipy import ndimage as ndi

from common import ROOT, MARS_R, describe, load_poses, load_site, true_dx

PATH_RADIUS_M = 1.5
EXCLUDE_M = 5.0
MAX_GAP_M = 30.0
FEATURES = ["slope1", "slope5", "slope15", "slope_max5", "rough5", "rough15", "curv", "curv_abs15", "tpi15", "texture5"]


def path_mask(poses: pd.DataFrame, transform, shape) -> np.ndarray:
    """Rasterise rover track segments; do not bridge telemetry gaps over 30 m."""
    px = (poses.x.to_numpy() - transform.c) / transform.a
    py = (poses.y.to_numpy() - transform.f) / transform.e
    mask = np.zeros(shape, dtype=bool)
    for i in range(len(px) - 1):
        gap = np.hypot(px[i + 1] - px[i], py[i + 1] - py[i])
        n = max(1, int(np.ceil(gap))) if gap <= MAX_GAP_M else 1
        cs = np.linspace(px[i], px[i + 1] if gap <= MAX_GAP_M else px[i], n + 1).astype(int)
        rs = np.linspace(py[i], py[i + 1] if gap <= MAX_GAP_M else py[i], n + 1).astype(int)
        valid = (cs >= 0) & (cs < shape[1]) & (rs >= 0) & (rs < shape[0])
        mask[rs[valid], cs[valid]] = True
    return mask


def terrain_features(dem: np.ndarray, resolution: float, y_center: float) -> dict[str, np.ndarray]:
    """Terrain metrics in true ground metres for a north-up equirectangular DEM."""
    bad = ~np.isfinite(dem)
    z = dem.astype(np.float32, copy=True)
    if bad.any():
        idx = ndi.distance_transform_edt(bad, return_distances=False, return_indices=True)
        z = z[tuple(idx)]
    dx = true_dx(resolution, y_center)
    dzdy, dzdx = np.gradient(z, resolution, dx)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype(np.float32)
    mean5 = ndi.uniform_filter(z, 5)
    mean15 = ndi.uniform_filter(z, 15)
    rough5 = np.sqrt(np.maximum(ndi.uniform_filter((z - mean5) ** 2, 5), 0))
    rough15 = np.sqrt(np.maximum(ndi.uniform_filter((z - mean15) ** 2, 15), 0))
    curvature = ndi.laplace(ndi.gaussian_filter(z, 1.5)).astype(np.float32) / (resolution * dx)
    out = {
        "slope1": slope,
        "slope5": ndi.uniform_filter(slope, 5),
        "slope15": ndi.uniform_filter(slope, 15),
        "slope_max5": ndi.maximum_filter(slope, 5),
        "rough5": rough5,
        "rough15": rough15,
        "curv": curvature,
        "curv_abs15": ndi.uniform_filter(np.abs(curvature), 15),
        "tpi15": z - mean15,
    }
    for a in out.values():
        a[bad] = np.nan
    return out


def add_image_texture(features: dict[str, np.ndarray], image_path: Path, transform, crs, shape) -> None:
    """Reproject source image to DEM cells, then compute 5 m local brightness SD."""
    with rasterio.open(image_path) as src:
        bands = min(src.count, 3)
        image = np.zeros(shape, dtype=np.float32)
        for b in range(1, bands + 1):
            channel = np.full(shape, np.nan, dtype=np.float32)
            reproject(rasterio.band(src, b), channel, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=transform, dst_crs=crs, resampling=Resampling.average,
                      src_nodata=src.nodata, dst_nodata=np.nan)
            image += channel / bands
    local_mean = ndi.uniform_filter(np.nan_to_num(image, nan=0.0), 5)
    local_sq = ndi.uniform_filter(np.nan_to_num(image * image, nan=0.0), 5)
    texture = np.sqrt(np.maximum(local_sq - local_mean * local_mean, 0)).astype(np.float32)
    texture[~np.isfinite(image)] = np.nan
    features["texture5"] = texture


def crop_dem_and_image(dem_path: Path, image_path: Path, poses: pd.DataFrame, margin: float):
    """Read only a route corridor plus margins, from source rasters."""
    bounds = (float(poses.x.min() - margin), float(poses.y.min() - margin),
              float(poses.x.max() + margin), float(poses.y.max() + margin))
    with rasterio.open(dem_path) as src:
        window = rasterio.windows.from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
        dem = src.read(1, window=window, masked=True).filled(np.nan).astype(np.float32)
        transform, crs = src.window_transform(window), src.crs
    return dem, transform, crs


def sample_arrays(features: dict[str, np.ndarray], valid: np.ndarray, poses: pd.DataFrame, transform,
                  corridor_m: float, rng: np.random.Generator, bg_per_pos: int = 3):
    path = path_mask(poses, transform, valid.shape)
    dist, nearest = ndi.distance_transform_edt(~path, return_indices=True)
    pos = (dist <= PATH_RADIUS_M) & valid
    bg = (dist > EXCLUDE_M) & (dist <= corridor_m) & valid
    # Split by contiguous rover drive IDs (path segments), assigning nearby cells
    # to the segment of their nearest recorded rover pose.
    drive_grid = np.full(valid.shape, -1, np.int32)
    cols = ((poses.x.to_numpy() - transform.c) / transform.a).astype(int)
    rows = ((poses.y.to_numpy() - transform.f) / transform.e).astype(int)
    ok = (cols >= 0) & (cols < valid.shape[1]) & (rows >= 0) & (rows < valid.shape[0])
    drive_grid[rows[ok], cols[ok]] = poses.drive.to_numpy()[ok]
    known = drive_grid >= 0
    near_pose = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
    segment_grid = drive_grid[tuple(near_pose)]
    pr, pc = np.nonzero(pos)
    br, bc = np.nonzero(bg)
    take = rng.choice(len(br), size=min(len(br), bg_per_pos * len(pr)), replace=False)
    br, bc = br[take], bc[take]
    rr, cc = np.concatenate((pr, br)), np.concatenate((pc, bc))
    X = np.column_stack([features[k][rr, cc] for k in FEATURES]).astype(np.float32)
    y = np.r_[np.ones(len(pr), np.uint8), np.zeros(len(br), np.uint8)]
    segments = segment_grid[rr, cc]
    print(f"samples: {len(pr):,} path cells, {len(br):,} background cells; corridor width {corridor_m:g} m")
    return X, y, segments


def gale_training_data(corridor_m: float, seed=0):
    """Training path intentionally resolves only Gale input files."""
    cfg = load_site("gale")
    poses = load_poses(cfg)
    d = Path(cfg["out"]) / "train_area"
    with rasterio.open(d / "dem.tif") as src:
        dem = src.read(1, masked=True).filled(np.nan).astype(np.float32)
        transform, crs = src.transform, src.crs
    features = terrain_features(dem, transform.a, (transform.f + transform.e * dem.shape[0] / 2))
    add_image_texture(features, Path(cfg["image"]), transform, crs, dem.shape)
    valid = np.isfinite(dem) & np.isfinite(features["texture5"])
    X, y, seg = sample_arrays(features, valid, poses, transform, corridor_m, np.random.default_rng(seed))
    print(f"Gale train extent: {dem.shape[1]}x{dem.shape[0]} px, resolution {transform.a:g} m, "
          f"range {np.nanmin(dem):.3f}..{np.nanmax(dem):.3f}")
    return X, y, seg, features, dem, transform, crs


def jezero_evaluation_data(corridor_m: float, seed=1):
    """Evaluation-only reader for Jezero's DTM, orthoimage and Perseverance poses."""
    pfile = ROOT / "data/raw/pds_places/best_interp.csv"
    raw = pd.read_csv(pfile)
    poses = raw[raw.frame.eq("ROVER")].copy()
    poses["x"] = MARS_R * np.radians(poses.longitude.to_numpy())
    poses["y"] = MARS_R * np.radians(poses.planetocentric_latitude.to_numpy())
    poses = poses.sort_values(["sol", "drive", "pose"]).reset_index(drop=True)
    dem_path = next((ROOT / "data/raw/jezero_hirise_dtm").glob("*.tif"))
    image_path = next((ROOT / "data/raw/jezero_hirise_ortho").glob("*.tif"))
    dem, transform, crs = crop_dem_and_image(dem_path, image_path, poses, corridor_m + 25)
    features = terrain_features(dem, transform.a, transform.f + transform.e * dem.shape[0] / 2)
    add_image_texture(features, image_path, transform, crs, dem.shape)
    valid = np.isfinite(dem) & np.isfinite(features["texture5"])
    X, y, seg = sample_arrays(features, valid, poses, transform, corridor_m, np.random.default_rng(seed))
    describe("Jezero evaluation DTM", dem, transform)
    return X, y, seg, features, dem, transform, crs
