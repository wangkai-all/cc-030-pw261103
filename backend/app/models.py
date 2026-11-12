from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class TrackPointIn(BaseModel):
    id: str | None = None
    timestamp: datetime
    lon: float = Field(ge=-180.0, le=180.0)
    lat: float = Field(ge=-90.0, le=90.0)

    @field_validator("timestamp")
    @classmethod
    def timestamp_not_empty(cls, value: datetime) -> datetime:
        return value


class TrackIn(BaseModel):
    vehicle_id: str = Field(min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=120)
    scenario: str | None = Field(default=None, max_length=80)
    color: str | None = Field(default=None, max_length=16)
    description: str | None = Field(default=None, max_length=300)
    points: list[TrackPointIn] = Field(min_length=1, max_length=5000)


class AnalysisOptions(BaseModel):
    buffer_m: float = Field(default=10.0, ge=0.0, le=100.0)
    enter_confirm_seconds: int = Field(default=60, ge=1, le=600)
    exit_confirm_seconds: int = Field(default=60, ge=1, le=600)
    gap_break_seconds: int = Field(default=300, ge=1, le=86400)


class AnalyzeRequest(BaseModel):
    geojson: dict[str, Any]
    tracks: list[TrackIn] = Field(min_length=1, max_length=100)
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)


class NormalizeRequest(BaseModel):
    geojson: dict[str, Any]
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)


StayStatus = Literal["complete", "incomplete", "ongoing"]
