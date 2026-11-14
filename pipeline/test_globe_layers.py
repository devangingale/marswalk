import numpy as np
import pytest

from globe_layers import (
    NODATA,
    colour_ramp,
    dequantise_values,
    format_legend_number,
    layer_limits,
    quantise_values,
    tile_rectangle,
)


def test_level_zero_tile_rectangle():
    assert tile_rectangle(0, 0, 0) == (-180.0, -90.0, 0.0, 90.0)


def test_level_one_tile_rectangle():
    assert tile_rectangle(1, 2, 1) == (0.0, -90.0, 90.0, 0.0)


@pytest.mark.parametrize("coords", [(-1, 0, 0), (0, 2, 0), (0, 0, 1)])
def test_invalid_tile_coordinates_are_rejected(coords):
    with pytest.raises(ValueError):
        tile_rectangle(*coords)


def test_quantise_dequantise_round_trip_and_nodata():
    values = np.array([0.0, 12.5, 100.0, np.nan], dtype=np.float32)
    encoded, scale, offset = quantise_values(values, 0.0, 100.0)
    assert encoded.tolist() == [0, 8192, 65534, NODATA]
    decoded = dequantise_values(encoded, scale, offset)
    assert decoded[:3] == pytest.approx([0.0, 12.5, 100.0], abs=scale / 2)
    assert np.isnan(decoded[3])


def test_quantise_rejects_invalid_range():
    with pytest.raises(ValueError):
        quantise_values(np.array([1]), 2, 2)


def test_colour_ramp_endpoints_and_low_end_transparency():
    rgba = colour_ramp(np.array([0.0, 0.5, 1.0], dtype=np.float32), 0, 1, "Greens")
    assert rgba[0].tolist() == [247, 252, 245, 0]
    assert rgba[2].tolist() == [0, 68, 27, 240]
    assert 0 < rgba[1, 3] < 240


def test_ice_distance_fades_from_near_to_far():
    rgba = colour_ramp(np.array([0.0, 1000.0], dtype=np.float32), 0, 500, "ice_distance")
    assert rgba[0, 3] == 240
    assert rgba[1, 3] == 0


def test_ice_consistency_ends_transparent_to_near_white():
    rgba = colour_ramp(np.array([-0.5, 0.0, 1.0], dtype=np.float32), -1, 1, "swim_ice")
    assert rgba[:2, 3].tolist() == [0, 0]
    assert rgba[2, :3].tolist() == [247, 251, 255]
    assert rgba[2, 3] == 240


def test_radiation_low_end_is_transparent():
    rgba = colour_ramp(np.array([261.0, 332.0], dtype=np.float32), 261, 332, "dose_yellow")
    assert rgba[0, 3] == 0
    assert rgba[1, :3].tolist() == [255, 233, 77]


@pytest.mark.parametrize(
    "value,expected",
    [(2750.8, "2,751"), (1540, "1,540"), (336, "336"), (0.278, "0.28"), (0.0, "0")],
)
def test_legend_number_format(value, expected):
    assert format_legend_number(value) == expected


def test_layer_limits_use_percentile_clipping_or_natural_bounds():
    values = np.arange(101, dtype=np.float32)
    assert layer_limits(values, None) == pytest.approx((2, 98))
    assert layer_limits(values, (0, 1)) == (0.0, 1.0)
