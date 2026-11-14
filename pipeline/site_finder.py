"""Rank globally viable Mars exploration sites from the bundled map layers."""

from __future__ import annotations

import csv
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from matplotlib.colors import LightSource


MARS_RADIUS_KM = 3396.19
ROOT = Path(__file__).resolve().parents[1]
GRID_DIR = Path("data/processed/global-layers")
KNOWN_SITES = ROOT / "data" / "raw" / "known_sites" / "known_sites.csv"
DTM_INDEX = Path("data/raw/hez_dem_index/dem_index_v1.xlsx")
OUTPUT = Path("data/globe/sites.json")
PREVIEW = Path(".shots/site-finder-candidates.png")
LAYERS = {
    "elevation_m": "elevation_m.tif",
    "slope_p90_deg": "slope_p90_deg.tif",
    "roughness_m": "roughness_m.tif",
    "ice_dist_km": "ice_dist_km.tif",
    "ice_dist_km_0_5m": "ice_dist_km_0_5m.tif",
    "dose_ugy_day": "dose_ugy_day.tif",
    "dust_mean": "dust_mean.tif",
    "dust_p95": "dust_p95.tif",
    "storm_frac": "storm_frac.tif",
    "insolation_wm2": "insolation_wm2.tif",
    "cave_count_zone": "cave_count_zone.tif",
    "unit_diversity_zone": "unit_diversity_zone.tif",
    "tes_ti_night_2007": "tes_ti_night_2007.tif",
    "surface_pressure_pa": "surface_pressure_pa.tif",
}
GROUP_WEIGHTS = {"terrain": 0.20, "climate": 0.20, "solar": 0.20, "protection": 0.20, "science": 0.20}
AFTER_CRITERIA = {
    "terrain": {"slope_p90_deg": (0.40, False), "roughness_m": (0.17, False), "elevation_m": (0.18, False), "tes_ti_night_2007": (0.15, False), "habitat_dist_km": (0.10, False)},
    "climate": {"dust_mean": (0.10, False), "dust_p95": (0.10, False), "storm_frac": (0.05, False), "surface_pressure_pa": (0.35, True), "ice_dist_km": (0.40, False)},
    "solar": {"insolation_wm2": (1.0, True)},
    "protection": {"dose_ugy_day": (0.75, False), "cave_count_zone": (0.25, True)},
    "science": {"unit_diversity_zone": (1.0, True)},
}
BEFORE_CRITERIA = {**AFTER_CRITERIA, "climate": {"dust_mean": (0.25, False), "dust_p95": (0.35, False), "storm_frac": (0.25, False), "surface_pressure_pa": (0.05, True), "ice_dist_km": (0.05, False)}}


def average_percentiles(values, higher_is_better: bool = True) -> np.ndarray:
    """Return average-rank percentiles from 0 to 100, preserving NaNs."""
    arr = np.asarray(values, dtype=np.float64)
    flat = arr.ravel()
    valid = np.isfinite(flat)
    out = np.full(flat.shape, np.nan, dtype=np.float64)
    indices = np.flatnonzero(valid)
    if not len(indices):
        return out.reshape(arr.shape)
    order = np.argsort(flat[indices], kind="mergesort")
    sorted_indices = indices[order]
    sorted_values = flat[sorted_indices]
    n = len(sorted_values)
    starts = np.r_[0, np.flatnonzero(sorted_values[1:] != sorted_values[:-1]) + 1]
    ends = np.r_[starts[1:], n]
    for start, end in zip(starts, ends):
        avg_rank_zero_based = (start + end - 1) / 2.0
        pct = 50.0 if n == 1 else 100.0 * avg_rank_zero_based / (n - 1)
        if not higher_is_better:
            pct = 100.0 - pct
        out[sorted_indices[start:end]] = pct
    return out.reshape(arr.shape)


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in kilometres on the 3,396,190 m Mars sphere."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = np.radians(np.asarray(lat2) - np.asarray(lat1))
    dl = np.radians((np.asarray(lon2) - np.asarray(lon1) + 180.0) % 360.0 - 180.0)
    a = np.sin(dp / 2.0) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2.0) ** 2
    return MARS_RADIUS_KM * 2.0 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def site_veto_reasons(lat: float, elevation_m: float, slope_patch) -> list[str]:
    """Apply the three hard limits selected from the 2015 human landing call."""
    patch = np.asarray(slope_patch, dtype=np.float64)
    reasons = []
    if not math.isfinite(lat) or abs(lat) > 50.0:
        reasons.append("latitude")
    if not math.isfinite(elevation_m):
        reasons.append("elevation_no_data")
    elif elevation_m >= 2000.0:
        reasons.append("elevation")
    if patch.size == 0 or patch.shape != (2, 2) or not np.isfinite(patch).all():
        reasons.append("flat_area_no_data")
    elif not np.all(patch < 10.0):
        reasons.append("flat_area")
    return reasons


def select_spaced_candidates(candidates, minimum_km: float = 100.0, limit: int = 200) -> list[dict]:
    """Greedily retain highest-scoring points at the required great-circle spacing."""
    ordered = sorted(candidates, key=lambda item: (-item["score"], item["id"]))
    kept = []
    for candidate in ordered:
        if kept:
            distances = haversine_km(
                np.asarray([item["lat"] for item in kept]),
                np.asarray([item["lon_east"] for item in kept]),
                candidate["lat"], candidate["lon_east"],
            )
            if np.any(distances < minimum_km):
                continue
        kept.append(candidate)
        if len(kept) == limit:
            break
    return kept


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def cesium_longitude(lon_east: float) -> float:
    value = (float(lon_east) + 180.0) % 360.0 - 180.0
    return -180.0 if value == 180.0 else value


def grid_index(lon_east: float, lat: float, transform, width: int, height: int) -> tuple[int, int]:
    col = int(math.floor((lon_east % 360.0 - transform.c) / transform.a)) % width
    row = int(math.floor((transform.f - lat) / abs(transform.e)))
    return max(0, min(height - 1, row)), col


def nearest_index_distance(lat: float, lon_east: float, index_lats, index_lons) -> float:
    distances = haversine_km(lat, lon_east, np.asarray(index_lats), np.asarray(index_lons))
    return float(np.min(distances))


def _load_grid() -> tuple[dict[str, np.ndarray], object]:
    arrays = {}
    transform = None
    shape = None
    for key, filename in LAYERS.items():
        with rasterio.open(GRID_DIR / filename) as src:
            arr = src.read(1, masked=True).filled(np.nan).astype(np.float32)
            if shape is None:
                shape, transform = arr.shape, src.transform
            elif arr.shape != shape or src.transform != transform:
                raise ValueError(f"Layer grid does not match base grid: {filename}")
            arrays[key] = arr
    return arrays, transform


def _pass_mask(arrays: dict[str, np.ndarray], transform) -> np.ndarray:
    slope_ok = np.isfinite(arrays["slope_p90_deg"]) & (arrays["slope_p90_deg"] < 10.0)
    patch = slope_ok & np.roll(slope_ok, -1, axis=1) & np.roll(slope_ok, -1, axis=0) & np.roll(np.roll(slope_ok, -1, axis=0), -1, axis=1)
    lat = transform.f + (np.arange(patch.shape[0], dtype=np.float32) + 0.5) * transform.e
    in_band = np.abs(lat) <= 50.0
    patch[-1, :] = False
    return in_band[:, None] & (arrays["elevation_m"] < 2000.0) & np.isfinite(arrays["elevation_m"]) & patch


def _group_scores(arrays: dict[str, np.ndarray], passed: np.ndarray, weights: dict) -> dict[str, np.ndarray]:
    groups = {}
    for group, criteria in weights.items():
        total = np.zeros(passed.shape, dtype=np.float32)
        divisor = np.zeros(passed.shape, dtype=np.float32)
        for layer, (weight, higher) in criteria.items():
            values = arrays[layer]
            usable = passed & np.isfinite(values)
            if not np.any(usable):
                continue
            pct = average_percentiles(np.where(usable, values, np.nan), higher_is_better=higher).astype(np.float32)
            good = np.isfinite(pct)
            total[good] += pct[good] * weight
            divisor[good] += weight
            del pct
        result = np.full(passed.shape, np.nan, dtype=np.float32)
        good = divisor > 0
        result[good] = total[good] / divisor[good]
        groups[group] = result
    return groups


def _combine_groups(groups: dict[str, np.ndarray]) -> np.ndarray:
    shape = next(iter(groups.values())).shape
    total = np.zeros(shape, dtype=np.float32)
    denominator = np.zeros(shape, dtype=np.float32)
    for group, weight in GROUP_WEIGHTS.items():
        values = groups[group]
        good = np.isfinite(values)
        total[good] += values[good] * weight
        denominator[good] += weight
    out = np.full(shape, np.nan, dtype=np.float32)
    good = denominator > 0
    out[good] = total[good] / denominator[good]
    return out


def _load_known(path: Path) -> list[dict]:
    manifest_path = path.parent / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entry = next((item for item in manifest.get("files", []) if item.get("path") == path.name), None)
        if entry and entry.get("sha256"):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest.lower() != entry["sha256"].lower():
                raise ValueError(f"SHA-256 mismatch for {path}")
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    out = []
    for row in rows:
        kind = "zone2015" if row["type"].strip().lower() in {"ez", "zone2015", "exploration zone"} else "landed"
        lon = float(row["lon_east"]) % 360.0
        out.append({"id": f"{kind}-{slugify(row['name'])}", "name": row["name"].strip(), "kind": kind,
                    "lat": float(row["lat"]), "lon_east": lon, "source_url": row.get("source_url", ""),
                    "status": row.get("status", ""), "frame": row.get("frame", ""),
                    "precision_deg": float(row.get("precision_deg") or 0), "note": row.get("note", "")})
    return out


def _load_dtm_centres(path: Path) -> tuple[np.ndarray, np.ndarray]:
    import pandas as pd

    frame = pd.read_excel(path, header=None)
    return frame.iloc[:, 5].to_numpy(dtype=np.float64), frame.iloc[:, 6].to_numpy(dtype=np.float64) % 360.0


def _cell_patch(slope: np.ndarray, row: int, col: int) -> np.ndarray:
    rows, cols = slope.shape
    return slope[row:min(row + 2, rows), :][:, [(col + offset) % cols for offset in range(2)]]


def _site_record(site: dict, arrays: dict, groups: dict, score: np.ndarray,
                 transform, dtm_lats, dtm_lons) -> dict:
    row, col = grid_index(site["lon_east"], site["lat"], transform, score.shape[1], score.shape[0])
    south = transform.f + score.shape[0] * transform.e
    if not south <= site["lat"] <= transform.f:
        reasons = site_veto_reasons(site["lat"], float("nan"), [[float("nan"), float("nan")], [float("nan"), float("nan")]])
        detail_km = nearest_index_distance(site["lat"], site["lon_east"], dtm_lats, dtm_lons)
        return {"id": site["id"], "name": site["name"], "lat": round(float(site["lat"]), 6),
                "lon": round(cesium_longitude(site["lon_east"]), 6), "kind": site["kind"], "score": None,
                "groups": {key: None for key in groups}, "evidence": {**{key: None for key in arrays},
                    "habitat_dist_km": None, "habitat_slope_patch_max_deg": None, "habitat_area_km2_approx": None,
                    "latitude_deg_abs": round(abs(float(site["lat"])), 4)}, "vetoed": bool(reasons),
                "veto_reason": reasons, "detail_available": bool(detail_km <= 5.0),
                "nearest_hirise_dtm_km": round(detail_km, 3),
                **({"source_url": site["source_url"], "status": site["status"], "coordinate_frame": site["frame"],
                    "precision_deg": site["precision_deg"], "source_note": site["note"]} if site["kind"] != "new" else {})}
    patch = _cell_patch(arrays["slope_p90_deg"], row, col)
    reasons = site_veto_reasons(site["lat"], float(arrays["elevation_m"][row, col]), patch)
    raw_score = float(score[row, col]) if np.isfinite(score[row, col]) else None
    group_values = {key: round(float(value[row, col]), 2) if np.isfinite(value[row, col]) else None for key, value in groups.items()}
    evidence = {}
    for key, values in arrays.items():
        value = float(values[row, col])
        evidence[key] = round(value, 3) if math.isfinite(value) else None
    evidence.update({
        "habitat_dist_km": 0.0 if not reasons or (np.isfinite(arrays["slope_p90_deg"][row, col]) and arrays["slope_p90_deg"][row, col] < 10.0) else None,
        "habitat_slope_patch_max_deg": round(float(np.nanmax(patch)), 3) if patch.size and np.isfinite(patch).any() else None,
        "habitat_area_km2_approx": round(float(np.cos(np.radians(site["lat"])) * 4 *
                                                   (3396.19 * np.radians(abs(transform.a))) *
                                                   (3396.19 * np.radians(abs(transform.e)))), 2),
        "latitude_deg_abs": round(abs(float(site["lat"])), 4),
    })
    detail_km = nearest_index_distance(site["lat"], site["lon_east"], dtm_lats, dtm_lons)
    return {
        "id": site["id"], "name": site["name"], "lat": round(float(site["lat"]), 6),
        "lon": round(cesium_longitude(site["lon_east"]), 6), "kind": site["kind"],
        "score": round(raw_score, 2) if raw_score is not None else None,
        "groups": group_values, "evidence": evidence, "vetoed": bool(reasons),
        "veto_reason": reasons,
        "detail_available": bool(detail_km <= 5.0), "nearest_hirise_dtm_km": round(detail_km, 3),
        **({"source_url": site["source_url"], "status": site["status"], "coordinate_frame": site["frame"],
            "precision_deg": site["precision_deg"], "source_note": site["note"]} if site["kind"] != "new" else {}),
    }


def _metric_summary(score, passed, known, transform) -> dict:
    rows = [site for site in known if site["kind"] == "zone2015"]
    if not rows:
        return {"zone2015_count": 0, "median_percentile": None, "auc": None}
    ez_scores = []
    for site in rows:
        r, c = grid_index(site["lon_east"], site["lat"], transform, score.shape[1], score.shape[0])
        if np.isfinite(score[r, c]):
            ez_scores.append(float(score[r, c]))
    controls = score[passed & np.isfinite(score)]
    if not ez_scores or not len(controls):
        return {"zone2015_count": len(rows), "median_percentile": None, "auc": None}
    vals = np.sort(controls)
    ranks = np.searchsorted(vals, ez_scores, side="left")
    right = np.searchsorted(vals, ez_scores, side="right")
    percs = 100.0 * (ranks + right) / (2.0 * len(vals))
    return {"zone2015_count": len(rows), "zone_scores_available": len(ez_scores),
            "median_percentile": round(float(np.median(percs)), 2),
            "auc": round(float(np.mean(percs) / 100.0), 4)}


def _sources() -> list[dict]:
    raw = Path("data/raw")
    names = {
        "elevation_m": "mola_megdr_128", "slope_p90_deg": "mola_megdr_128", "roughness_m": "mola_megdr_128",
        "ice_dist_km": "swim_ice", "ice_dist_km_0_5m": "swim_ice", "dose_ugy_day": "msl_rad_dose",
        "dust_mean": "montabone_dust", "dust_p95": "montabone_dust", "storm_frac": "montabone_dust",
        "insolation_wm2": "montabone_dust", "cave_count_zone": "mgc3_caves", "unit_diversity_zone": "tanaka2014_geo",
        "tes_ti_night_2007": "tes_ti_2007", "surface_pressure_pa": "mola_megdr_128",
        "nearest_hirise_dtm_km": "hez_dem_index",
    }
    sources = {}
    for dataset in sorted(set(names.values())):
        manifest = json.loads((raw / dataset / "manifest.json").read_text(encoding="utf-8"))
        record = {"dataset": dataset, "citation": manifest["citation"], "licence": manifest["licence"],
                  "landing_page": manifest["landing_page"]}
        if "not stated" in manifest["licence"].lower():
            record["licence_note"] = "Licence is not stated by the product page; retain the source credit and confirm terms before redistribution."
        sources[dataset] = record
    return list(sources.values())


def _make_preview(arrays: dict, candidates: list[dict]):
    elevation = arrays["elevation_m"][::4, ::4]
    elevation = np.roll(elevation, elevation.shape[1] // 2, axis=1)
    safe = np.where(np.isfinite(elevation), elevation, np.nanmedian(elevation))
    shade = LightSource(azdeg=315, altdeg=40).hillshade(safe, vert_exag=0.8)
    fig, ax = plt.subplots(figsize=(14, 7), constrained_layout=True)
    ax.imshow(shade, cmap="gray", extent=(-180, 180, -60, 60), origin="upper", vmin=0, vmax=1)
    points = ax.scatter([site["lon"] for site in candidates], [site["lat"] for site in candidates],
                        c=[site["score"] for site in candidates], cmap="Greens", vmin=0, vmax=100,
                        s=16, edgecolors="#17351f", linewidths=0.35)
    ax.set(xlim=(-180, 180), ylim=(-60, 60), xlabel="Longitude (east-positive, Cesium convention)", ylabel="Latitude",
           title="Mars site-finder candidates")
    fig.colorbar(points, ax=ax, label="Score (0–100)")
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(PREVIEW, dpi=150)
    plt.close(fig)


def run(known_sites_path: Path = KNOWN_SITES) -> dict:
    arrays, transform = _load_grid()
    passed = _pass_mask(arrays, transform)
    arrays["habitat_dist_km"] = np.where(passed, 0.0, np.nan).astype(np.float32)
    normalizable = np.ones(passed.shape, dtype=bool)
    after_groups = _group_scores(arrays, normalizable, AFTER_CRITERIA)
    after_score = _combine_groups(after_groups)
    before_groups = _group_scores(arrays, normalizable, BEFORE_CRITERIA)
    before_score = _combine_groups(before_groups)

    dtm_lats, dtm_lons = _load_dtm_centres(DTM_INDEX)
    rows, cols = np.where(passed & np.isfinite(after_score))
    values = after_score[rows, cols]
    order = np.argsort(-values, kind="mergesort")
    candidates = []
    kept_lats = []
    kept_lons = []
    for idx in order:
        r, c = int(rows[idx]), int(cols[idx])
        lat = float(transform.f + (r + 0.5) * transform.e)
        lon = float((transform.c + (c + 0.5) * transform.a) % 360.0)
        if kept_lats and np.any(haversine_km(np.asarray(kept_lats), np.asarray(kept_lons), lat, lon) < 100.0):
            continue
        number = len(candidates) + 1
        candidates.append({"id": f"candidate-{number:06d}", "name": f"Candidate {number:03d}",
                           "kind": "new", "lat": lat, "lon_east": lon, "score": float(values[idx]), "row": r, "col": c})
        kept_lats.append(lat)
        kept_lons.append(lon)
        if len(candidates) == 200:
            break
    candidate_sites = [_site_record(site, arrays, after_groups, after_score, transform, dtm_lats, dtm_lons) for site in candidates]
    known_raw = _load_known(known_sites_path)
    known_sites = [_site_record(site, arrays, after_groups, after_score, transform, dtm_lats, dtm_lons) for site in known_raw]

    before_validation = _metric_summary(before_score, passed, known_raw, transform)
    after_validation = _metric_summary(after_score, passed, known_raw, transform)
    output = {
        "version": 1,
        "planet": {"name": "Mars", "radius_m": 3396190, "longitude_convention": "-180..180 east-positive (Cesium)",
                   "grid_resolution_deg": [abs(float(transform.a)), abs(float(transform.e))]},
        "weights": {"group_weights": GROUP_WEIGHTS, "criteria": AFTER_CRITERIA,
                    "validation_before_bias_fix": BEFORE_CRITERIA,
                    "score_scale": "0-100 percentile ranks over valid cells per criterion; ties use average ranks; hard vetoes restrict new candidate selection",
                    "bias_fix": "Dust and storm remain soft scored criteria with lower within-climate weights; terrain, climate, solar, protection and science groups have equal weight."},
        "vetoes": [
            {"id": "latitude", "rule": "abs(latitude) <= 50 degrees", "source": "Bussey & Davis, NASA HEOMD/SMD Human Landing Sites Study (2015), Second Announcement, p. 3, https://www.nasa.gov/wp-content/uploads/2015/06/hls2-2nd-announcement-7-8.pdf"},
            {"id": "elevation", "rule": "MOLA elevation < +2,000 m", "source": "Bussey & Davis, NASA HEOMD/SMD Human Landing Sites Study (2015), Second Announcement, p. 3; MOLA is the stated datum. https://www.nasa.gov/wp-content/uploads/2015/06/hls2-2nd-announcement-7-8.pdf"},
            {"id": "flat_area", "rule": "approximately 25 km2 with slopes < approximately 10 degrees; screened as a 2x2-cell patch at 0.0625 degree resolution", "source": "Bussey & Davis, NASA HEOMD/SMD Human Landing Sites Study (2015), Second Announcement, p. 3, https://www.nasa.gov/wp-content/uploads/2015/06/hls2-2nd-announcement-7-8.pdf", "notes": "Water and habitat distances are scored resource/ISRU criteria, not vetoes. Raw material <3 km from the ISRU plant is from Bussey & Hoffman (2016), p. 16, https://ntrs.nasa.gov/citations/20160001040; infrastructure <5 km from the landing site is from the Second Announcement, p. 4, and Bussey & Hoffman (2016), p. 17."}
        ],
        "resource_scoring_notes": "Water distance and habitat feasibility remain scored evidence per Bussey & Hoffman (2016), pp. 16-17, https://ntrs.nasa.gov/citations/20160001040. Habitat flat-area distance is 0 km when the qualifying patch includes the landing cell; the patch's approximate area is also recorded.",
        "counts": {"cells_passing_vetoes": int(np.count_nonzero(passed)), "new_candidates": len(candidate_sites), "known_sites": len(known_sites)},
        "validation": {"population": "2015 zone2015 locations vs all hard-veto-passing scored cells",
                       "before_bias_fix": before_validation, "after_bias_fix": after_validation},
        "sources": _sources(), "sites": candidate_sites + known_sites,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    _make_preview(arrays, candidate_sites)
    return output


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--known-sites", type=Path, default=KNOWN_SITES, help="override the known sites CSV")
    args = ap.parse_args()
    result = run(args.known_sites)
    print(json.dumps({"counts": result["counts"], "validation": result["validation"],
                      "output_bytes": OUTPUT.stat().st_size, "preview_bytes": PREVIEW.stat().st_size}, indent=2))
