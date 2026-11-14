"""Exact-value unit tests for globe history pipeline helpers.

Tests cover:
1. Mars date conversion against published anchors (Clancy et al. 2000, Piqueux et al. 2015)
2. Byte quantisation round-trip for uint8 frames (exact byte preservation & bounded precision)
3. Sol-to-frame indexing, byte offsets, and coordinate-to-grid mapping
4. Gale weather data parsing and contract validation without gap-filling

Written with AI assistance (Gemini), directed and reviewed by the team.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from globe_history import (
    DAYS_PER_MY,
    DAYS_PER_SOL,
    DUST_GRID,
    DUST_NODATA,
    DUST_OFFSET,
    DUST_SCALE,
    dequantize_cdod,
    frame_byte_offset,
    lonlat_to_grid_indices,
    mars_year_sol_to_earth_date,
    parse_gale_weather,
    quantize_cdod,
    sol_to_frame_index,
)


# ==============================================================================
# 1. Mars date conversion tests against published anchors
# ==============================================================================

class TestMarsDateConversion:
    """Exact-value tests against published Martian calendar anchors."""

    def test_my1_start(self):
        """Mars Year 1 begins on 1955-04-11 at sol 1 (Clancy et al. 2000)."""
        assert mars_year_sol_to_earth_date(1, 1) == "1955-04-11"

    def test_my34_start_anchor(self):
        """Mars Year 34 began 2017-05-05 (published anchor)."""
        assert mars_year_sol_to_earth_date(34, 1) == "2017-05-05"

    def test_my34_global_dust_storm_dates(self):
        """The 2018 global dust storm was MY 34, roughly Ls 185-250, June to September 2018."""
        # Sol 381 is near Ls 185 (storm onset: late May / early June 2018)
        onset_date = mars_year_sol_to_earth_date(34, 381)
        assert onset_date == "2018-05-30"

        # Sol 425 is near Ls 212 (storm peak: mid-July 2018)
        peak_date = mars_year_sol_to_earth_date(34, 425)
        assert peak_date == "2018-07-14"

        # Sol 484 is near Ls 250 (storm dissipation: mid-September 2018)
        end_date = mars_year_sol_to_earth_date(34, 484)
        assert end_date == "2018-09-13"

    @pytest.mark.parametrize(
        ("my", "expected_start_date"),
        [
            (24, "1998-07-14"),
            (25, "2000-05-31"),
            (26, "2002-04-18"),
            (27, "2004-03-05"),
            (28, "2006-01-21"),
            (29, "2007-12-09"),
            (30, "2009-10-26"),
            (31, "2011-09-13"),
            (32, "2013-07-31"),
            (33, "2015-06-18"),
            (34, "2017-05-05"),
            (35, "2019-03-22"),
            (36, "2021-02-06"),
        ],
    )
    def test_published_mars_years_starts(self, my: int, expected_start_date: str):
        """Verify all dataset Mars Years (MY 24-36) match Table 1 of Piqueux et al. (2015)."""
        assert mars_year_sol_to_earth_date(my, 1) == expected_start_date

    def test_fractional_sol(self):
        """Fractional sols advance into the day."""
        date_start = mars_year_sol_to_earth_date(34, 1.0)
        date_mid = mars_year_sol_to_earth_date(34, 1.5)
        assert date_start == "2017-05-05"
        assert date_mid == "2017-05-05"

    def test_invalid_my_or_sol(self):
        with pytest.raises(ValueError, match="Mars Year must be >= 1"):
            mars_year_sol_to_earth_date(0, 1)
        with pytest.raises(ValueError, match="Sol must be >= 1"):
            mars_year_sol_to_earth_date(1, 0)


# ==============================================================================
# 2. Byte quantisation round-trip tests
# ==============================================================================

class TestByteQuantisation:
    """Exact round-trip tests for uint8 dust encoding."""

    def test_all_bytes_round_trip(self):
        """Every valid byte 0..254 must round-trip exactly to itself."""
        for b in range(255):  # 0 to 254
            raw = dequantize_cdod(b, scale=DUST_SCALE, offset=DUST_OFFSET)
            b_reconstructed = quantize_cdod(raw, scale=DUST_SCALE, offset=DUST_OFFSET)
            assert b_reconstructed == b, f"Byte {b} failed round trip: got {b_reconstructed}"

    def test_nodata_round_trip(self):
        """Nodata byte (255) decodes to NaN and NaN encodes back to 255."""
        val = dequantize_cdod(DUST_NODATA, scale=DUST_SCALE, offset=DUST_OFFSET)
        assert math.isnan(val)
        assert quantize_cdod(float("nan"), scale=DUST_SCALE, offset=DUST_OFFSET) == DUST_NODATA
        assert quantize_cdod(None, scale=DUST_SCALE, offset=DUST_OFFSET) == DUST_NODATA

    def test_float_quantisation_error_bound(self):
        """Quantisation error for any float within dynamic range must be <= scale / 2."""
        test_values = np.linspace(0.0, 7.5, 751)
        half_step = DUST_SCALE / 2.0
        for x in test_values:
            byte_val = quantize_cdod(x, scale=DUST_SCALE, offset=DUST_OFFSET)
            reconstructed = dequantize_cdod(byte_val, scale=DUST_SCALE, offset=DUST_OFFSET)
            assert abs(reconstructed - x) <= half_step + 1e-6

    def test_clamping_behavior(self):
        """Negative values clamp to 0; values exceeding max clamp to 254."""
        assert quantize_cdod(-1.5, scale=DUST_SCALE, offset=DUST_OFFSET) == 0
        assert quantize_cdod(10.0, scale=DUST_SCALE, offset=DUST_OFFSET) == 254

    def test_vectorized_quantisation(self):
        """Numpy array round-trip matches scalar logic."""
        arr = np.array([[0.0, 0.3, float("nan")], [1.5, 4.2, 7.6]], dtype=np.float32)
        q = quantize_cdod(arr, scale=DUST_SCALE, offset=DUST_OFFSET)
        assert q.dtype == np.uint8
        assert q[0, 0] == 0
        assert q[0, 1] == 10  # 0.3 / 0.03 = 10
        assert q[0, 2] == DUST_NODATA
        assert q[1, 0] == 50  # 1.5 / 0.03 = 50
        assert q[1, 1] == 140 # 4.2 / 0.03 = 140
        assert q[1, 2] == 253 # 7.6 clamped to 254 (or round 7.6/0.03 = 253.33 -> 253)

        dq = dequantize_cdod(q, scale=DUST_SCALE, offset=DUST_OFFSET)
        assert dq.dtype == np.float32
        assert np.isclose(dq[0, 0], 0.0)
        assert np.isclose(dq[0, 1], 0.3)
        assert np.isnan(dq[0, 2])
        assert np.isclose(dq[1, 0], 1.5)
        assert np.isclose(dq[1, 1], 4.2)


# ==============================================================================
# 3. Sol to frame indexing and coordinate mapping
# ==============================================================================

class TestIndexingAndOffsets:
    """Tests for sol indexing, byte offsets, and grid geometry."""

    def test_sol_to_frame_index(self):
        """Sols 1..669 map to 0-based frame indices 0..668."""
        assert sol_to_frame_index(1) == 0
        assert sol_to_frame_index(381) == 380
        assert sol_to_frame_index(669) == 668

    def test_sol_out_of_bounds(self):
        with pytest.raises(IndexError):
            sol_to_frame_index(0)
        with pytest.raises(IndexError):
            sol_to_frame_index(670)

    def test_frame_byte_offset(self):
        """Frame byte offsets for 120x60 uint8 grid (7200 bytes per frame)."""
        assert frame_byte_offset(0) == 0
        assert frame_byte_offset(1) == 7200
        assert frame_byte_offset(10) == 72000
        assert frame_byte_offset(668) == 4809600

    def test_lonlat_to_grid_indices(self):
        """Coordinates map accurately into 120 lon x 60 lat cells."""
        # Top-left corner (lon -180, lat 90)
        r0, c0 = lonlat_to_grid_indices(-180.0, 90.0)
        assert (r0, c0) == (0, 0)

        # Center equator & prime meridian (lon 0, lat 0)
        r_mid, c_mid = lonlat_to_grid_indices(0.0, 0.0)
        assert (r_mid, c_mid) == (30, 60)

        # Bottom-right corner (lon 177, lat -88.5)
        r_end, c_end = lonlat_to_grid_indices(177.0, -88.5)
        assert (r_end, c_end) == (59, 119)

        # Gale crater location (lat -4.59°N, lon 137.44°E)
        r_gale, c_gale = lonlat_to_grid_indices(137.4417, -4.5895)
        # Lat: (90 - (-4.5895)) / 3 = 94.5895 / 3 = 31.53 -> row 31
        # Lon: (137.4417 - (-180)) / 3 = 317.4417 / 3 = 105.81 -> col 105
        assert (r_gale, c_gale) == (31, 105)

    def test_coordinate_clamping(self):
        """Out of range coordinates clamp safely to border cells."""
        assert lonlat_to_grid_indices(-200.0, 100.0) == (0, 0)
        assert lonlat_to_grid_indices(200.0, -100.0) == (59, 119)


# ==============================================================================
# 4. Gale weather parsing tests
# ==============================================================================

class TestGaleWeatherParsing:
    """Tests for parsing, sorting, and contract integrity of Gale REMS weather data."""

    def test_sorting_and_contract_fields(self):
        raw_sample = [
            {
                "sol": "10",
                "terrestrial_date": "2012-08-16",
                "ls": "155",
                "min_temp": "-75",
                "max_temp": "-16",
                "pressure": "739",
                "atmo_opacity": "Sunny",
                "min_gts_temp": "-83",
                "max_gts_temp": "8",
            },
            {
                "sol": "1",
                "terrestrial_date": "2012-08-07",
                "ls": "150",
                "min_temp": "--",
                "max_temp": "--",
                "pressure": "--",
                "atmo_opacity": "Sunny",
                "min_gts_temp": "--",
                "max_gts_temp": "--",
            },
            {
                "sol": "9",
                "terrestrial_date": "2012-08-15",
                "ls": "155",
                "min_temp": "--",
                "max_temp": "--",
                "pressure": "--",
                "atmo_opacity": "Sunny",
                "min_gts_temp": "--",
                "max_gts_temp": "--",
            },
        ]

        parsed = parse_gale_weather(raw_sample)

        # Must be sorted ascending by sol: 1, 9, 10
        assert [d["sol"] for d in parsed] == [1, 9, 10]

        # Sol 1 has None for missing temperatures and pressure
        sol1 = parsed[0]
        assert sol1["sol"] == 1
        assert sol1["earth_date"] == "2012-08-07"
        assert sol1["ls"] == 150
        assert sol1["t_min_c"] is None
        assert sol1["t_max_c"] is None
        assert sol1["pressure_pa"] is None
        assert sol1["atmo_opacity"] == "Sunny"
        # Optional field min_gts_temp was '--', so it must NOT be in sol1
        assert "t_gts_min_c" not in sol1
        assert "t_gts_max_c" not in sol1

        # Sol 10 has valid values for all fields
        sol10 = parsed[2]
        assert sol10["sol"] == 10
        assert sol10["earth_date"] == "2012-08-16"
        assert sol10["ls"] == 155
        assert sol10["t_min_c"] == -75
        assert sol10["t_max_c"] == -16
        assert sol10["pressure_pa"] == 739
        assert sol10["t_gts_min_c"] == -83
        assert sol10["t_gts_max_c"] == 8
        assert sol10["atmo_opacity"] == "Sunny"

    def test_no_gap_filling(self):
        """Input with missing sols (e.g. sols 2..8) must retain exactly the source sols."""
        raw_sample = [
            {"sol": "1", "terrestrial_date": "2012-08-07", "ls": "150", "min_temp": "--", "max_temp": "--", "pressure": "--"},
            {"sol": "9", "terrestrial_date": "2012-08-15", "ls": "155", "min_temp": "--", "max_temp": "--", "pressure": "--"},
        ]
        parsed = parse_gale_weather(raw_sample)
        assert len(parsed) == 2
        assert [d["sol"] for d in parsed] == [1, 9]
