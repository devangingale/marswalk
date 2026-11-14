"""Orbiter pass prediction from NASA NAIF SPICE.

Computes topocentric passes of active Mars relay orbiters (MRO, 2001 Mars Odyssey,
ExoMars TGO, Mars Express) over Mars surface sites (Gale Crater and Jezero Crater).
Outputs passes.json bundle files and manifest records.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

import matplotlib.pyplot as plt
import numpy as np
from scipy.optimize import brentq, minimize_scalar
import spiceypy as spice

# Constants
MARS_RADIUS_M: float = 3396190.0
MARS_RADIUS_KM: float = MARS_RADIUS_M / 1000.0
DEFAULT_MIN_ELEVATION_DEG: float = 10.0

# Site definitions
SITES = {
    "gale": {
        "id": "gale",
        "name": "Mount Sharp, Gale Crater",
        "lat": -4.5895,
        "lon_east": 137.4417,
    },
    "jezero": {
        "id": "jezero",
        "name": "Jezero Crater",
        "lat": 18.4447,
        "lon_east": 77.4508,
    },
}

# Active relay fleet mapping (MAVEN excluded - mission terminated Dec 2025)
ORBITERS = {
    "MRO": {
        "name": "Mars Reconnaissance Orbiter",
        "naif_id": -74,
    },
    "ODY": {
        "name": "2001 Mars Odyssey",
        "naif_id": -53,
    },
    "TGO": {
        "name": "ExoMars 2016 Trace Gas Orbiter",
        "naif_id": -143,
    },
    "MEX": {
        "name": "Mars Express",
        "naif_id": -41,
    },
}


def site_to_cartesian_mars(
    lat_deg: float, lon_east_deg: float, radius_m: float = MARS_RADIUS_M
) -> np.ndarray:
    """Compute 3D Cartesian coordinates in km on IAU_MARS body-fixed sphere."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_east_deg)
    r_km = radius_m / 1000.0
    return np.array(
        [
            r_km * np.cos(lat) * np.cos(lon),
            r_km * np.cos(lat) * np.sin(lon),
            r_km * np.sin(lat),
        ],
        dtype=float,
    )


def local_zenith_unit(lat_deg: float, lon_east_deg: float) -> np.ndarray:
    """Compute unit normal pointing straight up (zenith) at the site."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_east_deg)
    return np.array(
        [
            np.cos(lat) * np.cos(lon),
            np.cos(lat) * np.sin(lon),
            np.sin(lat),
        ],
        dtype=float,
    )


def elevation_angle_deg(
    site_pos_km: np.ndarray, sc_pos_km: np.ndarray, zenith_unit: np.ndarray
) -> float:
    """Compute spacecraft topocentric elevation angle above local horizon in degrees."""
    rho = sc_pos_km - site_pos_km
    dist = float(np.linalg.norm(rho))
    if dist == 0.0:
        return 90.0
    sin_el = float(np.dot(rho, zenith_unit) / dist)
    sin_el = max(-1.0, min(1.0, sin_el))
    return float(np.degrees(np.arcsin(sin_el)))


def find_intervals_from_series(
    times: np.ndarray, elevations: np.ndarray, min_elevation_deg: float = 10.0
) -> list[dict[str, Any]]:
    """Pure helper: extract pass intervals from discrete 1D time and elevation arrays."""
    passes: list[dict[str, Any]] = []
    n = len(times)
    if n < 2:
        return passes

    in_pass = False
    rise_time: float = 0.0
    pass_times: list[float] = []
    pass_elevations: list[float] = []

    for i in range(n - 1):
        t0, t1 = float(times[i]), float(times[i + 1])
        e0, e1 = float(elevations[i]), float(elevations[i + 1])

        if not in_pass and e0 < min_elevation_deg and e1 >= min_elevation_deg:
            in_pass = True
            # Linear interpolation for crossing
            if e1 != e0:
                rise_time = t0 + (min_elevation_deg - e0) / (e1 - e0) * (t1 - t0)
            else:
                rise_time = t0
            pass_times = [t1]
            pass_elevations = [e1]
        elif in_pass:
            pass_times.append(t1)
            pass_elevations.append(e1)
            if e0 >= min_elevation_deg and e1 < min_elevation_deg:
                in_pass = False
                if e1 != e0:
                    set_time = t0 + (min_elevation_deg - e0) / (e1 - e0) * (t1 - t0)
                else:
                    set_time = t1

                peak_idx = int(np.argmax(pass_elevations))
                peak_time = pass_times[peak_idx]
                peak_el = pass_elevations[peak_idx]

                passes.append(
                    {
                        "rise_time": rise_time,
                        "set_time": set_time,
                        "peak_time": peak_time,
                        "peak_elevation_deg": peak_el,
                        "duration_s": set_time - rise_time,
                    }
                )
                pass_times = []
                pass_elevations = []

    return passes


def validate_passes_sorted_and_non_overlapping(passes: list[dict[str, Any]]) -> bool:
    """Validate that passes are sorted by rise_utc and do not overlap per orbiter."""
    if not passes:
        return True

    # Check globally sorted by rise_utc
    for i in range(len(passes) - 1):
        if passes[i]["rise_utc"] > passes[i + 1]["rise_utc"]:
            raise ValueError(
                f"Passes are not sorted: pass {i} rise {passes[i]['rise_utc']} > pass {i+1} rise {passes[i+1]['rise_utc']}"
            )

    # Check non-overlapping per orbiter
    by_orbiter: dict[str, list[dict[str, Any]]] = {}
    for p in passes:
        orb = p["orbiter"]
        by_orbiter.setdefault(orb, []).append(p)

    for orb, orb_passes in by_orbiter.items():
        for i in range(len(orb_passes) - 1):
            if orb_passes[i]["set_utc"] > orb_passes[i + 1]["rise_utc"]:
                raise ValueError(
                    f"Orbiter {orb} passes overlap: pass {i} set {orb_passes[i]['set_utc']} > pass {i+1} rise {orb_passes[i+1]['rise_utc']}"
                )

    return True


class SPICEPassPredictor:
    """Predicts orbiter passes over Mars surface locations using NAIF SPICE kernels."""

    def __init__(self, kernels_dir: str | Path):
        self.kernels_dir = Path(kernels_dir)
        self.loaded_kernels: list[str] = []
        self._load_kernels()

    def _load_kernels(self) -> None:
        spice.kclear()
        required_kernels = [
            "naif0012.tls",
            "pck00011.tpc",
            "de442s.bsp",
            "mar099s.bsp",
            "mro_psp.bsp",
            "m01_map.bsp",
            "em16_tgo_fsp_463_01_20260706_20261219_v01.bsp",
            "ORMF_T19_260611_330101_01965.BSP",
            "ORMM_T19_261101000000_01981.BSP",
        ]
        for name in required_kernels:
            path = self.kernels_dir / name
            if not path.exists():
                raise FileNotFoundError(f"Missing required SPICE kernel: {path}")
            spice.furnsh(str(path))
            self.loaded_kernels.append(name)

    def close(self) -> None:
        spice.kclear()

    def get_orbiter_coverage_et(self, target_id: int) -> tuple[float, float]:
        """Find total coverage interval (et_min, et_max) available across loaded SPKs."""
        et_min = -float("inf")
        et_max = float("inf")
        # Probe coverage from individual SPKs
        intervals: list[tuple[float, float]] = []
        for name in self.loaded_kernels:
            if not name.endswith((".bsp", ".BSP")):
                continue
            path = str(self.kernels_dir / name)
            try:
                ids = [int(i) for i in spice.spkobj(path)]
                if target_id in ids:
                    cov = spice.spkcov(path, target_id)
                    for j in range(0, len(cov), 2):
                        intervals.append((cov[j], cov[j + 1]))
            except Exception:
                continue
        if intervals:
            et_min = min(iv[0] for iv in intervals)
            et_max = max(iv[1] for iv in intervals)
        return et_min, et_max

    def compute_passes(
        self,
        lat_deg: float,
        lon_east_deg: float,
        start_utc: str = "2026-11-01T00:00:00Z",
        end_utc: str = "2026-12-31T23:59:59Z",
        step_s: float = 30.0,
        min_elevation_deg: float = DEFAULT_MIN_ELEVATION_DEG,
    ) -> list[dict[str, Any]]:
        """Compute topocentric passes for all active orbiters over the specified window."""
        site_pos = site_to_cartesian_mars(lat_deg, lon_east_deg, MARS_RADIUS_M)
        zenith = local_zenith_unit(lat_deg, lon_east_deg)

        window_start_et = spice.str2et(start_utc.replace("Z", ""))
        window_end_et = spice.str2et(end_utc.replace("Z", ""))

        all_passes: list[dict[str, Any]] = []

        for orb_id, orb_meta in ORBITERS.items():
            target_id = orb_meta["naif_id"]
            cov_start, cov_end = self.get_orbiter_coverage_et(target_id)
            orb_start_et = max(window_start_et, cov_start)
            orb_end_et = min(window_end_et, cov_end)

            if orb_end_et <= orb_start_et:
                continue

            times = np.arange(orb_start_et, orb_end_et + step_s, step_s)
            elevations = np.empty(len(times), dtype=float)

            for i, t in enumerate(times):
                try:
                    pos, _ = spice.spkpos(str(target_id), t, "IAU_MARS", "NONE", "499")
                    elevations[i] = elevation_angle_deg(site_pos, pos, zenith)
                except Exception:
                    elevations[i] = -90.0

            # Find crossings and apply root refinement
            in_pass = False
            rise_idx = 0

            def elevation_at(t: float) -> float:
                p, _ = spice.spkpos(str(target_id), t, "IAU_MARS", "NONE", "499")
                return elevation_angle_deg(site_pos, p, zenith)

            for i in range(len(times) - 1):
                e0, e1 = elevations[i], elevations[i + 1]
                t0, t1 = times[i], times[i + 1]

                if not in_pass and e0 < min_elevation_deg and e1 >= min_elevation_deg:
                    in_pass = True
                    rise_idx = i
                elif in_pass and e0 >= min_elevation_deg and e1 < min_elevation_deg:
                    in_pass = False

                    # Refine rise root: elevation_at(t) - min_elevation_deg = 0
                    def f_rise(t: float) -> float:
                        return elevation_at(t) - min_elevation_deg

                    try:
                        t_rise = brentq(
                            f_rise, times[rise_idx], times[rise_idx + 1], xtol=0.01
                        )
                    except Exception:
                        t_rise = times[rise_idx]

                    # Refine set root
                    def f_set(t: float) -> float:
                        return elevation_at(t) - min_elevation_deg

                    try:
                        t_set = brentq(f_set, t0, t1, xtol=0.01)
                    except Exception:
                        t_set = t1

                    # Refine peak inside [t_rise, t_set]
                    try:
                        res = minimize_scalar(
                            lambda t: -elevation_at(t),
                            bounds=(t_rise, t_set),
                            method="bounded",
                            options={"xatol": 0.1},
                        )
                        t_peak = float(res.x)
                        peak_el = float(-res.fun)
                    except Exception:
                        t_peak = 0.5 * (t_rise + t_set)
                        peak_el = elevation_at(t_peak)

                    duration_s = max(0.0, t_set - t_rise)
                    rise_utc = spice.et2utc(t_rise, "ISOC", 0) + "Z"
                    set_utc = spice.et2utc(t_set, "ISOC", 0) + "Z"
                    peak_utc = spice.et2utc(t_peak, "ISOC", 0) + "Z"

                    all_passes.append(
                        {
                            "orbiter": orb_id,
                            "rise_utc": rise_utc,
                            "set_utc": set_utc,
                            "peak_utc": peak_utc,
                            "peak_elevation_deg": round(peak_el, 2),
                            "duration_s": round(duration_s, 1),
                        }
                    )

        # Sort all passes chronologically by rise_utc
        all_passes.sort(key=lambda p: p["rise_utc"])
        validate_passes_sorted_and_non_overlapping(all_passes)
        return all_passes


def build_passes_bundle(
    site_id: str,
    kernels_dir: str | Path,
    output_path: str | Path,
    start_utc: str = "2026-11-01T00:00:00Z",
    end_utc: str = "2026-12-31T23:59:59Z",
    min_elevation_deg: float = DEFAULT_MIN_ELEVATION_DEG,
) -> dict[str, Any]:
    """Compute passes for a named site and write the bundle passes.json."""
    site = SITES[site_id]
    predictor = SPICEPassPredictor(kernels_dir)
    try:
        passes = predictor.compute_passes(
            lat_deg=site["lat"],
            lon_east_deg=site["lon_east"],
            start_utc=start_utc,
            end_utc=end_utc,
            step_s=30.0,
            min_elevation_deg=min_elevation_deg,
        )
        kernel_names = predictor.loaded_kernels.copy()
    finally:
        predictor.close()

    bundle = {
        "version": 1,
        "site": site_id,
        "lat": site["lat"],
        "lon_east": site["lon_east"],
        "min_elevation_deg": min_elevation_deg,
        "window": {
            "start": start_utc,
            "end": end_utc,
        },
        "orbiters": list(ORBITERS.keys()),
        "passes": passes,
        "source": {
            "kernels": kernel_names,
            "notes": (
                "Passes computed using NASA NAIF SPICE (spiceypy 8.4.0) with topocentric "
                "elevation above local horizon on a spherical Mars (radius 3396190 m, IAU_MARS body-fixed frame). "
                f"min_elevation_deg = {min_elevation_deg} is an assumed communication elevation mask "
                "(no published minimum mask found in relay literature). MAVEN excluded (mission ended Dec 2025). "
                "TGO forward predicted trajectory extends through 2026-12-19 per latest ESA/NAIF publication."
            ),
        },
    }

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(bundle, f, indent=2)

    return bundle


def generate_gale_timeline_plot(
    gale_bundle: dict[str, Any], output_png: str | Path
) -> None:
    """Generate a timeline PNG in .shots/ for 3 sols at Gale Crater (2026-11-01 to 2026-11-04)."""
    out_path = Path(output_png)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Filter passes in first 3 sols (2026-11-01T00:00:00Z to 2026-11-04T00:00:00Z)
    t0_str = "2026-11-01T00:00:00Z"
    t1_str = "2026-11-04T00:00:00Z"
    passes_3sol = [
        p
        for p in gale_bundle["passes"]
        if p["rise_utc"] >= t0_str and p["rise_utc"] < t1_str
    ]

    orbiter_colors = {
        "MRO": "#1f77b4",  # Blue
        "ODY": "#ff7f0e",  # Orange
        "TGO": "#2ca02c",  # Green
        "MEX": "#d62728",  # Red
    }
    orbiter_y = {"MRO": 3, "ODY": 2, "TGO": 1, "MEX": 0}

    fig, ax = plt.subplots(figsize=(12, 5), dpi=150)

    # Plot pass bars
    for p in passes_3sol:
        orb = p["orbiter"]
        color = orbiter_colors.get(orb, "#333333")
        y = orbiter_y[orb]

        # Convert rise/set to hours from 2026-11-01T00:00:00Z
        # Simple ISO parse
        from datetime import datetime, timezone

        t_base = datetime(2026, 11, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp()
        t_rise = (
            datetime.fromisoformat(p["rise_utc"].replace("Z", "+00:00")).timestamp()
            - t_base
        ) / 3600.0
        t_set = (
            datetime.fromisoformat(p["set_utc"].replace("Z", "+00:00")).timestamp()
            - t_base
        ) / 3600.0
        dur_h = t_set - t_rise

        ax.barh(
            y,
            dur_h,
            left=t_rise,
            height=0.45,
            color=color,
            edgecolor="black",
            linewidth=0.5,
            alpha=0.85,
        )
        # Label with peak elevation
        ax.text(
            t_rise + dur_h / 2.0,
            y + 0.28,
            f"{p['peak_elevation_deg']}°",
            ha="center",
            va="bottom",
            fontsize=7,
            fontweight="bold",
            color=color,
        )

    # Sol dividers (approx 24.66h per sol)
    for sol in range(1, 4):
        ax.axvline(
            sol * 24.66,
            color="#888888",
            linestyle="--",
            linewidth=0.8,
            alpha=0.7,
            label="Sol boundary (~24.66h)" if sol == 1 else "",
        )

    ax.set_yticks([0, 1, 2, 3])
    ax.set_yticklabels(["MEX", "TGO", "ODY", "MRO"], fontsize=10, fontweight="bold")
    ax.set_xlim(0, 72)
    ax.set_xticks(np.arange(0, 73, 6))
    ax.set_xlabel("Hours from 2026-11-01T00:00:00 UTC", fontsize=10)
    ax.set_ylabel("Relay Orbiter", fontsize=10)
    ax.set_title(
        "Gale Crater Relay Orbiter Passes (3 Sols: 2026-11-01 to 2026-11-04, Elevation ≥ 10°)",
        fontsize=11,
        fontweight="bold",
    )
    ax.grid(axis="x", linestyle=":", alpha=0.5)

    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()
    print(f"Timeline plot saved to {out_path}")


def compute_evidence_metrics(bundle: dict[str, Any]) -> dict[str, Any]:
    """Compute statistics: passes per sol per orbiter, median pass duration, etc."""
    site_id = bundle["site"]
    passes = bundle["passes"]

    # Calculate span in sols (approx 24.66 hours = 88775.244 s per sol)
    sol_duration_s = 88775.244
    from datetime import datetime, timezone

    t_start = datetime.fromisoformat(
        bundle["window"]["start"].replace("Z", "+00:00")
    ).timestamp()
    t_end = datetime.fromisoformat(
        bundle["window"]["end"].replace("Z", "+00:00")
    ).timestamp()
    total_sols = (t_end - t_start) / sol_duration_s

    stats: dict[str, Any] = {"site": site_id, "total_sols": round(total_sols, 2), "orbiters": {}}

    for orb in bundle["orbiters"]:
        orb_passes = [p for p in passes if p["orbiter"] == orb]
        if not orb_passes:
            continue

        # Effective coverage window for orbiter
        orb_t_start = datetime.fromisoformat(
            orb_passes[0]["rise_utc"].replace("Z", "+00:00")
        ).timestamp()
        orb_t_end = datetime.fromisoformat(
            orb_passes[-1]["set_utc"].replace("Z", "+00:00")
        ).timestamp()
        orb_sols = max(1.0, (orb_t_end - orb_t_start) / sol_duration_s)

        # Count passes per day/sol bin
        bins: dict[int, int] = {}
        durations: list[float] = []
        for p in orb_passes:
            t = datetime.fromisoformat(
                p["rise_utc"].replace("Z", "+00:00")
            ).timestamp()
            sol_idx = int((t - t_start) / sol_duration_s)
            bins[sol_idx] = bins.get(sol_idx, 0) + 1
            durations.append(p["duration_s"])

        counts = list(bins.values())
        min_c = min(counts) if counts else 0
        max_c = max(counts) if counts else 0
        med_c = float(np.median(counts)) if counts else 0.0
        med_dur = float(np.median(durations)) if durations else 0.0

        stats["orbiters"][orb] = {
            "total_passes": len(orb_passes),
            "passes_per_sol": {
                "min": min_c,
                "median": med_c,
                "max": max_c,
            },
            "median_duration_s": round(med_dur, 1),
            "median_duration_min": round(med_dur / 60.0, 1),
        }

    return stats


def main() -> None:
    """Main execution script: generate passes bundles for Gale and Jezero, timeline plot, and report evidence."""
    kernels_dir = Path("data/raw/naif_spice")
    if not kernels_dir.exists():
        raise FileNotFoundError(f"Kernels directory not found: {kernels_dir}")

    # 1. Gale Crater bundle
    print("Computing passes for Gale Crater...")
    gale_bundle = build_passes_bundle(
        site_id="gale",
        kernels_dir=kernels_dir,
        output_path="data/sites/gale/bundle/passes.json",
    )
    gale_stats = compute_evidence_metrics(gale_bundle)

    # 2. Jezero Crater bundle
    print("Computing passes for Jezero Crater...")
    jezero_bundle = build_passes_bundle(
        site_id="jezero",
        kernels_dir=kernels_dir,
        output_path="data/sites/jezero/bundle/passes.json",
    )
    jezero_stats = compute_evidence_metrics(jezero_bundle)

    # 3. Timeline plot for Gale (.shots/gale_passes_timeline.png)
    shots_dir = Path(".shots")
    timeline_png = shots_dir / "gale_passes_timeline.png"
    generate_gale_timeline_plot(gale_bundle, timeline_png)

    # 4. Print evidence summary
    print("\n" + "=" * 60)
    print("ORBITER PASS PREDICTION EVIDENCE REPORT")
    print("=" * 60)
    for site_stats in [gale_stats, jezero_stats]:
        print(f"\nSite: {site_stats['site'].upper()} ({site_stats['total_sols']} sols)")
        print(f"{'Orbiter':<10} {'Passes/Sol (Min/Med/Max)':<28} {'Med Duration':<15} {'Total Passes':<12}")
        print("-" * 65)
        for orb, s in site_stats["orbiters"].items():
            pps = f"{s['passes_per_sol']['min']} / {s['passes_per_sol']['median']:.1f} / {s['passes_per_sol']['max']}"
            dur = f"{s['median_duration_min']} min ({s['median_duration_s']}s)"
            print(f"{orb:<10} {pps:<28} {dur:<15} {s['total_passes']:<12}")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
