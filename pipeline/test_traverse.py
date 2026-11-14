from traverse import build_coordinates, dedupe_consecutive, simplify_xy


def test_dedupe_consecutive_exact_values():
    assert dedupe_consecutive([(1, 2), (1, 2), (2, 2), (2, 2), (1, 2)]) == [
        (1.0, 2.0), (2.0, 2.0), (1.0, 2.0)
    ]


def test_simplify_xy_exact_values_at_two_metre_tolerance():
    assert simplify_xy([(0, 0), (1, 0.5), (2, 0), (3, 3), (4, 0)], 2) == [
        (0.0, 0.0), (3.0, 3.0), (4.0, 0.0)
    ]


def test_build_coordinates_dedupes_and_rounds_six_decimals():
    assert build_coordinates([(10, 20), (10, 20), (10.00001, 20)]) == [
        [10.0, 20.0], [10.00001, 20.0]
    ]
