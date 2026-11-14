"""Unit tests for orbiter pass prediction (pipeline/passes.py).

Tests pure geometric and interval-finding helpers with exact expected values,
as well as pass ordering and non-overlapping constraints per orbiter.
"""

from pathlib import Path
import numpy as np
import pytest

from pipeline.passes import (
    DEFAULT_MIN_ELEVATION_DEG,
    MARS_RADIUS_M,
    SPICEPassPredictor,
    elevation_angle_deg,
    find_intervals_from_series,
    local_zenith_unit,
    site_to_cartesian_mars,
    validate_passes_sorted_and_non_overlapping,
)


def test_elevation_angle_overhead_is_exact_90_deg():
    """Spacecraft directly overhead at zenith returns exactly 90.0 degrees."""
    lat_deg = -4.5895
    lon_east_deg = 137.4417
    site_km = site_to_cartesian_mars(lat_deg, lon_east_deg, radius_m=MARS_RADIUS_M)
    zenith = local_zenith_unit(lat_deg, lon_east_deg)

    # Place synthetic spacecraft 300 km directly above site along local zenith
    altitude_km = 300.0
    sc_km = site_km + altitude_km * zenith

    el = elevation_angle_deg(site_km, sc_km, zenith)
    assert el == pytest.approx(90.0, abs=1e-9)


def test_elevation_angle_horizon_is_exact_0_deg():
    """Spacecraft on the local horizon returns exactly 0.0 degrees."""
    lat_deg = 18.4447
    lon_east_deg = 77.4508
    site_km = site_to_cartesian_mars(lat_deg, lon_east_deg, radius_m=MARS_RADIUS_M)
    zenith = local_zenith_unit(lat_deg, lon_east_deg)

    # Construct an arbitrary tangent (horizon) vector orthogonal to zenith
    ref = np.array([0.0, 0.0, 1.0]) if abs(zenith[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    tangent = np.cross(zenith, ref)
    tangent = tangent / np.linalg.norm(tangent)

    # Spacecraft located 500 km away along the horizon tangent line
    sc_km = site_km + 500.0 * tangent

    el = elevation_angle_deg(site_km, sc_km, zenith)
    assert el == pytest.approx(0.0, abs=1e-9)


def test_elevation_angle_nadir_is_minus_90_deg():
    """Spacecraft directly downward at nadir returns -90.0 degrees."""
    lat_deg = 0.0
    lon_east_deg = 0.0
    site_km = site_to_cartesian_mars(lat_deg, lon_east_deg, radius_m=MARS_RADIUS_M)
    zenith = local_zenith_unit(lat_deg, lon_east_deg)

    sc_km = site_km - 1000.0 * zenith
    el = elevation_angle_deg(site_km, sc_km, zenith)
    assert el == pytest.approx(-90.0, abs=1e-9)


def test_elevation_angle_45_deg():
    """Spacecraft at 45 deg elevation: equal vertical and horizontal components."""
    lat_deg = 0.0
    lon_east_deg = 0.0
    site_km = site_to_cartesian_mars(lat_deg, lon_east_deg, radius_m=MARS_RADIUS_M)
    zenith = local_zenith_unit(lat_deg, lon_east_deg)
    tangent = np.array([0.0, 1.0, 0.0])  # along East

    # Line of sight at 45 degrees: component along zenith == component along tangent
    sc_km = site_km + 200.0 * zenith + 200.0 * tangent
    el = elevation_angle_deg(site_km, sc_km, zenith)
    assert el == pytest.approx(45.0, abs=1e-9)


def test_find_intervals_from_series_exact():
    """Interval finding on a synthetic symmetric elevation series returns exact rise/set."""
    # Synthetic pass with parabolic shape: E(t) = 30 - 0.05 * (t - 100)^2
    # Crossing E = 10 occurs when 0.05 * (t - 100)^2 = 20 => (t-100)^2 = 400 => t = 80 and 120.
    times = np.arange(0, 201, 10, dtype=float)  # 0, 10, 20, ..., 200
    elevations = 30.0 - 0.05 * (times - 100.0) ** 2

    # At t=80: 30 - 0.05*(20^2) = 10.0
    # At t=120: 30 - 0.05*(20^2) = 10.0
    passes = find_intervals_from_series(times, elevations, min_elevation_deg=10.0)

    assert len(passes) == 1
    p = passes[0]
    assert p["rise_time"] == pytest.approx(80.0, abs=1e-5)
    assert p["set_time"] == pytest.approx(120.0, abs=1e-5)
    assert p["peak_time"] == pytest.approx(100.0, abs=1e-5)
    assert p["peak_elevation_deg"] == pytest.approx(30.0, abs=1e-5)
    assert p["duration_s"] == pytest.approx(40.0, abs=1e-5)


def test_find_intervals_multiple_passes_with_interp():
    """Two separate passes with linear interpolation on boundary points."""
    times = np.array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], dtype=float)
    elevations = np.array([0.0, 5.0, 15.0, 5.0, 0.0, 0.0, 0.0, 20.0, 20.0, 0.0, 0.0])

    passes = find_intervals_from_series(times, elevations, min_elevation_deg=10.0)
    assert len(passes) == 2

    assert passes[0]["rise_time"] == pytest.approx(15.0, abs=1e-5)
    assert passes[0]["set_time"] == pytest.approx(25.0, abs=1e-5)
    assert passes[0]["peak_elevation_deg"] == pytest.approx(15.0, abs=1e-5)

    assert passes[1]["rise_time"] == pytest.approx(65.0, abs=1e-5)
    assert passes[1]["set_time"] == pytest.approx(85.0, abs=1e-5)
    assert passes[1]["peak_elevation_deg"] == pytest.approx(20.0, abs=1e-5)


def test_passes_sorted_and_non_overlapping_validation():
    """Validation succeeds on correctly sorted, non-overlapping passes."""
    valid_passes = [
        {"orbiter": "MRO", "rise_utc": "2026-11-01T02:00:00Z", "set_utc": "2026-11-01T02:10:00Z"},
        {"orbiter": "TGO", "rise_utc": "2026-11-01T02:05:00Z", "set_utc": "2026-11-01T02:15:00Z"},
        {"orbiter": "MRO", "rise_utc": "2026-11-01T04:00:00Z", "set_utc": "2026-11-01T04:12:00Z"},
    ]
    assert validate_passes_sorted_and_non_overlapping(valid_passes) is True


def test_passes_rejects_unsorted():
    """Validation fails if global passes list is not sorted by rise_utc."""
    unsorted_passes = [
        {"orbiter": "MRO", "rise_utc": "2026-11-01T04:00:00Z", "set_utc": "2026-11-01T04:10:00Z"},
        {"orbiter": "TGO", "rise_utc": "2026-11-01T02:00:00Z", "set_utc": "2026-11-01T02:10:00Z"},
    ]
    with pytest.raises(ValueError, match="not sorted"):
        validate_passes_sorted_and_non_overlapping(unsorted_passes)


def test_passes_rejects_overlapping_per_orbiter():
    """Validation fails if passes for the same orbiter overlap."""
    overlapping_passes = [
        {"orbiter": "MRO", "rise_utc": "2026-11-01T02:00:00Z", "set_utc": "2026-11-01T02:15:00Z"},
        {"orbiter": "MRO", "rise_utc": "2026-11-01T02:10:00Z", "set_utc": "2026-11-01T02:25:00Z"},
    ]
    with pytest.raises(ValueError, match="overlap"):
        validate_passes_sorted_and_non_overlapping(overlapping_passes)


def test_spice_predictor_integration_if_kernels_exist():
    """Integration test: compute passes over a 2-day sample window at Gale."""
    kernels_dir = Path("data/raw/naif_spice")
    if not (kernels_dir / "naif0012.tls").exists():
        pytest.skip("SPICE kernels not downloaded yet")

    predictor = SPICEPassPredictor(kernels_dir)
    try:
        # Gale: -4.5895, 137.4417
        passes = predictor.compute_passes(
            lat_deg=-4.5895,
            lon_east_deg=137.4417,
            start_utc="2026-11-01T00:00:00Z",
            end_utc="2026-11-03T00:00:00Z",
            step_s=30.0,
            min_elevation_deg=DEFAULT_MIN_ELEVATION_DEG,
        )
        assert len(passes) > 0
        assert validate_passes_sorted_and_non_overlapping(passes) is True

        # Check required keys in pass records
        for p in passes:
            assert p["orbiter"] in ["MRO", "ODY", "MEX", "TGO"]
            assert "rise_utc" in p and p["rise_utc"].endswith("Z")
            assert "set_utc" in p and p["set_utc"].endswith("Z")
            assert "peak_utc" in p and p["peak_utc"].endswith("Z")
            assert p["peak_elevation_deg"] >= DEFAULT_MIN_ELEVATION_DEG
            assert p["duration_s"] > 0
            assert p["rise_utc"] < p["set_utc"]
    finally:
        predictor.close()
