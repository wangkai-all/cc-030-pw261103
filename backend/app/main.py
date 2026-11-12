from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .demo import demo_dataset
from .geo import GeofenceError, parse_geofences
from .models import AnalysisOptions, AnalyzeRequest, NormalizeRequest, TrackIn
from .service import analyze_payload

app = FastAPI(
    title="场站驻留研判 API",
    version="1.0.0",
    description="基于 WGS 84 GPS 轨迹与 GeoJSON 场站围栏的进出/驻留判定服务。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(GeofenceError)
async def geofence_error_handler(_request: Request, exc: GeofenceError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc), "kind": "geofence"})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    message = errors[0].get("msg", "请求参数无效") if errors else "请求参数无效"
    return JSONResponse(
        status_code=422,
        content={"detail": f"请求参数校验失败：{message}", "errors": errors, "kind": "validation"},
    )


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "geofence-dwell", "crs": "EPSG:4326 / local AEQD metres"}


@app.get("/api/demo")
def demo() -> dict[str, Any]:
    dataset = demo_dataset()
    tracks = [TrackIn.model_validate(track) for track in dataset["tracks"]]
    options = AnalysisOptions()
    analysis = analyze_payload(dataset["geojson"], tracks, options)
    return {"dataset": dataset, "analysis": analysis}


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, Any]:
    return analyze_payload(request.geojson, request.tracks, request.options)


@app.post("/api/geojson/normalize")
def normalize(request: NormalizeRequest) -> dict[str, Any]:
    fences, projection = parse_geofences(request.geojson, buffer_m=request.options.buffer_m)
    return {"projection": projection.metadata(), "geofences": fences}


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
ASSETS_DIR = FRONTEND_DIST / "assets"
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/")
def home():
    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "service": "场站驻留研判 API",
        "docs": "/docs",
        "demo": "/api/demo",
        "frontend": "构建前端后可由本服务直接提供（npm run build）。",
    }
