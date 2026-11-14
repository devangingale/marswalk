"""Build sparse global MCS surface-temperature maps for twelve Mars seasons."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse

import numpy as np
import rasterio
from matplotlib import colormaps
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from pipeline.globe_layers import (
        MARS_LONLAT, NODATA, colour_ramp, format_legend_number, quantise_values,
        read_source_manifest, resample_to_world, source_grid, tile_rectangle,
    )
except ModuleNotFoundError:
    from globe_layers import (
        MARS_LONLAT, NODATA, colour_ramp, format_legend_number, quantise_values,
        read_source_manifest, resample_to_world, source_grid, tile_rectangle,
    )


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw" / "mcs_ddr_v62"
OUT = DATA / "globe"
TEMPERATURE_OUT = OUT / "temperature"
MANIFEST_OUT = OUT / "temperature.json"

GRID_RES = 3.0
VALUE_WIDTH = 120
VALUE_HEIGHT = 60
MIN_CELL_OBSERVATIONS = 3
WORLD_RES = 0.25
TILE_LEVELS = range(5)
NIGHT_HOURS = (0.0, 4.0)
AFTERNOON_HOURS = (12.0, 16.0)
SURFACE_TEMP_RANGE_K = (100.0, 400.0)
TEMPERATURE_CMAP_NAME = "mcs_temperature_cool_warm"
TEMPERATURE_COLOURS = ("#344a66", "#647c91", "#c2a079", "#ee873a")
TEMPERATURE_ALPHA = 150


def ls_bin(ls_deg: float) -> int:
    """Return the zero-based 30-degree Ls bin for an Ls in [0, 360)."""
    if not math.isfinite(ls_deg) or not 0.0 <= ls_deg < 360.0:
        raise ValueError("Ls must be finite and in [0, 360)")
    return min(11, int(ls_deg // 30.0))


def kelvin_to_celsius(temperature_k: float | np.ndarray) -> float | np.ndarray:
    """Convert kelvin to Celsius without rounding the source precision."""
    if isinstance(temperature_k, np.ndarray):
        return temperature_k.astype(np.float64) - 273.15
    return temperature_k - 273.15


def select_local_time(local_time_hours: float | np.ndarray, period: str) -> bool | np.ndarray:
    """Select MCS observations in the 00-04 h night or 12-16 h afternoon windows."""
    if period == "night":
        start, end = NIGHT_HOURS
    elif period == "afternoon":
        start, end = AFTERNOON_HOURS
    else:
        raise ValueError("period must be 'night' or 'afternoon'")
    if isinstance(local_time_hours, np.ndarray):
        return np.isfinite(local_time_hours) & (local_time_hours >= start) & (local_time_hours < end)
    return math.isfinite(local_time_hours) and start <= local_time_hours < end


def coarse_cell(lat: float, lon: float, resolution: float = GRID_RES) -> tuple[int, int]:
    """Return (row, column) in a global coarse grid, wrapping longitude at 180 degrees."""
    if not math.isfinite(lat) or not -90.0 <= lat <= 90.0 or not math.isfinite(lon):
        raise ValueError("latitude and longitude must be finite and latitude within [-90, 90]")
    if not math.isfinite(resolution) or resolution <= 0 or not math.isclose(360.0 % resolution, 0.0):
        raise ValueError("resolution must be a positive divisor of 360 degrees")
    width = round(360.0 / resolution)
    height = round(180.0 / resolution)
    wrapped_lon = ((lon + 180.0) % 360.0) - 180.0
    col = min(width - 1, int((wrapped_lon + 180.0) / resolution))
    row = min(height - 1, max(0, int((90.0 - lat) / resolution)))
    return row, col


def median_with_min_count(observations: list[float], minimum: int = MIN_CELL_OBSERVATIONS) -> float:
    """Return a cell median when enough observations exist, else NaN."""
    if minimum < 1:
        raise ValueError("minimum must be positive")
    if len(observations) < minimum:
        return math.nan
    return float(np.median(observations))


def _register_temperature_cmap() -> None:
    if TEMPERATURE_CMAP_NAME not in colormaps:
        colormaps.register(LinearSegmentedColormap.from_list(TEMPERATURE_CMAP_NAME, TEMPERATURE_COLOURS))


def _field_map(header_line: str) -> dict[str, int]:
    fields = next(csv.reader([header_line], skipinitialspace=True))
    return {field.strip().strip('"').lower(): index for index, field in enumerate(fields)}


def _number(row: list[str], fields: dict[str, int], name: str) -> float:
    return float(row[fields[name]].strip().strip('"'))


def iter_profiles(path: Path) -> Iterable[dict[str, float | str]]:
    """Yield the scalar profile rows from the MCS DDR stream table."""
    header: dict[str, int] | None = None
    with path.open("r", encoding="ascii", errors="replace", newline="") as stream:
        for line in stream:
            if line.startswith("#"):
                continue
            if header is None:
                if "date" in line.lower() and "t_surf" in line.lower():
                    header = _field_map(line)
                continue
            # Scalar profile rows are 1048 bytes; the 105 nested pressure-level rows
            # are 160 bytes each and are not used for the surface-temperature layer.
            if len(line.rstrip("\r\n")) < 900:
                continue
            row = next(csv.reader([line], skipinitialspace=True))
            if len(row) <= max(header.values()):
                continue
            try:
                source_date = row[header["date"]].strip().strip('"')
                obs_date = datetime.strptime(source_date, "%d-%b-%Y").date().isoformat()
                yield {
                    "date": obs_date,
                    "ls": _number(row, header, "l_s") % 360.0,
                    "ltst_hours": _number(row, header, "ltst") * 24.0,
                    "lat": _number(row, header, "surf_lat"),
                    "lon_east": _number(row, header, "surf_lon"),
                    "temperature_k": _number(row, header, "t_surf"),
                    "temperature_quality": _number(row, header, "t_qual"),
                    "surface_quality": _number(row, header, "surf_qual"),
                }
            except (KeyError, ValueError, IndexError):
                continue


def _manifest_inputs() -> tuple[dict, list[Path]]:
    manifest_path = RAW / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"missing source manifest: {manifest_path}")
    source_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    paths: list[Path] = []
    for entry in source_manifest.get("files", []):
        name = Path(unquote(urlparse(entry["url"]).path)).name
        path = RAW / name
        if not path.is_file():
            raise FileNotFoundError(f"listed MCS source file is missing: {path}")
        if path.stat().st_size != entry["bytes"]:
            raise ValueError(f"source file size does not match manifest: {path}")
        paths.append(path)
    if not paths:
        raise ValueError("source manifest lists no MCS data files")
    return source_manifest, paths


def _append_observation(groups: dict, ls: float, local_time: float, lat: float, lon_east: float, temp_k: float,
                        t_quality: float, surf_quality: float, obs_date: str,
                        resolution: float = GRID_RES) -> None:
    if (not math.isfinite(temp_k) or not SURFACE_TEMP_RANGE_K[0] <= temp_k <= SURFACE_TEMP_RANGE_K[1]
            or t_quality not in (0.0, 1.0) or surf_quality not in (0.0, 1.0, 2.0, 3.0)
            or not math.isfinite(lat) or not -90.0 <= lat <= 90.0
            or not math.isfinite(lon_east)):
        return
    y, x = coarse_cell(lat, lon_east, resolution)
    slot = ls_bin(ls)
    period = "night" if select_local_time(local_time, "night") else "afternoon" if select_local_time(local_time, "afternoon") else None
    if period is None:
        return
    groups[(slot, period, y, x)].append((temp_k, obs_date))


def _build_grids(source_paths: list[Path], resolution: float = GRID_RES) -> tuple[list[dict[str, np.ndarray]], list[dict], dict[str, int]]:
    width = round(360.0 / resolution)
    height = round(180.0 / resolution)
    groups: dict[tuple[int, str, int, int], list[tuple[float, str]]] = defaultdict(list)
    for path in source_paths:
        for profile in iter_profiles(path):
            _append_observation(groups, float(profile["ls"]), float(profile["ltst_hours"]),
                                float(profile["lat"]), float(profile["lon_east"]),
                                float(profile["temperature_k"]), float(profile["temperature_quality"]),
                                float(profile["surface_quality"]), str(profile["date"]), resolution)
    grids: list[dict[str, np.ndarray]] = []
    coverage: list[dict] = []
    for slot in range(12):
        bin_arrays: dict[str, np.ndarray] = {}
        bin_coverage: dict[str, dict] = {}
        for kind, period in (("t_min", "night"), ("t_max", "afternoon")):
            values = np.full((height, width), np.nan, dtype=np.float32)
            observation_counts = np.zeros((height, width), dtype=np.uint32)
            used_dates: set[str] = set()
            sample_count = 0
            for (group_bin, group_period, y, x), records in groups.items():
                if group_bin != slot or group_period != period:
                    continue
                observation_counts[y, x] = len(records)
                median_k = median_with_min_count([item[0] for item in records])
                if math.isfinite(median_k):
                    values[y, x] = np.float32(median_k - 273.15)
                sample_count += len(records)
                used_dates.update(item[1] for item in records)
            valid = np.isfinite(values)
            bin_arrays[kind] = values
            bin_coverage[kind] = {
                "fraction": float(valid.sum() / valid.size),
                "observed_cells": int(valid.sum()),
                "grid_cells": int(valid.size),
                "samples": sample_count,
                "min_observations_per_cell": MIN_CELL_OBSERVATIONS,
                "counts": observation_counts,
                "days_used": sorted(used_dates),
                "local_time_hours": list(NIGHT_HOURS if kind == "t_min" else AFTERNOON_HOURS),
            }
        grids.append(bin_arrays)
        coverage.append(bin_coverage)
    counts = {"night": sum(len(v) for (b,p,y,x),v in groups.items() if p == "night"),
              "afternoon": sum(len(v) for (b,p,y,x),v in groups.items() if p == "afternoon")}
    if not counts["night"] or not counts["afternoon"]:
        raise ValueError(f"MCS subset did not contain both local-time windows: {counts}")
    return grids, coverage, counts


def _save_values(values: np.ndarray, counts: np.ndarray, target: Path,
                 min_value: float, max_value: float, resolution: float) -> dict:
    encoded, scale, offset = quantise_values(values, min_value, max_value)
    target.parent.mkdir(parents=True, exist_ok=True)
    encoded.tofile(target)
    counts_path = target.parent / "counts.bin"
    counts.astype("<u4", copy=False).tofile(counts_path)
    return {
        "url": target.relative_to(OUT).as_posix(), "width": values.shape[1], "height": values.shape[0],
        "west": -180.0, "north": 90.0, "res_deg": resolution,
        "scale": scale, "offset": offset, "nodata": NODATA,
        "counts": {"url": counts_path.relative_to(OUT).as_posix(), "width": counts.shape[1],
                   "height": counts.shape[0], "res_deg": resolution, "dtype": "uint32", "byte_order": "little",
                   "units": "observations", "nodata": 0},
        "min_observations_per_cell": MIN_CELL_OBSERVATIONS,
    }


def _tile_grid(values: np.ndarray, low: float, high: float, folder: Path, resolution: float = GRID_RES) -> None:
    transform = Affine(resolution, 0.0, -180.0, 0.0, -resolution, 90.0)
    for level in TILE_LEVELS:
        for y in range(2**level):
            for x in range(2 ** (level + 1)):
                west, south, east, north = tile_rectangle(level, x, y)
                dst = np.full((256, 256), np.nan, dtype=np.float32)
                reproject(
                    values, dst, src_transform=transform, src_crs=MARS_LONLAT, src_nodata=np.nan,
                    dst_transform=Affine((east - west) / 256, 0.0, west, 0.0, -(north - south) / 256, north),
                    dst_crs=MARS_LONLAT, dst_nodata=np.nan, resampling=Resampling.nearest,
                )
                valid = np.isfinite(dst)
                if not valid.any():
                    continue
                rgba = colour_ramp(dst, low, high, TEMPERATURE_CMAP_NAME)
                rgba[valid, 3] = TEMPERATURE_ALPHA
                path = folder / str(level) / str(x) / f"{y}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(path, optimize=True)


def _write_previews(grids: list[dict[str, np.ndarray]], low: float, high: float) -> None:
    relief_path = DATA / "processed" / "global-layers" / "elevation_m.tif"
    relief, transform, crs, _ = source_grid(relief_path)
    relief = resample_to_world(relief, transform, crs, WORLD_RES, Resampling.average,
                               (-180.0, -90.0, 180.0, 90.0))
    finite = relief[np.isfinite(relief)]
    lo, hi = np.percentile(finite, [2, 98])
    normalized = np.clip((relief - lo) / (hi - lo), 0.0, 1.0)
    gy, gx = np.gradient(np.nan_to_num(normalized, nan=0.0))
    shade = np.clip(0.68 + gx * 2.4 - gy * 1.4, 0.22, 1.0)
    base = np.repeat((shade * 95 + 15).astype(np.uint8)[..., None], 3, axis=2)
    shots = ROOT / ".shots"
    shots.mkdir(exist_ok=True)
    for slot in (3, 9):
        for kind in ("t_min", "t_max"):
            values = resample_to_world(grids[slot][kind],
                                       Affine(GRID_RES, 0.0, -180.0, 0.0, -GRID_RES, 90.0),
                                       MARS_LONLAT, WORLD_RES, Resampling.nearest,
                                       (-180.0, -90.0, 180.0, 90.0))
            rgba = colour_ramp(values, low, high, TEMPERATURE_CMAP_NAME)
            rgba[np.isfinite(values), 3] = TEMPERATURE_ALPHA
            background = Image.fromarray(base, "RGB").convert("RGBA")
            overlay = Image.fromarray(rgba, "RGBA")
            preview = Image.alpha_composite(background, overlay).convert("RGB").resize((1280, 640))
            preview.save(shots / f"globe-temperature-ls{slot * 30:03d}-{kind}.png", optimize=True)


def build() -> dict:
    source_manifest, source_paths = _manifest_inputs()
    grids, coverage, sample_counts = _build_grids(source_paths, GRID_RES)
    fallback_slots = [slot for slot in range(12)
                      if any(coverage[slot][kind]["fraction"] < 0.5 for kind in ("t_min", "t_max"))]
    fallback_grids = fallback_coverage = None
    if fallback_slots:
        fallback_grids, fallback_coverage, _ = _build_grids(source_paths, 6.0)
    valid_values = np.concatenate([arr[np.isfinite(arr)] for bin_data in grids for arr in bin_data.values()])
    if not valid_values.size:
        raise ValueError("no valid MCS surface-temperature observations were assigned to Ls bins")
    low = float(np.min(valid_values))
    high = float(np.max(valid_values))
    if high <= low:
        high = low + 1.0
    _register_temperature_cmap()
    _write_previews(grids, low, high)
    if TEMPERATURE_OUT.exists():
        import shutil
        shutil.rmtree(TEMPERATURE_OUT)
    bins = []
    extremes = []
    for slot, bin_data in enumerate(grids):
        layer_entry = {"ls_start": slot * 30, "ls_end": (slot + 1) * 30}
        layer_extreme = {"ls_start": slot * 30}
        for kind in ("t_min", "t_max"):
            values = bin_data[kind]
            folder = TEMPERATURE_OUT / f"{slot:02d}" / kind
            _tile_grid(values, low, high, folder)
            value_meta = _save_values(values, coverage[slot][kind]["counts"], folder / "values.bin",
                                      low, high, GRID_RES)
            layer_entry[kind] = {
                "tiles": f"temperature/{slot:02d}/{kind}/{{z}}/{{x}}/{{y}}.png",
                "values": value_meta,
                "coverage": {key: value for key, value in coverage[slot][kind].items() if key != "counts"},
            }
            valid = np.isfinite(values)
            if valid.any():
                indices = np.argwhere(valid)
                chosen = indices[np.argmin(values[valid]) if kind == "t_min" else np.argmax(values[valid])]
                row, col = int(chosen[0]), int(chosen[1])
                extreme = {
                    "t_c": float(values[row, col]),
                    "lat": 90.0 - (row + 0.5) * GRID_RES,
                    "lon": ((-180.0 + (col + 0.5) * GRID_RES + 180.0) % 360.0) - 180.0,
                }
            else:
                extreme = None
            layer_extreme["coldest" if kind == "t_min" else "warmest"] = extreme
        layer_entry["coverage_fraction"] = {
            "t_min": coverage[slot]["t_min"]["fraction"],
            "t_max": coverage[slot]["t_max"]["fraction"],
        }
        layer_entry["days_used"] = {
            "t_min": coverage[slot]["t_min"]["days_used"],
            "t_max": coverage[slot]["t_max"]["days_used"],
        }
        layer_entry["local_time_hours"] = {"t_min": list(NIGHT_HOURS), "t_max": list(AFTERNOON_HOURS)}
        if slot in fallback_slots and fallback_grids is not None and fallback_coverage is not None:
            fallback = {}
            for kind in ("t_min", "t_max"):
                fallback_folder = TEMPERATURE_OUT / f"{slot:02d}" / f"{kind}_6deg"
                fallback_values = fallback_grids[slot][kind]
                _tile_grid(fallback_values, low, high, fallback_folder, 6.0)
                fallback_meta = _save_values(
                    fallback_values, fallback_coverage[slot][kind]["counts"],
                    fallback_folder / "values.bin", low, high, 6.0,
                )
                fallback[kind] = {
                    "tiles": f"temperature/{slot:02d}/{kind}_6deg/{{z}}/{{x}}/{{y}}.png",
                    "values": fallback_meta,
                    "coverage": {key: value for key, value in fallback_coverage[slot][kind].items()
                                 if key != "counts"},
                }
            layer_entry["fallback_6deg"] = fallback
            layer_entry["fallback_6deg_coverage_fraction"] = {
                kind: fallback_coverage[slot][kind]["fraction"] for kind in ("t_min", "t_max")
            }
        bins.append(layer_entry)
        extremes.append(layer_extreme)

    source = read_source_manifest("mcs_ddr_v62")
    source.update({
        "dataset": "MRO Mars Climate Sounder (MCS) DDR V6.2",
        "landing_page": source_manifest["landing_page"],
        "selection_reason": "MCS DDR profiles provide surface temperature, LTST and surface coordinates for both the near-pre-dawn and afternoon orbit passes, allowing both temperature maps to come from one PDS product.",
        "sampling": "Expanded sparse sample across multiple Mars Years; per-cell median from MCS observations in each bin's recorded days_used. Cells with fewer than 3 selected observations are nodata; 6-degree fallback grids are included for bins whose 3-degree coverage is below 50%.",
        "local_time_selection": {
            "t_min": {"hours": list(NIGHT_HOURS), "label": "night-side, near pre-dawn (MCS orbit local times around 3 am)"},
            "t_max": {"hours": list(AFTERNOON_HOURS), "label": "day-side, afternoon (MCS orbit local times around 3 pm)"},
        },
        "quality_filter": "T_QUAL in {0, 1}; SURF_QUAL in {0, 1, 2, 3} (surface temperature reported); 100 <= T_SURF <= 400 K.",
        "profile_samples": sample_counts,
        "download": {
            "date": source_manifest.get("download_date", ""),
            "files": len(source_paths),
            "bytes": sum(path.stat().st_size for path in source_paths),
        },
        "licence_note": source_manifest.get("licence_note", ""),
    })
    legend_stops = []
    for index, colour in enumerate(TEMPERATURE_COLOURS):
        value = low + (float(np.max(valid_values)) - low) * index / (len(TEMPERATURE_COLOURS) - 1)
        legend_stops.append([value, f"{colour}{TEMPERATURE_ALPHA:02x}"])
    legend = {
        "min": low, "max": float(np.max(valid_values)), "units": "deg C",
        "min_label": format_legend_number(low), "max_label": format_legend_number(float(np.max(valid_values))),
        "palette": TEMPERATURE_CMAP_NAME,
        "palette_label": "deep blue-grey cold to orange warm; fixed moderate alpha",
        "stops": legend_stops,
        "alpha": TEMPERATURE_ALPHA,
    }
    output = {"version": 1, "season_bins": bins, "legend": legend, "source": source, "extremes": extremes}
    MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_OUT.write_text(json.dumps(output, indent=2), encoding="utf-8")
    return output


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    result = build()
    print(json.dumps({
        "output": str(MANIFEST_OUT),
        "files": sum(1 for p in TEMPERATURE_OUT.rglob("*") if p.is_file()),
        "sample_counts": result["source"]["profile_samples"],
        "coverage": [{"ls_start": b["ls_start"], **b["coverage_fraction"]} for b in result["season_bins"]],
        "extremes": result["extremes"],
    }, indent=2))


if __name__ == "__main__":
    main()
