"""Tests for the site 3D terrain tileset builder.

Written with AI assistance, directed and reviewed by the team.
"""
import json
import struct

import numpy as np
import pytest

from pipeline.site_terrain3d import (
    MARS_A,
    SKIRT_MARGIN_M,
    DEFAULT_HEIGHT_OFFSETS_M,
    build_tileset,
    decode_terrain_rgb,
    enu_axes,
    geodetic_to_ecef,
    level_errors,
    mosaic_zoom,
    quadtree_depth,
    tile_mesh,
    write_glb,
)


def test_terrain_rgb_decode():
    rgb = np.array([[[1, 134, 160], [0, 234, 96], [0, 0, 0], [0, 156, 64]]], dtype=np.uint8)
    h = decode_terrain_rgb(rgb)
    assert h[0, 0] == pytest.approx(0.0, abs=1e-9)
    assert h[0, 1] == pytest.approx(-4000.0, abs=1e-9)
    assert np.isnan(h[0, 2])
    assert h[0, 3] == pytest.approx(-6000.0, abs=1e-9)


def test_known_vertex_matches_cesium_fromdegrees():
    # Cartesian3.fromDegrees(137.36045619776752, -4.765947140908848, -3926.24, Ellipsoid.MARS) in Cesium 1.146.
    p = geodetic_to_ecef(137.36045619776752, -4.765947140908848, -3926.24)
    assert p == pytest.approx([-2486922.792732328, 2290012.476513179, -278547.5096060308], abs=1e-6)
    assert geodetic_to_ecef(0.0, 0.0, 0.0) == pytest.approx([3396190.0, 0.0, 0.0], abs=1e-9)
    assert geodetic_to_ecef(90.0, 45.0, 100.0) == pytest.approx([0.0, 2408617.5911403326, 2380347.5851791212], abs=1e-6)


def read_glb(path):
    data = path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    binary = data[20 + json_len + 8:]
    count = gltf["accessors"][0]["count"]
    positions = np.frombuffer(binary, np.float32, count * 3, gltf["bufferViews"][0]["byteOffset"]).reshape(-1, 3)
    packed = np.frombuffer(binary, np.uint8, count * 4, gltf["bufferViews"][1]["byteOffset"]).reshape(-1, 4)
    return gltf, positions, packed


def test_glb_vertex_is_earth_fixed_after_y_up(tmp_path):
    lon = np.array([137.0, 137.001])
    lat = np.array([-4.0, -3.999])
    heights = np.array([[-4000.0, -4001.0], [-4002.0, -4003.0]])
    pos, nor, skirt, tris, _ = tile_mesh(heights, lon, lat, [True] * 4, 1.0, -4100.0)
    write_glb(tmp_path / "t.glb", pos, nor, skirt, tris)
    gltf, gl_pos, packed = read_glb(tmp_path / "t.glb")
    tx, ty, tz = gltf["nodes"][0]["translation"]
    x, y, z = gl_pos[0].astype(np.float64) + [tx, ty, tz]
    # glTF y-up back to Earth-fixed z-up: (x, y, z) -> (x, -z, y).
    assert [x, -z, y] == pytest.approx(geodetic_to_ecef(137.0, -4.0, -4000.0), abs=1e-3)
    assert gltf["extensionsRequired"] == ["KHR_mesh_quantization"]
    # Four grid vertices, then 2 skirt vertices on each of the four edges.
    assert packed[:, 3].tolist() == [0] * 4 + [255] * 8
    skirt_accessor = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["_SKIRT"]]
    assert (skirt_accessor["bufferView"], skirt_accessor["byteOffset"], skirt_accessor["componentType"]) == (1, 3, 5121)


def test_skirt_normals_are_horizontal_and_outward():
    lon = np.array([137.0, 137.001])
    lat = np.array([-4.0, -3.999])
    _, nor, skirt, _, _ = tile_mesh(np.zeros((2, 2)), lon, lat, [True] * 4, 1.0, -10.0)
    east, north, up = enu_axes(137.0, -4.0)
    first_of_each_edge = nor[skirt][[0, 2, 4, 6]]
    assert (first_of_each_edge @ up) == pytest.approx([0, 0, 0, 0], abs=1e-4)
    assert (first_of_each_edge @ north) == pytest.approx([-1, 0, 1, 0], abs=1e-4)
    assert (first_of_each_edge @ east) == pytest.approx([0, 1, 0, -1], abs=1e-4)


def test_geometric_error_per_level_on_a_plane_is_the_vertex_spacing():
    r, c = np.mgrid[0:17, 0:17]
    plane = 0.3 * r - 0.2 * c
    assert level_errors(plane, 3, 1.0) == [8.0, 4.0, 2.0, 0.0]
    assert level_errors(plane, 2, 0.5) == [2.0, 1.0, 0.0]


def test_geometric_error_per_level_takes_the_dem_gap_and_never_drops_going_up():
    spike = np.zeros((9, 9))
    spike[1, 1] = 10.0
    assert level_errors(spike, 2, 1.0) == [10.0, 10.0, 0.0]


def test_mosaic_zoom_matches_the_grid_resolution_within_the_archive():
    # Gale: 83 070 m per pixel at zoom 0, so 1 m needs zoom 17 (0.63 m) and 2 m zoom 16 (1.27 m).
    assert mosaic_zoom(13, 18, -4.76, 1.0) == 17
    assert mosaic_zoom(13, 18, -4.76, 2.0) == 16
    assert mosaic_zoom(13, 16, -4.76, 1.0) == 16
    assert mosaic_zoom(13, 18, -4.76, 100.0) == 13


def test_quadtree_depth():
    assert quadtree_depth(500) == 3
    assert quadtree_depth(4000) == 6
    assert quadtree_depth(64) == 0


def test_skirt_depth_inner_edges_and_site_floor():
    lon = np.array([10.0, 10.001, 10.002])
    lat = np.array([0.0, 0.001])
    heights = np.array([[-100.0, -101.0, -102.0], [-103.0, -104.0, -105.0]])
    # South and west on the site edge, east and north inside the site.
    _, _, _, _, skirt = tile_mesh(heights, lon, lat, [True, False, False, True], 4.0, -150.0)
    south, east, north, west = skirt[:3], skirt[3:5], skirt[5:8], skirt[8:]
    assert south.tolist() == [-150.0, -150.0, -150.0]
    assert east.tolist() == [-106.0, -109.0]
    assert north.tolist() == [-109.0, -108.0, -107.0]
    assert west.tolist() == [-150.0, -150.0]


def test_tileset_skirt_floor_sits_below_the_lowest_site_edge(tmp_path):
    r, c = np.mgrid[0:9, 0:9]
    heights = -4000.0 + r + 2.0 * c
    lon = np.linspace(137.0, 137.0001, 9)
    lat = np.linspace(-4.0, -3.9999, 9)
    tileset = build_tileset(heights, lon, lat, tmp_path, 70.0, 1.0, tile_cells=4)
    extras = tileset["extras"]
    assert extras["edge_min_height_m"] == -3930.0
    assert extras["skirt_floor_m"] == -3930.0 - SKIRT_MARGIN_M
    assert extras["level_geometric_error_m"] == [2.0, 0.0]
    assert extras["tiles"] == 5
    assert tileset["geometricError"] == MARS_A
    box = np.array(tileset["root"]["boundingVolume"]["box"])
    up = enu_axes(137.00005, -3.99995)[2]
    # Vertical half-axis spans the skirt floor (-3950 m) to the top corner (-3906 m), within the curvature sag.
    assert abs(box[9:12] @ up) == pytest.approx(22.0, abs=1e-3)
    assert [child["content"]["uri"] for child in tileset["root"]["children"]] == ["1/0_0.glb", "1/1_0.glb", "1/0_1.glb", "1/1_1.glb"]


def test_default_height_offsets():
    assert DEFAULT_HEIGHT_OFFSETS_M["gale"] == pytest.approx(70.91)
    assert DEFAULT_HEIGHT_OFFSETS_M["jezero"] == pytest.approx(-70.92)

