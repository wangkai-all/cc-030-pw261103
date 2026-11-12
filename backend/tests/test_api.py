from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def _rect_geojson() -> dict:
    ring = [
        [121.8000, 30.9000],
        [121.8028, 30.9000],
        [121.8028, 30.9025],
        [121.8000, 30.9025],
        [121.8000, 30.9000],
    ]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "station-a", "name": "测试场站"},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        ],
    }


def test_health_and_demo_endpoints() -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    demo = client.get("/api/demo")
    assert demo.status_code == 200
    payload = demo.json()
    assert set(payload) == {"dataset", "analysis"}

    analysis = payload["analysis"]
    assert len(analysis["geofences"]) == 3
    assert len(analysis["tracks"]) == 4
    assert analysis["projection"]["units"] == "m"
    assert "AEQD" in analysis["projection"]["crs"].upper()

    stats = analysis["statistics"]
    assert stats["total_stays"] == stats["complete_stays"] + stats["incomplete_stays"] + stats["ongoing_stays"]
    assert stats["complete_stays"] >= 1
    assert stats["incomplete_stays"] >= 1
    assert stats["ongoing_stays"] >= 1

    statuses = {stay["status"] for stay in analysis["stays"]}
    assert {"complete", "incomplete", "ongoing"} <= statuses
    # Every stay carries enough evidence for the decision trace UI.
    for stay in analysis["stays"]:
        assert stay["samples"]
        assert stay["events"]
        assert stay["entry_trigger"]["sequence"] is not None
        assert stay["rule_tags"]


def test_analyze_endpoint_returns_dwell_records() -> None:
    analysis = client.post(
        "/api/analyze",
        json={
            "geojson": _rect_geojson(),
            "tracks": [
                {
                    "vehicle_id": "V-API",
                    "label": "沪A·API",
                    "points": [
                        {"id": "p0", "timestamp": "2026-11-12T01:00:00Z", "lon": 121.8002, "lat": 30.9012},
                        {"id": "p1", "timestamp": "2026-11-12T01:00:40Z", "lon": 121.8005, "lat": 30.9012},
                        {"id": "p2", "timestamp": "2026-11-12T01:05:00Z", "lon": 121.8007, "lat": 30.9012},
                        {"id": "p3", "timestamp": "2026-11-12T01:06:00Z", "lon": 121.7990, "lat": 30.9012},
                        {"id": "p4", "timestamp": "2026-11-12T01:06:40Z", "lon": 121.7980, "lat": 30.9012},
                    ],
                }
            ],
        },
    )
    assert analysis.status_code == 200, analysis.text
    payload = analysis.json()
    assert payload["projection"]["units"] == "m"
    assert len(payload["stays"]) == 1
    stay = payload["stays"][0]
    assert stay["status"] == "complete"
    assert stay["entry_point_id"] == "p0"
    assert stay["exit_point_id"] == "p3"
    assert stay["duration_seconds"] == 360
    assert payload["statistics"]["average_complete_seconds"] == 360


def test_normalize_endpoint_returns_projected_geofences() -> None:
    response = client.post("/api/geojson/normalize", json={"geojson": _rect_geojson()})
    assert response.status_code == 200
    payload = response.json()
    assert payload["projection"]["units"] == "m"
    fence = payload["geofences"][0]
    assert fence["id"] == "station-a"
    assert fence["name"] == "测试场站"
    assert fence["area_m2"] > 50_000
    assert fence["geometry"]["type"] == "Polygon"
    assert len(fence["buffer_geometry"]["coordinates"][0]) > 4


def test_invalid_geojson_returns_friendly_422() -> None:
    response = client.post(
        "/api/geojson/normalize",
        json={
            "geojson": {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[121.8, 30.9], [121.9, 30.91]],
                },
            }
        },
    )
    assert response.status_code == 422
    payload = response.json()
    assert payload["kind"] == "geofence"
    assert "Polygon" in payload["detail"]

    empty = client.post(
        "/api/geojson/normalize",
        json={"geojson": {"type": "FeatureCollection", "features": []}},
    )
    assert empty.status_code == 422
    assert empty.json()["kind"] == "geofence"
