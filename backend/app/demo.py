from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from pyproj import CRS, Transformer

CST = timezone(timedelta(hours=8))
BASE_LON = 121.806
BASE_LAT = 30.907
BASE_DATE = "2026-11-11"

BASE_CRS = CRS.from_proj4(
    f"+proj=aeqd +lat_0={BASE_LAT} +lon_0={BASE_LON} +x_0=0 +y_0=0 "
    "+datum=WGS84 +units=m +no_defs"
)
TO_WGS = Transformer.from_crs(BASE_CRS, "EPSG:4326", always_xy=True)


def _to_lonlat(x: float, y: float) -> tuple[float, float]:
    lon, lat = TO_WGS.transform(x, y)
    return round(lon, 7), round(lat, 7)


def _ring(points: list[tuple[float, float]]) -> list[list[float]]:
    coords = [_to_lonlat(x, y) for x, y in points]
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return [[lon, lat] for lon, lat in coords]


def _at(clock: str) -> datetime:
    return datetime.fromisoformat(f"{BASE_DATE}T{clock}:00+08:00")


def _point(clock: str, x: float, y: float, point_id: str | None = None) -> dict[str, Any]:
    lon, lat = _to_lonlat(x, y)
    payload: dict[str, Any] = {
        "timestamp": _at(clock).isoformat(),
        "lon": lon,
        "lat": lat,
    }
    if point_id:
        payload["id"] = point_id
    return payload


def demo_geojson() -> dict[str, Any]:
    fence_a = [
        (-950, -500),
        (-120, -500),
        (-120, 430),
        (-420, 430),
        (-420, 800),
        (-950, 800),
    ]
    fence_b_outer = [(-300, -800), (900, -800), (900, 700), (-300, 700)]
    fence_b_hole = [(150, -480), (650, -480), (650, -80), (150, -80)]
    fence_c = [
        (-220, 360),
        (540, 360),
        (540, 800),
        (430, 930),
        (-100, 930),
        (-220, 810),
    ]

    features = [
        {
            "type": "Feature",
            "properties": {
                "id": "cold-store",
                "name": "1号冷链仓",
                "code": "WH-01",
                "description": "L 形冷链库区，西侧边界用于验证抖动与缓冲。",
                "color": "#0F766E",
            },
            "geometry": {"type": "Polygon", "coordinates": [_ring(fence_a)]},
        },
        {
            "type": "Feature",
            "properties": {
                "id": "cross-dock",
                "name": "2号分拨中心",
                "code": "DC-02",
                "description": "围栏内含中央装卸天井，作为内部空洞处理。",
                "color": "#B45309",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [_ring(fence_b_outer), _ring(fence_b_hole)],
            },
        },
        {
            "type": "Feature",
            "properties": {
                "id": "charging-yard",
                "name": "3号充电场站",
                "code": "EV-03",
                "description": "与 1、2 号场站存在重叠，按每座围栏独立判定。",
                "color": "#4F46E5",
            },
            "geometry": {"type": "Polygon", "coordinates": [_ring(fence_c)]},
        },
    ]
    return {
        "type": "FeatureCollection",
        "name": "临港物流园场站围栏",
        "features": features,
    }


def _vehicle_one() -> dict[str, Any]:
    points = [
        _point("08:00:00", -1040, -250),
        _point("08:00:20", -990, -250),
        _point("08:00:40", -955, -250),
        _point("08:01:00", -947, -250),
        _point("08:01:20", -944, -250),
        _point("08:01:40", -972, -250),
        _point("08:02:00", -955, -250),
        _point("08:02:20", -949, -250),
        _point("08:02:40", -964, -250),
        _point("08:03:00", -930, -250),
        _point("08:03:20", -900, -250),
        _point("08:04:00", -850, -250),
        _point("08:04:40", -800, -250),
        _point("08:05:00", -780, -250),
        _point("08:06:00", -780, -250),
        _point("08:07:00", -780, -250),
        _point("08:08:00", -780, -250),
        _point("08:09:00", -780, -250),
        _point("08:10:00", -780, -250),
        _point("08:10:00", -780, -250),  # exact duplicate, removed before analysis
        _point("08:11:00", -780, -250),
        _point("08:12:00", -780, -250),
        _point("08:13:00", -780, -250),
        _point("08:14:00", -780, -250),
        _point("08:15:00", -780, -250),
        _point("08:16:00", -780, -250),
        _point("08:17:00", -780, -250),
        _point("08:18:00", -780, -250),
        _point("08:19:00", -780, -250),
        _point("08:20:00", -780, -250),
        _point("08:20:40", -920, -250),
        _point("08:21:00", -952, -250),
        _point("08:21:20", -962, -250),
        _point("08:21:40", -948, -250),
        _point("08:22:00", -965, -250),
        _point("08:22:20", -980, -250),
        _point("08:22:40", -1030, -250),
    ]
    return {
        "vehicle_id": "V-D2718",
        "label": "沪A·D2718 · 冷链配送",
        "scenario": "边界抖动",
        "color": "#BE5A38",
        "description": "驶入时围绕西侧边界反复抖动，验证 10 米缓冲保持、双点进入与时间回记。",
        "points": points,
    }


def _vehicle_two() -> dict[str, Any]:
    clock_points = [
        ("09:00:00", 580, -900),
        ("09:00:20", 580, -850),
        ("09:00:40", 580, -806),
        ("09:01:00", 580, -790),
        ("09:01:20", 580, -775),
        ("09:01:40", 580, -700),
        ("09:02:00", 580, -620),
        ("09:02:20", 580, -560),
        ("09:02:40", 580, -510),
        ("09:03:00", 580, -490),
        ("09:03:20", 580, -470),
        ("09:03:40", 580, -440),
        ("09:04:00", 580, -400),
        ("09:04:20", 580, -320),
        ("09:04:40", 580, -240),
        ("09:05:00", 580, -180),
        ("09:05:20", 580, -120),
        ("09:05:40", 580, -85),
        ("09:06:00", 580, -60),
        ("09:06:20", 580, -40),
        ("09:06:40", 580, -20),
        ("09:07:00", 580, 50),
        ("09:07:20", 580, 150),
        ("09:07:40", 580, 250),
        ("09:08:00", 580, 350),
        ("09:08:20", 580, 450),
        ("09:08:40", 580, 550),
        ("09:09:00", 580, 620),
        ("09:09:40", 580, 620),
        ("09:10:20", 580, 620),
        ("09:11:00", 580, 620),
        ("09:11:40", 580, 620),
        ("09:12:20", 580, 620),
        ("09:13:00", 580, 620),
        ("09:13:40", 580, 620),
        ("09:14:20", 580, 630),
        ("09:15:00", 580, 650),
        ("09:15:20", 580, 706),
        ("09:15:40", 580, 730),
        ("09:16:00", 580, 770),
    ]
    return {
        "vehicle_id": "V-K5306",
        "label": "沪B·K5306 · 分拨转运",
        "scenario": "穿过空洞",
        "color": "#2F6B5E",
        "description": "自南向北穿过 2 号场站中央空洞：空洞按场外处理，洞前洞后形成两段独立驻留。",
        "points": [_point(clock, x, y) for clock, x, y in clock_points],
    }


def _vehicle_three() -> dict[str, Any]:
    points = [
        _point("10:00:00", 150, 1020),
        _point("10:00:20", 150, 970),
        _point("10:00:40", 150, 938),
        _point("10:01:00", 150, 915),
        _point("10:01:20", 150, 900),
        _point("10:01:40", 150, 880),
    ]
    for minute in range(2, 10):
        points.append(_point(f"10:{minute:02d}:00", 150, 880))
    points.extend(
        [
            _point("10:09:40", 150, 880),
            _point("10:10:00", 150, 880),
            _point("10:10:00", 156, 874),  # same time, conflicting position
            _point("10:10:20", 150, 880),
            _point("10:11:00", 150, 880),
            _point("10:12:00", 150, 880),
            _point("10:13:00", 150, 880),
            _point("10:14:00", 150, 880),
            _point("10:15:00", 150, 880),
            _point("10:16:00", 150, 880),
            _point("10:17:00", 150, 880),
            # 9 minute signal outage
            _point("10:26:00", 150, 875),
            _point("10:26:20", 150, 865),
            _point("10:27:00", 150, 865),
            _point("10:28:00", 150, 865),
            _point("10:29:00", 150, 865),
            _point("10:30:00", 150, 865),
            _point("10:31:00", 150, 865),
            _point("10:32:00", 150, 865),
            _point("10:33:00", 150, 865),
            _point("10:34:00", 150, 865),
            _point("10:35:00", 150, 865),
            _point("10:36:00", 150, 865),
            _point("10:37:00", 150, 865),
            _point("10:38:00", 150, 865),
            _point("10:39:00", 150, 865),
            _point("10:40:00", 150, 865),
        ]
    )
    return {
        "vehicle_id": "V-M2043",
        "label": "沪C·M2043 · 园区补能",
        "scenario": "信号中断",
        "color": "#3B6591",
        "description": "充电停留中发生 9 分钟信号中断。断档前的驻留标不完整，断档后的驻留仍在进行中。",
        "points": points,
    }


def _vehicle_four() -> dict[str, Any]:
    points = [
        _point("11:00:00", -1200, -700),
        _point("11:00:20", -800, -700),
        _point("11:00:40", -500, -700),
        _point("11:01:00", -200, -700),
        _point("11:01:20", -200, -680),
        _point("11:01:40", -200, -600),
        _point("11:02:00", -200, -520),
        _point("11:02:20", -200, -460),
        _point("11:02:40", -200, -430),
        _point("11:03:00", -200, -300),
        _point("11:03:20", -200, -100),
        _point("11:03:40", -200, 100),
        _point("11:04:00", -200, 300),
        _point("11:04:20", -200, 350),
        _point("11:04:40", -200, 380),
        _point("11:05:00", -200, 390),
        _point("11:05:20", -190, 390),
    ]
    for minute in range(6, 12):
        points.append(_point(f"11:{minute:02d}:00", -190, 390))
    points.extend(
        [
            _point("11:12:00", -190, 390),
            _point("11:12:20", -150, 390),
            _point("11:12:40", -100, 390),
            _point("11:13:00", -80, 390),
            _point("11:13:20", 0, 390),
            _point("11:13:40", 100, 390),
            _point("11:14:00", 200, 390),
            _point("11:14:20", 300, 390),
            _point("11:14:40", 400, 390),
            _point("11:15:00", 500, 390),
            _point("11:15:20", 530, 390),
            _point("11:15:40", 560, 390),
            _point("11:16:00", 590, 390),
            _point("11:16:20", 700, 400),
            _point("11:16:40", 780, 450),
            _point("11:17:00", 800, 550),
            _point("11:17:20", 800, 650),
            _point("11:17:40", 800, 710),
            _point("11:18:00", 800, 740),
            _point("11:18:20", 800, 780),
            _point("11:18:40", 800, 850),
        ]
    )
    return {
        "vehicle_id": "V-L8037",
        "label": "沪D·L8037 · 干线接驳",
        "scenario": "围栏重叠",
        "color": "#7251A3",
        "description": "在三个场站的重叠区停靠。三座围栏各自独立判定，形成交叠的三段完整驻留。",
        "points": points,
    }


def demo_dataset() -> dict[str, Any]:
    return {
        "name": "临港物流园 · 多场景轨迹",
        "region": "上海 · 临港",
        "date": BASE_DATE,
        "description": "覆盖边界抖动、空洞穿越、信号中断与围栏重叠的四组本地 GPS 轨迹。",
        "geojson": demo_geojson(),
        "tracks": [
            _vehicle_one(),
            _vehicle_two(),
            _vehicle_three(),
            _vehicle_four(),
        ],
    }
