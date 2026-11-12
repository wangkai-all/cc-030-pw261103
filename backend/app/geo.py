from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable

from pyproj import CRS, Transformer
from shapely import Geometry, make_valid
from shapely.geometry import (
    GeometryCollection,
    MultiPolygon,
    Polygon,
    mapping,
    shape,
)
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union

PALETTE = [
    "#0F766E",
    "#B45309",
    "#4F46E5",
    "#BE123C",
    "#0369A1",
    "#4D7C0F",
    "#7C3AED",
    "#0E7490",
]

COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class GeofenceError(ValueError):
    """Raised when a GeoJSON payload cannot be interpreted as station fences."""


@dataclass
class ProjectionContext:
    transformer: Transformer
    inverse: Transformer
    crs: CRS
    lon_0: float
    lat_0: float

    def to_metric(self, lon: float, lat: float) -> tuple[float, float]:
        return self.transformer.transform(lon, lat)

    def to_wgs84(self, x: float, y: float) -> tuple[float, float]:
        return self.inverse.transform(x, y)

    def project_geometry(self, geom: BaseGeometry) -> BaseGeometry:
        return shapely_transform(lambda x, y, z=None: self.transformer.transform(x, y), geom)

    def metadata(self) -> dict[str, Any]:
        return {
            "name": "本地方位等距投影",
            "crs": self.crs.to_string(),
            "lon_0": round(self.lon_0, 6),
            "lat_0": round(self.lat_0, 6),
            "units": "m",
            "description": "以场站范围中心为原点的 WGS 84 / AEQD 米制投影，距离与 10 米缓冲均在该平面计算。",
        }


def _polygon_parts(geom: BaseGeometry) -> list[Polygon]:
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if isinstance(geom, GeometryCollection):
        parts: list[Polygon] = []
        for child in geom.geoms:
            parts.extend(_polygon_parts(child))
        return parts
    return []


def _as_polygonal(geom: BaseGeometry) -> BaseGeometry:
    parts = _polygon_parts(geom)
    if not parts:
        raise GeofenceError("只支持 Polygon / MultiPolygon 场站，当前几何不含面要素。")
    merged = unary_union(parts)
    if merged.is_empty:
        raise GeofenceError("场站几何为空。")
    if not isinstance(merged, (Polygon, MultiPolygon)):
        raise GeofenceError("场站几何无法归一为多边形。")
    return merged


def holes_union(geom: BaseGeometry) -> BaseGeometry | None:
    polygons = _polygon_parts(geom)
    holes = [Polygon(ring) for poly in polygons for ring in poly.interiors]
    if not holes:
        return None
    return unary_union(holes)


def build_projection(geoms: Iterable[BaseGeometry]) -> ProjectionContext:
    bounds = [geom.bounds for geom in geoms]
    if not bounds:
        raise GeofenceError("至少需要一个场站才能建立米制投影。")
    minx = min(item[0] for item in bounds)
    miny = min(item[1] for item in bounds)
    maxx = max(item[2] for item in bounds)
    maxy = max(item[3] for item in bounds)
    lon_0 = (minx + maxx) / 2.0
    lat_0 = max((miny + maxy) / 2.0, -80.0)
    lat_0 = min(lat_0, 80.0)
    proj4 = (
        f"+proj=aeqd +lat_0={lat_0:.8f} +lon_0={lon_0:.8f} "
        "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    )
    crs = CRS.from_proj4(proj4)
    forward = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    inverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    return ProjectionContext(forward, inverse, crs, lon_0, lat_0)


def feature_collection(geojson: Any) -> dict[str, Any]:
    if not isinstance(geojson, dict):
        raise GeofenceError("GeoJSON 必须是 JSON 对象。")
    kind = geojson.get("type")
    if kind == "FeatureCollection":
        features = geojson.get("features")
        if not isinstance(features, list):
            raise GeofenceError("FeatureCollection.features 必须是数组。")
        return geojson
    if kind == "Feature":
        return {"type": "FeatureCollection", "features": [geojson]}
    if kind in {"Polygon", "MultiPolygon", "GeometryCollection"}:
        return {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {}, "geometry": geojson}],
        }
    raise GeofenceError("请导入 GeoJSON FeatureCollection、Feature 或 Polygon。")


def _clean_name(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()[:80]
    return fallback


def _sanitize_id(value: Any, index: int, used: set[str]) -> str:
    if isinstance(value, str) and value.strip():
        base = re.sub(r"[^0-9A-Za-z_-]+", "-", value.strip()).strip("-")[:64]
        if base:
            candidate = base
        else:
            candidate = f"station-{index + 1}"
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        candidate = f"station-{int(value)}"
    else:
        candidate = f"station-{index + 1}"
    if candidate in used:
        suffix = 2
        while f"{candidate}-{suffix}" in used:
            suffix += 1
        candidate = f"{candidate}-{suffix}"
    used.add(candidate)
    return candidate


def _round_coords(coords: Any, digits: int = 2) -> Any:
    if isinstance(coords, (list, tuple)):
        return [_round_coords(item, digits) for item in coords]
    if isinstance(coords, float):
        return round(coords, digits)
    return coords


def geometry_geojson(geom: BaseGeometry, digits: int = 2) -> dict[str, Any]:
    data = mapping(geom)
    return {
        "type": data["type"],
        "coordinates": _round_coords(data["coordinates"], digits),
    }


def _overlap_ids(fences: list[dict[str, Any]]) -> None:
    for index, fence in enumerate(fences):
        geom = fence["_projected_geom"]
        ids: list[str] = []
        for other_index, other in enumerate(fences):
            if other_index == index:
                continue
            if not geom.intersects(other["_projected_geom"]):
                continue
            intersection = geom.intersection(other["_projected_geom"])
            if getattr(intersection, "area", 0.0) > 1.0:
                ids.append(other["id"])
        fence["overlaps"] = ids


def parse_geofences(
    geojson: Any,
    projection: ProjectionContext | None = None,
    buffer_m: float = 10.0,
) -> tuple[list[dict[str, Any]], ProjectionContext]:
    collection = feature_collection(geojson)
    raw_features = collection.get("features", [])
    if not raw_features:
        raise GeofenceError("GeoJSON 中没有可用的场站要素。")
    if len(raw_features) > 100:
        raise GeofenceError("一次最多导入 100 个场站。")

    parsed: list[dict[str, Any]] = []
    used_ids: set[str] = set()

    for index, feature in enumerate(raw_features):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise GeofenceError(f"第 {index + 1} 个要素不是有效的 GeoJSON Feature。")
        raw_geom = feature.get("geometry")
        if not isinstance(raw_geom, dict):
            raise GeofenceError(f"第 {index + 1} 个要素缺少 geometry。")
        try:
            geom = shape(raw_geom)
        except Exception as exc:  # noqa: BLE001 - convert library errors to a clear API message
            raise GeofenceError(f"第 {index + 1} 个场站几何无法解析：{exc}") from exc
        if geom.is_empty:
            raise GeofenceError(f"第 {index + 1} 个场站几何为空。")
        if not geom.is_valid:
            geom = make_valid(geom)
        geom = _as_polygonal(geom)
        if geom.is_empty or geom.area <= 0:
            raise GeofenceError(f"第 {index + 1} 个场站面积无效。")

        props = feature.get("properties") or {}
        if not isinstance(props, dict):
            props = {}
        fence_id = _sanitize_id(
            props.get("id", props.get("station_id", props.get("code"))),
            index,
            used_ids,
        )
        name = _clean_name(
            props.get("name", props.get("station_name", props.get("title"))),
            f"场站 {index + 1}",
        )
        color = props.get("color") or props.get("fill") or PALETTE[index % len(PALETTE)]
        if not isinstance(color, str) or not COLOR_RE.match(color):
            color = PALETTE[index % len(PALETTE)]
        parsed.append(
            {
                "id": fence_id,
                "name": name,
                "description": _clean_name(
                    props.get("description", props.get("desc")), ""
                ),
                "color": color,
                "_lnglat_geom": geom,
            }
        )

    if projection is None:
        projection = build_projection([item["_lnglat_geom"] for item in parsed])

    for item in parsed:
        projected = projection.project_geometry(item["_lnglat_geom"])
        holes = holes_union(projected)
        buffer_geom = projected.buffer(buffer_m, quad_segs=10)
        if holes is not None:
            buffer_geom = buffer_geom.difference(holes)
        point = projected.representative_point()
        item["_projected_geom"] = projected
        item["_holes"] = holes
        item["_buffer_geom"] = buffer_geom
        item["geometry"] = geometry_geojson(projected, 2)
        item["buffer_geometry"] = geometry_geojson(buffer_geom, 2)
        item["centroid"] = {"x": round(point.x, 2), "y": round(point.y, 2)}
        item["bounds"] = [round(value, 2) for value in projected.bounds]
        item["area_m2"] = round(projected.area, 1)

    _overlap_ids(parsed)

    for item in parsed:
        item.pop("_lnglat_geom", None)
        item.pop("_projected_geom", None)
        item.pop("_holes", None)
        item.pop("_buffer_geom", None)

    return parsed, projection


def prepare_runtime_fences(
    raw_geojson: Any,
    projection: ProjectionContext,
    buffer_m: float,
) -> list[dict[str, Any]]:
    """Re-project fence geometry for analysis and retain prepared internals."""
    parsed, _ = parse_geofences(raw_geojson, projection=projection, buffer_m=buffer_m)
    # parse_geofences strips internals to keep the public payload clean. Build the
    # runtime-only objects again from the source rings so the analysis can use
    # prepared Shapely predicates without round-tripping through JSON.
    collection = feature_collection(raw_geojson)
    runtime: list[dict[str, Any]] = []
    for index, feature in enumerate(collection["features"]):
        geom = shape(feature["geometry"])
        if not geom.is_valid:
            geom = make_valid(geom)
        geom = _as_polygonal(geom)
        projected = projection.project_geometry(geom)
        holes = holes_union(projected)
        buffer_geom = projected.buffer(buffer_m, quad_segs=10)
        if holes is not None:
            buffer_geom = buffer_geom.difference(holes)
        public = parsed[index]
        public_holes = holes_union(projected)
        runtime.append(
            {
                **public,
                "_projected_geom": projected,
                "_holes": public_holes,
                "_buffer_geom": buffer_geom,
            }
        )
    return runtime


def classify_point(
    geom: BaseGeometry,
    buffer_geom: BaseGeometry,
    holes: BaseGeometry | None,
    point: BaseGeometry,
) -> str:
    """Classify a projected point for one fence.

    Shapely's ``covers`` includes the outer boundary. Interior rings are not
    covered, so holes are naturally outside. The 10 m buffer is explicitly
    clipped by the original holes: no hysteresis is granted inside a hole.
    """
    # Check holes first: a point exactly on an interior-ring edge belongs to
    # the void, not to the enclosed station area, so it must be outside.
    if holes is not None and holes.covers(point):
        return "hole"
    if geom.covers(point):
        return "inside"
    if buffer_geom.covers(point):
        return "buffer"
    return "outside"


def nice_scale_length(scale: float, target_pixels: float = 90.0) -> tuple[float, int]:
    """Return a round metre length and its pixel width at a given scale."""
    target_metres = target_pixels / max(scale, 1e-9)
    exponent = 10 ** math.floor(math.log10(max(target_metres, 1.0)))
    for multiplier in (1, 2, 5, 10):
        candidate = multiplier * exponent
        if candidate >= target_metres * 0.55:
            return candidate, int(round(candidate * scale))
    return exponent * 10, int(round(exponent * 10 * scale))
