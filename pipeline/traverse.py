"""Build compact rover-traverse GeoJSON from shared localized pose tables."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Iterable, Sequence

MARS_R = 3396190.0
ROOT = Path(__file__).resolve().parents[1]
MARGIN_M = 250.0
TOLERANCE_M = 2.0

# Site footprints in the equirectangular Mars frame used by pipeline/sites/*.yaml.
AREAS = {
    "gale": (8142000.0, -286000.0, 8146000.0, -282000.0),
    "jezero": (4587000.0, 1092300.0, 4591000.0, 1096300.0),
}


def dedupe_consecutive(points: Iterable[Sequence[float]]) -> list[tuple[float, float]]:
    """Remove repeated adjacent coordinates while preserving the input order."""
    result: list[tuple[float, float]] = []
    for point in points:
        coordinate = (float(point[0]), float(point[1]))
        if not result or coordinate != result[-1]:
            result.append(coordinate)
    return result


def simplify_xy(points: Sequence[Sequence[float]], tolerance_m: float) -> list[tuple[float, float]]:
    """Douglas-Peucker simplify projected metre coordinates, keeping endpoints."""
    if tolerance_m < 0:
        raise ValueError("tolerance must be non-negative")
    if len(points) < 3:
        return [(float(p[0]), float(p[1])) for p in points]

    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    tolerance_sq = tolerance_m * tolerance_m
    while pending:
        start, end = pending.pop()
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        farthest_index = -1
        farthest_sq = -1.0
        for index in range(start + 1, end):
            px, py = points[index]
            if length_sq == 0:
                distance_sq = (px - ax) ** 2 + (py - ay) ** 2
            else:
                ratio = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
                distance_sq = (px - (ax + ratio * dx)) ** 2 + (py - (ay + ratio * dy)) ** 2
            if distance_sq > farthest_sq:
                farthest_sq, farthest_index = distance_sq, index
        if farthest_index >= 0 and farthest_sq > tolerance_sq:
            keep.add(farthest_index)
            pending.extend(((start, farthest_index), (farthest_index, end)))
    return [(float(points[i][0]), float(points[i][1])) for i in sorted(keep)]


def local_xy(point: Sequence[float], lat_c_rad: float) -> tuple[float, float]:
    lon, lat = point
    return MARS_R * math.cos(lat_c_rad) * math.radians(lon), MARS_R * math.radians(lat)


def select_area_path(points: list[tuple[float, float]], site: str) -> list[tuple[float, float]]:
    """Keep the ordered traverse between its first and last visits near the site."""
    left, bottom, right, top = AREAS[site]
    indices = [
        index for index, (lon, lat) in enumerate(points)
        if left - MARGIN_M <= MARS_R * math.radians(lon) <= right + MARGIN_M
        and bottom - MARGIN_M <= MARS_R * math.radians(lat) <= top + MARGIN_M
    ]
    if not indices:
        raise ValueError(f"no {site} poses inside the configured area and margin")
    return points[indices[0]:indices[-1] + 1]


def build_coordinates(points: Iterable[Sequence[float]], tolerance_m: float = TOLERANCE_M) -> list[list[float]]:
    """Dedupe then simplify lon/lat in a local-metre frame."""
    unique = dedupe_consecutive(points)
    if len(unique) < 3:
        simplified = unique
    else:
        lat_c = math.radians(sum(point[1] for point in unique) / len(unique))
        projected = [local_xy(point, lat_c) for point in unique]
        kept_xy = simplify_xy(projected, tolerance_m)
        # Preserve exact input lon/lat at selected indexes, including path endpoints.
        selected = {xy: lonlat for xy, lonlat in zip(projected, unique)}
        simplified = [selected[xy] for xy in kept_xy]
    return [[round(lon, 6), round(lat, 6)] for lon, lat in simplified]


def load_pose_positions(path: Path) -> list[tuple[float, float]]:
    with path.open(newline="", encoding="utf-8") as stream:
        return [(float(row["lon"]), float(row["lat"])) for row in csv.DictReader(stream)]


def main() -> None:
    for site in ("gale", "jezero"):
        poses = load_pose_positions(ROOT / "shared" / "poses" / f"{site}_poses.csv")
        path = select_area_path(poses, site)
        coordinates = build_coordinates(path)
        if len(coordinates) < 2:
            raise ValueError(f"{site} traverse has fewer than two unique points")
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": {"site": site},
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }],
        }
        output = ROOT / "app" / "public" / "data" / site / "traverse.geojson"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(geojson, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{output.relative_to(ROOT)}: {len(coordinates)} positions, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
