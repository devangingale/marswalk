"""Build the history data for the app's clock and time slider.

Generates:
1. Daily global dust-storm frames and index manifest:
   - data/globe/dust/MY<nn>.bin (uint8 frames [sol][lat][lon], cdodtot variable, units: 1)
   - data/globe/dust/index.json (grid, scale, offset, palette, year frames, source citation)
2. Gale weather history:
   - data/globe/weather/gale.json (daily min/max air temp, pressure, Ls, earth_date sorted by sol)
3. Quality preview evidence in .shots/ (MY34 dust storm 6-frame strip and Gale weather time-series plot)

Written with AI assistance (Gemini), directed and reviewed by the team.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import json
import math
import os
from pathlib import Path
import re
import tarfile
from typing import Any

import numpy as np
from scipy.io import netcdf_file

MARS_R = 3396190.0
ROOT = Path(__file__).resolve().parents[1]

# Calendar constants (Clancy et al. 2000 / Piqueux et al. 2015)
# Mars Year 1 begins at Ls = 0 on 1955-04-11
MY1_START_DATE = datetime(1955, 4, 11)
SOLS_PER_MY = 668.6
DAYS_PER_MY = 686.97
DAYS_PER_SOL = DAYS_PER_MY / SOLS_PER_MY  # ~1.0274753215674543 Earth days / sol

# Dust grid specification
# Native Montabone et al. kriged CDOD grid: 120 lon x 60 lat, 3 deg resolution
DUST_VARIABLE = "cdodtot"
DUST_UNITS = "1"
DUST_GRID = {
    "west": -180.0,
    "north": 90.0,
    "res_lon": 3.0,
    "res_lat": 3.0,
    "width": 120,
    "height": 60,
}
DUST_SCALE = 0.03
DUST_OFFSET = 0.0
DUST_NODATA = 255

# Palette: transparent at clear sky (<= 0.2), transitioning from warm ochre to deep rust
DUST_PALETTE_STOPS: list[list[Any]] = [
    [0.0, "#d2905400"],
    [0.2, "#d2905400"],
    [0.5, "#d99b5044"],
    [1.0, "#c6783288"],
    [1.8, "#b35222bb"],
    [3.0, "#9c3014dd"],
    [5.0, "#7a1a0cfa"],
    [7.5, "#580d05ff"],
]


# ==============================================================================
# Pure helper functions
# ==============================================================================

def mars_year_sol_to_earth_date(my: int, sol: int | float) -> str:
    """Compute Earth date (YYYY-MM-DD) from Mars Year and 1-based sol-of-year.

    Uses the standard Clancy et al. (2000) / Piqueux et al. (2015) convention:
    - Mars Year 1 begins on 1955-04-11 at sol 1.
    - One Mars year = 668.6 sols = 686.97 Earth days.
    """
    if my < 1:
        raise ValueError(f"Mars Year must be >= 1, got {my}")
    if sol < 1:
        raise ValueError(f"Sol must be >= 1, got {sol}")

    elapsed_days = (my - 1) * DAYS_PER_MY + (sol - 1) * DAYS_PER_SOL
    dt = MY1_START_DATE + timedelta(days=elapsed_days)
    return dt.strftime("%Y-%m-%d")


def quantize_cdod(
    val: float | np.ndarray | None,
    scale: float = DUST_SCALE,
    offset: float = DUST_OFFSET,
    nodata_byte: int = DUST_NODATA,
) -> int | np.ndarray:
    """Quantize continuous column dust optical depth to uint8 [0..254], reserving 255 for nodata.

    raw = byte * scale + offset
    byte = round((raw - offset) / scale)
    """
    if val is None:
        return nodata_byte

    if isinstance(val, (int, float, np.floating)):
        if math.isnan(val):
            return nodata_byte
        b = int(round((val - offset) / scale))
        return max(0, min(254, b))

    arr = np.asarray(val, dtype=np.float64)
    out = np.full(arr.shape, nodata_byte, dtype=np.uint8)
    valid = ~np.isnan(arr)
    scaled = np.round((arr[valid] - offset) / scale)
    out[valid] = np.clip(scaled, 0, 254).astype(np.uint8)
    return out


def dequantize_cdod(
    byte_val: int | np.ndarray,
    scale: float = DUST_SCALE,
    offset: float = DUST_OFFSET,
    nodata_byte: int = DUST_NODATA,
) -> float | np.ndarray:
    """Dequantize uint8 byte value back to float optical depth."""
    if isinstance(byte_val, (int, np.integer)):
        if byte_val == nodata_byte:
            return float("nan")
        return float(byte_val * scale + offset)

    arr = np.asarray(byte_val, dtype=np.uint8)
    out = np.full(arr.shape, np.nan, dtype=np.float32)
    valid = arr != nodata_byte
    out[valid] = arr[valid].astype(np.float32) * scale + offset
    return out


def sol_to_frame_index(sol: int, min_sol: int = 1, max_sol: int = 669) -> int:
    """Return 0-based frame index for a given 1-based sol-of-year."""
    if not (min_sol <= sol <= max_sol):
        raise IndexError(f"Sol {sol} is out of bounds [{min_sol}, {max_sol}]")
    return sol - min_sol


def frame_byte_offset(frame_idx: int, width: int = 120, height: int = 60) -> int:
    """Return byte offset for frame_idx in a raw uint8 [sol][lat][lon] file."""
    if frame_idx < 0:
        raise IndexError(f"Frame index must be non-negative, got {frame_idx}")
    return frame_idx * (width * height)


def lonlat_to_grid_indices(
    lon: float,
    lat: float,
    west: float = -180.0,
    north: float = 90.0,
    res_lon: float = 3.0,
    res_lat: float = 3.0,
    width: int = 120,
    height: int = 60,
) -> tuple[int, int]:
    """Map geographic coordinates (lon [-180, 180], lat [-90, 90]) to (row, col) grid indices."""
    col = int(math.floor((lon - west) / res_lon))
    row = int(math.floor((north - lat) / res_lat))
    row = max(0, min(height - 1, row))
    col = max(0, min(width - 1, col))
    return row, col


def parse_gale_weather(soles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Parse, clean, and sort Gale REMS soles into contract schema without gap-filling."""
    days: list[dict[str, Any]] = []

    for s in soles:
        sol_num = int(s["sol"])
        earth_date = s["terrestrial_date"]

        # Parse Ls
        ls_raw = s.get("ls")
        if ls_raw is not None and str(ls_raw) != "--":
            ls_val = float(ls_raw)
            if ls_val.is_integer():
                ls_val = int(ls_val)
        else:
            ls_val = None

        # Parse air temperature extrema
        t_min_raw = s.get("min_temp")
        t_min_c = int(t_min_raw) if (t_min_raw not in ("--", None, "") and str(t_min_raw).lstrip("-").isdigit()) else None

        t_max_raw = s.get("max_temp")
        t_max_c = int(t_max_raw) if (t_max_raw not in ("--", None, "") and str(t_max_raw).lstrip("-").isdigit()) else None

        # Parse pressure
        press_raw = s.get("pressure")
        pressure_pa = int(press_raw) if (press_raw not in ("--", None, "") and str(press_raw).lstrip("-").isdigit()) else None

        day: dict[str, Any] = {
            "sol": sol_num,
            "earth_date": earth_date,
            "ls": ls_val,
            "t_min_c": t_min_c,
            "t_max_c": t_max_c,
            "pressure_pa": pressure_pa,
        }

        # Add other fields only when they exist and are non-empty in sources
        min_gts = s.get("min_gts_temp")
        if min_gts not in ("--", None, ""):
            day["t_gts_min_c"] = int(min_gts) if str(min_gts).lstrip("-").isdigit() else float(min_gts)

        max_gts = s.get("max_gts_temp")
        if max_gts not in ("--", None, ""):
            day["t_gts_max_c"] = int(max_gts) if str(max_gts).lstrip("-").isdigit() else float(max_gts)

        opacity = s.get("atmo_opacity")
        if opacity not in ("--", None, ""):
            day["atmo_opacity"] = str(opacity)

        uv = s.get("local_uv_irradiance_index")
        if uv not in ("--", None, ""):
            day["local_uv_irradiance_index"] = str(uv)

        sunrise = s.get("sunrise")
        if sunrise not in ("--", None, ""):
            day["sunrise"] = str(sunrise)

        sunset = s.get("sunset")
        if sunset not in ("--", None, ""):
            day["sunset"] = str(sunset)

        season = s.get("season")
        if season not in ("--", None, ""):
            day["season"] = str(season)

        days.append(day)

    # Sort strictly by sol ascending (no gap-filling)
    days.sort(key=lambda d: d["sol"])
    return days


def filter_temperature_spikes(
    days: list[dict[str, Any]],
    window_size: int = 5,
    threshold_deg: float = 15.0,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Filter isolated one-sol temperature spikes (sensor glitches) without gap-filling.

    A value is considered an isolated spike if:
    - for t_min_c: it is more than threshold_deg below both the median of the window_size
      valid sols before and the window_size valid sols after.
    - for t_max_c: it is more than threshold_deg above both the median of the window_size
      valid sols before and the window_size valid sols after.

    Spike values are set to None. Returns (cleaned_days, dropped_counts).
    """
    cleaned_days = [dict(d) for d in days]
    dropped_counts = {"t_min_c": 0, "t_max_c": 0}

    for key, mode in [("t_min_c", "min"), ("t_max_c", "max")]:
        valid_indices = [i for i, d in enumerate(cleaned_days) if d.get(key) is not None]
        spikes_to_null: list[int] = []

        for k, idx in enumerate(valid_indices):
            before = [cleaned_days[valid_indices[j]][key] for j in range(max(0, k - window_size), k)]
            after = [cleaned_days[valid_indices[j]][key] for j in range(k + 1, min(len(valid_indices), k + 1 + window_size))]

            if not before or not after:
                continue

            med_before = float(np.median(before))
            med_after = float(np.median(after))
            val = cleaned_days[idx][key]

            if mode == "min":
                if (val < med_before - threshold_deg) and (val < med_after - threshold_deg):
                    spikes_to_null.append(idx)
            elif mode == "max":
                if (val > med_before + threshold_deg) and (val > med_after + threshold_deg):
                    spikes_to_null.append(idx)

        for idx in spikes_to_null:
            cleaned_days[idx][key] = None
        dropped_counts[key] = len(spikes_to_null)

    return cleaned_days, dropped_counts


# ==============================================================================
# Pipeline builders
# ==============================================================================

def extract_dust_archive(tar_path: Path, extract_dir: Path) -> list[Path]:
    """Extract krigedcdod_v2.tar.gz if extracted directory is empty."""
    extract_dir.mkdir(parents=True, exist_ok=True)
    existing_nc = sorted(extract_dir.glob("*.nc"))
    if existing_nc:
        return existing_nc

    if not tar_path.exists():
        raise FileNotFoundError(f"Montabone dust archive not found: {tar_path}")

    print(f"Extracting {tar_path} -> {extract_dir} ...")
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(extract_dir)

    return sorted(extract_dir.glob("*.nc"))


def build_dust(
    tar_path: Path = ROOT / "data" / "raw" / "montabone_dust" / "krigedcdod_v2.tar.gz",
    extracted_dir: Path = ROOT / "data" / "raw" / "montabone_dust" / "extracted",
    manifest_path: Path = ROOT / "data" / "raw" / "montabone_dust" / "manifest.json",
    output_dir: Path = ROOT / "data" / "globe" / "dust",
) -> None:
    """Build uint8 binary frames per Mars year and index.json manifest."""
    output_dir.mkdir(parents=True, exist_ok=True)
    nc_files = extract_dust_archive(tar_path, extracted_dir)

    # Read manifest metadata for citation and licence
    source_meta: dict[str, str] = {
        "dataset": "montabone_dust",
        "citation": (
            "TES, THEMIS and MCS data (MGS, Mars Odyssey, MRO), processed by Montabone et al. (2015) "
            "Icarus doi:10.1016/j.icarus.2014.12.034 and Montabone et al. (2020) JGR Planets doi:10.1029/2019JE006111, LMD"
        ),
        "licence": "CC-BY-SA-3.0",
    }
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            mf = json.load(f)
            source_meta["dataset"] = mf.get("dataset", source_meta["dataset"])
            source_meta["citation"] = mf.get("citation", source_meta["citation"])
            source_meta["licence"] = mf.get("licence", source_meta["licence"])

    year_entries: list[dict[str, Any]] = []
    total_bytes = 0

    print(f"Building dust history binary frames into {output_dir} ...")

    # Match files by Mars Year
    for nc_path in nc_files:
        m = re.search(r"MY(\d+)", nc_path.name)
        if not m:
            continue
        my_num = int(m.group(1))

        with netcdf_file(nc_path, "r", mmap=False) as nc:
            # Check grid dimensions
            lons = nc.variables["longitude"].data.copy()
            lats = nc.variables["latitude"].data.copy()
            soys = nc.variables["SOY"].data.copy()
            lss = nc.variables["Ls"].data.copy()
            raw_cdod = nc.variables[DUST_VARIABLE].data.copy()

        frames_count = len(soys)
        n_lat, n_lon = len(lats), len(lons)
        if (n_lon, n_lat) != (DUST_GRID["width"], DUST_GRID["height"]):
            raise ValueError(
                f"Unexpected grid shape ({n_lat}, {n_lon}) in {nc_path.name}, expected (60, 120)"
            )

        # Quantize to uint8 [sol][lat][lon]
        bin_data = quantize_cdod(raw_cdod, scale=DUST_SCALE, offset=DUST_OFFSET, nodata_byte=DUST_NODATA)

        bin_filename = f"MY{my_num}.bin"
        bin_path = output_dir / bin_filename
        bin_bytes = bin_data.tobytes()
        bin_path.write_bytes(bin_bytes)

        file_size = len(bin_bytes)
        total_bytes += file_size

        # Compile sol entries
        sols_list: list[dict[str, Any]] = []
        for s, ls_val in zip(soys, lss):
            sol_int = int(s)
            ls_float = round(float(ls_val), 2)
            ed = mars_year_sol_to_earth_date(my_num, sol_int)
            sols_list.append({"sol": sol_int, "ls": ls_float, "earth_date": ed})

        year_entries.append({
            "my": my_num,
            "url": bin_filename,
            "frames": frames_count,
            "sols": sols_list,
        })

        print(f"  MY{my_num:02d}: {frames_count} frames -> {bin_filename} ({file_size / (1024*1024):.2f} MB)")

    # Sort years ascending
    year_entries.sort(key=lambda y: y["my"])

    # Build index.json
    index_manifest: dict[str, Any] = {
        "version": 1,
        "variable": DUST_VARIABLE,
        "units": DUST_UNITS,
        "grid": DUST_GRID,
        "scale": DUST_SCALE,
        "offset": DUST_OFFSET,
        "nodata": DUST_NODATA,
        "palette": {
            "stops": DUST_PALETTE_STOPS,
        },
        "years": year_entries,
        "jezero_weather": None,
        "source": source_meta,
    }

    index_path = output_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_manifest, f, indent=2)

    index_size = index_path.stat().st_size
    total_bytes += index_size

    print(f"Wrote {index_path} ({index_size / 1024:.1f} KB)")
    print(f"Total dust layer size: {total_bytes / (1024*1024):.2f} MB across {len(year_entries)} Mars years.")


def build_weather(
    rems_dir: Path = ROOT / "data" / "raw" / "rems",
    output_file: Path = ROOT / "data" / "globe" / "weather" / "gale.json",
) -> None:
    """Build Gale crater Curiosity REMS daily weather history."""
    output_file.parent.mkdir(parents=True, exist_ok=True)
    nw_file = rems_dir / "nasa_weather.json"
    if not nw_file.exists():
        raise FileNotFoundError(f"Gale weather file not found: {nw_file}")

    with open(nw_file, "r", encoding="utf-8") as f:
        nw = json.load(f)

    soles = nw.get("soles", [])
    raw_days = parse_gale_weather(soles)
    days, dropped = filter_temperature_spikes(raw_days)

    # Source metadata
    source_meta: dict[str, str] = {
        "dataset": "rems",
        "name": "Curiosity rover REMS daily weather reports, Gale crater",
        "provider": "NASA/JPL-Caltech; REMS instrument by Centro de Astrobiología (CSIC-INTA, Spain)",
        "url": "https://mars.nasa.gov/msl/weather/",
        "licence": "NASA content, public domain; credit NASA/JPL-Caltech/CAB(CSIC-INTA)",
        "licence_url": "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        "citation": (
            "Gómez-Elvira, J., et al. (2012). REMS: the Environmental Sensor Suite for the Mars Science Laboratory rover. "
            "Space Science Reviews, 170, 583–640. Daily reports of the REMS team, NASA/JPL-Caltech/CAB(CSIC-INTA)."
        ),
        "notes": (
            f"Filtered isolated 1-sol sensor glitches (>15 °C below both the 5-sol preceding and succeeding medians "
            f"for t_min_c, or >15 °C above for t_max_c): dropped {dropped['t_min_c']} t_min_c spikes "
            f"and {dropped['t_max_c']} t_max_c spikes to null."
        ),
    }

    # If tmax.json has source details, merge any extras
    tmax_file = rems_dir / "tmax.json"
    if tmax_file.exists():
        try:
            with open(tmax_file, "r", encoding="utf-8") as f:
                tmax_data = json.load(f)
                src = tmax_data.get("series", {}).get("source", {})
                for k, v in src.items():
                    if k not in source_meta and v:
                        source_meta[k] = v
        except Exception:
            pass

    out_data = {
        "version": 1,
        "site": "gale",
        "source": source_meta,
        "days": days,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(out_data, f, indent=2)

    file_size = output_file.stat().st_size
    clean_mins = [d for d in days if d["t_min_c"] is not None]
    clean_maxs = [d for d in days if d["t_max_c"] is not None]
    lowest_min = min(clean_mins, key=lambda x: x["t_min_c"])
    highest_min = max(clean_mins, key=lambda x: x["t_min_c"])
    lowest_max = min(clean_maxs, key=lambda x: x["t_max_c"])
    highest_max = max(clean_maxs, key=lambda x: x["t_max_c"])

    print(f"Wrote {output_file}: {len(days)} sols ({file_size / 1024:.1f} KB, sol {days[0]['sol']}..{days[-1]['sol']})")
    print(f"Spike filtering dropped {dropped['t_min_c']} t_min_c spikes and {dropped['t_max_c']} t_max_c spikes.")
    print(f"New t_min_c extrema: lowest {lowest_min['t_min_c']} °C on Sol {lowest_min['sol']} ({lowest_min['earth_date']}), highest {highest_min['t_min_c']} °C on Sol {highest_min['sol']} ({highest_min['earth_date']})")
    print(f"New t_max_c extrema: lowest {lowest_max['t_max_c']} °C on Sol {lowest_max['sol']} ({lowest_max['earth_date']}), highest {highest_max['t_max_c']} °C on Sol {highest_max['sol']} ({highest_max['earth_date']})")


def build_previews(
    shots_dir: Path = ROOT / ".shots",
    elevation_path: Path = ROOT / "data" / "processed" / "global-layers" / "elevation_m.tif",
    dust_dir: Path = ROOT / "data" / "globe" / "dust",
    weather_file: Path = ROOT / "data" / "globe" / "weather" / "gale.json",
) -> None:
    """Generate visual verification evidence in .shots/.

    1. 6-frame preview strip across the MY 34 global dust storm over shaded relief
    2. Gale daily min/max temperature and atmospheric pressure time series
    """
    shots_dir.mkdir(parents=True, exist_ok=True)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap, LightSource
    import rasterio

    # --------------------------------------------------------------------------
    # 1. MY 34 Global Dust Storm 6-frame preview strip
    # --------------------------------------------------------------------------
    print("Generating MY 34 dust storm preview strip ...")
    if not elevation_path.exists():
        raise FileNotFoundError(f"Elevation raster not found: {elevation_path}")

    with rasterio.open(elevation_path) as src:
        # Read downsampled elevation (180x360) and roll longitude from [0, 360] to [-180, 180]
        elev = src.read(1, out_shape=(180, 360), resampling=rasterio.enums.Resampling.bilinear)
        elev = np.roll(elev, 180, axis=1)

    # Elevation raster spans lat -60..60. Pad poles to cover -90..90
    top_pad = np.repeat(elev[0:1, :], 30, axis=0)
    bot_pad = np.repeat(elev[-1:, :], 30, axis=0)
    full_elev = np.vstack([top_pad, elev, bot_pad])  # 240 x 360

    ls = LightSource(azdeg=315, altdeg=45)
    hillshade = ls.hillshade(full_elev, vert_exag=0.03)

    # Build colormap from palette stops
    max_tau = 7.5
    cmap_stops = []
    for val, hex_code in DUST_PALETTE_STOPS:
        norm_v = min(1.0, val / max_tau)
        h = hex_code.lstrip("#")
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        a = int(h[6:8], 16) / 255.0
        cmap_stops.append((norm_v, (r, g, b, a)))

    dust_cmap = LinearSegmentedColormap.from_list("mars_dust", cmap_stops)

    # Load MY 34 binary file and index.json
    index_file = dust_dir / "index.json"
    with open(index_file, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    my34_entry = next((y for y in manifest["years"] if y["my"] == 34), None)
    if not my34_entry:
        raise ValueError("MY 34 entry not found in index.json")

    bin_path = dust_dir / my34_entry["url"]
    raw_bytes = bin_path.read_bytes()
    all_frames = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((-1, 60, 120))
    sols_data = my34_entry["sols"]

    # Select 6 key sols across the 2018 global dust storm:
    # 1. Sol 360: Pre-storm baseline / clear sky
    # 2. Sol 385: Storm initiation / onset (Ls ~187)
    # 3. Sol 405: Rapid expansion / regional obscuration (Ls ~199)
    # 4. Sol 425: Planet-encircling peak (Ls ~212, June/July 2018)
    # 5. Sol 455: Decaying storm / hazy atmosphere (Ls ~231)
    # 6. Sol 485: Clearing phase (Ls ~250, September 2018)
    target_sols = [360, 385, 405, 425, 455, 485]

    fig, axes = plt.subplots(2, 3, figsize=(15, 7.5), constrained_layout=True)
    axes_flat = axes.flatten()

    for idx, sol in enumerate(target_sols):
        frame_idx = sol - 1
        byte_grid = all_frames[frame_idx]
        cdod_grid = dequantize_cdod(byte_grid, scale=DUST_SCALE, offset=DUST_OFFSET)
        sol_meta = sols_data[frame_idx]

        ax = axes_flat[idx]
        ax.imshow(hillshade, cmap="gray", extent=[-180, 180, -90, 90], origin="upper")
        im = ax.imshow(
            cdod_grid,
            cmap=dust_cmap,
            vmin=0.0,
            vmax=max_tau,
            extent=[-180, 180, -90, 90],
            origin="upper",
            interpolation="bilinear",
        )
        mean_tau = np.nanmean(cdod_grid)
        max_tau_val = np.nanmax(cdod_grid)
        ax.set_title(
            f"Sol {sol} (Ls {sol_meta['ls']}°, {sol_meta['earth_date']})\nMean τ: {mean_tau:.2f} | Max τ: {max_tau_val:.2f}",
            fontsize=10,
            fontweight="bold",
        )
        ax.set_xticks([-180, -90, 0, 90, 180])
        ax.set_yticks([-60, -30, 0, 30, 60])
        ax.tick_params(labelsize=8)
        if idx % 3 == 0:
            ax.set_ylabel("Latitude (°N)", fontsize=9)
        if idx >= 3:
            ax.set_xlabel("Longitude (°E)", fontsize=9)

    fig.suptitle(
        "Mars Year 34 Global Dust Storm Lifecycle (2018)\nMontabone et al. CDOD over Shaded Relief",
        fontsize=14,
        fontweight="bold",
    )
    cbar = fig.colorbar(im, ax=axes, orientation="horizontal", fraction=0.05, pad=0.04, shrink=0.7)
    cbar.set_label("Kriged Column Dust Optical Depth (cdodtot, dimensionless)", fontsize=10)

    strip_path = shots_dir / "my34_dust_storm_strip.png"
    fig.savefig(strip_path, dpi=160)
    plt.close(fig)
    print(f"Saved {strip_path} ({strip_path.stat().st_size / 1024:.1f} KB)")

    # --------------------------------------------------------------------------
    # 2. Gale daily weather history plot
    # --------------------------------------------------------------------------
    print("Generating Gale weather history plot ...")
    with open(weather_file, "r", encoding="utf-8") as f:
        gale_data = json.load(f)

    gale_days = gale_data["days"]
    sols = [d["sol"] for d in gale_days]
    t_mins = [d["t_min_c"] for d in gale_days]
    t_maxs = [d["t_max_c"] for d in gale_days]
    pressures = [d["pressure_pa"] for d in gale_days]

    valid_temp = [(s, mi, ma) for s, mi, ma in zip(sols, t_mins, t_maxs) if mi is not None and ma is not None]
    s_temp = [x[0] for x in valid_temp]
    t_min_v = [x[1] for x in valid_temp]
    t_max_v = [x[2] for x in valid_temp]

    valid_press = [(s, p) for s, p in zip(sols, pressures) if p is not None]
    s_press = [x[0] for x in valid_press]
    press_v = [x[1] for x in valid_press]

    fig, (ax_temp, ax_press) = plt.subplots(2, 1, figsize=(14, 8), sharex=True, constrained_layout=True)

    # Temperature panel
    ax_temp.fill_between(s_temp, t_min_v, t_max_v, color="#e67e22", alpha=0.3, label="Daily temp range")
    ax_temp.plot(s_temp, t_max_v, color="#d35400", lw=0.8, alpha=0.8, label="Max air temp (°C)")
    ax_temp.plot(s_temp, t_min_v, color="#2980b9", lw=0.8, alpha=0.8, label="Min air temp (°C)")
    ax_temp.set_ylabel("Air Temperature (°C)", fontsize=11, fontweight="bold")
    ax_temp.set_title("Curiosity REMS Weather History at Gale Crater (Sols 1–4995)", fontsize=13, fontweight="bold")
    ax_temp.grid(True, alpha=0.3, linestyle="--")
    ax_temp.legend(loc="upper right", frameon=True)

    # Pressure panel
    ax_press.plot(s_press, press_v, color="#27ae60", lw=0.9, label="Atmospheric pressure (Pa)")
    ax_press.set_ylabel("Pressure (Pa)", fontsize=11, fontweight="bold")
    ax_press.set_xlabel("Curiosity Mission Sol", fontsize=11, fontweight="bold")
    ax_press.grid(True, alpha=0.3, linestyle="--")
    ax_press.legend(loc="upper right", frameon=True)

    plot_path = shots_dir / "gale_weather_history.png"
    fig.savefig(plot_path, dpi=160)
    plt.close(fig)
    print(f"Saved {plot_path} ({plot_path.stat().st_size / 1024:.1f} KB)")


# ==============================================================================
# CLI Entrypoint
# ==============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Globe history pipeline: dust frames and Gale weather.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # dust subcommand
    p_dust = subparsers.add_parser("dust", help="Build daily global dust-storm frames and index.json")
    p_dust.add_argument("--tar-path", type=Path, default=ROOT / "data" / "raw" / "montabone_dust" / "krigedcdod_v2.tar.gz")
    p_dust.add_argument("--extracted-dir", type=Path, default=ROOT / "data" / "raw" / "montabone_dust" / "extracted")
    p_dust.add_argument("--manifest-path", type=Path, default=ROOT / "data" / "raw" / "montabone_dust" / "manifest.json")
    p_dust.add_argument("--output-dir", type=Path, default=ROOT / "data" / "globe" / "dust")

    # weather subcommand
    p_weather = subparsers.add_parser("weather", help="Build Gale weather history JSON")
    p_weather.add_argument("--rems-dir", type=Path, default=ROOT / "data" / "raw" / "rems")
    p_weather.add_argument("--output-file", type=Path, default=ROOT / "data" / "globe" / "weather" / "gale.json")

    # previews subcommand
    p_prev = subparsers.add_parser("preview", help="Generate verification preview strip and weather plots in .shots/")
    p_prev.add_argument("--shots-dir", type=Path, default=ROOT / ".shots")
    p_prev.add_argument("--elevation-path", type=Path, default=ROOT / "data" / "processed" / "global-layers" / "elevation_m.tif")
    p_prev.add_argument("--dust-dir", type=Path, default=ROOT / "data" / "globe" / "dust")
    p_prev.add_argument("--weather-file", type=Path, default=ROOT / "data" / "globe" / "weather" / "gale.json")

    # all subcommand
    p_all = subparsers.add_parser("all", help="Run dust, weather, and preview generation")

    args = parser.parse_args()

    if args.command == "dust":
        build_dust(args.tar_path, args.extracted_dir, args.manifest_path, args.output_dir)
    elif args.command == "weather":
        build_weather(args.rems_dir, args.output_file)
    elif args.command == "preview":
        build_previews(args.shots_dir, args.elevation_path, args.dust_dir, args.weather_file)
    elif args.command == "all":
        build_dust()
        build_weather()
        build_previews()


if __name__ == "__main__":
    main()
