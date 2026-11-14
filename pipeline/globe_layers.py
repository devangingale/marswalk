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
OKLAB_RAMPS = {
    "dose_yellow": ("#fff8d6", "#ffe94d"),
    "insolation_coral": ("#fff5e9", "#e87569"),
    "pressure_teal": ("#e4f3eb", "#087f7b"),
    "crustal_olive": ("#f3edcf", "#777735"),
    "unit_slate_sand": ("#707d87", "#dcc895"),
    "swim_ice": ("#3a7fd0", "#eef7ff"),
    "ice_distance": ("#256fc1", "#dbeeff"),
}
PALETTE_LABELS = {
    "dose_yellow": "OKLab pale yellow to bright yellow (#ffe94d)",
    "insolation_coral": "OKLab warm white to coral",
    "pressure_teal": "OKLab pale teal to deep teal",
    "crustal_olive": "OKLab khaki to olive",
    "unit_slate_sand": "OKLab slate to sand",
    "ice_distance": "OKLab strong blue near ice; fades to transparent at 500 km",
    "swim_ice": "OKLab blue at 0+ through light blue to near-white at +1",
}


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


def _hex_to_oklab(value: str) -> np.ndarray:
    rgb = np.array([int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float64)
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    lms = np.array([
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
    ]) @ linear
    l, m, s = np.cbrt(lms)
    return np.array([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ])


def _oklab_colour(values: np.ndarray, palette: str) -> np.ndarray:
    start, end = ( _hex_to_oklab(colour) for colour in OKLAB_RAMPS[palette])
    lab = start + values[:, None] * (end - start)
    l = lab[:, 0] + 0.3963377774 * lab[:, 1] + 0.2158037573 * lab[:, 2]
    m = lab[:, 0] - 0.1055613458 * lab[:, 1] - 0.0638541728 * lab[:, 2]
    s = lab[:, 0] - 0.0894841775 * lab[:, 1] - 1.2914855480 * lab[:, 2]
    l, m, s = l**3, m**3, s**3
    linear = np.column_stack((
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ))
    rgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.maximum(linear, 0) ** (1 / 2.4) - 0.055)
    return np.rint(np.clip(rgb, 0, 1) * 255).astype(np.uint8)


def colour_ramp(values: np.ndarray, minimum: float, maximum: float, cmap_name: str) -> np.ndarray:
    """Map values to a perceptual matplotlib sequential ramp with a clear low end."""
    if maximum <= minimum:
        raise ValueError("maximum must be greater than minimum")
    valid = np.isfinite(values)
    t = np.clip((values - minimum) / (maximum - minimum), 0, 1)
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    if valid.any():
        if cmap_name in OKLAB_RAMPS:
            colour_t = np.clip(values[valid], 0, 1) if cmap_name == "swim_ice" else t[valid]
            rgb = _oklab_colour(colour_t, cmap_name)
        else:
            cmap = colormaps[cmap_name]
            rgb = np.rint(cmap(t[valid])[:, :3] * 255).astype(np.uint8)
        if cmap_name == "ice_distance":
            alpha_t = np.clip((500 - values[valid]) / 500, 0, 1)
        elif cmap_name == "swim_ice":
            positive = np.clip(values[valid], 0, 1)
            alpha_t = np.where(positive > 0, 0.35 + 0.65 * np.power(positive, 0.65), 0)
        else:
            alpha_t = t[valid]
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
        ("dose_ugy_day", "Estimated surface radiation dose", "µGy/day", "msl_rad_dose", "radiation", "dose_yellow", "Pressure-scaled estimate of daily surface radiation dose.", None),
        ("dust_mean", "Mean atmospheric dust opacity", "τIR", "montabone_dust", "dust", "YlOrBr", "Mean total-column infrared dust opacity across the source observations.", None),
        ("dust_p95", "95th-percentile dust opacity", "τIR", "montabone_dust", "dust", "YlOrBr", "95th-percentile total-column infrared dust opacity across the source observations.", None),
        ("storm_frac", "Dust-storm fraction", "fraction", "montabone_dust", "dust", "YlOrBr", "Fraction of observed sols with dust optical depth above the source threshold.", None),
        ("tes_ti_night_2007", "Nighttime thermal inertia", "raw TI units", "tes_ti_2007", "thermal", "RdPu", "Global nighttime thermal inertia from TES observations.", None),
        ("expert_likeness", "Expert-likeness site score", "score", "", "habitability", "Greens", "Positive-unlabelled model score indicating resemblance to expert-selected sites.", (0, 1)),
        ("cave_count_zone", "Cave candidates within 100 km", "count", "mgc3_caves", "caves", "Purples", "Count of catalogue cave candidates within a 100 km radius.", None),
        ("slope_p90_deg", "90th-percentile slope", "deg", "mola_megdr_128", "terrain", "Greys", "90th-percentile local terrain slope.", None),
        ("roughness_m", "Terrain roughness", "m", "mola_megdr_128", "terrain", "Greys", "Local detrended elevation standard deviation.", None),
        ("elevation_m", "Global elevation", "m", "mola_megdr_128", "terrain", "Greys", "MOLA global topographic elevation relative to the areoid.", None),
        ("insolation_wm2", "Mean daily insolation", "W/m²", "montabone_dust", "other", "insolation_coral", "Modelled mean daily direct and diffuse surface insolation.", None),
        ("surface_pressure_pa", "Estimated surface pressure", "Pa", "mola_megdr_128", "other", "pressure_teal", "Gale-referenced pressure estimate scaled by elevation.", None),
        ("crustal_b_nt", "Crustal magnetic field", "nT", "langlais2019", "other", "crustal_olive", "Modelled total crustal magnetic field intensity at the surface.", None),
        ("unit_diversity_zone", "Geologic unit diversity", "unique units", "tanaka2014_geo", "other", "unit_slate_sand", "Number of mapped geologic units within a 100 km radius.", None),
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


def format_legend_number(value: float) -> str:
    """Format a legend value without scientific notation or noisy decimals."""
    if not math.isfinite(value):
        return "—"
    magnitude = abs(value)
    decimals = 0 if magnitude >= 100 else 1 if magnitude >= 10 else 2 if magnitude >= 0.1 else 3
    text = f"{value:,.{decimals}f}"
    return text.rstrip("0").rstrip(".") if decimals else text


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
        "legend": {"stops": [[low, "#00000000"], [high, "#ffffffF0"]], "min": low, "max": high,
                   "min_label": format_legend_number(low), "max_label": format_legend_number(high),
                   "units": config["units"], "palette": config["cmap"],
                   "palette_label": PALETTE_LABELS.get(config["cmap"], config["cmap"])},
        "source": read_source_manifest(config["dataset"]),
    }
    # Correct palette-specific legend endpoints; values are encoded for the legend, alpha is zero at low.
    ramp = colour_ramp(np.array([low, high], dtype=np.float32), low, high, config["cmap"])
    legend_start = "#%02x%02x%02xF0" % tuple(ramp[0, :3]) if config["cmap"] == "ice_distance" else "#00000000"
    legend_end = "#00000000" if config["cmap"] == "ice_distance" else "#%02x%02x%02xF0" % tuple(ramp[1, :3])
    manifest["legend"]["stops"] = [[low, legend_start], [high, legend_end]]
    if config["cmap"] == "ice_distance":
        near = ramp[0]
        bright = "#%02x%02x%02x%02x" % tuple(near)
        manifest["legend"]["stops"] = [[low, bright], [min(500.0, high), "#00000000"], [high, "#00000000"]]
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
        draw.text((x0 + 5, y0 + thumb_h + 33),
                  f"{format_legend_number(lo)} — {format_legend_number(hi)} {layer['units']}",
                  fill="#b9c2cd", font=font)
    shots = ROOT / ".shots"
    shots.mkdir(exist_ok=True)
    sheet.save(shots / "globe-layers-contact-sheet.png", optimize=True)


def build(only: str | list[str] | None = None) -> None:
    configs = metadata()
    selected = [only] if isinstance(only, str) else only
    if selected:
        unknown = [layer_id for layer_id in selected if layer_id not in configs]
        if unknown:
            raise SystemExit(f"unknown layer id: {', '.join(unknown)}")
    layer_ids = selected or sorted(configs)
    manifest_layers = []
    for layer_id in layer_ids:
        cfg = configs[layer_id]
        layer_manifest, _, _ = make_layer(layer_id, cfg)
        manifest_layers.append(layer_manifest)
    manifest_path = OUT / "layers.json"
    if selected and manifest_path.exists():
        current = json.loads(manifest_path.read_text(encoding="utf-8"))
        merged = {entry["id"]: entry for entry in current["layers"]}
        merged.update({entry["id"]: entry for entry in manifest_layers})
        manifest_layers = [merged[k] for k in sorted(merged)]
    for entry in manifest_layers:
        cfg = configs[entry["id"]]
        entry.update(title=cfg["title"], group=cfg["group"], units=cfg["units"], description=cfg["description"])
        legend = entry["legend"]
        legend.update(
            min_label=format_legend_number(legend["min"]), max_label=format_legend_number(legend["max"]),
            units=cfg["units"], palette=cfg["cmap"],
            palette_label=PALETTE_LABELS.get(cfg["cmap"], cfg["cmap"]),
        )
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({"version": 1, "layers": manifest_layers}, indent=2), encoding="utf-8")
    if not selected:
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
    parser.add_argument("--only", action="append", help="rebuild one layer id; repeat to select several")
    args = parser.parse_args()
    build(args.only)


if __name__ == "__main__":
    main()
