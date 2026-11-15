"""Orbiter pass prediction from NASA NAIF SPICE.

Computes topocentric passes of active Mars relay orbiters (MRO, 2001 Mars Odyssey,
ExoMars TGO, Mars Express) over Mars surface sites (Gale Crater and Jezero Crater).
Outputs passes.json bundle files and manifest records.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

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

# Kernels every run needs: leap seconds, planetary constants, planet and Mars-satellite ephemerides.
BASE_KERNELS = ["naif0012.tls", "pck00011.tpc", "de442s.bsp", "mar099s.bsp"]
# Spacecraft ephemerides per orbiter. Each is optional: an orbiter whose kernel is missing is
# skipped. mro_psp.bsp and m01_map.bsp are NAIF's ever-growing, regularly refreshed files.
ORBITER_KERNELS = {
    "MRO": ["mro_psp.bsp"],
    "ODY": ["m01_map.bsp"],
    "TGO": ["em16_tgo_fsp_463_01_20260706_20261219_v01.bsp"],
    "MEX": ["ORMF_T19_260611_330101_01965.BSP", "ORMM_T19_261101000000_01981.BSP"],
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

    def __init__(self, kernels_dir: str | Path, orbiters: list[str] | None = None):
        self.kernels_dir = Path(kernels_dir)
        self.loaded_kernels: list[str] = []
        self.orbiters: list[str] = []
        self._load_kernels(orbiters or list(ORBITERS))

    def _load_kernels(self, orbiters: list[str]) -> None:
        spice.kclear()
        for name in BASE_KERNELS:
            path = self.kernels_dir / name
            if not path.exists():
                raise FileNotFoundError(f"Missing required SPICE kernel: {path}")
            spice.furnsh(str(path))
            self.loaded_kernels.append(name)
        for orbiter in orbiters:
            names = ORBITER_KERNELS[orbiter]
            missing = [n for n in names if not (self.kernels_dir / n).exists()]
            if missing:
                print(f"Skipping {orbiter}: missing kernel(s) {', '.join(missing)}")
                continue
            for name in names:
                spice.furnsh(str(self.kernels_dir / name))
                self.loaded_kernels.append(name)
            self.orbiters.append(orbiter)

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

        for orb_id in self.orbiters:
            target_id = ORBITERS[orb_id]["naif_id"]
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
    orbiters: list[str] | None = None,
) -> dict[str, Any]:
    """
    Compute passes for a named site and write the bundle passes.json. The window's end is
    clamped to the loaded kernels' coverage, so the bundle never claims to cover time it has
    no ephemeris for.
    """
    site = SITES[site_id]
    predictor = SPICEPassPredictor(kernels_dir, orbiters)
    try:
        coverage = {}
        for orbiter in predictor.orbiters:
            cov_start, cov_end = predictor.get_orbiter_coverage_et(ORBITERS[orbiter]["naif_id"])
            if np.isfinite(cov_start) and np.isfinite(cov_end):
                coverage[orbiter] = {
                    "start": spice.et2utc(cov_start, "ISOC", 0) + "Z",
                    "end": spice.et2utc(cov_end, "ISOC", 0) + "Z",
                }
        if coverage:
            last = max(c["end"] for c in coverage.values())
            end_utc = min(end_utc, last)
        passes = predictor.compute_passes(
            lat_deg=site["lat"],
            lon_east_deg=site["lon_east"],
            start_utc=start_utc,
            end_utc=end_utc,
            step_s=30.0,
            min_elevation_deg=min_elevation_deg,
        )
        kernel_names = predictor.loaded_kernels.copy()
        computed = predictor.orbiters.copy()
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
        "orbiters": computed,
        "passes": passes,
        "source": {
            "kernels": kernel_names,
            "coverage": coverage,
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "notes": (
                "Passes computed using NASA NAIF SPICE (spiceypy 8.4.0) with topocentric "
                "elevation above local horizon on a spherical Mars (radius 3396190 m, IAU_MARS body-fixed frame). "
                f"min_elevation_deg = {min_elevation_deg} is an assumed communication elevation mask "
                "(no published minimum mask found in relay literature). MAVEN excluded (mission ended Dec 2025). "
                "Each orbiter's passes stop where its loaded ephemeris coverage ends (source.coverage)."
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
    """Generate a timeline PNG in .shots/ for the first 3 days of the bundle's window at Gale Crater."""
    out_path = Path(output_png)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    t0_str = gale_bundle["window"]["start"]
    t1_str = window_end(t0_str, 3)
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

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(12, 5), dpi=150)

    # Plot pass bars
    for p in passes_3sol:
        orb = p["orbiter"]
        color = orbiter_colors.get(orb, "#333333")
        y = orbiter_y[orb]

        # Convert rise/set to hours from the window start
        t_base = datetime.fromisoformat(t0_str.replace("Z", "+00:00")).timestamp()
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
    ax.set_xlabel(f"Hours from {t0_str.replace('Z', '')} UTC", fontsize=10)
    ax.set_ylabel("Relay Orbiter", fontsize=10)
    ax.set_title(
        f"Gale Crater Relay Orbiter Passes (3 days from {t0_str[:10]}, Elevation ≥ 10°)",
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


def utc_midnight_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")


def window_end(start_utc: str, days: float) -> str:
    start = datetime.strptime(start_utc, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (start + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv: list[str] | None = None) -> None:
    """Generate passes bundles for each site over a rolling window, and report evidence."""
    parser = argparse.ArgumentParser(description="Orbiter relay passes over Mars sites from NAIF SPICE.")
    parser.add_argument("--kernels-dir", type=Path, default=Path("data/raw/naif_spice"))
    parser.add_argument("--sites", default="gale,jezero", help="comma-separated site ids")
    parser.add_argument("--start", default=None, help="window start, YYYY-MM-DDTHH:MM:SSZ (default: today 00:00 UTC)")
    parser.add_argument("--days", type=float, default=30.0, help="window length; clamped to kernel coverage")
    parser.add_argument("--orbiters", default=",".join(ORBITERS), help="comma-separated: MRO,ODY,TGO,MEX")
    parser.add_argument("--out-root", type=Path, default=Path("data/sites"), help="writes <root>/<site>/bundle/passes.json")
    parser.add_argument("--no-plot", action="store_true", help="skip the Gale timeline PNG")
    args = parser.parse_args(argv)

    if not args.kernels_dir.exists():
        raise FileNotFoundError(f"Kernels directory not found: {args.kernels_dir} (run pipeline/fetch_spice.py)")
    start = args.start or utc_midnight_today()
    end = window_end(start, args.days)
    orbiters = [o.strip().upper() for o in args.orbiters.split(",") if o.strip()]
    unknown = [o for o in orbiters if o not in ORBITERS]
    if unknown:
        parser.error(f"unknown orbiter(s): {', '.join(unknown)}")

    stats = []
    bundles = {}
    for site_id in [s.strip() for s in args.sites.split(",") if s.strip()]:
        print(f"Computing passes for {SITES[site_id]['name']} from {start} for {args.days:g} days...")
        bundles[site_id] = build_passes_bundle(
            site_id=site_id,
            kernels_dir=args.kernels_dir,
            output_path=args.out_root / site_id / "bundle" / "passes.json",
            start_utc=start,
            end_utc=end,
            orbiters=orbiters,
        )
        b = bundles[site_id]
        print(f"  {len(b['passes'])} passes, window {b['window']['start']} to {b['window']['end']}, orbiters {b['orbiters']}")
        stats.append(compute_evidence_metrics(b))

    if not args.no_plot and "gale" in bundles:
        generate_gale_timeline_plot(bundles["gale"], Path(".shots") / "gale_passes_timeline.png")

    print("\n" + "=" * 60)
    print("ORBITER PASS PREDICTION EVIDENCE REPORT")
    print("=" * 60)
    for site_stats in stats:
        print(f"\nSite: {site_stats['site'].upper()} ({site_stats['total_sols']} sols)")
        print(f"{'Orbiter':<10} {'Passes/Sol (Min/Med/Max)':<28} {'Med Duration':<15} {'Total Passes':<12}")
        print("-" * 65)
        for orb, st in site_stats["orbiters"].items():
            pps = f"{st['passes_per_sol']['min']} / {st['passes_per_sol']['median']:.1f} / {st['passes_per_sol']['max']}"
            dur = f"{st['median_duration_min']} min ({st['median_duration_s']}s)"
            print(f"{orb:<10} {pps:<28} {dur:<15} {st['total_passes']:<12}")
    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
