import json
import math

import pytest

from candidate_hirise import (
    CREDIT,
    LICENCE,
    LICENCE_URL,
    SELECTION_RULE,
    SOURCE,
    browse_url,
    build_index,
    choose_observation,
    covered_entry,
    footprint_contains,
    footprint_lonlat,
    has_data_at,
    lon_360,
    ode_products,
    ode_query_url,
    parse_label,
    parse_wkt_rings,
    point_in_ring,
    site_pixel,
    target_sites,
    uncovered_entry,
    wrap_180,
)

SITE = {"id": "candidate-000001", "name": "Candidate 001", "lat": -13.6, "lon": -58.5}
COVER = "POLYGON ((301.6 -13.7, 301.4 -13.7, 301.4 -13.5, 301.6 -13.5, 301.6 -13.7))"
ELSEWHERE = "POLYGON ((302.6 -13.7, 302.4 -13.7, 302.4 -13.5, 302.6 -13.5, 302.6 -13.7))"


def product(pdsid, emission, time, footprint=COVER, scale="0.25"):
    obs = pdsid.rsplit("_", 1)[0]
    return {
        "pdsid": pdsid,
        "Observation_id": obs,
        "Emission_angle": str(emission),
        "Observation_time": time,
        "Footprint_geometry": footprint,
        "Map_scale": scale,
        "LabelURL": f"https://example.test/{pdsid}.LBL",
        "Product_files": {
            "Product_file": [
                {"FileName": f"{pdsid}.ABROWSE.JPG", "URL": "https://example.test/a.abrowse.jpg"},
                {"FileName": f"{pdsid}.BROWSE.JPG", "URL": "https://example.test/b.browse.jpg"},
                {"FileName": f"{pdsid}.NOMAP.BROWSE.JPG", "URL": "https://example.test/c.nomap.jpg"},
            ]
        },
    }


# A stubbed ODE answer: two near-nadir RED products cover the site, one RED is elsewhere,
# and a COLOR product of the newest observation also covers it.
STUB = {
    "ODEResults": {
        "Count": "4",
        "Products": {
            "Product": [
                product("ESP_011111_1660_RED", 4.0, "2012-01-01T10:00:00.000"),
                product("ESP_022222_1660_RED", 8.0, "2015-06-01T10:00:00.000"),
                product("ESP_033333_1660_RED", 2.0, "2020-01-01T10:00:00.000", ELSEWHERE),
                product("ESP_022222_1660_COLOR", 1.0, "2015-06-01T10:00:00.000"),
            ]
        },
    }
}

# Synthetic equirectangular label: 1 deg = 100 km, 1 m pixels, upper-left corner at
# x = -10 m, y = 10 m.
LABEL_TEXT = """OBJECT = IMAGE_MAP_PROJECTION
    /* A_AXIS_RADIUS is set at the CENTER_LATITUDE  */
    MAP_PROJECTION_TYPE          = "EQUIRECTANGULAR"
    A_AXIS_RADIUS                = {r} <KM>
    CENTER_LATITUDE              = 0.000 <DEG>
    CENTER_LONGITUDE             = 0.000 <DEG>
    MAP_SCALE                    = 1.0 <METERS/PIXEL>
    LINE_PROJECTION_OFFSET       = 9.5 <PIXEL>
    SAMPLE_PROJECTION_OFFSET     = 9.5 <PIXEL>
END_OBJECT = IMAGE_MAP_PROJECTION
        LINES                      = 200
        LINE_SAMPLES               = 100
""".format(r=100.0 * 180.0 / math.pi)


def site(sid, kind="new", score=50.0, vetoed=False, detail=False):
    return {"id": sid, "kind": kind, "score": score, "vetoed": vetoed, "detail_available": detail}


def test_target_sites_ranks_like_the_app_then_adds_detail_sites():
    sites = [
        site("a", score=70.0),
        site("b", score=80.0, vetoed=True),
        site("c", score=75.0),
        site("d", score=70.0),
        site("gale", kind="landed", score=90.0, detail=True),
        site("zone", kind="zone2015", score=60.0, detail=False),
        site("e", score=60.0),
    ]
    assert [s["id"] for s in target_sites(sites, n=3)] == ["c", "a", "d", "gale"]


def test_longitude_wrapping():
    assert lon_360(-58.5) == 301.5
    assert lon_360(137.0) == 137.0
    assert wrap_180(301.5) == -58.5
    assert wrap_180(180.0) == -180.0


def test_ode_query_url_uses_east_positive_box():
    assert ode_query_url(-58.5, -13.6) == (
        "https://oderest.rsl.wustl.edu/live2/?query=product&results=fmp&output=JSON&target=mars"
        "&ihid=MRO&iid=HIRISE&pt=RDRV11&westlon=301.4990&eastlon=301.5010"
        "&minlat=-13.6010&maxlat=-13.5990"
    )


def test_ode_products_handles_list_single_and_none():
    assert len(ode_products(STUB)) == 4
    one = {"ODEResults": {"Products": {"Product": product("ESP_1_RED", 1.0, "2010")}}}
    assert [p["pdsid"] for p in ode_products(one)] == ["ESP_1_RED"]
    assert ode_products({"ODEResults": {"Products": "No Products Found"}}) == []


def test_wkt_rings_and_containment():
    assert parse_wkt_rings("POLYGON ((1 2, 3 4, 5 6, 1 2))") == [[(1.0, 2.0), (3.0, 4.0), (5.0, 6.0), (1.0, 2.0)]]
    assert len(parse_wkt_rings("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))")) == 2
    ring = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (0.0, 0.0)]
    assert point_in_ring(1.0, 1.0, ring) is True
    assert point_in_ring(3.0, 1.0, ring) is False
    assert footprint_contains(COVER, 301.5, -13.6) is True
    assert footprint_contains(ELSEWHERE, 301.5, -13.6) is False


def test_footprint_lonlat_wraps_around_the_site():
    assert footprint_lonlat(COVER, -58.5) == [[-58.4, -13.7], [-58.6, -13.7], [-58.6, -13.5], [-58.4, -13.5], [-58.4, -13.7]]
    across = "POLYGON ((180.1 1, 179.9 1, 179.9 2, 180.1 1))"
    assert footprint_lonlat(across, 179.95) == [[180.1, 1.0], [179.9, 1.0], [179.9, 2.0], [180.1, 1.0]]


def test_choose_prefers_newest_near_nadir_red():
    best, reason, observations = choose_observation(ode_products(STUB), SITE["lon"], SITE["lat"])
    assert best["pdsid"] == "ESP_022222_1660_RED"
    assert observations == 2
    assert reason == (
        "Newest of 2 near-nadir RED products (emission <= 10 deg) among 2 observations covering the site"
    )


def test_choose_without_near_nadir_takes_smallest_emission_newest_on_ties():
    products = [
        product("ESP_1_RED", 15.0, "2011-01-01T00:00:00.000"),
        product("ESP_2_RED", 12.0, "2010-01-01T00:00:00.000"),
        product("ESP_3_RED", 12.0, "2013-01-01T00:00:00.000"),
    ]
    best, reason, observations = choose_observation(products, SITE["lon"], SITE["lat"])
    assert best["pdsid"] == "ESP_3_RED"
    assert observations == 3
    assert reason == "Smallest emission angle (12.0 deg) of 3 RED products covering the site; none within 10 deg"


def test_choose_falls_back_to_colour_and_honours_skip():
    products = [product("ESP_1_COLOR", 3.0, "2011-01-01"), product("ESP_2_COLOR", 5.0, "2012-01-01")]
    best, reason, _ = choose_observation(products, SITE["lon"], SITE["lat"], frozenset({"ESP_2_COLOR"}))
    assert best["pdsid"] == "ESP_1_COLOR"
    assert reason == (
        "Newest of 1 near-nadir COLOR products (emission <= 10 deg) among 2 observations covering the site"
        "; skipped 1 with no image data at the site (ESP_2_COLOR)"
    )
    assert choose_observation(products, SITE["lon"], SITE["lat"], frozenset({"ESP_1_COLOR", "ESP_2_COLOR"})) is None
    assert choose_observation([product("ESP_9_RED", 1.0, "2010", ELSEWHERE)], SITE["lon"], SITE["lat"]) is None


def test_browse_url_picks_the_plain_map_projected_browse():
    assert browse_url(product("ESP_1_RED", 1.0, "2010")) == "https://example.test/b.browse.jpg"


def test_parse_label_and_site_pixel():
    label = parse_label(LABEL_TEXT)
    assert label == {
        "projection": "EQUIRECTANGULAR",
        "radius_m": pytest.approx(100_000.0 * 180.0 / math.pi),
        "center_lat": 0.0,
        "center_lon": 0.0,
        "map_scale": 1.0,
        "line_offset": 9.5,
        "sample_offset": 9.5,
        "lines": 200,
        "samples": 100,
    }
    # lon 0.0001 deg = 10 m east -> sample 10 + 9.5 + 0.5; lat -0.0002 deg = 20 m south -> line 9.5 + 0.5 + 20.
    assert site_pixel(label, 0.0001, -0.0002, 50, 100) == [10.0, 15.0]
    assert site_pixel({**label, "projection": "POLAR STEREOGRAPHIC"}, 0.0, 0.0, 50, 100) is None


def test_has_data_at():
    gray = [[0] * 10 for _ in range(10)]
    for y in range(10):
        for x in range(5, 10):
            gray[y][x] = 120
    assert has_data_at(gray, [8.0, 5.0], radius=1) is True
    assert has_data_at(gray, [1.0, 5.0], radius=1) is False
    # Centred on the boundary: 6 of 9 bright pixels.
    assert has_data_at(gray, [5.0, 5.0], radius=1) is True
    assert has_data_at(gray, [4.0, 5.0], radius=1) is False


def test_index_from_stubbed_response():
    best, reason, observations = choose_observation(ode_products(STUB), SITE["lon"], SITE["lat"])
    # Projection centred on the site longitude, 0.25 m pixels; the site falls on browse pixel (500, 1000).
    label = {
        "projection": "EQUIRECTANGULAR",
        "radius_m": 100_000.0 * 180.0 / math.pi,
        "center_lat": 0.0,
        "center_lon": 301.5,
        "map_scale": 0.25,
        "line_offset": -13.6 * 100_000.0 / 0.25 + 2000.0 - 0.5,
        "sample_offset": 999.5,
        "lines": 10000,
        "samples": 4096,
    }
    entry = covered_entry(SITE, best, reason, observations, label, (2048, 5000), 2_000_000)
    index = json.loads(json.dumps(build_index({SITE["id"]: entry, "candidate-000002": uncovered_entry({"name": "Candidate 002"})}, "2026-11-15")))
    assert index == {
        "version": 1,
        "source": SOURCE,
        "credit": CREDIT,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "queried": "2026-11-15",
        "selection_rule": SELECTION_RULE,
        "sites": {
            "candidate-000001": {
                "covered": True,
                "name": "Candidate 001",
                "observation_id": "ESP_022222_1660",
                "product_id": "ESP_022222_1660_RED",
                "acquired": "2015-06-01",
                "resolution_m_px": 0.25,
                "browse_m_px": 0.5,
                "emission_deg": 8.0,
                "footprint": [[-58.4, -13.7], [-58.6, -13.7], [-58.6, -13.5], [-58.4, -13.5], [-58.4, -13.7]],
                "page_url": "https://www.uahirise.org/ESP_022222_1660",
                "image": "hirise/candidate-000001.jpg",
                "image_px": [2048, 5000],
                "image_bytes": 2000000,
                "site_px": [500.0, 1000.0],
                "observations_covering": 2,
                "reason": "Newest of 2 near-nadir RED products (emission <= 10 deg) among 2 observations covering the site",
                "credit": "NASA/JPL/University of Arizona",
            },
            "candidate-000002": {
                "covered": False,
                "name": "Candidate 002",
                "reason": "No HiRISE RDR V1.1 footprint in ODE contains the site point",
            },
        },
    }


def test_uncovered_entry_names_blank_products():
    assert uncovered_entry({"name": "X"}, blank=3) == {
        "covered": False,
        "name": "X",
        "reason": "3 HiRISE products cover the site point but none has image data there",
    }
