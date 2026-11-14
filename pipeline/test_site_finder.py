import importlib.util
from pathlib import Path
from rasterio.transform import Affine

_SPEC = importlib.util.spec_from_file_location("site_finder", Path(__file__).with_name("site_finder.py"))
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
average_percentiles = _MODULE.average_percentiles
site_veto_reasons = _MODULE.site_veto_reasons
select_spaced_candidates = _MODULE.select_spaced_candidates
slugify = _MODULE.slugify
cesium_longitude = _MODULE.cesium_longitude
nearest_index_distance = _MODULE.nearest_index_distance
grid_index = _MODULE.grid_index
haversine_km = _MODULE.haversine_km
pass_mask = _MODULE._pass_mask
group_scores = _MODULE._group_scores
combine_groups = _MODULE._combine_groups
cell_patch = _MODULE._cell_patch


def test_olympus_mons_summit_is_vetoed_by_elevation():
    reasons = site_veto_reasons(18.65, 20_002.0, [[1.0, 2.0], [2.0, 1.0]])
    assert reasons == ["elevation"]


def test_jezero_landing_point_passes_hard_vetoes():
    reasons = site_veto_reasons(18.4447, -2_566.5, [[2.6, 2.7], [2.8, 2.9]])
    assert reasons == []


def test_veto_boundaries_are_inclusive_or_strict_as_sourced():
    assert site_veto_reasons(50.0, 1_999.9, [[9.9, 0.0], [1.0, 2.0]]) == []
    assert site_veto_reasons(50.01, 2_000.0, [[10.0, 0.0], [1.0, 2.0]]) == ["latitude", "elevation", "flat_area"]
    assert site_veto_reasons(0.0, float("nan"), [[float("nan"), 1.0], [2.0, 3.0]]) == ["elevation_no_data", "flat_area_no_data"]


def test_percentile_ties_use_average_rank():
    assert average_percentiles([1.0, 2.0, 2.0, 4.0]).tolist() == [0.0, 50.0, 50.0, 100.0]
    assert average_percentiles([1.0, 2.0, 2.0, 4.0], higher_is_better=False).tolist() == [100.0, 50.0, 50.0, 0.0]
    assert average_percentiles([7.0]).tolist() == [50.0]


def test_candidate_spacing_wraps_the_zero_360_seam():
    candidates = [
        {"id": "better", "lat": 0.0, "lon_east": 359.6, "score": 90.0},
        {"id": "near-seam", "lat": 0.0, "lon_east": 0.4, "score": 80.0},
    ]
    chosen = select_spaced_candidates(candidates, minimum_km=100.0, limit=200)
    assert [candidate["id"] for candidate in chosen] == ["better"]


def test_slugify_and_cesium_longitude_are_stable():
    assert slugify("Mars 2020 / Octavia E. Butler") == "mars-2020-octavia-e-butler"
    assert cesium_longitude(250.0) == -110.0
    assert cesium_longitude(180.0) == -180.0


def test_nearest_index_distance_returns_zero_for_the_same_centre():
    assert nearest_index_distance(18.0, 359.0, [18.0, -20.0], [359.0, 10.0]) == 0.0


def test_grid_index_wraps_longitude_and_maps_cell_centres():
    assert grid_index(359.5, 5.5, Affine(1, 0, 0, 0, -1, 10), 360, 10) == (4, 359)


def test_haversine_uses_mars_radius_and_wraps_seam():
    assert round(float(haversine_km(0.0, 359.6, 0.0, 0.4)), 3) == 47.42


def test_pass_mask_requires_four_low_slope_cells_and_a_valid_latitude():
    import numpy as np

    arrays = {"slope_p90_deg": np.ones((3, 3)), "elevation_m": np.zeros((3, 3))}
    assert pass_mask(arrays, Affine(1, 0, 0, 0, -1, 3)).tolist() == [
        [True, True, True], [True, True, True], [False, False, False]
    ]
    arrays["slope_p90_deg"][1, 1] = 10.0
    assert pass_mask(arrays, Affine(1, 0, 0, 0, -1, 3)).tolist() == [
        [False, False, True], [False, False, True], [False, False, False]
    ]


def test_group_scoring_and_weighted_score_are_exact():
    import numpy as np

    passed = np.array([True, True, True])
    groups = group_scores({"metric": np.array([1.0, 2.0, 3.0])}, passed,
                          {"terrain": {"metric": (1.0, True)}})
    assert groups["terrain"].tolist() == [0.0, 50.0, 100.0]
    combined = combine_groups({name: np.full(2, value, dtype=np.float32) for name, value in
                               zip(("terrain", "climate", "solar", "protection", "science"), (10, 20, 30, 40, 50))})
    assert combined.tolist() == [30.0, 30.0]


def test_cell_patch_wraps_the_longitude_seam():
    import numpy as np

    slope = np.array([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    assert cell_patch(slope, 0, 2).tolist() == [[3, 1], [6, 4]]
