import math

import numpy as np
import pytest

from globe_hydrated import (
    MARS_RADIUS_KM,
    MINERAL_STOPS,
    NODATA,
    PER_AREA_KM2,
    cell_areas_km2,
    coverage_grid,
    density_per_area,
    disc_sum,
    hotspots,
    legend,
    merge_max,
    mineral_colour,
    occupancy,
    feature_cells,
    polygon_area_km2,
    quantise_values,
    ramp_limits,
    ring_area_km2,
    sparse_occupancy,
    to_grid,
    within_coverage,
)

KM_PER_DEG = math.radians(1.0) * MARS_RADIUS_KM  # 59.274 km


def square(lon, lat, size):
    return [[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]


def test_ring_area_of_one_degree_square_at_equator():
    expected = KM_PER_DEG**2 * math.cos(math.radians(0.5))
    assert ring_area_km2(square(0, 0, 1)) == pytest.approx(expected, rel=1e-12)
    assert ring_area_km2(square(0, 0, 1)) == pytest.approx(3513.356, abs=1e-3)


def test_small_feature_goes_wholly_to_its_cell_with_holes_subtracted():
    geometry = {"type": "Polygon", "coordinates": [square(10.2, 20.2, 0.2), square(10.25, 20.25, 0.1)]}
    cells, area = feature_cells(geometry, res=1.0)
    assert cells.tolist() == [69 * 360 + 190]  # 20.4N, 10.4E
    assert area.tolist() == pytest.approx([ring_area_km2(square(10.2, 20.2, 0.2))
                                           - ring_area_km2(square(10.25, 20.25, 0.1))])
    assert polygon_area_km2(geometry) == pytest.approx(area[0])


def test_large_feature_is_rasterised_and_split_by_covered_area():
    # A 2 x 1 degree block over two 1-degree cells: half of its area in each.
    geometry = {"type": "MultiPolygon", "coordinates": [[[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]]]}
    cells, area = feature_cells(geometry, res=1.0)
    total = polygon_area_km2(geometry)
    assert cells.tolist() == [89 * 360 + 180, 89 * 360 + 181]
    assert area.tolist() == pytest.approx([total / 2, total / 2])
    assert area.sum() == pytest.approx(total)


def test_cell_areas_sum_to_sphere():
    areas = cell_areas_km2(180, 1.0)
    assert areas.sum() * 360 == pytest.approx(4 * math.pi * MARS_RADIUS_KM**2, rel=1e-12)
    assert areas[0] == pytest.approx(areas[-1])


def test_occupancy_bins_by_cell_and_caps_at_cell_area():
    points = np.array([
        [0.5, 0.5, 2.0],      # cell row 89, col 180
        [0.6, 0.4, 3.0],      # same cell
        [-179.5, 45.5, 1e9],  # row 44, col 0, far more than the cell holds
    ])
    grid = occupancy(points, res=1.0)
    assert grid.shape == (180, 360)
    assert grid[89, 180] == 5.0
    assert grid[44, 0] == pytest.approx(cell_areas_km2(180, 1.0)[44])
    assert grid.sum() == pytest.approx(5.0 + cell_areas_km2(180, 1.0)[44])


def test_sparse_occupancy_matches_dense_cells():
    points = np.array([[0.5, 0.5, 2.0], [0.6, 0.4, 3.0], [10.5, -20.5, 1.0]])
    cells, area = sparse_occupancy(points, res=1.0)
    assert cells.tolist() == [89 * 360 + 180, 110 * 360 + 190]
    assert area.tolist() == [5.0, 1.0]


def test_instruments_merge_by_maximum_not_sum():
    omega = (np.array([3, 7, 9]), np.array([1.0, 2.0, 4.0]))
    crism = (np.array([1, 3, 9]), np.array([0.5, 3.0, 4.0]))
    cells, area = merge_max([omega, crism])
    assert cells.tolist() == [1, 3, 7, 9]
    assert area.tolist() == [0.5, 3.0, 2.0, 4.0]


def test_to_grid_sums_fine_cells_into_coarse_cells():
    # 90-degree fine grid is 2 x 4; a factor of 2 gives a 1 x 2 grid of 180-degree cells.
    cells = np.array([0, 1, 4, 5, 2, 7])
    area = np.array([1.0, 2.0, 3.0, 4.0, 10.0, 20.0])
    assert to_grid(cells, area, 90.0, 2).tolist() == [[10.0, 30.0]]


def test_density_of_a_single_detection_on_a_tiny_catalogue():
    # One 10 km2 detection at (0.5E, 0.5N). With a 100 km radius on a 1-degree grid the disc
    # holds the cell, its four neighbours (59.3 km) and four diagonals (83.8 km), not 2 cells away (118.5 km).
    detected = occupancy(np.array([[0.5, 0.5, 10.0]]), res=1.0)
    covered = coverage_grid(180, 1.0, limit=90.0)
    density = density_per_area(detected, covered, 1.0, 100.0)
    areas = cell_areas_km2(180, 1.0)
    disc_area = 3 * (areas[88] + areas[89] + areas[90])
    assert density[89, 180] == pytest.approx(10.0 / disc_area * PER_AREA_KM2, rel=1e-12)
    assert density[89, 180] == pytest.approx(3.16290, abs=1e-5)
    # The neighbour at (1.5E, 0.5N) has the same disc shape, so the same value.
    assert density[89, 181] == pytest.approx(density[89, 180])
    assert density[89, 182] == 0.0
    assert density[87, 180] == 0.0


def test_disc_wraps_across_the_antimeridian():
    detected = occupancy(np.array([[-179.5, 0.5, 4.0]]), res=1.0)
    total = disc_sum(detected, 1.0, 100.0)
    assert total[89, 359] == 4.0  # 179.5E is next to 179.5W
    assert total[89, 0] == 4.0
    assert total[89, 2] == 0.0


def test_disc_near_the_pole_takes_the_whole_polar_row():
    # At 89.5N every cell of the row is within 1 degree (59 km) across the pole.
    grid = np.zeros((180, 360))
    grid[0] = 1.0
    totals = disc_sum(grid, 1.0, 100.0)
    assert totals[0].tolist() == [360.0] * 360
    assert totals[2].max() == 0.0  # 87.5N is 2 degrees (119 km) from 89.5N


def test_density_is_nodata_where_nothing_is_covered():
    detected = np.zeros((180, 360))
    covered = coverage_grid(180, 1.0, limit=70.0)
    density = density_per_area(detected, covered, 1.0, 150.0)
    assert np.isnan(density[0, 0])            # 89.5N, far from mapped ground
    assert density[89, 0] == 0.0              # equator, mapped, nothing found


def test_value_encoding_round_trip():
    values = np.array([0.0, 21.5, 43.0, np.nan], dtype=np.float32)
    encoded, scale, offset = quantise_values(values, 0.0, 43.0)
    assert encoded.dtype == np.uint16
    assert encoded.tolist() == [0, 32767, 65534, NODATA]
    assert offset == 0.0
    assert encoded[1] * scale + offset == pytest.approx(21.5, abs=scale / 2)


def test_ramp_limits_come_from_percentiles_of_nonzero_values():
    values = np.concatenate([np.zeros(500), np.arange(1, 101, dtype=float), [np.nan]])
    low, high = ramp_limits(values)
    assert low == pytest.approx(10.9)    # 10th percentile of 1..100
    assert high == pytest.approx(99.01)  # 99th percentile of 1..100


def test_ramp_starts_visible_and_saturates_at_the_high_end():
    rgba = mineral_colour(np.array([0.0, 5.0, 10.0, 1000.0, np.nan]), 10.0, 100.0)
    assert rgba[0, 3] == 0 and rgba[1, 3] == 0 and rgba[4, 3] == 0
    first, last = MINERAL_STOPS[0], MINERAL_STOPS[-1]
    assert rgba[2].tolist() == [0x6c, 0xc7, 0xad, first[1]]
    assert rgba[3].tolist() == [0x05, 0x59, 0x4c, last[1]]
    assert first[1] >= 100  # low end clearly visible, not transparent-at-zero


def test_legend_endpoints_and_stops():
    entry = legend(10.9, 99.01)
    assert (entry["min"], entry["max"]) == (10.9, 99.01)
    assert (entry["min_label"], entry["max_label"]) == ("10.9", "99")
    assert entry["stops"][0] == [0.0, "#00000000"]
    assert entry["stops"][1] == [10.9, "#6cc7ad78"]
    assert entry["stops"][-1] == [99.01, "#05594cf0"]
    assert entry["units"] == "km² per 10⁴ km²"


def test_hotspots_are_separated():
    values = np.zeros((4, 8))
    values[1, 1] = 9.0
    values[1, 2] = 8.0   # 1 degree from the first: suppressed
    values[2, 6] = 7.0
    found = hotspots(values, north=2.0, res=1.0, count=5, separation_km=150.0)
    assert [h["value"] for h in found] == [9.0, 7.0]
    assert (found[0]["lon"], found[0]["lat"]) == (-178.5, 0.5)


def test_detections_outside_the_mapped_band_are_dropped_and_reported():
    # 1-degree grid: row 9 is 80.5N (outside 70), row 89 is 0.5N (inside).
    cells = np.array([9 * 360 + 5, 89 * 360 + 5])
    kept_cells, kept_area, dropped = within_coverage(cells, np.array([7.0, 3.0]), res=1.0, limit=70.0)
    assert kept_cells.tolist() == [89 * 360 + 5]
    assert kept_area.tolist() == [3.0]
    assert dropped == 7.0
