"""Tests for the IAU Mars gazetteer -> names.geojson pipeline.

Written with AI assistance (Claude), directed and reviewed by the team.
These tests are pure: they use synthetic records and never hit the network.
"""
import pytest

from pipeline.names import (
    build_feature,
    build_feature_collection,
    is_approved,
    keep_feature,
    lon_east_to_180,
)


def test_longitude_east_to_180_examples():
    assert lon_east_to_180(350.0) == -10.0
    assert lon_east_to_180(10.0) == 10.0
    assert lon_east_to_180(0.0) == 0.0
    assert lon_east_to_180(360.0) == 0.0
    assert lon_east_to_180(190.0) == -170.0


def test_is_approved():
    assert is_approved("Adopted by IAU") is True
    assert is_approved("Dropped, disallowed") is False
    assert is_approved("Proposed") is False


def test_keep_feature_filtering_rule():
    # Approved and at/above the floor -> kept.
    assert keep_feature("Adopted by IAU", 5.0, 1.0) is True
    assert keep_feature("Adopted by IAU", 1.0, 1.0) is True
    # Approved but below the floor -> dropped.
    assert keep_feature("Adopted by IAU", 0.5, 1.0) is False
    # Not approved -> dropped regardless of size.
    assert keep_feature("Dropped", 500.0, 0.0) is False
    # Missing diameter treated as 0.
    assert keep_feature("Adopted by IAU", float("nan"), 0.0) is True
    assert keep_feature("Adopted by IAU", float("nan"), 1.0) is False


def test_build_feature_schema_and_longitude_conversion():
    feat = build_feature("Gale", "Crater, craters", 154.0, -5.4, 137.8)
    assert feat["type"] == "Feature"
    assert feat["geometry"]["type"] == "Point"
    lon, lat = feat["geometry"]["coordinates"]
    assert lon == pytest.approx(137.8)
    assert lat == pytest.approx(-5.4)
    assert -180.0 <= lon <= 180.0
    assert feat["properties"] == {"name": "Gale", "type": "Crater, craters", "diameter_km": 154.0}


def test_build_feature_converts_east_longitude():
    feat = build_feature("Far", "Crater, craters", 10.0, 0.0, 350.0)
    assert feat["geometry"]["coordinates"][0] == -10.0


def test_feature_collection_filters_and_is_valid_geojson():
    records = [
        {"name": "Big", "type": "Crater, craters", "diameter_km": 100.0, "lat": 1.0, "lon_east": 200.0, "approval": "Adopted by IAU"},
        {"name": "Small", "type": "Crater, craters", "diameter_km": 0.5, "lat": 2.0, "lon_east": 10.0, "approval": "Adopted by IAU"},
        {"name": "Unapproved", "type": "Crater, craters", "diameter_km": 300.0, "lat": 3.0, "lon_east": 20.0, "approval": "Proposed"},
    ]
    fc = build_feature_collection(records, min_diameter_km=1.0)
    assert fc["type"] == "FeatureCollection"
    # Only "Big" survives: "Small" is below the floor, "Unapproved" is not adopted.
    assert len(fc["features"]) == 1
    only = fc["features"][0]
    assert only["properties"]["name"] == "Big"
    for feat in fc["features"]:
        assert feat["type"] == "Feature"
        assert feat["geometry"]["type"] == "Point"
        lon, lat = feat["geometry"]["coordinates"]
        assert -180.0 <= lon <= 180.0
        assert -90.0 <= lat <= 90.0
        assert set(feat["properties"]) == {"name", "type", "diameter_km"}


def test_feature_collection_metadata_optional():
    fc = build_feature_collection([], min_diameter_km=0.0, metadata={"source": "x"})
    assert fc["metadata"] == {"source": "x"}
    assert fc["features"] == []
