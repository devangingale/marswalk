"""Tests for build_panoramas.py. Written with AI assistance (Claude), directed and reviewed by the team."""
from __future__ import annotations

import json

from PIL import Image, ImageStat

import build_panoramas as bp


STRIP = (200, 120, 80)


def _strip(width: int, height: int, colour=STRIP) -> Image.Image:
    return Image.new("RGB", (width, height), colour)


def _mean(frame: Image.Image, box) -> tuple[float, ...]:
    return tuple(ImageStat.Stat(frame.crop(box)).mean)


def _close(a, b, tol=30) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))



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


def test_walkability_carries_forward_only_for_an_unmoved_stop(tmp_path):
    published = {"stops": [
        {"id": "a", "lat": -4.75, "lon_east": 137.4, "walkability": "caution", "slope_deg": 12.5, "walkability_source": "grids.py cost grid"},
        {"id": "b", "lat": -4.75, "lon_east": 137.4, "walkability": None, "slope_deg": None, "walkability_source": None},
    ]}
    path = tmp_path / "panoramas.json"
    path.write_text(json.dumps(published))
    previous = bp.load_previous(str(path))
    assert bp.carried_walkability(previous, "a", -4.75, 137.4) == {
        "walkability": "caution", "slope_deg": 12.5, "walkability_source": "grids.py cost grid",
    }
    assert bp.carried_walkability(previous, "a", -4.76, 137.4) is None  # stop moved: recompute, never reuse
    assert bp.carried_walkability(previous, "b", -4.75, 137.4) is None  # nothing published
    assert bp.load_previous(str(tmp_path / "missing.json")) == {}


def test_sols_come_from_the_first_sentence_that_names_them():
    assert bp.parse_sols("Taken on May 22, 2022, the 3,481st Martian day, or sol, of the mission.") == (3481, None)
    assert bp.parse_sols("It took Spirit three days, sols 620 to 622 (Oct. 2005). Later, on sol 700, ...") == (620, 622)
    assert bp.parse_sols("The images were taken between April 15 and 26, 2021, or the 53rd and 64th Martian days, or sols.") == (53, 64)
    assert bp.parse_sols("Began during the 814th Martian day, or sol, and completed on Sol 980 (Oct. 2006).") == (814, 980)
    assert bp.parse_sols("A view of Mount Sharp.") is None


def test_orientation_only_when_the_caption_states_it():
    assert bp.caption_orientation("North is at the center of the image. South is at both ends.") == 0.0
    assert bp.caption_orientation("North is at both ends and south is in the center.") == 180.0
    assert bp.caption_orientation("A sweeping view of the crater rim.") is None


def test_rover_and_variant_ranking():
    assert bp.rover_of("NASA's Curiosity Mars rover used its Mastcam") == "Curiosity"
    assert bp.rover_of("Mars Exploration Rover Spirit") == "Spirit"
    # Opportunity ended its mission in Perseverance Valley: that is a place, not the rover.
    assert bp.rover_of("Opportunity's last panorama, from Perseverance Valley. Opportunity ...", "Opportunity Legacy Pan") == "Opportunity"
    assert bp.rover_of("Unlike Perseverance, ...", "Curiosity's Navcams View the Area Around 'Sequoia'") == "Curiosity"
    assert bp.variant_penalty("Greeley Panorama (False Color)") > bp.variant_penalty("Greeley Panorama")
    assert bp.variant_penalty("How Mastcam-Z's 360-Degree Panorama Was Taken") >= 100


def test_dedupe_keeps_one_natural_colour_panorama_per_rover_sol():
    notes: list[str] = []
    entries = [
        {"pia_id": "PIA1", "rover": "Curiosity", "sol": 10, "sol_end": None, "penalty": 30, "source_size": (9000, 3000)},
        {"pia_id": "PIA2", "rover": "Curiosity", "sol": 10, "sol_end": None, "penalty": 0, "source_size": (8000, 3000)},
        {"pia_id": "PIA3", "rover": "Perseverance", "sol": 10, "sol_end": None, "penalty": 0, "source_size": (8000, 3000)},
    ]
    kept = {e["pia_id"] for e in bp.dedupe(entries, notes)}
    assert kept == {"PIA2", "PIA3"}
    assert any("PIA1" in n for n in notes)


def test_spirit_traverse_projection_matches_the_published_landing_site():
    import mer_poses
    lon, lat = mer_poses.to_lonlat(-1432.26, -863385.06)  # MERA_traverse.csv, sol 1
    assert abs(lat - -14.5692) < 0.005 and abs(lon - 175.4729) < 0.005


def test_capture_dates_come_from_a_sentence_about_imaging():
    from datetime import date
    assert bp.parse_capture_dates("The mosaic was generated using 993 images taken from Nov. 3-6, 2023.") == (date(2023, 11, 3), date(2023, 11, 6))
    assert bp.parse_capture_dates("The images were taken between April 15 and 26, 2021, or the 53rd and 64th sols.") == (date(2021, 4, 15), date(2021, 4, 26))
    assert bp.parse_capture_dates("Pancam took the images between Dec. 21, 2011, and May 8, 2012.") == (date(2011, 12, 21), date(2012, 5, 8))
    # A release or event date in a sentence that is not about taking the images is ignored.
    assert bp.parse_capture_dates("The rover landed on Feb. 18, 2021. It drove on.") is None


def test_mars2020_sol_clock_matches_captions_that_state_both():
    from datetime import date
    # (capture date, caption sol): every caption sol falls inside the +-1 window of its date.
    for day, sol in [((2021, 2, 21), 3), ((2021, 4, 15), 53), ((2021, 4, 26), 64), ((2024, 5, 20), 1155),
                     ((2024, 6, 12), 1178), ((2024, 11, 23), 1337), ((2025, 5, 26), 1516)]:
        lo, hi = bp.mars2020_sols(date(*day), date(*day))
        assert lo <= sol <= hi, (day, sol, lo, hi)
        assert hi - lo <= 3


def test_full_circle_strip_keeps_the_photo_and_continues_it_beyond_its_edges():
    frame = bp.to_equirectangular(_strip(2000, 500), 2000, 360, 0)
    assert frame.size == (2000, 1000)
    # The strip spans rows 250-750; inside it the photo is untouched.
    assert frame.getpixel((1000, 500)) == STRIP
    # Just above the strip the sky carries on in the photo's colour, not a fixed gradient...
    assert _close(_mean(frame, (0, 200, 2000, 230)), STRIP, 40)
    # ...and darkens only gently toward the zenith (it stays sky-coloured), more toward the nadir.
    near, zenith = sum(_mean(frame, (0, 200, 2000, 230))), sum(_mean(frame, (0, 0, 2000, 10)))
    assert 0.7 * near < zenith < near
    assert sum(_mean(frame, (0, 990, 2000, 1000))) < sum(_mean(frame, (0, 770, 2000, 800)))


def test_sky_gaps_fill_from_sky_not_from_the_terrain_beside_them():
    # Pale grey sky above the horizon, a rust mountain rising into the sky on the left, rust ground
    # below; a black gap in the sky next to the mountain. The gap must take the sky's colour.
    sky, rust = (225, 215, 205), (150, 80, 45)
    strip = Image.new("RGB", (2000, 500), sky)
    strip.paste(rust, (0, 250, 2000, 500))      # ground below the horizon (row 250 of the strip)
    strip.paste(rust, (0, 60, 700, 250))         # mountain on the left, up into the sky
    strip.paste((0, 0, 0), (700, 0, 1100, 200))  # missing data beside it
    frame = bp.to_equirectangular(strip, 2000, 360, 0)
    gap = frame.getpixel((900, 330))             # inside the gap (frame row = 250 + 80)
    assert _close(gap, sky, 30), gap


def test_partial_strip_is_centred_and_its_sides_are_filled_from_it():
    # 180 degrees across a 2000 px frame is 1000 px wide (columns 500-1500).
    frame = bp.to_equirectangular(_strip(1800, 450), 2000, 180, 0)
    assert frame.getpixel((1000, 500)) == STRIP
    assert _close(_mean(frame, (100, 450, 300, 550)), STRIP, 40)


def test_pitch_moves_the_strip_and_tall_strips_are_cropped():
    # Pitched 30 degrees up, the 500 px strip in a 2000 px frame centres on row 333.
    up = bp.to_equirectangular(_strip(2000, 500), 2000, 360, 30)
    assert up.getpixel((1000, 333)) == STRIP
    tall = bp.to_equirectangular(_strip(400, 400), 400, 360, 0)
    assert tall.size == (400, 200)


def test_missing_data_takes_the_surrounding_colour():
    strip = _strip(2000, 500)
    strip.paste((255, 255, 255), (600, 0, 1400, 150))  # white gap along the top edge (Mastcam-Z)
    strip.paste((0, 0, 0), (200, 380, 500, 500))        # black block at the bottom (Mastcam)
    frame = bp.to_equirectangular(strip, 2000, 360, 0)
    assert _close(frame.getpixel((1000, 300)), STRIP, 40)
    assert _close(frame.getpixel((350, 700)), STRIP, 40)


def test_pull_push_fills_holes_seamlessly_across_the_wrap():
    import numpy as np
    rgb = np.zeros((8, 16, 3), np.float32)
    rgb[:, :] = (100, 50, 25)
    weight = np.ones((8, 16), np.float32)
    weight[:, 0] = weight[:, -1] = 0  # a hole straddling the 360-degree seam
    out = bp.pull_push(rgb * 1.0, weight)
    assert np.allclose(out[:, 0], (100, 50, 25), atol=1) and np.allclose(out[:, -1], (100, 50, 25), atol=1)


def test_horizon_is_found_where_grey_sky_meets_rust_ground():
    # 3600 x 900 strip, 360 degrees across, 90 degrees tall: grey sky in the top 300 rows, rust ground below.
    # The skyline is 150 rows (15 degrees) above the centre row, so the horizon offset is +15 degrees.
    strip = Image.new("RGB", (3600, 900), (170, 165, 160))
    ground = Image.effect_noise((3600, 600), 40).convert("RGB")
    ground = Image.merge("RGB", [b.point(lambda v, o=o: min(255, max(0, v // 3 + o))) for b, o in zip(ground.split(), (120, 60, 30))])
    strip.paste(ground, (0, 300))
    offset, how = bp.estimate_horizon(strip)
    assert abs(offset - 15) < 2, offset
    assert "saturation" in how
    # Levelled: the skyline lands on the frame's equator (row 1000 of a 4000 x 2000 frame).
    frame = bp.to_equirectangular(strip, 4000, 360, -offset)
    sky_px, ground_px = frame.getpixel((2000, 980)), frame.getpixel((2000, 1030))
    assert max(sky_px) - min(sky_px) < 20 and max(ground_px) - min(ground_px) > 40


def test_no_horizon_without_sky():
    assert bp.estimate_horizon(Image.new("RGB", (2000, 500), (0, 0, 0))) is None
