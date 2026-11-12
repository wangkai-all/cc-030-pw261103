"""Behavioural tests for the geofence dwell detector.

All tracks are generated in the analysis projection's metric plane and then
converted back to WGS 84, so distances such as "8 metres outside the fence"
are real metres rather than degrees.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from shapely.geometry import Point, Polygon, shape

from backend.app.geo import (
    classify_point,
    parse_geofences,
    prepare_runtime_fences,
)
from backend.app.models import AnalysisOptions, TrackIn, TrackPointIn
from backend.app.service import analyze_payload

BASE_TIME = datetime(2026, 11, 12, 1, 0, tzinfo=timezone.utc)

# Roughly 270 m x 280 m at the test latitude.
LON_MIN, LON_MAX = 121.8000, 121.8028
LAT_MIN, LAT_MAX = 30.9000, 30.9025


def _feature(
    feature_id: str,
    name: str,
    geometry: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "Feature",
        "properties": {"id": feature_id, "name": name},
        "geometry": geometry,
    }


def _rect_ring(
    lon_min: float = LON_MIN,
    lat_min: float = LAT_MIN,
    lon_max: float = LON_MAX,
    lat_max: float = LAT_MAX,
) -> list[list[float]]:
    return [
        [lon_min, lat_min],
        [lon_max, lat_min],
        [lon_max, lat_max],
        [lon_min, lat_max],
        [lon_min, lat_min],
    ]


def _rect_geojson(feature_id: str = "station-a", name: str = "测试场站") -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            _feature(feature_id, name, {"type": "Polygon", "coordinates": [_rect_ring()]})
        ],
    }


HOLE_OUTER = _rect_ring()
HOLE_INNER = [
    [121.8009, 30.9008],
    [121.8009, 30.9020],
    [121.8019, 30.9020],
    [121.8019, 30.9008],
    [121.8009, 30.9008],
]


def _hole_geojson() -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            _feature(
                "station-with-hole",
                "带空洞场站",
                {
                    "type": "Polygon",
                    "coordinates": [HOLE_OUTER, HOLE_INNER],
                },
            )
        ],
    }


def _context(geojson: dict[str, Any]):
    fences, projection = parse_geofences(geojson, buffer_m=10.0)
    return fences, projection


def _projected_polygon(geojson: dict[str, Any], projection, index: int = 0):
    geometry = shape(geojson["features"][index]["geometry"])
    return projection.project_geometry(geometry)


def _lonlat(projection, x: float, y: float) -> tuple[float, float]:
    return projection.to_wgs84(x, y)


def _track(
    projection,
    points: Iterable[tuple[str, int, float, float]],
    vehicle_id: str = "V-TEST",
    label: str = "沪A·TEST",
) -> TrackIn:
    return TrackIn(
        vehicle_id=vehicle_id,
        label=label,
        scenario="测试轨迹",
        points=[
            TrackPointIn(
                id=point_id,
                timestamp=BASE_TIME + timedelta(seconds=offset),
                lon=lon,
                lat=lat,
            )
            for point_id, offset, x, y in points
            for lon, lat in [_lonlat(projection, x, y)]
        ],
    )


def _analyze(
    geojson: dict[str, Any],
    tracks: list[TrackIn],
    options: AnalysisOptions | None = None,
) -> dict[str, Any]:
    return analyze_payload(geojson, tracks, options or AnalysisOptions())


def _stay_for(analysis: dict[str, Any], fence_id: str) -> dict[str, Any]:
    matches = [stay for stay in analysis["stays"] if stay["geofence_id"] == fence_id]
    assert len(matches) == 1, f"expected exactly one stay on {fence_id}, got {len(matches)}"
    return matches[0]


def _samples_by_id(stay: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {sample["id"]: sample for sample in stay["samples"]}


def test_projection_is_metric_and_boundary_counts_as_inside() -> None:
    geojson = _rect_geojson()
    fences, projection = _context(geojson)
    runtime = prepare_runtime_fences(geojson, projection, 10.0)[0]
    outer = runtime["_projected_geom"]

    width = outer.bounds[2] - outer.bounds[0]
    height = outer.bounds[3] - outer.bounds[1]
    # A 0.0028 degree longitude span at this latitude is roughly 270 m. This
    # would be ~0.0028 if raw degrees were (incorrectly) used as metres.
    assert 240.0 < width < 300.0
    assert 250.0 < height < 310.0
    assert fences[0]["area_m2"] > 50_000

    minx, miny, maxx, maxy = outer.bounds
    center_y = (miny + maxy) / 2.0
    # Use an exact vertex of the projected ring: `covers` must include the
    # boundary itself, even though the west edge bends slightly under AEQD.
    inside = Point(outer.exterior.coords[0])
    assert outer.covers(inside)
    assert (
        classify_point(outer, runtime["_buffer_geom"], runtime["_holes"], inside)
        == "inside"
    )
    # 8 m outside the boundary is still inside the 10 m hysteresis buffer.
    assert (
        classify_point(
            outer,
            runtime["_buffer_geom"],
            runtime["_holes"],
            Point(minx - 8.0, center_y),
        )
        == "buffer"
    )
    # 12 m outside is unambiguously outside.
    assert (
        classify_point(
            outer,
            runtime["_buffer_geom"],
            runtime["_holes"],
            Point(minx - 12.0, center_y),
        )
        == "outside"
    )


def test_entry_is_backdated_to_first_inside_point_and_exit_to_first_outside() -> None:
    geojson = _rect_geojson()
    _, projection = _context(geojson)
    minx, miny, maxx, maxy = _projected_polygon(geojson, projection).bounds
    cy = (miny + maxy) / 2.0

    track = _track(
        projection,
        [
            ("outside-before", 0, minx - 30.0, cy),
            ("entry-1", 40, minx + 5.0, cy),
            ("entry-2", 80, minx + 20.0, cy),
            ("still-inside", 200, minx + 40.0, cy),
            ("exit-1", 300, minx - 20.0, cy),
            ("exit-2", 340, minx - 40.0, cy),
        ],
    )
    analysis = _analyze(geojson, [track])
    stay = _stay_for(analysis, "station-a")

    assert stay["status"] == "complete"
    assert stay["entry_point_id"] == "entry-1"
    assert stay["exit_point_id"] == "exit-1"
    assert stay["entry_pair_ids"] == ["entry-1", "entry-2"]
    assert stay["exit_pair_ids"] == ["exit-1", "exit-2"]
    assert stay["entry_gap_seconds"] == 40
    assert stay["exit_gap_seconds"] == 40
    assert stay["duration_seconds"] == 260  # 09:00:40 -> 09:05:00
    assert stay["enter_time"] == "2026-11-12T01:00:40Z"
    assert stay["exit_time"] == "2026-11-12T01:05:00Z"
    assert stay["events"][0]["type"] == "entry_confirm"
    assert stay["events"][-1]["type"] == "exit_confirm"


def test_buffer_holds_inside_but_two_clear_outside_points_exit() -> None:
    geojson = _rect_geojson()
    _, projection = _context(geojson)
    minx, miny, maxx, maxy = _projected_polygon(geojson, projection).bounds
    cy = (miny + maxy) / 2.0

    track = _track(
        projection,
        [
            ("p0", 0, minx + 20.0, cy),
            ("p1", 40, minx + 10.0, cy),
            ("p2-buffer", 80, minx - 8.0, cy),  # 8 m outside: keep state
            ("p3", 120, minx + 10.0, cy),
            ("p4-single", 160, minx - 15.0, cy),  # single outside point
            ("p5", 200, minx + 10.0, cy),
            ("p6-exit", 240, minx - 15.0, cy),
            ("p7-exit", 280, minx - 25.0, cy),
        ],
    )
    analysis = _analyze(geojson, [track])
    stay = _stay_for(analysis, "station-a")

    assert stay["status"] == "complete"
    assert stay["entry_point_id"] == "p0"
    assert stay["exit_point_id"] == "p6-exit"
    assert stay["exit_pair_ids"] == ["p6-exit", "p7-exit"]

    samples = _samples_by_id(stay)
    assert samples["p2-buffer"]["classification"] == "buffer"
    assert samples["p2-buffer"]["action"] == "buffer_hold"
    assert samples["p4-single"]["classification"] == "outside"
    assert samples["p4-single"]["action"] == "outside_wait"

    event_types = [event["type"] for event in stay["events"]]
    assert "buffer_hold" in event_types
    assert "outside_candidate" in event_types
    assert "10 米缓冲保持" in stay["rule_tags"]
    # The single outside point did not close the stay.
    assert len(analysis["stays"]) == 1


def test_hole_is_outside_and_has_no_buffer_hysteresis() -> None:
    geojson = _hole_geojson()
    fences, projection = _context(geojson)
    runtime = prepare_runtime_fences(geojson, projection, 10.0)[0]
    outer = runtime["_projected_geom"]
    hole = Polygon(outer.interiors[0])
    minx, miny, maxx, maxy = outer.bounds
    hx, hy = hole.representative_point().x, hole.representative_point().y
    cy = (miny + maxy) / 2.0

    # A point 5 m inside the hole edge would be "buffer" if the hole did not
    # cancel hysteresis. It must be classified as "hole" (i.e. outside).
    hole_edge_point = Point(hole.bounds[0] + 5.0, (hole.bounds[1] + hole.bounds[3]) / 2.0)
    assert hole.covers(hole_edge_point)
    assert (
        classify_point(outer, runtime["_buffer_geom"], runtime["_holes"], hole_edge_point)
        == "hole"
    )
    # Even an exact interior-ring vertex belongs to the void, not the station.
    hole_vertex = Point(hole.exterior.coords[0])
    assert outer.covers(hole_vertex)
    assert (
        classify_point(outer, runtime["_buffer_geom"], runtime["_holes"], hole_vertex)
        == "hole"
    )

    track = _track(
        projection,
        [
            ("p0", 0, minx + 20.0, cy),
            ("p1", 40, minx + 40.0, cy),
            ("hole-1", 80, hx, hy),
            ("hole-2", 120, hx, hy + 15.0),
            ("outside", 160, minx - 30.0, cy),
        ],
    )
    analysis = _analyze(geojson, [track])
    stay = _stay_for(analysis, "station-with-hole")

    assert stay["status"] == "complete"
    assert stay["entry_point_id"] == "p0"
    assert stay["exit_point_id"] == "hole-1"
    assert stay["exit_pair_ids"] == ["hole-1", "hole-2"]

    samples = _samples_by_id(stay)
    assert samples["hole-1"]["classification"] == "hole"
    assert samples["hole-2"]["classification"] == "hole"
    assert any(event["type"] == "hole_outside" for event in stay["events"])
    assert "空洞按场外" in stay["rule_tags"]
    assert fences[0]["id"] == "station-with-hole"


def test_gap_breaks_stay_without_bridging_and_creates_ongoing_record() -> None:
    geojson = _rect_geojson()
    _, projection = _context(geojson)
    minx, miny, maxx, maxy = _projected_polygon(geojson, projection).bounds
    cy = (miny + maxy) / 2.0
    x = minx + 40.0

    track = _track(
        projection,
        [
            ("before-gap-1", 0, x, cy),
            ("before-gap-2", 40, x, cy),
            ("before-gap-3", 280, x, cy),
            # 540 s gap >= 300 s: the previous stay is closed as incomplete.
            ("after-gap-1", 820, x, cy),
            ("after-gap-2", 860, x, cy),
        ],
    )
    analysis = _analyze(geojson, [track])

    assert len(analysis["stays"]) == 2
    incomplete = next(stay for stay in analysis["stays"] if stay["status"] == "incomplete")
    ongoing = next(stay for stay in analysis["stays"] if stay["status"] == "ongoing")

    assert incomplete["entry_point_id"] == "before-gap-1"
    assert incomplete["last_seen_point"]["id"] == "before-gap-3"
    assert incomplete["exit_trigger"] is None
    assert incomplete["break_gap"] == {
        "after_point_id": "before-gap-3",
        "before_point_id": "after-gap-1",
        "gap_seconds": 540,
    }
    assert incomplete["duration_seconds"] == 280
    assert any(event["type"] == "gap_break" for event in incomplete["events"])

    assert ongoing["entry_point_id"] == "after-gap-1"
    assert ongoing["entry_pair_ids"] == ["after-gap-1", "after-gap-2"]
    assert ongoing["exit_trigger"] is None
    assert ongoing["duration_seconds"] == 40

    stats = analysis["statistics"]
    assert stats["complete_stays"] == 0
    assert stats["incomplete_stays"] == 1
    assert stats["ongoing_stays"] == 1
    assert stats["average_complete_seconds"] == 0

    gap_marker = analysis["tracks"][0]["gaps"][0]
    assert gap_marker["gap_seconds"] == 540
    assert gap_marker["breaks_stay"] is True
    assert incomplete["id"] in gap_marker["affected_stay_ids"]


def test_confirmation_pairs_must_be_within_sixty_seconds() -> None:
    geojson = _rect_geojson()
    _, projection = _context(geojson)
    minx, miny, maxx, maxy = _projected_polygon(geojson, projection).bounds
    cy = (miny + maxy) / 2.0

    # Entry candidate points are 90 s apart: no entry may be confirmed.
    entry_track = _track(
        projection,
        [
            ("e0", 0, minx + 30.0, cy),
            ("e1", 90, minx + 30.0, cy),
        ],
        vehicle_id="V-ENTRY-GAP",
    )
    entry_analysis = _analyze(geojson, [entry_track])
    assert entry_analysis["stays"] == []

    # Inside first, then two outside points 90 s apart: no exit confirmation.
    exit_track = _track(
        projection,
        [
            ("x0", 0, minx + 30.0, cy),
            ("x1", 40, minx + 30.0, cy),
            ("x2", 100, minx - 20.0, cy),
            ("x3", 190, minx - 30.0, cy),
        ],
        vehicle_id="V-EXIT-GAP",
    )
    exit_analysis = _analyze(geojson, [exit_track])
    stay = exit_analysis["stays"][0]
    assert stay["status"] == "ongoing"
    assert stay["exit_trigger"] is None
    assert stay["entry_point_id"] == "x0"


def test_overlapping_fences_are_evaluated_independently() -> None:
    fence_a = _rect_ring(121.8000, 30.9000, 121.8020, 30.9020)
    fence_b = _rect_ring(121.8012, 30.9002, 121.8032, 30.9022)
    geojson = {
        "type": "FeatureCollection",
        "features": [
            _feature("fence-a", "A 场站", {"type": "Polygon", "coordinates": [fence_a]}),
            _feature("fence-b", "B 场站", {"type": "Polygon", "coordinates": [fence_b]}),
        ],
    }
    fences, projection = _context(geojson)
    poly_a = _projected_polygon(geojson, projection, 0)
    poly_b = _projected_polygon(geojson, projection, 1)
    overlap = poly_a.intersection(poly_b)
    assert overlap.area > 1_000

    ox, oy = overlap.representative_point().x, overlap.representative_point().y
    a_cy = (poly_a.bounds[1] + poly_a.bounds[3]) / 2.0
    b_cy = (poly_b.bounds[1] + poly_b.bounds[3]) / 2.0

    assert poly_a.covers(Point(ox, oy)) and poly_b.covers(Point(ox, oy))
    assert poly_a.covers(Point(ox + 5.0, oy)) and poly_b.covers(Point(ox + 5.0, oy))

    track = _track(
        projection,
        [
            ("o0", 0, poly_a.bounds[0] - 40.0, a_cy),
            ("o1", 40, ox, oy),
            ("o2", 80, ox + 5.0, oy),
            ("o3", 160, poly_b.bounds[2] + 20.0, b_cy),
            ("o4", 200, poly_b.bounds[2] + 40.0, b_cy),
        ],
    )
    analysis = _analyze(geojson, [track])

    stays = analysis["stays"]
    assert len(stays) == 2
    by_fence = {stay["geofence_id"]: stay for stay in stays}
    assert set(by_fence) == {"fence-a", "fence-b"}

    for fence_id, other_id in (("fence-a", "fence-b"), ("fence-b", "fence-a")):
        stay = by_fence[fence_id]
        assert stay["status"] == "complete"
        assert stay["entry_point_id"] == "o1"
        assert stay["exit_point_id"] == "o3"
        assert stay["duration_seconds"] == 120
        assert other_id in stay["geofence_overlaps"]
        assert by_fence[other_id]["id"] in stay["concurrent_stay_ids"]

    fence_lookup = {fence["id"]: fence for fence in fences}
    assert fence_lookup["fence-a"]["overlaps"] == ["fence-b"]
    assert fence_lookup["fence-b"]["overlaps"] == ["fence-a"]

    stats = analysis["statistics"]
    assert stats["complete_stays"] == 2
    assert stats["average_complete_seconds"] == 120


def test_duplicate_and_conflicting_points_are_removed_before_detection() -> None:
    geojson = _rect_geojson()
    _, projection = _context(geojson)
    minx, miny, maxx, maxy = _projected_polygon(geojson, projection).bounds
    cy = (miny + maxy) / 2.0
    inside_x = minx + 40.0

    track = _track(
        projection,
        [
            ("q0", 0, inside_x, cy),
            ("q0-duplicate", 0, inside_x, cy),
            ("q1", 40, inside_x, cy),
            # Same timestamp, > 0.5 m apart: both points are invalid.
            ("conflict-inside", 80, inside_x, cy),
            ("conflict-outside", 80, minx - 40.0, cy),
            ("q2", 120, inside_x, cy),
            ("q3-out", 160, minx - 20.0, cy),
            ("q4-out", 200, minx - 40.0, cy),
        ],
    )
    analysis = _analyze(geojson, [track])
    stay = _stay_for(analysis, "station-a")
    points = {point["id"]: point for point in analysis["tracks"][0]["points"]}

    assert points["q0"]["valid"] is True
    assert points["q0"]["sequence"] == 1
    assert points["q0-duplicate"]["valid"] is False
    assert points["q0-duplicate"]["issue"] == "duplicate"
    assert points["q0-duplicate"]["sequence"] is None
    for conflict_id in ("conflict-inside", "conflict-outside"):
        assert points[conflict_id]["valid"] is False
        assert points[conflict_id]["issue"] == "timestamp_conflict"
        assert points[conflict_id]["sequence"] is None

    assert stay["status"] == "complete"
    assert stay["entry_point_id"] == "q0"
    assert stay["exit_point_id"] == "q3-out"

    anomalies = analysis["anomalies"]
    assert len(anomalies) == 2
    duplicate = next(item for item in anomalies if item["kind"] == "duplicate")
    conflict = next(item for item in anomalies if item["kind"] == "timestamp_conflict")
    assert duplicate["retained_point_id"] == "q0"
    assert duplicate["point_ids"] == ["q0", "q0-duplicate"]
    assert conflict["point_ids"] == ["conflict-inside", "conflict-outside"]
    assert len(conflict["coordinates"]) == 2

    stats = analysis["statistics"]
    assert stats["total_points"] == 8
    assert stats["valid_points"] == 5
    assert stats["duplicate_points"] == 1
    assert stats["conflict_points"] == 2
    assert stats["anomaly_groups"] == 2


def test_average_duration_excludes_incomplete_and_ongoing_stays() -> None:
    geojson = _rect_geojson()
    _, projection = _context(geojson)
    minx, miny, maxx, maxy = _projected_polygon(geojson, projection).bounds
    cy = (miny + maxy) / 2.0
    x = minx + 40.0

    complete_track = _track(
        projection,
        [
            ("c0", 0, x, cy),
            ("c1", 40, x, cy),
            ("c2", 100, minx - 20.0, cy),
            ("c3", 140, minx - 30.0, cy),
        ],
        vehicle_id="V-COMPLETE",
    )
    ongoing_track = _track(
        projection,
        [
            ("g0", 0, x, cy),
            ("g1", 40, x, cy),
        ],
        vehicle_id="V-ONGOING",
    )
    analysis = _analyze(geojson, [complete_track, ongoing_track])

    assert len(analysis["stays"]) == 2
    stats = analysis["statistics"]
    assert stats["complete_stays"] == 1
    assert stats["ongoing_stays"] == 1
    assert stats["incomplete_stays"] == 0
    # Only the 100 s complete stay contributes to the average.
    assert stats["average_complete_seconds"] == 100


def test_concave_and_multipolygon_fences_are_supported() -> None:
    l_shape = [
        [121.8000, 30.9000],
        [121.8020, 30.9000],
        [121.8020, 30.9010],
        [121.8010, 30.9010],
        [121.8010, 30.9020],
        [121.8000, 30.9020],
        [121.8000, 30.9000],
    ]
    multipolygon = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[121.8030, 30.9000], [121.8040, 30.9000], [121.8040, 30.9010], [121.8030, 30.9010], [121.8030, 30.9000]]],
            [[[121.8050, 30.9000], [121.8060, 30.9000], [121.8060, 30.9010], [121.8050, 30.9010], [121.8050, 30.9000]]],
        ],
    }
    geojson = {
        "type": "FeatureCollection",
        "features": [
            _feature("l-shape", "凹形场站", {"type": "Polygon", "coordinates": [l_shape]}),
            _feature("multi", "双地块场站", multipolygon),
        ],
    }
    fences, projection = _context(geojson)
    runtime = prepare_runtime_fences(geojson, projection, 10.0)

    assert [fence["id"] for fence in fences] == ["l-shape", "multi"]
    assert fences[0]["geometry"]["type"] == "Polygon"
    assert fences[1]["geometry"]["type"] == "MultiPolygon"

    l_runtime = runtime[0]
    notch = projection.project_geometry(shape({
        "type": "Point",
        "coordinates": [121.8015, 30.9015],
    }))
    arm = projection.project_geometry(shape({
        "type": "Point",
        "coordinates": [121.8005, 30.9015],
    }))
    assert not l_runtime["_projected_geom"].covers(notch)
    assert (
        classify_point(
            l_runtime["_projected_geom"],
            l_runtime["_buffer_geom"],
            l_runtime["_holes"],
            notch,
        )
        == "outside"
    )
    assert (
        classify_point(
            l_runtime["_projected_geom"],
            l_runtime["_buffer_geom"],
            l_runtime["_holes"],
            arm,
        )
        == "inside"
    )
