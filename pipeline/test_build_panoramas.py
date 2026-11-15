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


def test_build_writes_contract_stops_chained_by_sol(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    _strip(800, 200).save(raw / "gale_sol3481.jpg")
    _strip(800, 200).save(raw / "gale_sol3167.jpg")
    out_dir = tmp_path / "panos"
    out_json = tmp_path / "panoramas.json"
    monkeypatch.setattr(bp, "ROOT", tmp_path.parent)
    stops = bp.build(bp.load_sources(tmp_path / "none.json", raw), raw, out_dir, out_json, 256, 80)
    data = json.loads(out_json.read_text())
    assert [s["id"] for s in data["stops"]] == [s["id"] for s in stops]
    by_id = {s["id"]: s for s in data["stops"]}
    assert by_id["gale_3167"]["next_id"] == "gale_3481" and by_id["gale_3481"]["prev_id"] == "gale_3167"
    for stop in data["stops"]:
        assert set(stop) == {
            "id", "name", "sol", "lat", "lon_east", "height", "heading", "pitch", "roll", "image_url",
            "walkability", "next_orbiter_pass", "next_id", "prev_id", "pois",
        }
        assert stop["image_url"].startswith("./panos/")
        assert Image.open(out_dir / f"{stop['id']}.jpg").size == (256, 128)


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
