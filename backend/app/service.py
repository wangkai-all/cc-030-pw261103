from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .detection import analyze_tracks
from .geo import parse_geofences, prepare_runtime_fences
from .models import AnalysisOptions, TrackIn


def analyze_payload(
    geojson: dict[str, Any],
    tracks: list[TrackIn],
    options: AnalysisOptions,
) -> dict[str, Any]:
    fences, projection = parse_geofences(geojson, buffer_m=options.buffer_m)
    runtime_fences = prepare_runtime_fences(geojson, projection, options.buffer_m)
    analysis = analyze_tracks(tracks, runtime_fences, projection, options)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "projection": projection.metadata(),
        "options": {
            "buffer_m": options.buffer_m,
            "enter_confirm_seconds": options.enter_confirm_seconds,
            "exit_confirm_seconds": options.exit_confirm_seconds,
            "gap_break_seconds": options.gap_break_seconds,
        },
        "geofences": fences,
        **analysis,
    }
