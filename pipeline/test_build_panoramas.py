"""Tests for build_panoramas.py. Written with AI assistance (Claude), directed and reviewed by the team."""
from __future__ import annotations

import json

from PIL import Image, ImageStat

import build_panoramas as bp


def _strip(width: int, height: int, colour=(200, 40, 200)) -> Image.Image:
    return Image.new("RGB", (width, height), colour)


def _is_fill(frame: Image.Image, box) -> bool:
    return max(ImageStat.Stat(frame.crop(box)).mean) < 110 and ImageStat.Stat(frame.crop(box)).mean[2] < 60


def test_full_circle_strip_fills_width_and_centres_on_horizon():
    frame = bp.to_equirectangular(_strip(720, 180), 400, 360, 0)
    assert frame.size == (400, 200)
    # 720x180 at 400 wide is 100 px tall, rows 50-150; well inside that is the strip, outside is fill.
    assert frame.getpixel((200, 100)) == (200, 40, 200)
    assert frame.getpixel((5, 100)) == (200, 40, 200)
    assert _is_fill(frame, (0, 0, 400, 30))
    assert _is_fill(frame, (0, 170, 400, 200))


def test_partial_strip_is_centred_with_fill_at_the_sides():
    # 180 degrees across a 2000 px frame is 1000 px wide (columns 500-1500) and 250 px tall.
    frame = bp.to_equirectangular(_strip(1800, 450), 2000, 180, 0)
    assert frame.getpixel((1000, 500)) == (200, 40, 200)
    assert _is_fill(frame, (0, 450, 400, 550))
    assert _is_fill(frame, (1600, 450, 2000, 550))


def test_pitch_moves_the_strip_and_tall_strips_are_cropped():
    # Pitched 30 degrees up, the 100 px strip centres on row 67 (rows 17-117) and clears the bottom.
    up = bp.to_equirectangular(_strip(720, 180), 400, 360, 30)
    assert up.getpixel((200, 67)) == (200, 40, 200)
    assert _is_fill(up, (0, 140, 400, 200))
    tall = bp.to_equirectangular(_strip(400, 400), 400, 360, 0)
    assert tall.size == (400, 200)


def test_white_cutouts_are_replaced_with_sky():
    strip = _strip(2000, 500)
    # A white gap along the top edge of the strip, as Mastcam mosaics have.
    strip.paste((255, 255, 255), (600, 0, 1400, 150))
    frame = bp.to_equirectangular(strip, 2000, 360, 0)
    # The strip spans rows 250-750; the gap's centre (row ~290) is now sky, not white.
    r, g, b = frame.getpixel((1000, 290))
    assert max(r, g, b) < 200 and (r, g, b) != (200, 40, 200)
    assert frame.getpixel((1000, 600)) == (200, 40, 200)


def test_sky_fades_from_space_to_ochre():
    sky = bp.sky_gradient(4, 100)
    assert sky.getpixel((0, 0)) == bp.SKY_TOP
    assert sky.getpixel((0, 99)) == bp.SKY_HORIZON


def test_black_cutouts_are_replaced_with_fill():
    strip = _strip(2000, 500)
    strip.paste((0, 0, 0), (600, 400, 1400, 500))
    frame = bp.to_equirectangular(strip, 2000, 360, 0)
    # The gap sits in the ground band (rows ~650-750); it now shows the regolith gradient, not black.
    assert max(frame.getpixel((1000, 720))) > 15


def test_pose_lookup_uses_where_the_rover_stood_on_that_sol():
    poses = [{"sol": "10", "lat": "0", "lon": "0"}, {"sol": "10", "lat": "0", "lon": "0.001"}, {"sol": "14", "lat": "0", "lon": "0.002"}]
    assert bp.pose_index_for_sol(poses, 10) == 1  # last pose of the sol
    assert bp.pose_index_for_sol(poses, 13) == 1  # still parked where sol 10's drive ended
    assert bp.pose_index_for_sol(poses, 14) == 2
    assert bp.pose_index_for_sol(poses, 3) == 0  # nothing earlier: first pose after


def test_drive_distance_sums_every_pose_segment():
    # Out 0.001 deg east and back: the drive is twice the one-way distance; the endpoints coincide.
    poses = [{"lat": "0", "lon": "0"}, {"lat": "0", "lon": "0.001"}, {"lat": "0", "lon": "0"}]
    one_way = bp.segment_m(0, 0, 0, 0.001)
    assert abs(one_way - 59.27) < 0.05  # 0.001 deg of equator on Mars
    assert abs(bp.drive_distance_m(poses, 0, 2) - 2 * one_way) < 1e-9


def test_grid_bundle_samples_the_published_sample_grid():
    grid = bp.GridBundle.find("gale")
    assert grid is not None
    site = json.loads((grid.folder / "site.json").read_text())
    west, south, east, north = site["bounds_lonlat"]
    inside = grid.sample((south + north) / 2, (west + east) / 2)
    assert inside["walkability"] in {"safe", "caution", "hazard"}
    assert inside["slope_deg"] is None or 0 <= inside["slope_deg"] < 90
    assert grid.sample(north + 0.05, east + 0.05) is None


def test_caption_skips_navigation_and_notes():
    page = (
        "<p>Explore Search News &amp; Events " + "x" * 200 + "</p>"
        "<p>Photojournal Note: Also available is a high resolution TIF file of this mosaic, very large indeed.</p>"
        "<p>Description NASA&#039;s Curiosity Mars rover captured this 360-degree panorama near a location nicknamed X, seen through a dusty haze.</p>"
    )
    assert bp.caption_from_page(page).startswith("NASA's Curiosity Mars rover captured")


def test_relay_passes_keep_only_mro_and_odyssey(tmp_path, monkeypatch=None):
    url = bp.copy_relay_passes("gale", tmp_path)
    assert url == f"./{tmp_path.name}/gale.json"
    bundle = json.loads((tmp_path / "gale.json").read_text())
    assert bundle["passes"] and {p["orbiter"] for p in bundle["passes"]} <= {"MRO", "ODY"}
    assert bp.copy_relay_passes("nowhere", tmp_path) is None
