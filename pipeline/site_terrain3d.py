"""Build a 3D Tiles terrain mesh for a site bundle from its terrain.pmtiles.

Written with AI assistance, directed and reviewed by the team.

Usage:
    python pipeline/site_terrain3d.py <bundle_dir> --height-offset-m 73.76

The highest zoom of terrain.pmtiles (Mapbox terrain-RGB, written by bake.py) is decoded and
resampled to a longitude/latitude grid at the DEM resolution. A quadtree of glb meshes is written
to <bundle_dir>/terrain3d/ with tileset.json: the root covers the whole site, each level halves the
vertex spacing, and the leaves sit at the DEM resolution.

Vertices are Earth-fixed Mars coordinates on Cesium's Ellipsoid.MARS (3396190 m equatorial,
3376200 m polar), treating bundle latitude as the ellipsoid latitude, the same convention the app
uses for imagery and overlays. Heights are the DEM height plus the height offset to Cesium Mars.
Tile edges carry skirts; site-edge skirts drop to a common floor below the lowest edge point so the
site closes against Cesium Mars online and against the plain ellipsoid offline.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import shutil
import struct
from pathlib import Path

import numpy as np
from PIL import Image
from pmtiles.reader import MmapSource, Reader, all_tiles

MARS_A = 3396190.0
MARS_B = 3376200.0
TILE_PX = 256
TILE_CELLS = 64
SKIRT_MARGIN_M = 20.0
NORMAL_SCALE = 127
BAND_ROWS = 8

DEFAULT_HEIGHT_OFFSETS_M: dict[str, float] = {
    "gale": 70.91,
    "jezero": -70.92,
}


def decode_terrain_rgb(rgb: np.ndarray) -> np.ndarray:
    """Heights in metres from Mapbox terrain-RGB pixels; the all-zero nodata pixel becomes NaN."""
    rgb = rgb.astype(np.int64)
    encoded = rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]
    return np.where(encoded == 0, np.nan, -10000.0 + encoded * 0.1)


def mosaic_zoom(min_zoom: int, max_zoom: int, lat_deg: float, resolution_m: float) -> int:
    """The coarsest zoom whose pixels are no larger than resolution_m, within the archive's zooms."""
    ground_px_z0 = 2 * math.pi * MARS_A * math.cos(math.radians(lat_deg)) / TILE_PX
    return min(max_zoom, max(min_zoom, math.ceil(math.log2(ground_px_z0 / resolution_m))))


def read_terrain_mosaic(path: Path, lat_deg: float, resolution_m: float) -> tuple[int, int, int, np.ndarray]:
    """Heights at the zoom matching resolution_m (or the highest held) as (zoom, first x, first y, heights)."""
    with path.open("rb") as f:
        reader = Reader(MmapSource(f))
        header = reader.header()
        zoom = mosaic_zoom(header["min_zoom"], header["max_zoom"], lat_deg, resolution_m)
        tiles = {(x, y): data for (z, x, y), data in all_tiles(reader.get_bytes) if z == zoom}
    if not tiles:
        raise ValueError(f"{path} has no tiles at zoom {zoom}")
    xs = [x for x, _ in tiles]
    ys = [y for _, y in tiles]
    x0, y0 = min(xs), min(ys)
    mosaic = np.full(((max(ys) - y0 + 1) * TILE_PX, (max(xs) - x0 + 1) * TILE_PX), np.nan, dtype=np.float32)
    for (x, y), data in tiles.items():
        rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
        mosaic[(y - y0) * TILE_PX:(y - y0 + 1) * TILE_PX, (x - x0) * TILE_PX:(x - x0 + 1) * TILE_PX] = decode_terrain_rgb(rgb)
    return zoom, x0, y0, mosaic


def mercator_pixel(lon: np.ndarray, lat: np.ndarray, zoom: int) -> tuple[np.ndarray, np.ndarray]:
    """Global Web Mercator pixel coordinates, pixel centres at half-integers."""
    scale = TILE_PX * 2 ** zoom
    lat_r = np.radians(lat)
    px = (np.asarray(lon) + 180.0) / 360.0 * scale
    py = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / math.pi) / 2.0 * scale
    return px, py


def sample_bilinear(mosaic: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Bilinear samples at mosaic pixel coordinates, weighting only valid neighbours."""
    fx, fy = px - 0.5, py - 0.5
    ix, iy = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - ix, fy - iy
    total = np.zeros(np.broadcast(px, py).shape)
    weight = np.zeros_like(total)
    for dy, wy in ((0, 1 - ty), (1, ty)):
        for dx, wx in ((0, 1 - tx), (1, tx)):
            r = np.clip(iy + dy, 0, mosaic.shape[0] - 1)
            c = np.clip(ix + dx, 0, mosaic.shape[1] - 1)
            value = mosaic[r, c]
            w = np.where(np.isfinite(value), wx * wy, 0.0)
            total += np.where(w > 0, value, 0.0) * w
            weight += w
    return np.where(weight > 0, total / np.maximum(weight, 1e-12), np.nan)


def fill_gaps(heights: np.ndarray) -> np.ndarray:
    """Fills NaN cells from the mean of their valid 4-neighbours, growing inwards until none remain."""
    h = heights.copy()
    if not np.isfinite(h).any():
        raise ValueError("terrain has no valid heights inside the site")
    while not np.isfinite(h).all():
        padded = np.pad(h, 1, constant_values=np.nan)
        neighbours = np.stack([padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:]])
        count = np.isfinite(neighbours).sum(axis=0)
        mean = np.nansum(neighbours, axis=0) / np.maximum(count, 1)
        grow = ~np.isfinite(h) & (count > 0)
        h[grow] = mean[grow]
    return h


def geodetic_to_ecef(lon_deg, lat_deg, height_m) -> np.ndarray:
    """Cesium's Cartesian3.fromDegrees on Ellipsoid.MARS; returns (..., 3)."""
    lon, lat = np.radians(lon_deg), np.radians(lat_deg)
    n = np.stack(np.broadcast_arrays(np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)), axis=-1)
    radii_sq = np.array([MARS_A ** 2, MARS_A ** 2, MARS_B ** 2])
    k = radii_sq * n
    gamma = np.sqrt((n * k).sum(axis=-1, keepdims=True))
    return k / gamma + n * np.asarray(height_m)[..., None]


def enu_axes(lon_deg: float, lat_deg: float) -> np.ndarray:
    """Rows east, north and up (geodetic normal) at a point on Ellipsoid.MARS."""
    return enu_axes_grid(np.array([lon_deg]), np.array([lat_deg]))[:, 0]


def enu_axes_grid(lon_deg: np.ndarray, lat_deg: np.ndarray) -> np.ndarray:
    """East, north and up unit vectors, shape (3, n, 3), at each of n points."""
    lon, lat = np.radians(lon_deg), np.radians(lat_deg)
    zero = np.zeros_like(lon)
    east = np.stack([-np.sin(lon), np.cos(lon), zero], axis=-1)
    north = np.stack([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)], axis=-1)
    up = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)
    return np.stack([east, north, up])


def bounding_box(positions: np.ndarray, lon_deg: float, lat_deg: float) -> list[float]:
    """3D Tiles box (centre, then three half-axes) aligned east, north, up at the given point."""
    axes = enu_axes(lon_deg, lat_deg)
    local = positions @ axes.T
    lo, hi = local.min(axis=0), local.max(axis=0)
    centre = ((lo + hi) / 2) @ axes
    half = axes * ((hi - lo) / 2)[:, None]
    return [float(v) for v in np.concatenate([centre, half.reshape(-1)])]


def lattice(count: int, step: int) -> np.ndarray:
    """Grid indices 0, step, 2*step, ... always ending on the last index `count`."""
    idx = np.arange(0, count, step)
    return np.append(idx, count)


def mesh_deviation(fine: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> float:
    """Largest vertical gap between the fine grid and the triangle mesh on the given lattice.

    `fine` covers rows[0]..rows[-1] by cols[0]..cols[-1]; lattice indices are absolute and the
    fine grid starts at rows[0], cols[0]. Each lattice quad is split along its SE-NW diagonal.
    """
    rr = np.arange(rows[0], rows[-1] + 1)
    cc = np.arange(cols[0], cols[-1] + 1)
    ri = np.clip(np.searchsorted(rows, rr, side="right") - 1, 0, len(rows) - 2)
    ci = np.clip(np.searchsorted(cols, cc, side="right") - 1, 0, len(cols) - 2)
    v = ((rr - rows[ri]) / (rows[ri + 1] - rows[ri]))[:, None]
    u = ((cc - cols[ci]) / (cols[ci + 1] - cols[ci]))[None, :]
    coarse = fine[np.ix_(rows - rows[0], cols - cols[0])]
    a = coarse[ri][:, ci]
    b = coarse[ri][:, ci + 1]
    c = coarse[ri + 1][:, ci]
    d = coarse[ri + 1][:, ci + 1]
    lower = a + u * (b - a) + v * (c - a)
    upper = d + (1 - u) * (c - d) + (1 - v) * (b - d)
    mesh = np.where(u + v <= 1, lower, upper)
    return float(np.abs(fine - mesh).max())


def level_errors(heights: np.ndarray, depth: int, cell_m: float) -> list[float]:
    """Geometric error per level, root first: the larger of the vertex spacing and the largest
    vertical gap to the DEM, never below the level beneath it; zero at the DEM-resolution leaves."""
    rows_n, cols_n = heights.shape[0] - 1, heights.shape[1] - 1
    errors = [0.0] * (depth + 1)
    for level in range(depth - 1, -1, -1):
        step = 2 ** (depth - level)
        rows, cols = lattice(rows_n, step), lattice(cols_n, step)
        gap = 0.0
        # Bands of a few lattice rows keep memory flat on a full 4 km site.
        for start in range(0, len(rows) - 1, BAND_ROWS):
            band = rows[start:start + BAND_ROWS + 1]
            gap = max(gap, mesh_deviation(heights[band[0]:band[-1] + 1], band, cols))
        errors[level] = max(step * cell_m, gap, errors[level + 1])
    return errors


def vertex_normals(positions: np.ndarray) -> np.ndarray:
    """Unit normals of a (rows, cols, 3) position grid, rows northward and cols eastward."""
    d_row = np.gradient(positions, axis=0)
    d_col = np.gradient(positions, axis=1)
    n = np.cross(d_col, d_row)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def edge_loop(rows: int, cols: int) -> list[list[tuple[int, int]]]:
    """Border (row, col) indices counter-clockwise seen from above: south, east, north, west."""
    south = [(0, c) for c in range(cols)]
    east = [(r, cols - 1) for r in range(rows)]
    north = [(rows - 1, c) for c in range(cols - 1, -1, -1)]
    west = [(r, 0) for r in range(rows - 1, -1, -1)]
    return [south, east, north, west]


def tile_mesh(heights: np.ndarray, lon: np.ndarray, lat: np.ndarray, outer: list[bool],
              skirt_depth_m: float, floor_m: float, normals: np.ndarray | None = None):
    """Vertices (height grid then skirt rows), normals, skirt flags and triangle indices for one tile,
    plus the skirt vertex heights.

    `outer` flags the south, east, north and west edges that lie on the site boundary; their skirts
    drop to `floor_m`, the others drop `skirt_depth_m` below the edge. Skirt vertices take the
    horizontal outward normal of their edge, so walls shade like cliffs. Grid normals default to
    the tile's own; pass the level's normals so neighbouring tiles shade alike along shared edges.
    """
    rows, cols = heights.shape
    lon_g, lat_g = np.meshgrid(lon, lat)
    positions = geodetic_to_ecef(lon_g, lat_g, heights)
    if normals is None:
        normals = vertex_normals(positions)
    pos = [positions.reshape(-1, 3)]
    nor = [normals.reshape(-1, 3)]
    tris = []
    idx = np.arange(rows * cols).reshape(rows, cols)
    a, b, c, d = idx[:-1, :-1], idx[:-1, 1:], idx[1:, :-1], idx[1:, 1:]
    tris.append(np.stack([a, b, c], axis=-1).reshape(-1, 3))
    tris.append(np.stack([b, d, c], axis=-1).reshape(-1, 3))
    next_index = rows * cols
    skirt_heights = []
    outward_en = [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)]
    for edge, on_site_edge, (out_e, out_n) in zip(edge_loop(rows, cols), outer, outward_en):
        r = np.array([p[0] for p in edge])
        k = np.array([p[1] for p in edge])
        top = idx[r, k]
        h = np.full(len(edge), floor_m) if on_site_edge else heights[r, k] - skirt_depth_m
        skirt_heights.append(h)
        pos.append(geodetic_to_ecef(lon[k], lat[r], h))
        axes = enu_axes_grid(lon[k], lat[r])
        nor.append(out_e * axes[0] + out_n * axes[1])
        bottom = np.arange(next_index, next_index + len(edge))
        next_index += len(edge)
        tris.append(np.stack([top[:-1], bottom[:-1], top[1:]], axis=-1))
        tris.append(np.stack([bottom[:-1], bottom[1:], top[1:]], axis=-1))
    skirt = np.arange(next_index) >= rows * cols
    return np.concatenate(pos), np.concatenate(nor), skirt, np.concatenate(tris), np.concatenate(skirt_heights)


def _pad4(data: bytes, fill: bytes = b"\0") -> bytes:
    return data + fill * (-len(data) % 4)


def write_glb(path: Path, positions: np.ndarray, normals: np.ndarray, skirt: np.ndarray, triangles: np.ndarray) -> int:
    """One-mesh glb: float positions about a node translation, int8 normals (KHR_mesh_quantization),
    glTF y-up axes as 3D Tiles expects (Earth-fixed z becomes glTF y). The spare fourth byte of each
    packed normal holds the _SKIRT flag (255 on skirt vertices), read as its own attribute."""
    centre = (positions.min(axis=0) + positions.max(axis=0)) / 2
    local = positions - centre
    gl_pos = np.stack([local[:, 0], local[:, 2], -local[:, 1]], axis=-1).astype(np.float32)
    gl_nor = np.stack([normals[:, 0], normals[:, 2], -normals[:, 1]], axis=-1)
    packed = np.zeros((len(gl_nor), 4), dtype=np.uint8)
    packed[:, :3] = np.rint(gl_nor * NORMAL_SCALE).astype(np.int8).view(np.uint8)
    packed[:, 3] = np.where(skirt, 255, 0)
    index_type, index_dtype = (5123, np.uint16) if len(gl_pos) < 65536 else (5125, np.uint32)
    blobs = [gl_pos.tobytes(), packed.tobytes(), triangles.astype(index_dtype).tobytes()]
    offsets, binary = [], b""
    for blob in blobs:
        offsets.append(len(binary))
        binary += _pad4(blob)
    gltf = {
        "asset": {"version": "2.0", "generator": "site_terrain3d.py"},
        "extensionsUsed": ["KHR_mesh_quantization"],
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "translation": [float(centre[0]), float(centre[2]), float(-centre[1])]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "_SKIRT": 3}, "indices": 2, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1}}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": offsets[0], "byteLength": len(blobs[0]), "target": 34962},
            {"buffer": 0, "byteOffset": offsets[1], "byteLength": len(blobs[1]), "byteStride": 4, "target": 34962},
            {"buffer": 0, "byteOffset": offsets[2], "byteLength": len(blobs[2]), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(gl_pos), "type": "VEC3",
             "min": gl_pos.min(axis=0).tolist(), "max": gl_pos.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": 5120, "normalized": True, "count": len(gl_pos), "type": "VEC3"},
            {"bufferView": 2, "componentType": index_type, "count": int(triangles.size), "type": "SCALAR"},
            {"bufferView": 1, "byteOffset": 3, "componentType": 5121, "normalized": True, "count": len(gl_pos), "type": "SCALAR"},
        ],
    }
    header_json = _pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(header_json) + 8 + len(binary)
    out = (struct.pack("<III", 0x46546C67, 2, total)
           + struct.pack("<II", len(header_json), 0x4E4F534A) + header_json
           + struct.pack("<II", len(binary), 0x004E4942) + binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)
    return total


def quadtree_depth(cells: int, tile_cells: int = TILE_CELLS) -> int:
    """Levels below the root so the leaves hold at most tile_cells DEM cells a side."""
    return max(0, math.ceil(math.log2(math.ceil(cells / tile_cells))))


def build_tileset(heights: np.ndarray, lon: np.ndarray, lat: np.ndarray, out_dir: Path,
                  height_offset_m: float, cell_m: float, tile_cells: int = TILE_CELLS) -> dict:
    """Writes the glb quadtree under out_dir and returns the tileset.json dictionary.

    heights: (len(lat), len(lon)) DEM heights, rows south to north; heights are offset here.
    """
    mars_h = heights + height_offset_m
    rows_n, cols_n = mars_h.shape[0] - 1, mars_h.shape[1] - 1
    depth = quadtree_depth(max(rows_n, cols_n), tile_cells)
    errors = level_errors(mars_h, depth, cell_m)
    edge = np.concatenate([mars_h[0], mars_h[-1], mars_h[:, 0], mars_h[:, -1]])
    floor_m = float(edge.min()) - SKIRT_MARGIN_M
    stats = {"tiles": 0, "bytes": 0, "max_tile_bytes": 0}

    def tile(level: int, ti: int, tj: int) -> dict | None:
        step = 2 ** (depth - level)
        span = tile_cells * step
        r0, c0 = ti * span, tj * span
        if r0 >= rows_n or c0 >= cols_n:
            return None
        r1, c1 = min(r0 + span, rows_n), min(c0 + span, cols_n)
        all_rows, all_cols = lattice(rows_n, step), lattice(cols_n, step)
        ri = np.flatnonzero((all_rows >= r0) & (all_rows <= r1))
        ci = np.flatnonzero((all_cols >= c0) & (all_cols <= c1))
        # Normals from the tile plus one lattice vertex around it, cropped back to the tile.
        ra = all_rows[max(ri[0] - 1, 0):ri[-1] + 2]
        ca = all_cols[max(ci[0] - 1, 0):ci[-1] + 2]
        lon_a, lat_a = np.meshgrid(lon[ca], lat[ra])
        apron = vertex_normals(geodetic_to_ecef(lon_a, lat_a, mars_h[np.ix_(ra, ca)]))
        r_off, c_off = int(ri[0] > 0), int(ci[0] > 0)
        normals = apron[r_off:r_off + len(ri), c_off:c_off + len(ci)]
        rows, cols = all_rows[ri], all_cols[ci]
        outer = [r0 == 0, c1 == cols_n, r1 == rows_n, c0 == 0]
        skirt_depth = errors[max(level - 1, 0)]
        pos, nor, skirt, tris, _ = tile_mesh(mars_h[np.ix_(rows, cols)], lon[cols], lat[rows], outer, skirt_depth,
                                             floor_m, normals)
        name = f"{level}/{tj}_{ti}.glb"
        size = write_glb(out_dir / name, pos, nor, skirt, tris)
        stats["tiles"] += 1
        stats["bytes"] += size
        stats["max_tile_bytes"] = max(stats["max_tile_bytes"], size)
        mid_lon, mid_lat = (lon[c0] + lon[c1]) / 2, (lat[r0] + lat[r1]) / 2
        node = {
            "boundingVolume": {"box": bounding_box(pos, mid_lon, mid_lat)},
            "geometricError": errors[level],
            "content": {"uri": name},
        }
        if level < depth:
            children = [tile(level + 1, 2 * ti + di, 2 * tj + dj) for di in (0, 1) for dj in (0, 1)]
            node["children"] = [child for child in children if child]
        return node

    root = tile(0, 0, 0)
    root["refine"] = "REPLACE"
    return {
        "asset": {"version": "1.1", "generator": "site_terrain3d.py"},
        # Undrawn, the site would be a hole in Cesium Mars, so the tileset must draw whenever in view.
        "geometricError": MARS_A,
        "extras": {
            "height_offset_m": height_offset_m,
            "edge_min_height_m": float(edge.min()),
            "skirt_floor_m": floor_m,
            "cell_m": cell_m,
            "levels": depth + 1,
            "level_geometric_error_m": errors,
            "tiles": stats["tiles"],
            "bytes": stats["bytes"],
            "max_tile_bytes": stats["max_tile_bytes"],
        },
        "root": root,
    }


def site_grid(site: dict, resolution_m: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Vertex longitudes and latitudes (south to north) at about resolution_m, and the cell size."""
    west, south, east, north = site["bounds_lonlat"]
    cols = max(1, round(site["size_m"]["width"] / resolution_m))
    rows = max(1, round(site["size_m"]["height"] / resolution_m))
    cell_m = max(site["size_m"]["width"] / cols, site["size_m"]["height"] / rows)
    return np.linspace(west, east, cols + 1), np.linspace(south, north, rows + 1), cell_m


def dem_resolution_m(site: dict) -> float:
    """The DEM resolution recorded with the slope layer, which bake.py derives from the DEM."""
    slope = next((layer for layer in site.get("layers", []) if layer.get("id") == "slope"), None)
    return float(slope["resolution_m"]) if slope and slope.get("resolution_m") else 1.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("bundle", type=Path, help="site bundle directory with site.json and terrain.pmtiles")
    ap.add_argument("--height-offset-m", type=float,
                    help="Cesium Mars height minus DEM height at the site; default site.json terrain.height_offset_m")
    ap.add_argument("--resolution-m", type=float, help="leaf vertex spacing; default the DEM resolution")
    args = ap.parse_args()
    site = json.loads((args.bundle / "site.json").read_text(encoding="utf-8"))
    terrain = site["terrain"]
    if terrain.get("encoding") != "mapbox":
        raise ValueError(f"unsupported terrain encoding {terrain.get('encoding')}")
    offset = (
        args.height_offset_m
        if args.height_offset_m is not None
        else terrain.get("height_offset_m", DEFAULT_HEIGHT_OFFSETS_M.get(site.get("id")))
    )
    if offset is None:
        raise SystemExit("height offset missing: pass --height-offset-m or record terrain.height_offset_m in site.json")
    lon, lat, cell_m = site_grid(site, args.resolution_m or dem_resolution_m(site))
    zoom, x0, y0, mosaic = read_terrain_mosaic(args.bundle / terrain["url"], float(lat.mean()), cell_m)
    px = mercator_pixel(lon, np.full_like(lon, lat[0]), zoom)[0] - x0 * TILE_PX
    py = mercator_pixel(np.full_like(lat, lon[0]), lat, zoom)[1] - y0 * TILE_PX
    heights = np.empty((len(lat), len(lon)))
    for start in range(0, len(lat), 256):
        band = slice(start, start + 256)
        heights[band] = sample_bilinear(mosaic, px[None, :], py[band, None])
    del mosaic
    heights = fill_gaps(heights)
    out_dir = args.bundle / "terrain3d"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    tileset = build_tileset(heights, lon, lat, out_dir, float(offset), cell_m)
    (out_dir / "tileset.json").write_text(json.dumps(tileset, indent=1) + "\n", encoding="utf-8")
    extras = tileset["extras"]
    print(f"{site['id']}: z{zoom} terrain, {heights.shape[1]}x{heights.shape[0]} vertices at {cell_m:.3f} m, "
          f"offset {offset:+.2f} m, {extras['levels']} levels, {extras['tiles']} tiles, "
          f"{extras['bytes'] / 1e6:.2f} MB, largest tile {extras['max_tile_bytes'] / 1e3:.0f} kB, "
          f"errors {', '.join(f'{e:.2f}' for e in extras['level_geometric_error_m'])} m")


if __name__ == "__main__":
    main()
