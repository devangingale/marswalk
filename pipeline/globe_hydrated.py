"""Build whole-planet hydrated-mineral density layers from the MOCAAS catalogue.

Source: MOCAAS, the Mars Orbital Catalog of Aqueous Alteration Signatures
(Carter et al. 2023, Icarus 389, 115164), served by PSUP as an OGC WFS at
https://ows.psup.univ-lyon1.fr/mocaas. Each feature is a polygon of mapped
detection pixels (OMEGA ~500 m, CRISM ~100 m) of one spectral-mineral class;
CRISM features are single pixels, OMEGA ones can be merged areas of thousands of km2.

For each layer the script spreads each feature's area over the 1/16-degree cells
it covers, sums its classes per instrument, combines OMEGA and CRISM per cell by
taking the larger (so one outcrop seen by both is not counted twice), then takes
a uniform 150 km disc on the sphere around every quarter-degree cell. The value is
the detected area per 10,000 km2 of mapped ground (|lat| <= 70) inside that disc.

Usage:
    python pipeline/globe_hydrated.py                  # download (cached) and build into data/globe
    python pipeline/globe_hydrated.py --out some/dir   # write layers there and merge layers.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import shutil
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import reproject

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from pipeline.globe_layers import (
        MARS_LONLAT, NODATA, _hex_to_oklab, format_legend_number, quantise_values, tile_rectangle,
    )
except ModuleNotFoundError:
    from globe_layers import (
        MARS_LONLAT, NODATA, _hex_to_oklab, format_legend_number, quantise_values, tile_rectangle,
    )


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw" / "mocaas"
OUT = DATA / "globe"

WFS_URL = "https://ows.psup.univ-lyon1.fr/mocaas"
PAGE_SIZE = 5000                  # features per WFS request; about 5 MB of GeoJSON
INSTRUMENTS = ("OMEGA", "CRISM")
CLASSES = {
    "RED": "Fe/Mg-rich phyllosilicates (clays)",
    "CYAN": "Al-rich phyllosilicates (clays) and hydrated (opaline) silica",
    "GREEN": "Polyhydrated and hydroxylated sulfate salts (locally zeolites)",
    "BLUE": "Monohydrated sulfate salts",
    "ORANGE": "Carbonate salts (locally serpentine-group phyllosilicates)",
}

MARS_RADIUS_KM = 3396.19          # same sphere as globe_layers.MARS_LONLAT
FINE_RES = 1.0 / 16.0             # occupancy grid, about 3.7 km at the equator
WORLD_RES = 0.25                  # values grid and tile source, about 15 km
RADIUS_KM = 150.0                 # density disc radius
PER_AREA_KM2 = 1.0e4              # values are km2 of detections per 10^4 km2
COVERAGE_LAT = 70.0               # MOCAAS global maps cover non-polar latitudes to +/-70 deg
RAMP_LOW_PERCENTILE = 10.0        # faintest tenth of non-zero cells stays transparent
RAMP_HIGH_PERCENTILE = 99.0       # ramp saturates near the 99th percentile
MAX_LEVEL = 4
HOTSPOTS = 8
SUBDIVIDE = 8                     # sub-pixels per occupancy cell side for large features

# Minerals family: teal-green (approved globe palette). Every stop is visible, so the
# low end reads against the globe instead of fading to nothing; stronger is darker.
MINERAL_STOPS = (("#6cc7ad", 120), ("#22a184", 190), ("#05594c", 240))
PALETTE_ID = "mineral_teal"
PALETTE_LABEL = "OKLab light teal through green to deep teal-green; low end starts at 47% opacity"

LAYERS = {
    "hydrated_clays": {
        "title": "Phyllosilicates (clays)",
        "classes": ("RED", "CYAN"),
        "description": ("Area of orbital clay detections (Fe/Mg and Al phyllosilicates; the Al class also "
                        "includes opaline silica) within 150 km, from OMEGA and CRISM in the MOCAAS catalogue."),
    },
    "hydrated_all": {
        "title": "All hydrated minerals",
        "classes": ("RED", "CYAN", "GREEN", "BLUE", "ORANGE"),
        "description": ("Area of orbital detections of any aqueous-alteration mineral class (clays, sulfates, "
                        "carbonates, silica) within 150 km, from OMEGA and CRISM in the MOCAAS catalogue."),
    },
    "hydrated_sulfates": {
        "title": "Sulfates",
        "classes": ("GREEN", "BLUE"),
        "description": ("Area of orbital sulfate detections (mono- and polyhydrated; locally zeolites) within "
                        "150 km, from OMEGA and CRISM in the MOCAAS catalogue."),
    },
    "hydrated_carbonates": {
        "title": "Carbonates",
        "classes": ("ORANGE",),
        "description": ("Area of orbital carbonate detections (locally serpentine) within 150 km, from OMEGA "
                        "and CRISM in the MOCAAS catalogue."),
    },
}
UNITS = "km² per 10⁴ km²"
SOURCE = {
    "dataset": "mocaas",
    "citation": ("Carter, J., et al. (2023). A Mars orbital "
                 "catalog of aqueous alteration signatures (MOCAAS). Icarus 389, 115164, "
                 "doi:10.1016/j.icarus.2022.115164. Data: MOCAAS November 2023 release via PSUP WFS "
                 "(https://ows.psup.univ-lyon1.fr/mocaas); OMEGA (ESA Mars Express, IAS) and CRISM "
                 "(NASA MRO, JHU-APL)."),
    "licence": ("Not stated by MOCAAS or PSUP. Credited in full to Carter et al. (2023), the MOCAAS team (IAS, "
                "Universite Paris-Saclay) and PSUP; removed on request."),
    "licence_note": ("Licence is not stated by the source; retain this credit and check with the MOCAAS team "
                     "before redistribution."),
    "landing_page": "https://www.ias.u-psud.fr/moccas/",
}


# ---------------------------------------------------------------- download

def _get(params: dict, timeout: float = 600.0, attempts: int = 4) -> bytes:
    url = WFS_URL + "?" + urllib.parse.urlencode(params)
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "sol48-globe-pipeline"})
            with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("unreachable")


def feature_count(type_name: str) -> int:
    body = _get({"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
                 "TYPENAMES": f"ms:{type_name}", "RESULTTYPE": "hits"}, timeout=120).decode("utf-8")
    marker = 'numberMatched="'
    start = body.index(marker) + len(marker)
    return int(body[start:body.index('"', start)])


def download_class(instrument: str, colour: str, cache: Path) -> Path:
    """Fetch every feature of one instrument/class into gzipped GeoJSON pages; return the folder."""
    type_name = f"MOCAAS_{instrument}_{colour}"
    folder = cache / "pages" / type_name
    folder.mkdir(parents=True, exist_ok=True)
    total = feature_count(type_name)
    for start in range(0, total, PAGE_SIZE):
        page = folder / f"{start:07d}-{PAGE_SIZE}.json.gz"
        if page.exists() and page.stat().st_size > 0:
            continue
        body = _get({"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
                     "TYPENAMES": f"ms:{type_name}", "COUNT": PAGE_SIZE, "STARTINDEX": start,
                     "OUTPUTFORMAT": "application/json"})
        json.loads(body)  # fail now, not later, on a truncated page
        tmp = page.with_suffix(".tmp")
        tmp.write_bytes(gzip.compress(body, 6))
        tmp.replace(page)
        print(f"  {type_name}: {min(start + PAGE_SIZE, total)}/{total}", flush=True)
    (folder / "count.json").write_text(json.dumps({"features": total}), encoding="utf-8")
    return folder


def ring_area_km2(ring: list) -> float:
    """Area of a small lon/lat ring on the Mars sphere (local equal-area shoelace)."""
    pts = np.asarray(ring, dtype=np.float64)
    if len(pts) < 3:
        return 0.0
    body = pts[:-1] if np.array_equal(pts[0], pts[-1]) else pts
    lat0 = math.radians(float(np.mean(body[:, 1])))
    x = np.radians(pts[:, 0]) * MARS_RADIUS_KM * math.cos(lat0)
    y = np.radians(pts[:, 1]) * MARS_RADIUS_KM
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)


def _polygon_parts(geometry: dict) -> list:
    kind = geometry.get("type")
    if kind == "Polygon":
        return [geometry["coordinates"]]
    if kind == "MultiPolygon":
        return list(geometry["coordinates"])
    return []


def polygon_area_km2(geometry: dict) -> float:
    """Area of a (multi)polygon with holes subtracted."""
    total = 0.0
    for rings in _polygon_parts(geometry):
        if rings:
            total += ring_area_km2(rings[0]) - sum(ring_area_km2(hole) for hole in rings[1:])
    return max(total, 0.0)


def feature_cells(geometry: dict, res: float = FINE_RES) -> tuple[np.ndarray, np.ndarray]:
    """Spread one feature's area over the grid cells it covers: (flat cell index, km2).

    A feature inside one cell (every CRISM pixel) goes wholly to that cell. A larger one (merged
    OMEGA areas reach tens of thousands of km2) is rasterised at res / SUBDIVIDE inside its
    bounding box and its true area is shared evenly over the covered sub-pixels.
    """
    area = polygon_area_km2(geometry)
    exteriors = [np.asarray(rings[0], dtype=np.float64) for rings in _polygon_parts(geometry) if rings]
    if area <= 0 or not exteriors:
        return np.zeros(0, dtype=np.int64), np.zeros(0)
    pts = np.concatenate(exteriors)
    height, width = round(180 / res), round(360 / res)
    c0, c1 = (int(math.floor((v + 180.0) / res)) for v in (pts[:, 0].min(), pts[:, 0].max()))
    r0, r1 = (int(math.floor((90.0 - v) / res)) for v in (pts[:, 1].max(), pts[:, 1].min()))
    c0, c1 = max(c0, 0), min(c1, width - 1)
    r0, r1 = max(r0, 0), min(r1, height - 1)
    if c0 == c1 and r0 == r1:
        return np.array([r0 * width + c0], dtype=np.int64), np.array([area])
    sub = res / SUBDIVIDE
    mask = rasterize(
        [geometry], out_shape=((r1 - r0 + 1) * SUBDIVIDE, (c1 - c0 + 1) * SUBDIVIDE),
        transform=Affine(sub, 0, -180.0 + c0 * res, 0, -sub, 90.0 - r0 * res),
        fill=0, default_value=1, dtype="uint8",
    )
    rr, cc = np.nonzero(mask)
    if not rr.size:  # thin sliver between sub-pixel centres: put it at its centre
        lon, lat = float(pts[:, 0].mean()), float(pts[:, 1].mean())
        row = min(max(int(math.floor((90.0 - lat) / res)), 0), height - 1)
        col = min(max(int(math.floor((lon + 180.0) / res)), 0), width - 1)
        return np.array([row * width + col], dtype=np.int64), np.array([area])
    cells, counts = np.unique((r0 + rr // SUBDIVIDE) * width + (c0 + cc // SUBDIVIDE), return_counts=True)
    return cells.astype(np.int64), counts * (area / rr.size)


def class_cells(instrument: str, colour: str, cache: Path) -> tuple[np.ndarray, np.ndarray]:
    """Detected area per fine cell for one instrument/class, reduced once from the cached pages."""
    reduced = cache / "cells" / f"{instrument}_{colour}.npz"
    folder = cache / "pages" / f"MOCAAS_{instrument}_{colour}"
    if reduced.exists():
        with np.load(reduced) as saved:
            return saved["cells"], saved["area"]
    cells_parts, area_parts, features = [], [], 0
    for page in sorted(folder.glob(f"*-{PAGE_SIZE}.json.gz")):
        for feature in json.loads(gzip.decompress(page.read_bytes()))["features"]:
            features += 1
            if feature.get("geometry"):
                cells, area = feature_cells(feature["geometry"])
                cells_parts.append(cells)
                area_parts.append(area)
    expected = json.loads((folder / "count.json").read_text(encoding="utf-8"))["features"]
    if features != expected:
        raise ValueError(f"{instrument} {colour}: read {features} features, the service reported {expected}")
    cells, area = sum_cells(np.concatenate(cells_parts or [np.zeros(0, np.int64)]),
                            np.concatenate(area_parts or [np.zeros(0)]))
    reduced.parent.mkdir(parents=True, exist_ok=True)
    np.savez(reduced, cells=cells, area=area)
    return cells, area


def write_source_manifest(cache: Path, counts: dict) -> None:
    manifest = dict(SOURCE)
    manifest.update({
        "wfs": WFS_URL, "download_date": date.today().isoformat(),
        "feature_types": {f"MOCAAS_{inst}_{col}": {"class": CLASSES[col], "features": counts[(inst, col)]}
                          for inst, col in counts},
    })
    (cache / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


# ---------------------------------------------------------------- density

def cell_areas_km2(height: int, res: float, north: float = 90.0) -> np.ndarray:
    """Area of one grid cell in each row (row 0 at the north edge)."""
    edges = np.radians(north - np.arange(height + 1) * res)
    return MARS_RADIUS_KM**2 * math.radians(res) * (np.sin(edges[:-1]) - np.sin(edges[1:]))


def sum_cells(cells: np.ndarray, area: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Add up areas that share a cell index."""
    unique, inverse = np.unique(cells, return_inverse=True)
    return unique, np.bincount(inverse.ravel(), weights=area, minlength=unique.size)


def cap_cells(cells: np.ndarray, area: np.ndarray, res: float = FINE_RES) -> tuple[np.ndarray, np.ndarray]:
    """A cell cannot hold more detected area than its own area."""
    height, width = round(180 / res), round(360 / res)
    return cells, np.minimum(area, cell_areas_km2(height, res)[cells // width])


def point_cells(points: np.ndarray, res: float = FINE_RES) -> tuple[np.ndarray, np.ndarray]:
    """Cell index and area for (lon, lat, km2) point detections."""
    height, width = round(180 / res), round(360 / res)
    lon = ((points[:, 0] + 180.0) % 360.0) - 180.0
    col = np.clip(np.floor((lon + 180.0) / res).astype(np.int64), 0, width - 1)
    row = np.clip(np.floor((90.0 - points[:, 1]) / res).astype(np.int64), 0, height - 1)
    return row * width + col, points[:, 2].astype(np.float64)


def sparse_occupancy(points: np.ndarray, res: float = FINE_RES) -> tuple[np.ndarray, np.ndarray]:
    """Detected area per occupied cell for point detections, summed and capped at the cell area."""
    return cap_cells(*sum_cells(*point_cells(points, res)), res)


def merge_max(parts: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """Union of sparse occupancies, keeping the larger area where a cell appears more than once.

    One outcrop seen by OMEGA and CRISM therefore counts once.
    """
    cells = np.concatenate([c for c, _ in parts])
    area = np.concatenate([a for _, a in parts])
    if not cells.size:
        return cells, area
    order = np.lexsort((area, cells))
    cells, area = cells[order], area[order]
    last = np.r_[cells[1:] != cells[:-1], True]
    return cells[last], area[last]


def within_coverage(cells: np.ndarray, area: np.ndarray, res: float = FINE_RES,
                    limit: float = COVERAGE_LAT) -> tuple[np.ndarray, np.ndarray, float]:
    """Keep detections in cells whose centre is within the mapped band; also return the dropped km2.

    MOCAAS maps non-polar latitudes; a few OMEGA polar detections lie outside that band and
    would otherwise be divided by unmapped ground.
    """
    width = round(360 / res)
    lat = 90.0 - (cells // width + 0.5) * res
    keep = np.abs(lat) <= limit
    return cells[keep], area[keep], float(area[~keep].sum())


def to_grid(cells: np.ndarray, area: np.ndarray, res: float, factor: int = 1) -> np.ndarray:
    """Dense global grid at res * factor, summing the sparse cells that fall in each coarse cell."""
    height, width = round(180 / res), round(360 / res)
    rows, cols = cells // width // factor, cells % width // factor
    coarse_w = width // factor
    return np.bincount(rows * coarse_w + cols, weights=area,
                       minlength=(height // factor) * coarse_w).reshape(height // factor, coarse_w)


def occupancy(points: np.ndarray, res: float = FINE_RES) -> np.ndarray:
    """Dense grid of sparse_occupancy, for small grids and tests."""
    return to_grid(*sparse_occupancy(points, res), res)


def disc_sum(grid: np.ndarray, res: float, radius_km: float, north: float = 90.0) -> np.ndarray:
    """Sum of grid cells whose centres lie within radius_km (great circle) of each cell centre.

    The grid spans all longitudes, so windows wrap at the antimeridian.
    """
    height, width = grid.shape
    lat = np.radians(north - (np.arange(height) + 0.5) * res)
    cos_d = math.cos(radius_km / MARS_RADIUS_KM)
    padded = np.concatenate([grid, grid, grid], axis=1)
    csum = np.concatenate([np.zeros((height, 1)), np.cumsum(padded, axis=1)], axis=1)
    totals = grid.sum(axis=1)
    out = np.zeros_like(grid, dtype=np.float64)
    cols = np.arange(width)
    reach = int(math.ceil(math.degrees(radius_km / MARS_RADIUS_KM) / res)) + 1
    for i in range(height):
        for k in range(max(0, i - reach), min(height, i + reach + 1)):
            denom = math.cos(lat[i]) * math.cos(lat[k])
            if denom <= 1e-12:
                limit = 1.0 if math.sin(lat[i]) * math.sin(lat[k]) >= cos_d else -2.0
            else:
                limit = (cos_d - math.sin(lat[i]) * math.sin(lat[k])) / denom
            if limit > 1.0:
                continue
            if limit <= math.cos(math.pi):
                out[i] += totals[k]
                continue
            half = int(math.floor(math.degrees(math.acos(min(1.0, limit))) / res + 1e-9))
            if 2 * half + 1 >= width:
                out[i] += totals[k]
                continue
            out[i] += csum[k, cols + width + half + 1] - csum[k, cols + width - half]
    return out


def density_per_area(detected: np.ndarray, covered: np.ndarray, res: float, radius_km: float,
                     north: float = 90.0) -> np.ndarray:
    """Detected km2 per PER_AREA_KM2 of covered ground within radius_km; NaN where nothing is covered."""
    num = disc_sum(detected, res, radius_km, north)
    den = disc_sum(covered, res, radius_km, north)
    with np.errstate(invalid="ignore", divide="ignore"):
        result = np.where(den > 0, num / den * PER_AREA_KM2, np.nan)
    return result


def coverage_grid(height: int, res: float, north: float = 90.0, limit: float = COVERAGE_LAT) -> np.ndarray:
    """Cell area where the catalogue maps the ground (|lat| <= limit), else zero; full-width rows."""
    centres = north - (np.arange(height) + 0.5) * res
    areas = np.where(np.abs(centres) <= limit, cell_areas_km2(height, res, north), 0.0)
    return np.repeat(areas[:, None], round(360 / res), axis=1)


# ---------------------------------------------------------------- colour and legend

def ramp_limits(values: np.ndarray) -> tuple[float, float]:
    """Visible ramp: starts at the low percentile of non-zero values, saturates at the high percentile."""
    positive = values[np.isfinite(values) & (values > 0)]
    if not positive.size:
        return 0.0, 1.0
    low, high = (float(v) for v in np.percentile(positive, [RAMP_LOW_PERCENTILE, RAMP_HIGH_PERCENTILE]))
    if high <= low:
        high = low * 2 if low > 0 else 1.0
    return low, high


def _oklab_to_rgb(lab: np.ndarray) -> np.ndarray:
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


def mineral_colour(values: np.ndarray, low: float, high: float) -> np.ndarray:
    """RGBA for density values: transparent below low (and at nodata), teal-green ramp low..high."""
    if high <= low:
        raise ValueError("high must be greater than low")
    flat = np.asarray(values, dtype=np.float64).ravel()
    rgba = np.zeros((flat.size, 4), dtype=np.uint8)
    show = np.isfinite(flat) & (flat >= low) & (flat > 0)
    if show.any():
        t = np.clip((flat[show] - low) / (high - low), 0.0, 1.0)
        # Log-spaced position keeps the long tail of strong hotspots readable.
        t = np.log1p(9.0 * t) / math.log(10.0)
        knots = np.linspace(0.0, 1.0, len(MINERAL_STOPS))
        labs = np.array([_hex_to_oklab(colour) for colour, _ in MINERAL_STOPS])
        alphas = np.array([alpha for _, alpha in MINERAL_STOPS], dtype=np.float64)
        lab = np.column_stack([np.interp(t, knots, labs[:, j]) for j in range(3)])
        rgba[show, :3] = _oklab_to_rgb(lab)
        rgba[show, 3] = np.rint(np.interp(t, knots, alphas)).astype(np.uint8)
    return rgba.reshape(*np.shape(values), 4)


def legend(low: float, high: float) -> dict:
    samples = np.array([low, low + (high - low) * 0.25, low + (high - low) * 0.5, high])
    colours = mineral_colour(samples, low, high)
    stops = [[0.0, "#00000000"]] + [
        [float(v), "#%02x%02x%02x%02x" % tuple(int(c) for c in rgba)] for v, rgba in zip(samples, colours)
    ]
    return {"stops": stops, "min": low, "max": high,
            "min_label": format_legend_number(low), "max_label": format_legend_number(high),
            "units": UNITS, "palette": PALETTE_ID, "palette_label": PALETTE_LABEL}


def hotspots(values: np.ndarray, north: float, res: float, count: int = HOTSPOTS,
             separation_km: float = 2 * RADIUS_KM) -> list[dict]:
    """Highest cells, each at least separation_km from a stronger one already chosen."""
    finite = np.where(np.isfinite(values), values, -np.inf)
    order = np.argsort(finite, axis=None)[::-1]
    chosen: list[dict] = []
    width = values.shape[1]
    for flat in order:
        if len(chosen) >= count or not np.isfinite(finite.flat[flat]) or finite.flat[flat] <= 0:
            break
        row, col = divmod(int(flat), width)
        lat = north - (row + 0.5) * res
        lon = -180.0 + (col + 0.5) * res
        if any(_great_circle_km(lon, lat, h["lon"], h["lat"]) < separation_km for h in chosen):
            continue
        chosen.append({"lon": round(lon, 3), "lat": round(lat, 3), "value": round(float(values[row, col]), 3)})
    return chosen


def _great_circle_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return MARS_RADIUS_KM * math.acos(max(-1.0, min(1.0, c)))


# ---------------------------------------------------------------- output

def write_tiles(values: np.ndarray, north: float, low: float, high: float, folder: Path) -> int:
    transform = Affine(WORLD_RES, 0.0, -180.0, 0.0, -WORLD_RES, north)
    south = north - values.shape[0] * WORLD_RES
    written = 0
    source = values.astype(np.float32)
    for level in range(MAX_LEVEL + 1):
        for y in range(2**level):
            for x in range(2 ** (level + 1)):
                west, tile_south, east, tile_north = tile_rectangle(level, x, y)
                if tile_north <= south or tile_south >= north:
                    continue
                dst = np.full((256, 256), np.nan, dtype=np.float32)
                reproject(
                    source, dst, src_transform=transform, src_crs=MARS_LONLAT, src_nodata=np.nan,
                    dst_transform=Affine((east - west) / 256, 0, west, 0, -(tile_north - tile_south) / 256, tile_north),
                    dst_crs=MARS_LONLAT, dst_nodata=np.nan, resampling=Resampling.bilinear,
                )
                rgba = mineral_colour(dst, low, high)
                if not rgba[..., 3].any():
                    continue
                target = folder / str(level) / str(x) / f"{y}.png"
                target.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgba, "RGBA").save(target, optimize=True)
                written += 1
    return written


def layer_entry(layer_id: str, values: np.ndarray, north: float, out: Path, stats: dict,
                dropped_km2: float = 0.0) -> dict:
    cfg = LAYERS[layer_id]
    low, high = ramp_limits(values)
    finite = values[np.isfinite(values)]
    encode_max = float(finite.max()) if finite.size and finite.max() > 0 else 1.0
    encoded, scale, offset = quantise_values(values, 0.0, encode_max)
    folder = out / "layers" / layer_id
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    encoded.tofile(folder / "values.bin")
    tiles = write_tiles(values, north, low, high, folder)
    south = north - values.shape[0] * WORLD_RES
    entry = {
        "id": layer_id, "title": cfg["title"], "group": "minerals", "units": UNITS,
        "description": (cfg["description"] + f" Values below {format_legend_number(low)} are left clear "
                        "so the hot areas stand out; hover shows the exact value."),
        "tiles": f"layers/{layer_id}/{{z}}/{{x}}/{{y}}.png",
        "tiling": "geographic", "min_level": 0, "max_level": MAX_LEVEL,
        "rectangle": [-180, south, 180, north],
        "values": {"url": f"layers/{layer_id}/values.bin", "width": values.shape[1], "height": values.shape[0],
                   "west": -180, "north": north, "res_deg": WORLD_RES, "scale": scale, "offset": offset,
                   "nodata": NODATA},
        "legend": legend(low, high),
        "source": {k: SOURCE[k] for k in ("dataset", "citation", "licence", "licence_note")},
        "method": {"classes": [CLASSES[c] for c in cfg["classes"]], "radius_km": RADIUS_KM,
                   "occupancy_res_deg": FINE_RES, "coverage_lat": COVERAGE_LAT,
                   "instrument_merge": "max of OMEGA and CRISM mapped area per occupancy cell",
                   "ramp_percentiles": [RAMP_LOW_PERCENTILE, RAMP_HIGH_PERCENTILE],
                   "polar_detections_excluded_km2": round(dropped_km2, 1)},
        "hotspots": hotspots(values, north, WORLD_RES),
    }
    stats[layer_id] = {
        "min": float(finite.min()), "max": float(finite.max()), "ramp": [low, high],
        "nonzero_fraction": float(np.mean(finite > 0)), "visible_fraction": float(np.mean(finite >= low)),
        "tiles": tiles, "hotspots": entry["hotspots"][:5],
    }
    return entry


def merge_manifest(out: Path, entries: list[dict]) -> None:
    path = out / "layers.json"
    current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"version": 1, "layers": []}
    merged = {entry["id"]: entry for entry in current.get("layers", [])}
    merged.update({entry["id"]: entry for entry in entries})
    current["layers"] = [merged[key] for key in sorted(merged)]
    current.setdefault("version", 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")


def build(out: Path = OUT, cache: Path = RAW, only: list[str] | None = None) -> dict:
    layer_ids = only or list(LAYERS)
    unknown = [layer_id for layer_id in layer_ids if layer_id not in LAYERS]
    if unknown:
        raise SystemExit(f"unknown layer id: {', '.join(unknown)}")
    needed = sorted({colour for layer_id in layer_ids for colour in LAYERS[layer_id]["classes"]})
    counts, sets = {}, {}
    for instrument in INSTRUMENTS:
        for colour in needed:
            folder = download_class(instrument, colour, cache)
            counts[(instrument, colour)] = json.loads((folder / "count.json").read_text())["features"]
            sets[(instrument, colour)] = class_cells(instrument, colour, cache)
            print(f"{instrument} {colour}: {counts[(instrument, colour)]} features, "
                  f"{sets[(instrument, colour)][1].sum():.0f} km2", flush=True)
    write_source_manifest(cache, counts)

    factor = round(WORLD_RES / FINE_RES)
    height = round(180 / WORLD_RES)
    covered = coverage_grid(height, WORLD_RES)
    rows = slice(round((90 - COVERAGE_LAT) / WORLD_RES), round((90 + COVERAGE_LAT) / WORLD_RES))
    entries, stats = [], {}
    for layer_id in layer_ids:
        per_instrument = []
        for inst in INSTRUMENTS:
            parts = [sets[(inst, col)] for col in LAYERS[layer_id]["classes"]]
            merged = sum_cells(np.concatenate([c for c, _ in parts]), np.concatenate([a for _, a in parts]))
            per_instrument.append(cap_cells(*merged))
        cells, area, dropped = within_coverage(*merge_max(per_instrument))
        detected = to_grid(cells, area, FINE_RES, factor)
        density = density_per_area(detected, covered, WORLD_RES, RADIUS_KM)[rows].astype(np.float32)
        entries.append(layer_entry(layer_id, density, COVERAGE_LAT, out, stats, dropped))
        print(f"{layer_id}: done", flush=True)
    merge_manifest(out, entries)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT, help="globe output directory (default data/globe)")
    parser.add_argument("--cache", type=Path, default=RAW, help="download cache (default data/raw/mocaas)")
    parser.add_argument("--only", action="append", choices=sorted(LAYERS), help="build one layer; repeatable")
    args = parser.parse_args()
    stats = build(args.out.resolve(), args.cache.resolve(), args.only)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
