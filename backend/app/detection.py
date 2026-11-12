from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from shapely.geometry import Point

from .geo import ProjectionContext, classify_point
from .models import AnalysisOptions, TrackIn

STATUS_LABELS = {
    "complete": "完整驻留",
    "incomplete": "不完整",
    "ongoing": "进行中",
}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return _utc(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def _seconds(later: datetime, earlier: datetime) -> int:
    return int((later - earlier).total_seconds())


def _round(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


@dataclass
class PreparedPoint:
    id: str
    timestamp: datetime
    lon: float
    lat: float
    x: float
    y: float
    valid: bool
    issue: str | None
    sequence: int | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": _iso(self.timestamp),
            "lon": round(self.lon, 7),
            "lat": round(self.lat, 7),
            "x": _round(self.x),
            "y": _round(self.y),
            "valid": self.valid,
            "issue": self.issue,
            "sequence": self.sequence,
        }

    def trigger(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": _iso(self.timestamp),
            "lon": round(self.lon, 7),
            "lat": round(self.lat, 7),
            "x": _round(self.x),
            "y": _round(self.y),
            "sequence": self.sequence,
        }


def _prepare_tracks(
    tracks: list[TrackIn],
    projection: ProjectionContext,
    options: AnalysisOptions,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    prepared_tracks: list[dict[str, Any]] = []
    all_anomalies: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    anomaly_index = 0

    for track_index, track in enumerate(tracks):
        rows: list[PreparedPoint] = []
        for point_index, item in enumerate(track.points):
            base_id = item.id or f"v{track_index + 1}-p{point_index + 1:03d}"
            point_id = base_id
            if point_id in used_ids:
                suffix = 2
                while f"{point_id}-{suffix}" in used_ids:
                    suffix += 1
                point_id = f"{point_id}-{suffix}"
            used_ids.add(point_id)
            x, y = projection.to_metric(item.lon, item.lat)
            rows.append(
                PreparedPoint(
                    id=point_id,
                    timestamp=_utc(item.timestamp),
                    lon=item.lon,
                    lat=item.lat,
                    x=x,
                    y=y,
                    valid=False,
                    issue=None,
                )
            )

        # Stable chronological ordering, preserving input order for an exact tie.
        rows.sort(key=lambda row: row.timestamp)

        grouped: dict[datetime, list[PreparedPoint]] = defaultdict(list)
        for row in rows:
            grouped[row.timestamp].append(row)

        for timestamp, group in grouped.items():
            reference = group[0]
            distances = [
                ((candidate.x - reference.x) ** 2 + (candidate.y - reference.y) ** 2)
                ** 0.5
                for candidate in group
            ]
            if len(group) == 1:
                group[0].valid = True
                continue

            if all(distance <= 0.5 for distance in distances):
                # Same moment + same position: collapse the duplicate, retain the first.
                for candidate in group[1:]:
                    candidate.issue = "duplicate"
                group[0].valid = True
                duplicate_ids = [candidate.id for candidate in group]
                all_anomalies.append(
                    {
                        "id": f"anomaly-{anomaly_index + 1:02d}",
                        "kind": "duplicate",
                        "severity": "info",
                        "vehicle_id": track.vehicle_id,
                        "timestamp": _iso(timestamp),
                        "point_ids": duplicate_ids,
                        "retained_point_id": group[0].id,
                        "message": f"同一时刻存在 {len(group) - 1} 个重复点位，已合并保留第一个点。",
                        "detail": "去重阈值为同一时刻且位置偏差 ≤ 0.5 米。",
                    }
                )
                anomaly_index += 1
            else:
                for candidate in group:
                    candidate.issue = "timestamp_conflict"
                conflict_ids = [candidate.id for candidate in group]
                all_anomalies.append(
                    {
                        "id": f"anomaly-{anomaly_index + 1:02d}",
                        "kind": "timestamp_conflict",
                        "severity": "warning",
                        "vehicle_id": track.vehicle_id,
                        "timestamp": _iso(timestamp),
                        "point_ids": conflict_ids,
                        "retained_point_id": None,
                        "message": f"同一时刻出现 {len(group)} 个位置冲突的点，整组列为异常，不参与驻留判定。",
                        "detail": "同一时间戳下点位相距超过 0.5 米；为避免错误判定，整组有效点均被剔除。",
                        "coordinates": [
                            {"lon": round(candidate.lon, 7), "lat": round(candidate.lat, 7)}
                            for candidate in group
                        ],
                    }
                )
                anomaly_index += 1

        valid_sequence = 0
        for row in rows:
            if row.valid:
                valid_sequence += 1
                row.sequence = valid_sequence

        valid_rows = [row for row in rows if row.valid]
        gaps: list[dict[str, Any]] = []
        for index in range(1, len(valid_rows)):
            previous = valid_rows[index - 1]
            current = valid_rows[index]
            gap_seconds = _seconds(current.timestamp, previous.timestamp)
            if gap_seconds >= options.gap_break_seconds:
                gaps.append(
                    {
                        "id": f"gap-{track_index + 1}-{len(gaps) + 1}",
                        "after_point_id": previous.id,
                        "before_point_id": current.id,
                        "start_time": _iso(previous.timestamp),
                        "end_time": _iso(current.timestamp),
                        "gap_seconds": gap_seconds,
                        "from": {"x": _round(previous.x), "y": _round(previous.y)},
                        "to": {"x": _round(current.x), "y": _round(current.y)},
                        "breaks_stay": False,
                        "affected_stay_ids": [],
                    }
                )

        public_points = [row.public() for row in rows]
        counts = {
            "input": len(rows),
            "valid": len(valid_rows),
            "duplicate": sum(1 for row in rows if row.issue == "duplicate"),
            "conflict": sum(1 for row in rows if row.issue == "timestamp_conflict"),
            "gaps": len(gaps),
        }
        prepared_tracks.append(
            {
                "vehicle_id": track.vehicle_id,
                "label": track.label or track.vehicle_id,
                "scenario": track.scenario or "常规轨迹",
                "description": track.description or "",
                "color": track.color or "#315B52",
                "points": public_points,
                "gaps": gaps,
                "quality": counts,
                "_valid": valid_rows,
                "_track_index": track_index,
            }
        )

    return prepared_tracks, all_anomalies


def _gap_between(previous: PreparedPoint, current: PreparedPoint) -> int:
    return _seconds(current.timestamp, previous.timestamp)


def _sample_action(
    index: int,
    start_index: int,
    end_index: int,
    status: str,
    classification: str,
    active: bool,
) -> str:
    if index == start_index:
        return "entry_first"
    if index == start_index + 1:
        return "entry_second"
    if status == "complete" and index == end_index:
        return "exit_first"
    if status == "complete" and index == end_index + 1:
        return "exit_second"
    if status == "incomplete" and index == end_index:
        return "gap_last"
    if status == "ongoing" and index == end_index:
        return "ongoing_last"
    if active and classification == "buffer":
        return "buffer_hold"
    if active and classification in {"outside", "hole"}:
        return "outside_wait"
    if classification == "inside":
        return "inside_observe"
    if classification == "hole":
        return "hole"
    if classification == "buffer":
        return "buffer"
    return "outside"


def _build_stay(
    *,
    vehicle: dict[str, Any],
    fence: dict[str, Any],
    valid: list[PreparedPoint],
    classes: list[str],
    start_index: int,
    end_index: int,
    status: str,
    entry_pair: tuple[int, int],
    exit_pair: tuple[int, int] | None,
    gap: dict[str, Any] | None,
    stay_index: int,
    vehicle_index: int,
    fence_index: int,
    thresholds: AnalysisOptions,
) -> dict[str, Any]:
    entry_first = valid[start_index]
    entry_second = valid[entry_pair[1]]
    last_point = valid[end_index]
    exit_first = valid[exit_pair[0]] if exit_pair else None
    exit_second = valid[exit_pair[1]] if exit_pair else None

    entry_gap = _gap_between(entry_first, entry_second)
    exit_gap = (
        _gap_between(valid[exit_pair[0]], valid[exit_pair[1]]) if exit_pair else None
    )
    duration = _seconds(last_point.timestamp, entry_first.timestamp)

    sample_start = max(0, start_index - 1)
    sample_end = min(
        len(valid) - 1,
        end_index + (2 if status == "complete" else 0),
    )
    samples: list[dict[str, Any]] = []
    for index in range(sample_start, sample_end + 1):
        point = valid[index]
        active_now = (
            start_index <= index
            and (status != "complete" or index <= end_index + 1)
        )
        gap_seconds = _gap_between(valid[index - 1], point) if index > 0 else None
        samples.append(
            {
                **point.trigger(),
                "classification": classes[index],
                "gap_seconds": gap_seconds,
                "action": _sample_action(
                    index,
                    start_index,
                    end_index,
                    status,
                    classes[index],
                    active_now,
                ),
            }
        )

    # Group supporting point runs into concise decision events.
    events: list[dict[str, Any]] = [
        {
            "type": "entry_confirm",
            "severity": "success",
            "timestamp": entry_first.trigger()["timestamp"],
            "point_id": entry_first.id,
            "evidence_ids": [entry_first.id, entry_second.id],
            "title": "连续双点确认进入",
            "detail": (
                f"两个连续有效点均在围栏内，间隔 {entry_gap} 秒"
                f"（≤ {thresholds.enter_confirm_seconds} 秒）。"
                f"进入时间回记至第一个点，边界点按内部处理。"
            ),
            "metric": f"间隔 {entry_gap}s",
        }
    ]

    buffer_runs: list[tuple[int, int]] = []
    outside_runs: list[tuple[int, int]] = []
    current_kind: str | None = None
    current_start = 0
    for index in range(start_index + 2, end_index + 1):
        kind = classes[index]
        if kind == "buffer":
            if current_kind != "buffer":
                if current_kind == "outside":
                    outside_runs.append((current_start, index - 1))
                current_kind = "buffer"
                current_start = index
        elif kind in {"outside", "hole"}:
            if current_kind != "outside":
                if current_kind == "buffer":
                    buffer_runs.append((current_start, index - 1))
                current_kind = "outside"
                current_start = index
        else:
            if current_kind == "buffer":
                buffer_runs.append((current_start, index - 1))
            if current_kind == "outside":
                outside_runs.append((current_start, index - 1))
            current_kind = None
    if current_kind == "buffer":
        buffer_runs.append((current_start, end_index))
    if current_kind == "outside":
        outside_runs.append((current_start, end_index))

    for run_start, run_end in buffer_runs:
        if status == "complete" and run_start == end_index:
            continue
        # Do not surface the exit-pair candidates as "held" buffer runs.
        events.append(
            {
                "type": "buffer_hold",
                "severity": "warning",
                "timestamp": valid[run_start].trigger()["timestamp"],
                "point_id": valid[run_start].id,
                "evidence_ids": [valid[i].id for i in range(run_start, run_end + 1)],
                "title": "10 米缓冲内 · 保持在场",
                "detail": (
                    f"{run_end - run_start + 1} 个点位于边界外 10 米缓冲范围，"
                    "未触发退出，驻留状态保持。"
                ),
                "metric": f"缓冲 {run_end - run_start + 1} 点",
            }
        )

    for run_start, run_end in outside_runs:
        if status == "complete" and run_start == end_index:
            continue
        if classes[run_start] == "hole":
            events.append(
                {
                    "type": "hole_outside",
                    "severity": "danger",
                    "timestamp": valid[run_start].trigger()["timestamp"],
                    "point_id": valid[run_start].id,
                    "evidence_ids": [valid[i].id for i in range(run_start, run_end + 1)],
                    "title": "内部空洞 · 按围栏外处理",
                    "detail": "点位落入场站内部空洞，不享有 10 米缓冲，按场站外分类。",
                    "metric": "空洞",
                }
            )
        elif run_end - run_start + 1 == 1:
            events.append(
                {
                    "type": "outside_candidate",
                    "severity": "warning",
                    "timestamp": valid[run_start].trigger()["timestamp"],
                    "point_id": valid[run_start].id,
                    "evidence_ids": [valid[run_start].id],
                    "title": "越界单点 · 尚未退出",
                    "detail": (
                        "该点已越出 10 米缓冲，但未与相邻点形成连续两个缓冲外点，"
                        "驻留状态保持。"
                    ),
                    "metric": "单点",
                }
            )

    if exit_pair and classes[exit_pair[0]] == "hole":
        events.append(
            {
                "type": "hole_outside",
                "severity": "danger",
                "timestamp": exit_first.trigger()["timestamp"],
                "point_id": exit_first.id,
                "evidence_ids": [exit_first.id, exit_second.id],
                "title": "内部空洞 · 按围栏外处理",
                "detail": (
                    "退出触发点位于场站内部空洞。空洞不享有 10 米缓冲，"
                    "连续两点落入空洞即按场站外确认退出。"
                ),
                "metric": "空洞",
            }
        )

    if exit_pair:
        exit_event = {
            "type": "exit_confirm",
            "severity": "danger",
            "timestamp": exit_first.trigger()["timestamp"],
            "point_id": exit_first.id,
            "evidence_ids": [exit_first.id, exit_second.id],
            "title": "连续双点确认退出",
            "detail": (
                f"连续两个点均在 {thresholds.buffer_m:g} 米缓冲外，间隔 {exit_gap} 秒"
                f"（≤ {thresholds.exit_confirm_seconds} 秒）。"
                "退出时间回记至第一个缓冲外点。"
            ),
            "metric": f"间隔 {exit_gap}s",
        }
        events.append(exit_event)

    if gap is not None:
        events.append(
            {
                "type": "gap_break",
                "severity": "danger",
                "timestamp": last_point.trigger()["timestamp"],
                "point_id": last_point.id,
                "evidence_ids": [last_point.id],
                "title": "信号断档 · 驻留中断",
                "detail": (
                    f"相邻有效点间隔 {gap['gap_seconds']} 秒"
                    f"（≥ {thresholds.gap_break_seconds} 秒），轨迹在此断开。"
                    "不跨缺口补算驻留，本条记录标记为不完整。"
                ),
                "metric": f"{gap['gap_seconds']}s",
                "next_point_id": gap["before_point_id"],
            }
        )

    if status == "ongoing":
        events.append(
            {
                "type": "ongoing",
                "severity": "info",
                "timestamp": last_point.trigger()["timestamp"],
                "point_id": last_point.id,
                "evidence_ids": [last_point.id],
                "title": "轨迹结束 · 驻留进行中",
                "detail": (
                    "轨迹结束时仍处于场内，尚未形成连续两个缓冲外点，"
                    "显示为进行中；不混入完整驻留平均时长。"
                ),
                "metric": "未离开",
            }
        )

    if status == "incomplete":
        status_note = "因信号断档中断，记录不完整，未计入平均时长。"
    elif status == "ongoing":
        status_note = "尚未确认离开，驻留进行中，未计入平均时长。"
    else:
        status_note = "进出均由连续双点确认，计入完整驻留平均时长。"

    rule_tags = ["边界按内部", "时间回记至第一点"]
    rule_tags.append("双点确认进入")
    rule_tags.append("双点确认退出" if exit_pair else "未确认退出")
    if any(classes[i] == "buffer" for i in range(start_index, end_index + 1)):
        rule_tags.append("10 米缓冲保持")
    if any(classes[i] == "hole" for i in range(start_index, end_index + 1)):
        rule_tags.append("空洞按场外")
    if gap is not None:
        rule_tags.append(
            f"{thresholds.gap_break_seconds // 60} 分钟断档 · 不跨缺口"
            if thresholds.gap_break_seconds % 60 == 0
            else f"{thresholds.gap_break_seconds} 秒断档 · 不跨缺口"
        )
    if fence.get("overlaps"):
        rule_tags.append("重叠围栏独立判定")

    events.sort(key=lambda event: event["timestamp"])

    entry_trigger = entry_first.trigger()
    exit_trigger = exit_first.trigger() if exit_first else None
    last_trigger = last_point.trigger()

    return {
        "id": f"stay-{vehicle_index + 1}-{fence_index + 1}-{stay_index + 1}",
        "vehicle_id": vehicle["vehicle_id"],
        "vehicle_label": vehicle["label"],
        "vehicle_color": vehicle["color"],
        "vehicle_scenario": vehicle["scenario"],
        "geofence_id": fence["id"],
        "geofence_name": fence["name"],
        "geofence_color": fence["color"],
        "status": status,
        "status_label": STATUS_LABELS[status],
        "status_note": status_note,
        "enter_time": entry_trigger["timestamp"],
        "exit_time": exit_trigger["timestamp"] if exit_trigger else None,
        "last_seen_time": last_trigger["timestamp"],
        "duration_seconds": duration,
        "observed_duration_seconds": duration,
        "entry_point_id": entry_first.id,
        "exit_point_id": exit_first.id if exit_first else None,
        "entry_trigger": entry_trigger,
        "exit_trigger": exit_trigger,
        "last_seen_point": last_trigger,
        "entry_pair_ids": [entry_first.id, entry_second.id],
        "exit_pair_ids": [exit_first.id, exit_second.id] if exit_pair else None,
        "entry_gap_seconds": entry_gap,
        "exit_gap_seconds": exit_gap,
        "samples": samples,
        "events": events,
        "rule_tags": rule_tags,
        "break_gap": gap,
        "geofence_overlaps": list(fence.get("overlaps", [])),
        "concurrent_stay_ids": [],
    }


def _detect_for_fence(
    vehicle: dict[str, Any],
    fence: dict[str, Any],
    options: AnalysisOptions,
    vehicle_index: int,
    fence_index: int,
) -> list[dict[str, Any]]:
    valid: list[PreparedPoint] = vehicle["_valid"]
    geom = fence["_projected_geom"]
    buffer_geom = fence["_buffer_geom"]
    holes = fence["_holes"]
    classes = [
        classify_point(geom, buffer_geom, holes, Point(point.x, point.y))
        for point in valid
    ]

    stays: list[dict[str, Any]] = []
    active: dict[str, Any] | None = None
    local_count = 0

    for index in range(1, len(valid)):
        previous = valid[index - 1]
        current = valid[index]
        gap_seconds = _gap_between(previous, current)

        if gap_seconds >= options.gap_break_seconds:
            if active is not None:
                end_index = index - 1
                gap_detail = {
                    "after_point_id": previous.id,
                    "before_point_id": current.id,
                    "gap_seconds": gap_seconds,
                }
                stays.append(
                    _build_stay(
                        vehicle=vehicle,
                        fence=fence,
                        valid=valid,
                        classes=classes,
                        start_index=active["start_index"],
                        end_index=end_index,
                        status="incomplete",
                        entry_pair=active["entry_pair"],
                        exit_pair=None,
                        gap=gap_detail,
                        stay_index=local_count,
                        vehicle_index=vehicle_index,
                        fence_index=fence_index,
                        thresholds=options,
                    )
                )
                local_count += 1
                active = None
            # No pair may cross a gap: current point becomes a fresh segment head.
            continue

        if active is None:
            if (
                gap_seconds <= options.enter_confirm_seconds
                and classes[index - 1] == "inside"
                and classes[index] == "inside"
            ):
                active = {"start_index": index - 1, "entry_pair": (index - 1, index)}
        else:
            previous_out = classes[index - 1] not in {"inside", "buffer"}
            current_out = classes[index] not in {"inside", "buffer"}
            if (
                previous_out
                and current_out
                and gap_seconds <= options.exit_confirm_seconds
            ):
                stays.append(
                    _build_stay(
                        vehicle=vehicle,
                        fence=fence,
                        valid=valid,
                        classes=classes,
                        start_index=active["start_index"],
                        end_index=index - 1,
                        status="complete",
                        entry_pair=active["entry_pair"],
                        exit_pair=(index - 1, index),
                        gap=None,
                        stay_index=local_count,
                        vehicle_index=vehicle_index,
                        fence_index=fence_index,
                        thresholds=options,
                    )
                )
                local_count += 1
                active = None

    if active is not None and valid:
        stays.append(
            _build_stay(
                vehicle=vehicle,
                fence=fence,
                valid=valid,
                classes=classes,
                start_index=active["start_index"],
                end_index=len(valid) - 1,
                status="ongoing",
                entry_pair=active["entry_pair"],
                exit_pair=None,
                gap=None,
                stay_index=local_count,
                vehicle_index=vehicle_index,
                fence_index=fence_index,
                thresholds=options,
            )
        )

    return stays


def _annotate_concurrency(stays: list[dict[str, Any]]) -> None:
    by_vehicle: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for stay in stays:
        by_vehicle[stay["vehicle_id"]].append(stay)

    for vehicle_stays in by_vehicle.values():
        from_dt = datetime.fromisoformat
        intervals = []
        for stay in vehicle_stays:
            start = from_dt(stay["enter_time"].replace("Z", "+00:00"))
            end = from_dt((stay["exit_time"] or stay["last_seen_time"]).replace("Z", "+00:00"))
            intervals.append((start, end))
        for index, stay in enumerate(vehicle_stays):
            start, end = intervals[index]
            concurrent: list[str] = []
            for other_index, other in enumerate(vehicle_stays):
                if other_index == index or other["geofence_id"] == stay["geofence_id"]:
                    continue
                other_start, other_end = intervals[other_index]
                if min(end, other_end) > max(start, other_start):
                    concurrent.append(other["id"])
            stay["concurrent_stay_ids"] = concurrent


def analyze_tracks(
    tracks: list[TrackIn],
    fences: list[dict[str, Any]],
    projection: ProjectionContext,
    options: AnalysisOptions,
) -> dict[str, Any]:
    prepared_tracks, anomalies = _prepare_tracks(tracks, projection, options)

    stays: list[dict[str, Any]] = []
    for vehicle_index, vehicle in enumerate(prepared_tracks):
        for fence_index, fence in enumerate(fences):
            if not vehicle["_valid"]:
                continue
            stays.extend(
                _detect_for_fence(
                    vehicle,
                    fence,
                    options,
                    vehicle_index,
                    fence_index,
                )
            )

    _annotate_concurrency(stays)

    # A track gap can interrupt several independently evaluated fences. Keep
    # the track-level gap markers in sync with the stays they affected.
    for vehicle in prepared_tracks:
        for gap in vehicle["gaps"]:
            affected = [
                stay["id"]
                for stay in stays
                if stay["vehicle_id"] == vehicle["vehicle_id"]
                and stay["status"] == "incomplete"
                and stay["break_gap"]
                and stay["break_gap"]["after_point_id"] == gap["after_point_id"]
                and stay["break_gap"]["before_point_id"] == gap["before_point_id"]
            ]
            gap["affected_stay_ids"] = affected
            gap["breaks_stay"] = bool(affected)

    complete = [stay for stay in stays if stay["status"] == "complete"]
    incomplete = [stay for stay in stays if stay["status"] == "incomplete"]
    ongoing = [stay for stay in stays if stay["status"] == "ongoing"]
    average = (
        round(sum(stay["duration_seconds"] for stay in complete) / len(complete), 1)
        if complete
        else 0
    )

    for vehicle in prepared_tracks:
        vehicle_stays = [stay for stay in stays if stay["vehicle_id"] == vehicle["vehicle_id"]]
        for status in ("complete", "incomplete", "ongoing"):
            vehicle.setdefault("stay_counts", {})[status] = sum(
                1 for stay in vehicle_stays if stay["status"] == status
            )
        vehicle["stay_count"] = len(vehicle_stays)
        vehicle["average_complete_seconds"] = (
            round(
                sum(stay["duration_seconds"] for stay in vehicle_stays if stay["status"] == "complete")
                / max(sum(1 for stay in vehicle_stays if stay["status"] == "complete"), 1),
                1,
            )
            if any(stay["status"] == "complete" for stay in vehicle_stays)
            else 0
        )

    public_tracks = []
    for vehicle in prepared_tracks:
        public_tracks.append(
            {
                "vehicle_id": vehicle["vehicle_id"],
                "label": vehicle["label"],
                "scenario": vehicle["scenario"],
                "description": vehicle["description"],
                "color": vehicle["color"],
                "points": vehicle["points"],
                "gaps": vehicle["gaps"],
                "quality": vehicle["quality"],
                "stay_count": vehicle["stay_count"],
                "stay_counts": vehicle["stay_counts"],
                "average_complete_seconds": vehicle["average_complete_seconds"],
            }
        )

    per_fence = []
    for fence in fences:
        fence_stays = [stay for stay in stays if stay["geofence_id"] == fence["id"]]
        per_fence.append(
            {
                "geofence_id": fence["id"],
                "stay_count": len(fence_stays),
                "complete_count": sum(1 for stay in fence_stays if stay["status"] == "complete"),
                "average_complete_seconds": (
                    round(
                        sum(stay["duration_seconds"] for stay in fence_stays if stay["status"] == "complete")
                        / sum(1 for stay in fence_stays if stay["status"] == "complete"),
                        1,
                    )
                    if any(stay["status"] == "complete" for stay in fence_stays)
                    else 0
                ),
            }
        )

    input_points = sum(len(track.points) for track in tracks)
    valid_points = sum(
        sum(1 for point in vehicle["points"] if point["valid"]) for vehicle in public_tracks
    )

    return {
        "tracks": public_tracks,
        "stays": stays,
        "anomalies": anomalies,
        "statistics": {
            "total_points": input_points,
            "valid_points": valid_points,
            "duplicate_points": sum(
                1 for vehicle in public_tracks for point in vehicle["points"] if point["issue"] == "duplicate"
            ),
            "conflict_points": sum(
                1
                for vehicle in public_tracks
                for point in vehicle["points"]
                if point["issue"] == "timestamp_conflict"
            ),
            "anomaly_groups": len(anomalies),
            "total_stays": len(stays),
            "complete_stays": len(complete),
            "incomplete_stays": len(incomplete),
            "ongoing_stays": len(ongoing),
            "average_complete_seconds": average,
            "total_vehicles": len(public_tracks),
            "total_fences": len(fences),
            "per_fence": per_fence,
        },
    }
