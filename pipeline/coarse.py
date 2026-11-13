"""Crop and align orbital thermal and mineral layers to a site's walk area.

Written with AI assistance, directed and reviewed by the team.

Usage: python pipeline/coarse.py gale

Writes shared-interface GeoTIFFs and JSON sidecars under
data/sites/<site>/area/layers/. Source pixel sizes are retained in the metadata;
nearest-neighbour sampling keeps coarse source cells visibly blocky.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds
from rasterio.warp import Resampling, reproject

from common import MARS_R, load_site, read_window


ROOT = Path(__file__).resolve().parents[1]
THERMAL_DIR = ROOT / "data/raw/themis_ti_quant"
CRISM_VRT_DIR = ROOT / "data/processed/crism_vrt"
CRISM_RAW_DIR = ROOT / "data/raw/crism_mrdr_su_bands"

# CRISM summary parameter layers selected for Mount Sharp's hydrated minerals.
MINERAL_INDICES = {
    "bd1900_2": {
        "folder": "BD1900_2",
        "title": "CRISM 1.9 µm hydration band depth (BD1900_2)",
        "source": "CRISM MRDR summary parameter BD1900_2; 1.9 µm H2O absorption depth, a hydration proxy relevant to hydrated sulfates and clays.",
        "units": "dimensionless band depth",
        "colors": ["#313695", "#74add1", "#ffffbf", "#f46d43"],
    },
    "d2300": {
        "folder": "D2300",
        "title": "CRISM 2.3 µm Mg-OH index (D2300)",
        "source": "CRISM MRDR summary parameter D2300; 2.3 µm Mg-OH absorption depth, a phyllosilicate/clay indicator for Mount Sharp.",
        "units": "dimensionless band depth",
        "colors": ["#313695", "#74add1", "#ffffbf", "#f46d43"],
    },
}


def _mars_eqc_crs() -> rasterio.crs.CRS:
    return rasterio.crs.CRS.from_proj4(
        f"+proj=eqc +lat_ts=0 +lon_0=0 +a={MARS_R} +b={MARS_R} +units=m +no_defs"
    )


def _source_info(name: str, src, resolution: float, units: str | None, source_file: str | None = None) -> None:
    print(
        f"source {name}: file={source_file or src.name}, CRS={src.crs}, "
        f"resolution={resolution:.2f} m, nodata={src.nodata}, units={units or 'not encoded'}"
    )


def _describe(name: str, arr: np.ndarray, transform) -> tuple[float, float, float]:
    valid = np.isfinite(arr)
    h, w = arr.shape
    if valid.any():
        lo, hi = float(arr[valid].min()), float(arr[valid].max())
    else:
        lo = hi = float("nan")
    percent = 100.0 * float(valid.mean())
    print(
        f"{name}: {w}x{h} px, extent x {transform.c:.0f}..{transform.c + w * transform.a:.0f}, "
        f"y {transform.f + h * transform.e:.0f}..{transform.f:.0f}, "
        f"grid res {transform.a:g} m, range {lo:.6g}..{hi:.6g}, valid {percent:.1f}%"
    )
    return lo, hi, percent


def _legend(lo: float, hi: float, colors: list[str]) -> dict:
    if not math.isfinite(lo) or not math.isfinite(hi):
        return {"stops": []}
    values = np.linspace(lo, hi, len(colors))
    return {"stops": [[round(float(v), 6), c] for v, c in zip(values, colors)]}


def _write_layer(out_dir: Path, layer_id: str, title: str, kind: str,
                 resolution_m: float, source: str, units: str, colors: list[str],
                 arr: np.ndarray, transform, crs) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    tif = out_dir / f"{layer_id}.tif"
    with rasterio.open(
        tif, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
        dtype="float32", crs=crs, transform=transform, nodata=np.nan,
        tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=3,
    ) as dst:
        dst.write(arr.astype("float32"), 1)
    lo, hi, _ = _describe(layer_id, arr, transform)
    sidecar = {
        "id": layer_id,
        "title": title,
        "kind": kind,
        "resolution_m": round(float(resolution_m), 2),
        "source": source,
        "agency": "NASA",
        "units": units,
        "legend": _legend(lo, hi, colors),
        "default_on": False,
    }
    (out_dir / f"{layer_id}.json").write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")


def _mosaic_crs() -> rasterio.crs.CRS:
    return rasterio.crs.CRS.from_proj4(
        f"+proj=eqc +lat_ts=0 +lon_0=0 +a={MARS_R} +b={MARS_R} +units=m +no_defs"
    )


def _thermal_sources():
    for path in sorted(THERMAL_DIR.glob("*.cub")):
        with rasterio.open(path) as src:
            yield path, src.bounds, src.crs, src.res, src.nodata, src.tags()


def _load_crism_vrt(vrt_path: Path):
    """Open a relocated CRISM VRT by redirecting its stale absolute raw path in memory."""
    root = ET.parse(vrt_path).getroot()
    src_name = root.findtext(".//SourceFilename")
    if not src_name:
        raise ValueError(f"No raw source filename in {vrt_path}")
    raw_path = CRISM_RAW_DIR / vrt_path.parent.name / Path(src_name).name
    if not raw_path.is_file():
        raise FileNotFoundError(raw_path)
    node = root.find(".//SourceFilename")
    assert node is not None
    node.text = raw_path.resolve().as_posix()
    allow = str(CRISM_RAW_DIR.resolve()).replace("\\", "/")
    env = rasterio.Env(GDAL_VRT_RAWRASTERBAND_ALLOWED_SOURCE=allow)
    env.__enter__()
    memory = MemoryFile(ET.tostring(root), ext=".vrt")
    src = memory.open()
    return src, memory, env


def _crism_candidates(folder: str, center_lon: float, center_lat: float):
    candidates = []
    for path in sorted((CRISM_VRT_DIR / folder).glob("*.vrt")):
        try:
            root = ET.parse(path).getroot()
            width, height = int(root.attrib["rasterXSize"]), int(root.attrib["rasterYSize"])
            gt = [float(v) for v in root.findtext("GeoTransform", "").split(",")]
            left, px, _, top, _, py = gt
            right, bottom = left + width * px, top + height * py
            if min(left, right) <= center_lon <= max(left, right) and min(top, bottom) <= center_lat <= max(top, bottom):
                candidates.append(path)
        except (ET.ParseError, ValueError, KeyError):
            continue
    return candidates


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site", help="site name or YAML path")
    args = ap.parse_args()
    cfg = load_site(args.site)
    bounds = cfg["area"]
    area_dem, transform, _ = read_window(cfg["dem"], bounds)
    height, width = area_dem.shape[-2:]
    area_crs = _mosaic_crs()
    out_dir = Path(cfg["out"]) / "area" / "layers"
    print(f"site {cfg['name']} / area: bounds {bounds}, output grid {width}x{height} at {transform.a:g} m")

    # THEMIS is already in the project's equirectangular Mars metres.
    thermal_paths = []
    for path, src_bounds, src_crs, src_res, nodata, tags in _thermal_sources():
        print(
            f"THEMIS source inspected: {path.name}, CRS={src_crs}, resolution={float(np.mean(src_res)):.2f} m, "
            f"nodata={nodata}, units=not encoded in cube label (quantitative thermal inertia in TIU)"
        )
        intersects = not (src_bounds.right <= bounds[0] or src_bounds.left >= bounds[2]
                          or src_bounds.top <= bounds[1] or src_bounds.bottom >= bounds[3])
        if intersects:
            thermal_paths.append(path)
    if not thermal_paths:
        available = ", ".join(p.name for p in sorted(THERMAL_DIR.glob("*.cub")))
        print(f"thermal: SKIPPED — no THEMIS quantitative thermal-inertia source covers {cfg['name']} area {bounds}; available mosaics: {available}")
    else:
        thermal = np.full((height, width), np.nan, dtype="float32")
        for path in thermal_paths:
            with rasterio.open(path) as src:
                _source_info("THEMIS thermal inertia", src, float(np.mean(src.res)), "J m-2 K-1 s-1/2 (TIU)")
                # The supplied source bundle is partial; read only the area window so
                # unrelated missing blocks elsewhere in the global mosaic do not fail.
                win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
                try:
                    src_arr = src.read(1, window=win, masked=True).filled(np.nan).astype("float32")
                except rasterio.errors.RasterioIOError as exc:
                    raise SystemExit(
                        f"thermal: data-coverage failure for {cfg['name']}: the THEMIS file "
                        f"{path.name} is an incomplete partial download and its area window "
                        f"contains an unreadable source block ({exc}); no outputs were written."
                    ) from None
                warped = np.full_like(thermal, np.nan)
                reproject(src_arr, warped, src_transform=src.window_transform(win), src_crs=src.crs,
                          src_nodata=np.nan, dst_transform=transform, dst_crs=area_crs,
                          dst_nodata=np.nan, resampling=Resampling.nearest)
                thermal[np.isfinite(warped)] = warped[np.isfinite(warped)]
        _write_layer(out_dir, "thermal", "THEMIS thermal inertia", "thermal", 100.0,
                     "THEMIS quantitative thermal inertia mosaic (100 m); values indicate near-surface thermal inertia.",
                     "J m-2 K-1 s-1/2 (TIU)", ["#313695", "#74add1", "#ffffbf", "#a50026"],
                     thermal, transform, area_crs)

    center_x = (bounds[0] + bounds[2]) / 2
    center_y = (bounds[1] + bounds[3]) / 2
    center_lon = math.degrees(center_x / MARS_R)
    center_lat = math.degrees(center_y / MARS_R)
    missing = []
    for layer_id, spec in MINERAL_INDICES.items():
        candidates = _crism_candidates(spec["folder"], center_lon, center_lat)
        if not candidates:
            missing.append(layer_id)
            print(f"mineral {layer_id}: SKIPPED — no CRISM summary-parameter footprint covers {cfg['name']} area centre ({center_lon:.4f}E, {center_lat:.4f}°)")
            continue
        layer = np.full((height, width), np.nan, dtype="float32")
        for vrt in candidates:
            src, memory, env = _load_crism_vrt(vrt)
            try:
                lat_c = math.radians((src.bounds.bottom + src.bounds.top) / 2)
                dx = MARS_R * math.cos(lat_c) * math.radians(abs(src.transform.a))
                dy = MARS_R * math.radians(abs(src.transform.e))
                source_resolution = math.sqrt(dx * dy)
                raw_path = CRISM_RAW_DIR / spec["folder"] / vrt.name.replace(".vrt", ".f32")
                _source_info(f"CRISM {layer_id}", src, source_resolution, spec["units"], str(raw_path))
                print(f"  source VRT={vrt.relative_to(ROOT)}, raw={raw_path}, nodata={src.nodata}")
                src_arr = src.read(1, masked=True).filled(np.nan).astype("float32")
                warped = np.full_like(layer, np.nan)
                reproject(src_arr, warped, src_transform=src.transform, src_crs=src.crs,
                          src_nodata=np.nan, dst_transform=transform, dst_crs=area_crs,
                          dst_nodata=np.nan, resampling=Resampling.nearest)
                layer[np.isfinite(warped)] = warped[np.isfinite(warped)]
            finally:
                src.close()
                memory.close()
                env.__exit__(None, None, None)
        _write_layer(out_dir, layer_id, spec["title"], "spectral", source_resolution,
                     spec["source"], spec["units"], spec["colors"], layer, transform, area_crs)

    dust_src_path = ROOT / "data/processed/global-layers/dust_mean.tif"
    with rasterio.open(dust_src_path) as dust_src:
        source_grid = dust_src.tags().get("source_grid", "3 degree native")
        match = re.search(r"\d+(?:\.\d+)?", source_grid)
        dust_native_deg = float(match.group()) if match else 3.0
        dust_res_m = MARS_R * math.radians(dust_native_deg)
        _source_info("Montabone mean dust opacity", dust_src, dust_res_m,
                     dust_src.tags().get("unit"), str(dust_src_path))
    print("dust: SKIPPED — the Montabone mean dust-opacity observations are aggregated on a 3-degree native grid (about 178 km north-south), so they are not spatially meaningful over a 4 km walk area.")
    if missing:
        print(f"coverage gaps: CRISM index sources missing: {', '.join(missing)}")


if __name__ == "__main__":
    main()
