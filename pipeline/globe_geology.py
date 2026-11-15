"""Geology and mineral whole-planet layers for Mars globe (SIM 3292 & Bandfield 2002)."""

from __future__ import annotations

import io
import json
import math
import shutil
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
import rasterio.features
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject

from globe_layers import (
    DATA,
    MARS_LONLAT,
    NODATA,
    OUT,
    VALUE_HEIGHT,
    VALUE_WIDTH,
    WORLD_RES,
    colour_ramp,
    format_legend_number,
    quantise_values,
    read_source_manifest,
    tile_rectangle,
)

ROOT = Path(__file__).resolve().parents[1]

# 7 Major Unit Groups for Tanaka et al. (2014) SIM 3292
GEOLOGY_GROUPS: dict[str, dict[str, Any]] = {
    "noachian_highland": {
        "id": 1,
        "label": "Noachian highland",
        "color": "#8f7a52",
        "rgba": (143, 122, 82, 200),
    },
    "hesperian_plains": {
        "id": 2,
        "label": "Hesperian plains & lowlands",
        "color": "#6e8c78",
        "rgba": (110, 140, 120, 200),
    },
    "hesperian_volcanic": {
        "id": 3,
        "label": "Hesperian volcanic",
        "color": "#bf8b50",
        "rgba": (191, 139, 80, 200),
    },
    "amazonian_volcanic": {
        "id": 4,
        "label": "Amazonian volcanic",
        "color": "#c47d6e",
        "rgba": (196, 125, 110, 200),
    },
    "transition_apron": {
        "id": 5,
        "label": "Transition & apron",
        "color": "#a8a37e",
        "rgba": (168, 163, 126, 200),
    },
    "polar": {
        "id": 6,
        "label": "Polar deposits & ice",
        "color": "#b5cbd8",
        "rgba": (181, 203, 216, 200),
    },
    "impact": {
        "id": 7,
        "label": "Impact units",
        "color": "#7d6f8d",
        "rgba": (125, 111, 141, 200),
    },
}


def classify_geology_unit(unit: str, desc: str) -> tuple[str, str, str]:
    """Classify a Tanaka et al. (2014) unit code and description into (age, group_key, group_label)."""
    d = desc.lower()

    # Determine age
    if unit.startswith("eN"):
        age = "Early Noachian"
    elif unit.startswith("mN"):
        age = "Middle Noachian"
    elif unit.startswith("lN"):
        age = "Late Noachian"
    elif unit.startswith("N"):
        age = "Noachian"
    elif unit.startswith("HN"):
        age = "Hesperian and Noachian"
    elif unit.startswith("eH"):
        age = "Early Hesperian"
    elif unit.startswith("lH"):
        age = "Late Hesperian"
    elif unit.startswith("H"):
        age = "Hesperian"
    elif unit.startswith("AH"):
        age = "Amazonian and Hesperian"
    elif unit.startswith("eA"):
        age = "Early Amazonian"
    elif unit.startswith("mA"):
        age = "Middle Amazonian"
    elif unit.startswith("lA"):
        age = "Late Amazonian"
    elif unit.startswith("AN"):
        age = "Amazonian and Noachian"
    elif unit.startswith("A"):
        age = "Amazonian"
    else:
        age = "Unknown"

    # Determine group
    if "impact" in d:
        grp = "impact"
    elif "polar" in d:
        grp = "polar"
    elif "volcanic" in d:
        if "amazonian" in age.lower():
            grp = "amazonian_volcanic"
        elif "hesperian" in age.lower():
            grp = "hesperian_volcanic"
        else:
            grp = "noachian_highland"
    elif "highland" in d or "massif" in d:
        grp = "noachian_highland"
    elif "lowland" in d or "basin" in d:
        grp = "hesperian_plains"
    elif "transition" in d or "apron" in d or "outflow" in d:
        grp = "transition_apron"
    else:
        grp = "noachian_highland"

    return age, grp, GEOLOGY_GROUPS[grp]["label"]


def load_sim3292_catalog_and_shapes(zip_path: Path) -> tuple[dict[int, dict[str, Any]], list[tuple[dict, int]]]:
    """Load shapefile records from sim3292_database.zip, mapping units to 1-based integer IDs."""
    import shapefile

    with zipfile.ZipFile(zip_path) as z:
        shp = io.BytesIO(z.read("SIM3292_MarsGlobalGeologicGIS_20M/SIM3292_Shapefiles/SIM3292_Global_Geology.shp"))
        dbf = io.BytesIO(z.read("SIM3292_MarsGlobalGeologicGIS_20M/SIM3292_Shapefiles/SIM3292_Global_Geology.dbf"))
        shx = io.BytesIO(z.read("SIM3292_MarsGlobalGeologicGIS_20M/SIM3292_Shapefiles/SIM3292_Global_Geology.shx"))
        r = shapefile.Reader(shp=shp, dbf=dbf, shx=shx)
        records = r.records()
        shapes = r.shapes()

    # Collect sorted unique unit names
    unique_units = sorted({rec["Unit"] for rec in records})
    code_to_id = {u: i + 1 for i, u in enumerate(unique_units)}

    catalog: dict[int, dict[str, Any]] = {}
    for rec in records:
        u = rec["Unit"]
        uid = code_to_id[u]
        if uid not in catalog:
            desc = rec["UnitDesc"]
            age, grp_key, grp_label = classify_geology_unit(u, desc)
            catalog[uid] = {
                "id": uid,
                "code": u,
                "name": desc,
                "age": age,
                "group": grp_key,
                "group_label": grp_label,
                "color": GEOLOGY_GROUPS[grp_key]["color"],
            }

    shapes_and_ids = [(s.__geo_interface__, code_to_id[rec["Unit"]]) for s, rec in zip(shapes, records)]
    return catalog, shapes_and_ids


def rasterize_geology_grid(shapes_and_ids: list[tuple[dict, int]], out_shape: tuple[int, int],
                           transform: Affine) -> np.ndarray:
    """Rasterize polygon features with integer IDs onto the given transform and shape."""
    return rasterio.features.rasterize(
        shapes_and_ids,
        out_shape=out_shape,
        transform=transform,
        fill=0,
        dtype=np.uint16,
    )


def make_geology_layer(out_folder: Path = OUT / "layers/geology") -> dict[str, Any]:
    """Build the global geologic layer: rasterize SIM 3292 units, write values.bin and tiles."""
    zip_path = DATA / "raw/tanaka2014_geo/sim3292_database.zip"
    if not zip_path.exists():
        raise FileNotFoundError(f"Missing geologic database at {zip_path}")

    catalog, shapes_and_ids = load_sim3292_catalog_and_shapes(zip_path)

    # Rasterize values grid: 1440x480 at 0.25 deg across lon -180..180, lat 60..-60
    transform_values = Affine(WORLD_RES, 0, -180, 0, -WORLD_RES, 60)
    values_grid = rasterize_geology_grid(shapes_and_ids, (VALUE_HEIGHT, VALUE_WIDTH), transform_values)

    # Encode values.bin (uint16; nodata=65535, scale=1.0, offset=0.0)
    encoded = values_grid.copy()
    encoded[encoded == 0] = NODATA

    if out_folder.exists():
        shutil.rmtree(out_folder)
    out_folder.mkdir(parents=True, exist_ok=True)
    encoded.tofile(out_folder / "values.bin")

    # High-resolution raster for tile generation (1/16 deg = 0.0625 deg, 1920x5760)
    high_res = 1.0 / 16.0
    high_h = round(120.0 / high_res)
    high_w = round(360.0 / high_res)
    transform_high = Affine(high_res, 0, -180, 0, -high_res, 60)
    high_grid = rasterize_geology_grid(shapes_and_ids, (high_h, high_w), transform_high)

    # RGBA lookup table for unit_id (0..44)
    max_id = max(catalog.keys())
    palette = np.zeros((max_id + 1, 4), dtype=np.uint8)
    for uid, cat in catalog.items():
        grp = cat["group"]
        palette[uid] = GEOLOGY_GROUPS[grp]["rgba"]

    # Render tile pyramid (levels 0..4)
    for level in range(5):
        for y in range(2**level):
            for x in range(2 ** (level + 1)):
                west, south, east, north = tile_rectangle(level, x, y)
                if north <= -60 or south >= 60:
                    continue

                # Subsample tile from high_grid
                dst = np.full((256, 256), 0, dtype=np.uint16)
                reproject(
                    high_grid, dst,
                    src_transform=transform_high, src_crs=MARS_LONLAT, src_nodata=0,
                    dst_transform=Affine((east - west) / 256, 0, west, 0, -(north - south) / 256, north),
                    dst_crs=MARS_LONLAT, dst_nodata=0,
                    resampling=Resampling.nearest,
                )
                rgba = palette[dst]
                if not np.any(rgba[..., 3]):
                    continue
                target = out_folder / str(level) / str(x) / f"{y}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(target, optimize=True)

    # Legend stops corresponding to the 7 major groups
    stops = [[grp["id"], f"{grp['color']}f0"] for grp in GEOLOGY_GROUPS.values()]

    manifest = {
        "id": "geology",
        "title": "Geologic units (SIM 3292)",
        "group": "geology",
        "units": "",
        "description": "USGS global geologic map of Mars (Tanaka et al. 2014, SIM 3292) categorized by major epoch and terrain.",
        "tiles": "layers/geology/{z}/{x}/{y}.png",
        "tiling": "geographic",
        "min_level": 0,
        "max_level": 4,
        "rectangle": [-180, -60, 180, 60],
        "values": {
            "url": "layers/geology/values.bin",
            "width": VALUE_WIDTH,
            "height": VALUE_HEIGHT,
            "west": -180,
            "north": 60,
            "res_deg": WORLD_RES,
            "scale": 1.0,
            "offset": 0.0,
            "nodata": NODATA,
        },
        "legend": {
            "stops": stops,
            "min": 1,
            "max": 7,
            "min_label": "Noachian highland",
            "max_label": "Impact units",
            "units": "",
            "palette": "geology_muted",
            "palette_label": "Muted categorical ramp (7 major epoch and terrain groups)",
        },
        "categories": {str(uid): cat for uid, cat in catalog.items()},
        "source": read_source_manifest("tanaka2014_geo"),
    }
    return manifest


def compute_olivine_ramp_endpoints(values: np.ndarray) -> tuple[float, float]:
    """Compute ramp endpoints from data percentiles: low end above noise floor, high end at p99."""
    valid = values[np.isfinite(values) & (values >= 0)]
    nonzero = valid[valid > 0]
    p_low = float(np.percentile(nonzero, 50))  # median of positive detections (~0.95% -> 1.0%)
    p_high = float(np.percentile(valid, 99))   # 99th percentile of all mapped data (~3.47% -> 3.5%)
    lo = round(p_low, 1)
    hi = round(p_high, 1)
    if hi <= lo:
        hi = lo + 1.0
    return lo, hi


def make_tes_olivine_layer(out_folder: Path = OUT / "layers/tes_olivine") -> dict[str, Any]:
    """Build the TES olivine abundance layer from Bandfield (2002) VICAR raster."""
    vic_path = DATA / "raw/tes_bandfield2002/tes_olivine_numeric.vic"
    if not vic_path.exists():
        raise FileNotFoundError(f"Missing TES olivine raster at {vic_path}")

    with rasterio.open(vic_path) as src:
        arr = src.read(1).astype(np.float32)

    # Sliced to -60..60 latitude: row 120 to 600 of 720 rows
    # Lon is -180..180, 1440 cols
    arr_sliced = arr[120:600, :]
    arr_sliced[arr_sliced < 0] = np.nan
    # Convert abundance fraction (0..1) to percentage (0..100)
    values = arr_sliced * 100.0

    low, high = compute_olivine_ramp_endpoints(values)
    encoded, scale, offset = quantise_values(values, 0.0, 15.0)

    if out_folder.exists():
        shutil.rmtree(out_folder)
    out_folder.mkdir(parents=True, exist_ok=True)
    encoded.tofile(out_folder / "values.bin")

    # Tile generation
    src_transform = Affine(0.25, 0, -180, 0, -0.25, 60)
    for level in range(5):
        for y in range(2**level):
            for x in range(2 ** (level + 1)):
                west, south, east, north = tile_rectangle(level, x, y)
                if north <= -60 or south >= 60:
                    continue

                dst = np.full((256, 256), np.nan, dtype=np.float32)
                reproject(
                    values, dst,
                    src_transform=src_transform, src_crs=MARS_LONLAT, src_nodata=np.nan,
                    dst_transform=Affine((east - west) / 256, 0, west, 0, -(north - south) / 256, north),
                    dst_crs=MARS_LONLAT, dst_nodata=np.nan,
                    resampling=Resampling.bilinear,
                )
                rgba = colour_ramp(dst, low, high, "mineral_teal_green")
                if not np.any(rgba[..., 3]):
                    continue
                target = out_folder / str(level) / str(x) / f"{y}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(target, optimize=True)

    ramp = colour_ramp(np.array([low, high], dtype=np.float32), low, high, "mineral_teal_green")
    legend_start = "#%02x%02x%02x80" % tuple(ramp[0, :3])
    legend_end = "#%02x%02x%02xF0" % tuple(ramp[1, :3])

    manifest = {
        "id": "tes_olivine",
        "title": "TES olivine abundance",
        "group": "minerals",
        "units": "%",
        "description": "Global surface olivine mineral abundance derived from MGS TES thermal infrared spectra (Bandfield 2002).",
        "tiles": "layers/tes_olivine/{z}/{x}/{y}.png",
        "tiling": "geographic",
        "min_level": 0,
        "max_level": 4,
        "rectangle": [-180, -60, 180, 60],
        "values": {
            "url": "layers/tes_olivine/values.bin",
            "width": VALUE_WIDTH,
            "height": VALUE_HEIGHT,
            "west": -180,
            "north": 60,
            "res_deg": WORLD_RES,
            "scale": scale,
            "offset": offset,
            "nodata": NODATA,
        },
        "legend": {
            "stops": [[low, legend_start], [high, legend_end]],
            "min": low,
            "max": high,
            "min_label": format_legend_number(low),
            "max_label": format_legend_number(high),
            "units": "%",
            "palette": "mineral_teal_green",
            "palette_label": "OKLab pale teal-green to deep emerald teal",
        },
        "source": read_source_manifest("tes_bandfield2002"),
    }
    return manifest
