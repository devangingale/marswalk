"""Exact-value pytest suite for geology rasterisation, classification, and value encoding."""

from __future__ import annotations

import numpy as np
import pytest
from rasterio.transform import Affine

from globe_geology import (
    GEOLOGY_GROUPS,
    classify_geology_unit,
    compute_olivine_ramp_endpoints,
    rasterize_geology_grid,
)
from globe_layers import (
    NODATA,
    colour_ramp,
    dequantise_values,
    quantise_values,
)


def test_classify_geology_unit_epochs_and_groups():
    """Verify classification logic maps representative Tanaka 2014 units to correct age and group."""
    assert classify_geology_unit("eNh", "Early Noachian highland unit") == (
        "Early Noachian",
        "noachian_highland",
        "Noachian highland",
    )
    assert classify_geology_unit("lAv", "Late Amazonian volcanic unit") == (
        "Late Amazonian",
        "amazonian_volcanic",
        "Amazonian volcanic",
    )
    assert classify_geology_unit("lHl", "Late Hesperian lowland unit") == (
        "Late Hesperian",
        "hesperian_plains",
        "Hesperian plains & lowlands",
    )
    assert classify_geology_unit("AHi", "Amazonian and Hesperian impact unit") == (
        "Amazonian and Hesperian",
        "impact",
        "Impact units",
    )
    assert classify_geology_unit("lApc", "Late Amazonian polar cap unit") == (
        "Late Amazonian",
        "polar",
        "Polar deposits & ice",
    )
    assert classify_geology_unit("eHt", "Early Hesperian transition unit") == (
        "Early Hesperian",
        "transition_apron",
        "Transition & apron",
    )
    assert classify_geology_unit("eHv", "Early Hesperian volcanic unit") == (
        "Early Hesperian",
        "hesperian_volcanic",
        "Hesperian volcanic",
    )


def test_rasterize_geology_grid_exact_values_on_synthetic_polygons():
    """Rasterize two synthetic polygons onto a 2x4 grid and verify exact integer values."""
    # Poly A covers lon [0..2], lat [0..2] with unit ID 10
    poly_a = {
        "type": "Polygon",
        "coordinates": [[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0], [0.0, 0.0]]],
    }
    # Poly B covers lon [2..4], lat [0..2] with unit ID 25
    poly_b = {
        "type": "Polygon",
        "coordinates": [[[2.0, 0.0], [4.0, 0.0], [4.0, 2.0], [2.0, 2.0], [2.0, 0.0]]],
    }

    shapes_and_ids = [(poly_a, 10), (poly_b, 25)]
    # Transform: 1 deg resolution; top-left is (lon=0, lat=2)
    transform = Affine(1.0, 0.0, 0.0, 0.0, -1.0, 2.0)
    grid = rasterize_geology_grid(shapes_and_ids, out_shape=(2, 4), transform=transform)

    assert grid.shape == (2, 4)
    assert grid.dtype == np.uint16
    expected = np.array(
        [
            [10, 10, 25, 25],
            [10, 10, 25, 25],
        ],
        dtype=np.uint16,
    )
    np.testing.assert_array_equal(grid, expected)


def test_geology_value_encoding_exact_round_trip_and_nodata():
    """Verify uint16 categorical encoding with scale=1.0 and offset=0.0 preserves unit IDs and nodata."""
    grid = np.array([[1, 2], [44, 0]], dtype=np.uint16)
    encoded = grid.copy()
    encoded[encoded == 0] = NODATA

    assert encoded[0, 0] == 1
    assert encoded[0, 1] == 2
    assert encoded[1, 0] == 44
    assert encoded[1, 1] == NODATA

    decoded = dequantise_values(encoded, scale=1.0, offset=0.0)
    assert decoded[0, 0] == 1.0
    assert decoded[0, 1] == 2.0
    assert decoded[1, 0] == 44.0
    assert np.isnan(decoded[1, 1])


def test_mineral_values_quantisation_exact_round_trip():
    """Verify mineral abundance values quantise accurately and restore within tolerance."""
    vals = np.array([0.0, 7.5, 15.0, np.nan], dtype=np.float32)
    encoded, scale, offset = quantise_values(vals, 0.0, 15.0)

    assert encoded[0] == 0
    assert encoded[1] == 32767
    assert encoded[2] == 65534
    assert encoded[3] == NODATA

    decoded = dequantise_values(encoded, scale, offset)
    assert decoded[:3] == pytest.approx([0.0, 7.5, 15.0], abs=scale / 2)
    assert np.isnan(decoded[3])


def test_compute_olivine_ramp_endpoints_from_percentiles():
    """Verify olivine ramp endpoints are computed from the non-zero median and 99th percentile."""
    # Synthetic array: 100 values, 75 zeros (noise/background) and 25 positive values up to 10.0
    synth = np.zeros(100, dtype=np.float32)
    # Positive values: 1.0 to 5.0 (25 values)
    synth[75:] = np.linspace(1.0, 5.0, 25, dtype=np.float32)

    lo, hi = compute_olivine_ramp_endpoints(synth)
    # Non-zero median of [1.0..5.0] is 3.0
    assert lo == pytest.approx(3.0, abs=0.1)
    # 99th percentile of all 100 values evaluates to approx 4.8
    assert hi == pytest.approx(4.8, abs=0.1)


def test_mineral_teal_green_colour_ramp_transparency_and_low_end_opacity():
    """Verify mineral_teal_green ramp is transparent below minimum and visible at low end."""
    rgba = colour_ramp(np.array([0.0, 0.5, 1.0, 2.25, 3.5], dtype=np.float32), 1.0, 3.5, "mineral_teal_green")
    assert rgba.shape == (5, 4)
    # Below minimum (noise floor / unmapped) is completely transparent
    assert rgba[0, 3] == 0
    assert rgba[1, 3] == 0
    # At minimum (1.0%), starts visibly with low base opacity (around 105 / 240)
    assert 90 <= rgba[2, 3] <= 120
    assert rgba[2, :3].tolist() == [224, 245, 238]  # pale mint teal
    # Intermediate value has intermediate opacity
    assert rgba[2, 3] < rgba[3, 3] < rgba[4, 3]
    # At maximum (3.5%), deep emerald teal at full 240 alpha
    assert rgba[4, 3] == 240
    assert rgba[4, :3].tolist() == [8, 127, 123]


def test_geology_muted_categorical_ramp():
    """Verify geology_muted ramp maps integer group IDs to the exact group colours."""
    # Test group 1 (Noachian highland) and group 7 (Impact)
    vals = np.array([1.0, 7.0], dtype=np.float32)
    rgba = colour_ramp(vals, 1.0, 7.0, "geology_muted")
    assert rgba.shape == (2, 4)

    # Group 1: Noachian highland #8f7a52 (143, 122, 82, 200)
    assert rgba[0].tolist() == list(GEOLOGY_GROUPS["noachian_highland"]["rgba"])

    # Group 7: Impact #7d6f8d (125, 111, 141, 200)
    assert rgba[1].tolist() == list(GEOLOGY_GROUPS["impact"]["rgba"])
