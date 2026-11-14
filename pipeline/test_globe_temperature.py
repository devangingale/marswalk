"""Exact tests for the pure temperature-grid helpers."""

import numpy as np

from pipeline.globe_temperature import (
    coarse_cell, kelvin_to_celsius, ls_bin, median_with_min_count, select_local_time,
)


def test_ls_bin_edges() -> None:
    assert [ls_bin(value) for value in (0.0, 29.99, 30.0, 359.99)] == [0, 0, 1, 11]


def test_kelvin_to_celsius() -> None:
    result = kelvin_to_celsius(np.array([0.0, 273.15, 310.0], dtype=np.float64))
    np.testing.assert_array_equal(result, np.array([0.0 - 273.15, 273.15 - 273.15, 310.0 - 273.15]))


def test_local_time_selection_rule_on_synthetic_observations() -> None:
    local_times = np.array([1.5, 2.0, 3.99, 4.0, 11.99, 12.0, 14.0, 15.99, 16.0, 23.5])
    assert select_local_time(local_times, "night").tolist() == [True, True, True, False, False, False, False, False, False, False]
    assert select_local_time(local_times, "afternoon").tolist() == [False, False, False, False, False, True, True, True, False, False]


def test_coarse_cell_assignment_at_edges_and_longitude_seam() -> None:
    assert coarse_cell(90.0, -180.0) == (0, 0)
    assert coarse_cell(87.0, -177.0) == (1, 1)
    assert coarse_cell(-90.0, 177.0) == (59, 119)
    assert coarse_cell(0.0, 180.0) == coarse_cell(0.0, -180.0) == (30, 0)
    assert coarse_cell(0.0, 360.0) == (30, 60)


def test_cell_median_requires_three_observations() -> None:
    assert np.isnan(median_with_min_count([273.15, 275.15]))
    assert median_with_min_count([273.15, 283.15, 278.15]) == 278.15
