"""Build Curiosity conditions from public REMS, RAD and Montabone data.

Written with AI assistance, directed and reviewed by the team.

Usage: python pipeline/conditions.py gale
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import tarfile
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
from scipy.io import netcdf_file

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "app" / "public" / "data"
REMS_BASE = "https://observatory.lelama.digital/api/series"
REMS_SERIES = {
    "ls": "mars.msl.ls.daily",
    "tmin": "mars.msl.tmin.daily",
    "tmax": "mars.msl.tmax.daily",
    "pressure": "mars.msl.pressure.daily",
}
def fetch(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "Marswalk/1.0 data pipeline"})
    with urllib.request.urlopen(request, timeout=90) as response, path.open("wb") as dest:
        dest.write(response.read())


def read_series(code: str, key: str) -> dict[str, float]:
    path = RAW / "rems" / f"{key}.json"
    fetch(f"{REMS_BASE}/{code}.json", path)
    obj = json.loads(path.read_text(encoding="utf-8"))
    return {row[0][:10]: float(row[1]) for row in obj["points"] if row[1] is not None}


def rems_weather() -> tuple[list[dict], dict]:
    series = {key: read_series(code, key) for key, code in REMS_SERIES.items()}
    complete = []
    for day in sorted(set(series["ls"]) & set(series["tmin"]) & set(series["tmax"]) & set(series["pressure"])):
        ls = series["ls"][day] % 360
        complete.append({"date": day, "ls": ls, "tmin": series["tmin"][day], "tmax": series["tmax"][day], "pressure": series["pressure"][day]})
    if not complete:
        raise RuntimeError("No overlapping REMS daily records found")
    seasons = []
    for start in range(0, 360, 30):
        rows = [r for r in complete if start <= r["ls"] < start + 30]
        if not rows:
            continue
        seasons.append({
            "ls_from": start, "ls_to": start + 30,
            "air_temp_min_c": round(min(r["tmin"] for r in rows), 2),
            "air_temp_min_c_method": "Minimum of daily REMS air-temperature minima (°C) in this 30° Ls bin; overlapping public daily reports.",
            "air_temp_max_c": round(max(r["tmax"] for r in rows), 2),
            "air_temp_max_c_method": "Maximum of daily REMS air-temperature maxima (°C) in this 30° Ls bin; overlapping public daily reports.",
            "pressure_pa": round(float(np.mean([r["pressure"] for r in rows])), 2),
            "pressure_pa_method": "Arithmetic mean of daily mean REMS pressure (Pa) in this 30° Ls bin.",
            "uv": "unknown",
            "uv_method": "No UV field is published in the daily report series used; category is unknown rather than inferred.",
            "n_sols": len(rows),
            "n_sols_method": "Count of distinct terrestrial-date daily reports with Ls, air-temperature min/max and pressure.",
        })
    last = complete[-1]
    # Sol 1 began on 2012-08-07; convert elapsed UTC time by the mean Martian sol.
    sol = round((date.fromisoformat(last["date"]) - date(2012, 8, 7)).days / 1.02749125) + 1
    latest = {
        "sol": sol, "terrestrial_date": last["date"],
        "air_temp_min_c": round(last["tmin"], 2),
        "air_temp_min_c_method": "Latest available daily REMS minimum air temperature (°C).",
        "air_temp_max_c": round(last["tmax"], 2),
        "air_temp_max_c_method": "Latest available daily REMS maximum air temperature (°C).",
        "pressure_pa": round(last["pressure"], 2),
        "pressure_pa_method": "Latest available daily REMS mean pressure (Pa).",
        "sol_method": "Estimated from terrestrial date since Curiosity sol 1 using 1.02749125 Earth days per Martian sol.",
    }
    return seasons, latest


def radiation() -> tuple[float, float, str]:
    path = RAW / "msl_rad_dose" / "doseE_sol_filter_update.txt"
    samples: dict[int, list[float]] = {}
    with path.open(encoding="utf-8", errors="replace") as f:
        next(f, None)
        for line in f:
            fields = line.strip().split("\t")
            if len(fields) < 6:
                continue
            try:
                # The legacy file's header is one column short: after the date it
                # stores Earth year, Ls, mission sol, measured E-dose and filtered
                # E-dose. Use per-sol means to prevent high-cadence sols dominating.
                sol = int(round(float(fields[3])))
                dose = float(fields[5])
                if math.isfinite(dose) and dose >= 0:
                    samples.setdefault(sol, []).append(dose)
            except ValueError:
                continue
    per_sol = [float(np.mean(rows)) for rows in samples.values() if rows]
    if not per_sol:
        raise RuntimeError(f"No usable dose rows in {path}")
    typical = float(np.median(per_sol)) / 1000.0
    elevated = float(np.max(per_sol)) / 1000.0
    method = (f"Median of {len(per_sol)} per-sol mean filtered RAD E-dose rates; each mean uses the filtered-dose column in µGy/day, "
              "converted to mGy/day. Elevated rate is the highest per-sol mean in the same record series.")
    return round(typical, 4), round(elevated, 4), method


def dust_seasons() -> list[dict]:
    archive = RAW / "montabone_dust" / "krigedcdod_v2.tar.gz"
    files = []
    with tarfile.open(archive, "r:gz") as tf:
        nc_files = [m for m in tf.getmembers() if re.fullmatch(r"dustscenario_MY\d+_v2-[\d-]+\.nc", Path(m.name).name)]
        for member in nc_files:
            f = tf.extractfile(member)
            if f is None:
                continue
            try:
                nc = netcdf_file(f, "r", mmap=False)
                lon = np.asarray(nc.variables["longitude"][:], dtype=float)
                lat = np.asarray(nc.variables["latitude"][:], dtype=float)
                ls = np.asarray(nc.variables["Ls"][:], dtype=float)
                # cdodtot is total column optical depth down to local surface.
                field = np.asarray(nc.variables["cdodtot"][:, :, :], dtype=float)
                x = int(np.abs(lon - 137.4).argmin())
                y = int(np.abs(lat - (-4.79)).argmin())
                for season_ls, opacity in zip(ls, field[:, y, x]):
                    if np.isfinite(opacity) and opacity >= 0 and np.isfinite(season_ls):
                        files.append((float(season_ls) % 360, float(opacity)))
                nc.close()
            except Exception as exc:
                raise RuntimeError(f"Could not read Montabone file {member.name}: {exc}") from exc
            finally:
                f.close()
    seasons = []
    for start in range(0, 360, 30):
        vals = [op for ls, op in files if start <= ls < start + 30]
        if not vals:
            continue
        seasons.append({
            "ls_from": start, "ls_to": start + 30,
            "opacity": round(float(np.mean(vals)), 4),
            "opacity_method": "Mean local-surface column dust optical depth (cdodtot), nearest 2° Montabone climatology grid cell to Gale, pooled over available Mars years and Ls samples in this bin.",
            "storm_fraction": round(float(np.mean(np.asarray(vals) >= 1.0)), 4),
            "storm_fraction_method": "Fraction of available climatology Ls samples in this bin with local-surface CDOD ≥ 1.0; operational threshold stated here as the storm proxy.",
        })
    return seasons


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("site", choices=["gale"])
    args = ap.parse_args()
    weather_bins, latest = rems_weather()
    dose, elevated, dose_method = radiation()
    dust_bins = dust_seasons()
    data = {
        "weather": {
            "source": "REMS daily reports, Curiosity (Spain: Centro de Astrobiología / INTA; NASA/JPL-Caltech credit)",
            "by_season": weather_bins,
            "latest": latest,
        },
        "radiation": {
            "source": "RAD, Curiosity (NASA / SwRI)",
            "surface_dose_mgy_per_day": dose,
            "surface_dose_mgy_per_day_method": dose_method,
            "solar_event_mgy_per_day": elevated,
            "solar_event_mgy_per_day_method": "99th percentile of the unfiltered RAD dose-rate column; data-derived elevated proxy, not an event-specific reconstruction. " + dose_method,
            "note": "Measured at Gale. Filtered baseline and elevated unfiltered tail are RAD-derived proxies.",
        },
        "dust": {
            "source": "Mars Climate Database dust climatology (Montabone et al.)",
            "by_season": dust_bins,
        },
    }
    target = OUT / args.site / "conditions.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"{target}: {len(weather_bins)} weather seasons, {sum(x['n_sols'] for x in weather_bins)} REMS sols, {len(dust_bins)} dust seasons")
    print(f"RAD typical {dose} mGy/day; elevated {elevated} mGy/day; weather UV category unknown (source series has no UV field)")


if __name__ == "__main__":
    main()
