"""Build Cesium geographic imagery and hover grids from global Mars layers."""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import zipfile
from pathlib import Path

import numpy as np
import rasterio
from matplotlib import colormaps
from PIL import Image, ImageDraw, ImageFont
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import reproject


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "globe"
WORLD_RES = 0.25
SOURCE_RES = 1.0 / 16.0
VALUE_WIDTH = 1440
VALUE_HEIGHT = 480
NODATA = 65535
MARS_EQC = rasterio.crs.CRS.from_proj4(
    "+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +a=3396190 +b=3396190 +units=m +no_defs"
)
MARS_LONLAT = rasterio.crs.CRS.from_proj4("+proj=longlat +a=3396190 +b=3396190 +no_defs")


def tile_rectangle(level: int, x: int, y: int) -> tuple[float, float, float, float]:
    """Return a geographic tile rectangle as west, south, east, north."""
    if level < 0 or x < 0 or y < 0 or x >= 2 ** (level + 1) or y >= 2**level:
        raise ValueError("tile coordinates are outside this level")
    width = 360.0 / (2 ** (level + 1))
    height = 180.0 / (2**level)
    west = -180.0 + x * width
    north = 90.0 - y * height
    return west, north - height, west + width, north


def quantise_values(values: np.ndarray, minimum: float, maximum: float) -> tuple[np.ndarray, float, float]:
    """Encode float values as uint16; return encoded array, scale, and offset."""
    if not math.isfinite(minimum) or not math.isfinite(maximum) or maximum <= minimum:
        raise ValueError("minimum and maximum must be finite and increasing")
    scale = (maximum - minimum) / (NODATA - 1)
    encoded = np.full(values.shape, NODATA, dtype=np.uint16)
    valid = np.isfinite(values)
    if valid.any():
        q = np.rint((np.clip(values[valid], minimum, maximum) - minimum) / scale)
        encoded[valid] = q.astype(np.uint16)
    return encoded, scale, minimum


def dequantise_values(encoded: np.ndarray, scale: float, offset: float) -> np.ndarray:
    """Decode uint16 values, restoring nodata as NaN."""
    result = encoded.astype(np.float32) * scale + offset
    result[encoded == NODATA] = np.nan
    return result


def colour_ramp(values: np.ndarray, minimum: float, maximum: float, cmap_name: str) -> np.ndarray:
    """Map values to a perceptual matplotlib sequential ramp with a clear low end."""
    if maximum <= minimum:
        raise ValueError("maximum must be greater than minimum")
    valid = np.isfinite(values)
    t = np.clip((values - minimum) / (maximum - minimum), 0, 1)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    if valid.any():
        ramp_name = "Blues_r" if cmap_name == "swim_ice" else "Blues" if cmap_name == "ice_distance" else cmap_name
        cmap = colormaps[ramp_name]
        colour_t = t[valid]
        rgb = np.rint(cmap(colour_t)[:, :3] * 255).astype(np.uint8)
        alpha_t = 1 - t[valid] if cmap_name == "ice_distance" else t[valid]
        alpha = np.rint(np.power(alpha_t, 0.65) * 240).astype(np.uint8)
        rgba[valid, :3] = rgb
        rgba[valid, 3] = alpha
    return rgba


def source_grid(path: Path) -> tuple[np.ndarray, Affine, rasterio.crs.CRS, float | None]:
    with rasterio.open(path) as src:
        arr = src.read(1).astype(np.float32)
        transform = src.transform
        nodata = src.nodata
    if path.name.startswith("SWIM4MIM_Ci_"):
        arr[arr == nodata] = np.nan
        return arr, transform, MARS_EQC, nodata
    arr = np.roll(arr, arr.shape[1] // 2, axis=1)
    arr[~np.isfinite(arr)] = np.nan
    return arr, Affine(SOURCE_RES, 0, -180, 0, -SOURCE_RES, 60), MARS_LONLAT, nodata


def resample_to_world(arr: np.ndarray, src_transform: Affine, src_crs: rasterio.crs.CRS,
                      resolution: float, resampling: Resampling,
                      rectangle: tuple[float, float, float, float] = (-180, -90, 180, 90)) -> np.ndarray:
    west, south, east, north = rectangle
    width = round((east - west) / resolution)
    height = round((north - south) / resolution)
    dest = np.full((height, width), np.nan, dtype=np.float32)
    reproject(
        arr, dest,
        src_transform=src_transform, src_crs=src_crs,
        src_nodata=np.nan,
        dst_transform=Affine(resolution, 0, west, 0, -resolution, north),
        dst_crs=MARS_LONLAT, dst_nodata=np.nan,
        resampling=resampling,
    )
    return dest


def metadata() -> dict[str, dict]:
    configs = {}
    for filename in sorted((DATA / "processed/global-layers").glob("*.tif")):
        layer = filename.stem
        if layer in {"expert_likeness_rank", "dose_out_of_envelope", "ti_dev", "ti_tiu"}:
            continue
        configs[layer] = {"path": filename, "dataset": "", "group": "other", "cmap": "cividis",
                          "title": layer.replace("_", " ").title(), "units": "", "description": "Global Mars layer.", "bounds": None}
    for layer, title, units, dataset, group, cmap, description, bounds in [
        ("ice_dist_km", "Distance to shallow water ice", "km", "swim_ice", "ice", "ice_distance", "Distance from the nearest SWIM ice consistency value of 0.5 or greater at 0–1 m depth.", None),
        ("ice_dist_km_0_5m", "Distance to water ice at 0–5 m", "km", "swim_ice", "ice", "ice_distance", "Distance from the nearest SWIM ice consistency value of 0.5 or greater at 0–5 m depth.", None),
        ("dose_ugy_day", "Estimated surface radiation dose", "µGy/day", "msl_rad_dose", "radiation", "Wistia", "Pressure-scaled estimate of daily surface radiation dose.", None),
        ("dust_mean", "Mean atmospheric dust opacity", "τIR", "montabone_dust", "dust", "YlOrBr", "Mean total-column infrared dust opacity across the source observations.", None),
        ("dust_p95", "95th-percentile dust opacity", "τIR", "montabone_dust", "dust", "YlOrBr", "95th-percentile total-column infrared dust opacity across the source observations.", None),
        ("storm_frac", "Dust-storm fraction", "fraction", "montabone_dust", "dust", "YlOrBr", "Fraction of observed sols with dust optical depth above the source threshold.", (0, 1)),
        ("tes_ti_night_2007", "Nighttime thermal inertia", "raw TI units", "tes_ti_2007", "thermal", "RdPu", "Global nighttime thermal inertia from TES observations.", None),
        ("expert_likeness", "Expert-likeness site score", "score", "", "habitability", "Greens", "Positive-unlabelled model score indicating resemblance to expert-selected sites.", (0, 1)),
        ("cave_count_zone", "Cave candidates within 100 km", "count", "mgc3_caves", "caves", "Purples", "Count of catalogue cave candidates within a 100 km radius.", None),
        ("slope_p90_deg", "90th-percentile slope", "degrees", "mola_megdr_128", "terrain", "Greys", "90th-percentile local terrain slope.", None),
        ("roughness_m", "Terrain roughness", "m", "mola_megdr_128", "terrain", "Greys", "Local detrended elevation standard deviation.", None),
        ("elevation_m", "Global elevation", "m", "mola_megdr_128", "terrain", "Greys", "MOLA global topographic elevation relative to the areoid.", None),
        ("insolation_wm2", "Mean daily insolation", "W/m²", "montabone_dust", "other", "cividis", "Modelled mean daily direct and diffuse surface insolation.", None),
        ("surface_pressure_pa", "Estimated surface pressure", "Pa", "mola_megdr_128", "other", "cividis", "Gale-referenced pressure estimate scaled by elevation.", None),
        ("crustal_b_nt", "Crustal magnetic field", "nT", "langlais2019", "other", "cividis", "Modelled total crustal magnetic field intensity at the surface.", None),
        ("unit_diversity_zone", "Geologic unit diversity", "unique units", "tanaka2014_geo", "other", "cividis", "Number of mapped geologic units within a 100 km radius.", None),
    ]:
        if layer in configs:
            configs[layer].update(title=title, units=units, dataset=dataset, group=group, cmap=cmap,
                                  description=description, bounds=bounds)
    for stem, depth, title in [
        ("SWIM4MIM_Ci_0_1", "0–1 m", "SWIM ice consistency at 0–1 m"),
        ("SWIM4MIM_Ci_1_5", "1–5 m", "SWIM ice consistency at 1–5 m"),
        ("SWIM4MIM_Ci_5", "5 m", "SWIM ice consistency at 5 m"),
    ]:
        configs[stem] = {"path": DATA / f"raw/swim_ice/{stem}.tif", "title": title,
                         "units": "consistency", "dataset": "swim_ice", "group": "ice",
                         "cmap": "swim_ice", "description": f"SWIM water-ice consistency for the {depth} depth interval.",
                         "bounds": (-1, 1)}
    return configs


def read_source_manifest(dataset: str) -> dict:
    path = DATA / "raw" / dataset / "manifest.json"
    if not dataset or not path.exists():
        return {"dataset": dataset or "derived_global_layer", "citation": "Derived global science layer; see source processing metadata.", "licence": "See source dataset manifests."}
    src = json.loads(path.read_text(encoding="utf-8"))
    result = {"dataset": dataset, "citation": src.get("citation", ""), "licence": src.get("licence", "")}
    if "Not stated" in result["licence"] or "not stated" in result["licence"]:
        result["licence_note"] = "Licence is not stated by the source; retain this credit and check with the provider before redistribution."
    return result


def layer_limits(arr: np.ndarray, bounds: tuple[float, float] | None) -> tuple[float, float]:
    vals = arr[np.isfinite(arr)]
    if not vals.size:
        return (0.0, 1.0)
    if bounds:
        return float(bounds[0]), float(bounds[1])
    lo, hi = np.percentile(vals, [2, 98])
    if hi <= lo:
        hi = lo + 1.0
    return float(lo), float(hi)


def make_layer(layer_id: str, config: dict) -> tuple[dict, np.ndarray, tuple[float, float]]:
    arr, src_transform, src_crs, _ = source_grid(config["path"])
    data_rect = [-180, -60, 180, 60]
    # Values are area averages at a quarter degree; tiles are bilinearly sampled at each zoom.
    values = resample_to_world(arr, src_transform, src_crs, WORLD_RES, Resampling.average,
                               (-180, -60, 180, 60))
    low, high = layer_limits(values, config["bounds"])
    encoded, scale, offset = quantise_values(values, low, high)
    folder = OUT / "layers" / layer_id
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True, exist_ok=True)
    encoded.tofile(folder / "values.bin")
    manifest = {
        "id": layer_id, "title": config["title"], "group": config["group"], "units": config["units"],
        "description": config["description"], "tiles": f"layers/{layer_id}/{{z}}/{{x}}/{{y}}.png",
        "tiling": "geographic", "min_level": 0, "max_level": 4, "rectangle": data_rect,
        "values": {"url": f"layers/{layer_id}/values.bin", "width": VALUE_WIDTH, "height": VALUE_HEIGHT,
                   "west": -180, "north": 60, "res_deg": WORLD_RES, "scale": scale,
                   "offset": offset, "nodata": NODATA},
        "legend": {"stops": [[low, "#00000000"], [high, "#ffffffF0"]], "min": low, "max": high, "units": config["units"], "palette": config["cmap"]},
        "source": read_source_manifest(config["dataset"]),
    }
    # Correct palette-specific legend endpoints; values are encoded for the legend, alpha is zero at low.
    ramp = colour_ramp(np.array([low, high], dtype=np.float32), low, high, config["cmap"])
    legend_start = "#%02x%02x%02xF0" % tuple(ramp[0, :3]) if config["cmap"] == "ice_distance" else "#00000000"
    legend_end = "#00000000" if config["cmap"] == "ice_distance" else "#%02x%02x%02xF0" % tuple(ramp[1, :3])
    manifest["legend"]["stops"] = [[low, legend_start], [high, legend_end]]
    if layer_id.startswith("SWIM4MIM_"):
        positive = colour_ramp(np.array([0.01]), low, high, config["cmap"])[0]
        far = ramp[1]
        manifest["legend"]["stops"] = [
            [-1, "#00000000"], [0, "#00000000"],
            [0.01, "#%02x%02x%02x%02x" % tuple(positive)],
            [1, "#%02x%02x%02x%02x" % tuple(far)],
        ]
    for level in range(5):
        for y in range(2**level):
            for x in range(2 ** (level + 1)):
                west, south, east, north = tile_rectangle(level, x, y)
                if north <= -60 or south >= 60:
                    continue
                dst = np.full((256, 256), np.nan, dtype=np.float32)
                reproject(
                    arr, dst, src_transform=src_transform, src_crs=src_crs, src_nodata=np.nan,
                    dst_transform=Affine((east-west)/256, 0, west, 0, -(north-south)/256, north),
                    dst_crs=MARS_LONLAT, dst_nodata=np.nan, resampling=Resampling.bilinear,
                )
                rgba = colour_ramp(dst, low, high, config["cmap"])
                if layer_id.startswith("SWIM4MIM_"):
                    rgba[dst <= 0, 3] = 0
                if not np.any(rgba[..., 3]):
                    continue
                target = folder / str(level) / str(x) / f"{y}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(target, optimize=True)
    return manifest, values, (low, high)


def write_caves() -> None:
    archive = DATA / "raw/mgc3_caves/mars_cave_catalog.zip"
    with zipfile.ZipFile(archive) as zf:
        text = zf.read("data/Mars_Cave_Catalog.csv").decode("utf-8-sig")
    features = []
    for row in csv.DictReader(text.splitlines()):
        try:
            lon = float(row["latitude:string"])
            lat = float(row["Label:string"])
        except (KeyError, ValueError):
            continue
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [((lon + 180) % 360) - 180, lat]},
                         "properties": {"id": row["longitude:string"], "name": row["longitude:string"], "type": row["TypeCode:string"]}})
    output = OUT / "caves.geojson"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")


def write_contact_sheet(layers: list[dict]) -> None:
    relief_path = DATA / "processed/global-layers/elevation_m.tif"
    relief, transform, crs, _ = source_grid(relief_path)
    relief = resample_to_world(relief, transform, crs, 0.5, Resampling.average, (-180, -60, 180, 60))
    relief = np.clip((relief - np.nanpercentile(relief, 2)) / (np.nanpercentile(relief, 98)-np.nanpercentile(relief, 2)), 0, 1)
    # Simple latitudinal hillshade from the 0.5-degree relief grid.
    gy, gx = np.gradient(np.nan_to_num(relief))
    shade = np.clip(0.68 + gx * 2.4 - gy * 1.4, 0.25, 1.0)
    bg = np.repeat(np.repeat((shade * 70 + 20).astype(np.uint8), 2, axis=0), 2, axis=1)
    bg = bg[:VALUE_HEIGHT, :VALUE_WIDTH]
    thumb_w, thumb_h, cols = 420, 230, 3
    rows = math.ceil(len(layers) / cols)
    sheet = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + 46)), "#10151d")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("arial.ttf", 13) if Path("C:/Windows/Fonts/arial.ttf").exists() else ImageFont.load_default()
    for i, layer in enumerate(layers):
        row, col = divmod(i, cols)
        x0, y0 = col * thumb_w, row * (thumb_h + 46)
        panel = Image.fromarray(np.stack([bg, bg, bg], axis=-1), "RGB").resize((thumb_w, thumb_h))
        data = layer["data"]
        lo, hi = layer["range"]
        cmap_name = layer["cmap"]
        overlay = colour_ramp(data, lo, hi, cmap_name)
        if layer["id"].startswith("SWIM4MIM_"):
            overlay[data <= 0, 3] = 0
        ov = Image.fromarray(overlay, "RGBA").resize((thumb_w, thumb_h))
        panel = Image.alpha_composite(panel.convert("RGBA"), ov).convert("RGB")
        sheet.paste(panel, (x0, y0))
        draw.text((x0 + 5, y0 + thumb_h + 4), layer["title"], fill="#ffffff", font=font)
        rgba = colour_ramp(np.linspace(lo, hi, thumb_w, dtype=np.float32)[None, :], lo, hi, cmap_name)
        bar = Image.fromarray(rgba, "RGBA").resize((thumb_w - 10, 9))
        sheet.paste(bar, (x0 + 5, y0 + thumb_h + 23), bar)
        draw.text((x0 + 5, y0 + thumb_h + 33), f"{lo:.3g} — {hi:.3g} {layer['units']}", fill="#b9c2cd", font=font)
    shots = ROOT / ".shots"
    shots.mkdir(exist_ok=True)
    sheet.save(shots / "globe-layers-contact-sheet.png", optimize=True)


def build(only: str | None = None) -> None:
    configs = metadata()
    if only and only not in configs:
        raise SystemExit(f"unknown layer id: {only}")
    layer_ids = [only] if only else sorted(configs)
    manifest_layers = []
    for layer_id in layer_ids:
        cfg = configs[layer_id]
        layer_manifest, _, _ = make_layer(layer_id, cfg)
        manifest_layers.append(layer_manifest)
    manifest_path = OUT / "layers.json"
    if only and manifest_path.exists():
        current = json.loads(manifest_path.read_text(encoding="utf-8"))
        merged = {entry["id"]: entry for entry in current["layers"]}
        merged[only] = manifest_layers[0]
        manifest_layers = [merged[k] for k in sorted(merged)]
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({"version": 1, "layers": manifest_layers}, indent=2), encoding="utf-8")
    if not only:
        write_caves()
    sheet_items = []
    for entry in manifest_layers:
        cfg = configs[entry["id"]]
        vmeta = entry["values"]
        packed = np.fromfile(OUT / vmeta["url"], dtype=np.uint16).reshape(vmeta["height"], vmeta["width"])
        values = dequantise_values(packed, vmeta["scale"], vmeta["offset"])
        sheet_items.append({"id": entry["id"], "title": cfg["title"], "units": cfg["units"], "data": values,
                            "range": (entry["legend"]["min"], entry["legend"]["max"]), "cmap": cfg["cmap"]})
    write_contact_sheet(sheet_items)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="rebuild one layer id")
    args = parser.parse_args()
    build(args.only)


if __name__ == "__main__":
    main()
