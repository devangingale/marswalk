import pytest

from pipeline.basemap import crop_bounds


def test_crop_bounds_returns_two_degree_window():
    assert crop_bounds(10.0, -20.0, 1.0) == (9.0, -21.0, 11.0, -19.0)


def test_default_crop_bounds_covers_two_degrees_each_side():
    assert crop_bounds(10.0, -20.0) == (8.0, -22.0, 12.0, -18.0)


def test_crop_bounds_clamps_to_planet_edges():
    assert crop_bounds(179.5, 89.5, 1.0) == (178.5, 88.5, 180.0, 90.0)


@pytest.mark.parametrize("center_lat", [-90.1, 90.1])
def test_crop_bounds_rejects_invalid_latitude(center_lat):
    with pytest.raises(ValueError, match="center latitude"):
        crop_bounds(0.0, center_lat)
