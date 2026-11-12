import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type {
  Analysis,
  Classification,
  FocusRequest,
  Geofence,
  PolygonGeometry,
  Stay,
  StaySample,
  Track,
  TrackPoint,
} from "../types";
import { formatArea, formatTime, vehicleShort } from "../lib/format";
import { Icon } from "./Icon";

interface MapCanvasProps {
  analysis: Analysis;
  selectedStay: Stay | null;
  selectedVehicleId: string | "all";
  focus: FocusRequest;
}

type Bounds = [number, number, number, number];
type Camera = { cx: number; cy: number; scale: number };
type HoverState = {
  point: TrackPoint;
  track: Track;
  sample?: StaySample;
  left: number;
  top: number;
};

const CLASS_COLOR: Record<Classification, string> = {
  inside: "#0F766E",
  buffer: "#C27A27",
  outside: "#B4442C",
  hole: "#6D4AD1",
};

const CLASS_LABEL: Record<Classification, string> = {
  inside: "围栏内",
  buffer: "10m 缓冲",
  outside: "缓冲外",
  hole: "内部空洞",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unionBounds(bounds: Bounds[]): Bounds {
  if (!bounds.length) return [-1000, -1000, 1000, 1000];
  return [
    Math.min(...bounds.map((item) => item[0])),
    Math.min(...bounds.map((item) => item[1])),
    Math.max(...bounds.map((item) => item[2])),
    Math.max(...bounds.map((item) => item[3])),
  ];
}

function polygonsOf(geometry: PolygonGeometry): number[][][][] {
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates as number[][][][];
  }
  return [geometry.coordinates as number[][][]];
}

function ringPath(ring: number[][], project: (x: number, y: number) => [number, number]): string {
  return ring
    .map((coordinate, index) => {
      const [sx, sy] = project(coordinate[0], coordinate[1]);
      return `${index === 0 ? "M" : "L"}${sx.toFixed(2)},${sy.toFixed(2)}`;
    })
    .join(" ");
}

function geometryPath(
  geometry: PolygonGeometry,
  project: (x: number, y: number) => [number, number],
): string {
  return polygonsOf(geometry)
    .flatMap((polygon) => polygon.map((ring) => ringPath(ring, project)))
    .join(" ");
}

function holeCentroids(geometry: PolygonGeometry): { x: number; y: number }[] {
  const centroids: { x: number; y: number }[] = [];
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon.slice(1)) {
      const xs = ring.map((coordinate) => coordinate[0]);
      const ys = ring.map((coordinate) => coordinate[1]);
      centroids.push({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      });
    }
  }
  return centroids;
}

function holeRingsOf(geometry: PolygonGeometry): number[][][] {
  return polygonsOf(geometry).flatMap((polygon) => polygon.slice(1));
}

function niceScale(scale: number): { metres: number; pixels: number } {
  const targetMetres = 92 / scale;
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(targetMetres, 1))));
  const candidates = [1, 2, 5, 10].map((item) => item * power);
  const metres = candidates.find((item) => item >= targetMetres * 0.62) ?? candidates[3];
  return { metres, pixels: metres * scale };
}

function niceGridStep(scale: number): number {
  const target = 72 / scale;
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(target, 10))));
  const candidates = [1, 2, 5, 10].map((item) => item * power);
  return candidates.find((item) => item >= target) ?? candidates[3];
}

function pathBetween(
  points: TrackPoint[],
  project: (x: number, y: number) => [number, number],
): string {
  return points
    .map((point, index) => {
      const [sx, sy] = project(point.x, point.y);
      return `${index === 0 ? "M" : "L"}${sx.toFixed(2)},${sy.toFixed(2)}`;
    })
    .join(" ");
}

export function MapCanvas({ analysis, selectedStay, selectedVehicleId, focus }: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>({ cx: 0, cy: 0, scale: 0.32 });
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    cx: number;
    cy: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  const selectedFence = useMemo(
    () => analysis.geofences.find((fence) => fence.id === selectedStay?.geofence_id) ?? null,
    [analysis.geofences, selectedStay?.geofence_id],
  );
  const selectedTrack = useMemo(
    () =>
      analysis.tracks.find((track) => track.vehicle_id === selectedStay?.vehicle_id) ??
      null,
    [analysis.tracks, selectedStay?.vehicle_id],
  );
  const sampleById = useMemo(() => {
    const map = new Map<string, StaySample>();
    selectedStay?.samples.forEach((sample) => map.set(sample.id, sample));
    return map;
  }, [selectedStay]);

  const visibleFences = analysis.geofences;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      setSize((previous) =>
        Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
          ? previous
          : { width, height },
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const allBounds = useMemo<Bounds>(() => {
    const bounds: Bounds[] = analysis.geofences.map((fence) => fence.bounds);
    analysis.tracks.forEach((track) => {
      track.points.forEach((point) => {
        bounds.push([point.x, point.y, point.x, point.y]);
      });
    });
    return unionBounds(bounds);
  }, [analysis]);

  const stayBounds = useCallback(
    (stay: Stay): Bounds => {
      const fence = analysis.geofences.find((item) => item.id === stay.geofence_id);
      const track = analysis.tracks.find((item) => item.vehicle_id === stay.vehicle_id);
      const evidence = [
        stay.entry_trigger,
        stay.exit_trigger,
        stay.last_seen_point,
      ].filter((point): point is NonNullable<typeof point> => Boolean(point));
      if (track) {
        const pairIds = [
          ...(stay.entry_pair_ids ?? []),
          ...(stay.exit_pair_ids ?? []),
        ];
        pairIds.forEach((id) => {
          const point = track.points.find((item) => item.id === id);
          if (point) evidence.push(point);
        });
      }
      if (!evidence.length) {
        return fence ? fence.bounds : allBounds;
      }
      // Frame the actual entry/exit evidence points rather than the entire
      // fence, so a selected record zooms onto the decision boundary.
      const minX = Math.min(...evidence.map((point) => point.x));
      const maxX = Math.max(...evidence.map((point) => point.x));
      const minY = Math.min(...evidence.map((point) => point.y));
      const maxY = Math.max(...evidence.map((point) => point.y));
      const pad = 55;
      return [minX - pad, minY - pad, maxX + pad, maxY + pad];
    },
    [analysis.geofences, analysis.tracks, allBounds],
  );

  const vehicleBounds = useCallback(
    (vehicleId: string): Bounds => {
      const track = analysis.tracks.find((item) => item.vehicle_id === vehicleId);
      if (!track) return allBounds;
      const bounds: Bounds[] = [];
      track.points.forEach((point) =>
        bounds.push([point.x, point.y, point.x, point.y]),
      );
      analysis.stays
        .filter((stay) => stay.vehicle_id === vehicleId)
        .forEach((stay) => {
          const fence = analysis.geofences.find((item) => item.id === stay.geofence_id);
          if (fence) bounds.push(fence.bounds);
        });
      return unionBounds(bounds);
    },
    [analysis, allBounds],
  );

  const fitBounds = useCallback(
    (bounds: Bounds) => {
      if (!size.width || !size.height) return;
      const padding = 58;
      const width = Math.max(bounds[2] - bounds[0], 40);
      const height = Math.max(bounds[3] - bounds[1], 40);
      const scale = clamp(
        Math.min(
          (size.width - padding * 2) / width,
          (size.height - padding * 2) / height,
        ),
        0.035,
        5,
      );
      setCamera({
        cx: (bounds[0] + bounds[2]) / 2,
        cy: (bounds[1] + bounds[3]) / 2,
        scale,
      });
    },
    [size.height, size.width],
  );

  useEffect(() => {
    if (!size.width || !size.height) return;
    if (focus.kind === "stay") {
      const stay = analysis.stays.find((item) => item.id === focus.stayId);
      if (stay) {
        fitBounds(stayBounds(stay));
        return;
      }
    }
    if (focus.kind === "vehicle") {
      fitBounds(vehicleBounds(focus.vehicleId));
      return;
    }
    fitBounds(allBounds);
  }, [focus, size.width, size.height, analysis, allBounds, fitBounds, stayBounds, vehicleBounds]);

  const project = useCallback(
    (x: number, y: number): [number, number] => [
      size.width / 2 + (x - camera.cx) * camera.scale,
      size.height / 2 - (y - camera.cy) * camera.scale,
    ],
    [camera, size.height, size.width],
  );

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    setCamera((previous) => {
      const nextScale = clamp(previous.scale * factor, 0.035, 5);
      const beforeX = previous.cx + (sx - size.width / 2) / previous.scale;
      const beforeY = previous.cy - (sy - size.height / 2) / previous.scale;
      return {
        cx: beforeX - (sx - size.width / 2) / nextScale,
        cy: beforeY + (sy - size.height / 2) / nextScale,
        scale: nextScale,
      };
    });
  }, [size.height, size.width]);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("[data-no-pan]")) return;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      cx: camera.cx,
      cy: camera.cy,
      moved: false,
      pointerId: event.pointerId,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    setCamera((previous) => ({
      ...previous,
      cx: drag.cx - dx / previous.scale,
      cy: drag.cy + dy / previous.scale,
    }));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.active = false;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
  };

  const handleFit = () => {
    if (selectedStay) fitBounds(stayBounds(selectedStay));
    else if (selectedVehicleId !== "all") fitBounds(vehicleBounds(selectedVehicleId));
    else fitBounds(allBounds);
  };

  const gridStep = niceGridStep(camera.scale);
  const dataLeft = camera.cx - (size.width / 2) / camera.scale;
  const dataRight = camera.cx + (size.width / 2) / camera.scale;
  const dataBottom = camera.cy - (size.height / 2) / camera.scale;
  const dataTop = camera.cy + (size.height / 2) / camera.scale;
  const gridLines = useMemo(() => {
    const vertical: number[] = [];
    const horizontal: number[] = [];
    const maxLines = 90;
    let start = Math.ceil(dataLeft / gridStep) * gridStep;
    while (start <= dataRight && vertical.length < maxLines) {
      vertical.push(start);
      start += gridStep;
    }
    start = Math.ceil(dataBottom / gridStep) * gridStep;
    while (start <= dataTop && horizontal.length < maxLines) {
      horizontal.push(start);
      start += gridStep;
    }
    return { vertical, horizontal };
  }, [dataBottom, dataLeft, dataRight, dataTop, gridStep]);

  const scaleBar = niceScale(camera.scale);

  const highlightedPath = useMemo(() => {
    if (!selectedStay) return null;
    const track = analysis.tracks.find((item) => item.vehicle_id === selectedStay.vehicle_id);
    if (!track) return null;
    const validPoints = track.points.filter((point) => point.valid);
    const start = validPoints.findIndex((point) => point.id === selectedStay.entry_point_id);
    const endId = selectedStay.exit_point_id ?? selectedStay.last_seen_point.id;
    const end = validPoints.findIndex((point) => point.id === endId);
    if (start < 0 || end < start) return null;
    return validPoints.slice(start, end + 1);
  }, [analysis.tracks, selectedStay]);

  const getSample = (pointId: string) => sampleById.get(pointId);

  const handlePointHover = (
    event: ReactMouseEvent<SVGCircleElement>,
    point: TrackPoint,
    track: Track,
  ) => {
    const host = hostRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const targetRect = event.currentTarget.getBoundingClientRect();
    setHovered({
      point,
      track,
      sample: getSample(point.id),
      left: clamp(targetRect.left - hostRect.left + 14, 12, Math.max(hostRect.width - 244, 12)),
      top: clamp(targetRect.top - hostRect.top - 36, 12, Math.max(hostRect.height - 130, 12)),
    });
  };

  if (!analysis.geofences.length) {
    return (
      <div className="map-shell">
        <div className="map-empty">
          <Icon name="layers" size={30} />
          <strong>尚未载入场站围栏</strong>
          <span>导入 GeoJSON 后即可开始驻留分析。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="map-shell" ref={hostRef}>
      <svg
        ref={svgRef}
        className="map-svg"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.width} ${size.height}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseLeave={() => setHovered(null)}
        style={{ cursor: dragging ? "grabbing" : "crosshair" }}
      >
        <defs>
          <pattern id="map-grid-major" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#D9D4C7" strokeWidth="0.8" />
          </pattern>
          <pattern
            id="hole-hatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(42)"
          >
            <line x1="0" y1="0" x2="0" y2="8" stroke="#A79F8D" strokeWidth="1" opacity="0.52" />
          </pattern>
          <filter id="station-halo" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feFlood floodColor="#D9D1BF" floodOpacity="0.45" result="colour" />
            <feComposite in="colour" in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="marker-shadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.4" floodColor="#243A34" floodOpacity="0.2" />
          </filter>
        </defs>

        <rect x="0" y="0" width={size.width} height={size.height} fill="#F7F4EC" />
        <rect
          x="0"
          y="0"
          width={size.width}
          height={size.height}
          fill="url(#map-grid-major)"
          opacity="0.5"
        />

        {/* Survey grid labels */}
        {gridLines.vertical.map((x) => {
          const sx = project(x, 0)[0];
          if (sx < 8 || sx > size.width - 8) return null;
          return (
            <g key={`vx-${x}`}>
              <line x1={sx} y1={0} x2={sx} y2={size.height} stroke="#E2DDD0" strokeWidth="0.7" />
              <text
                x={sx + 5}
                y={size.height - 13}
                fontSize="8.5"
                fill="#9A9486"
                fontFamily="'IBM Plex Mono', ui-monospace, monospace"
              >
                {Math.round(x)}
              </text>
            </g>
          );
        })}
        {gridLines.horizontal.map((y) => {
          const sy = project(0, y)[1];
          if (sy < 8 || sy > size.height - 8) return null;
          return (
            <g key={`hy-${y}`}>
              <line x1={0} y1={sy} x2={size.width} y2={sy} stroke="#E2DDD0" strokeWidth="0.7" />
              <text
                x={8}
                y={sy - 4}
                fontSize="8.5"
                fill="#9A9486"
                fontFamily="'IBM Plex Mono', ui-monospace, monospace"
              >
                {Math.round(y)}
              </text>
            </g>
          );
        })}

        {/* 10 m buffers */}
        {visibleFences.map((fence) => {
          const isSelected = selectedFence?.id === fence.id;
          return (
            <path
              key={`buffer-${fence.id}`}
              d={geometryPath(fence.buffer_geometry, project)}
              fill="none"
              stroke={fence.color}
              strokeWidth={isSelected ? 1.4 : 0.9}
              strokeDasharray={isSelected ? "5 4" : "4 6"}
              opacity={isSelected ? 0.75 : 0.27}
            />
          );
        })}

        {/* Fences, holes and labels */}
        {visibleFences.map((fence) => {
          const isSelected = selectedFence?.id === fence.id;
          const hasSelectedVehicle = Boolean(selectedTrack);
          return (
            <g key={`fence-${fence.id}`} opacity={isSelected || !hasSelectedVehicle ? 1 : 0.56}>
              <path
                d={geometryPath(fence.geometry, project)}
                fill={fence.color}
                fillOpacity={isSelected ? 0.16 : 0.1}
                fillRule="evenodd"
                stroke={fence.color}
                strokeWidth={isSelected ? 3 : 1.7}
                strokeLinejoin="round"
              />
              {holeCentroids(fence.geometry).map((hole, index) => {
                const [sx, sy] = project(hole.x, hole.y);
                const width = 82;
                const ring = holeRingsOf(fence.geometry)[index];
                return (
                  <g key={`hole-${fence.id}-${index}`}>
                    <path
                      d={ring ? ringPath(ring, project) : ""}
                      fill="url(#hole-hatch)"
                      opacity="0.64"
                    />
                    <g transform={`translate(${sx - width / 2}, ${sy - 9})`}>
                      <rect
                        width={width}
                        height="18"
                        rx="4"
                        fill="#F8F5EE"
                        stroke="#C9C1AF"
                        strokeWidth="0.8"
                        opacity="0.9"
                      />
                      <text
                        x={width / 2}
                        y="12.2"
                        textAnchor="middle"
                        fontSize="8.5"
                        letterSpacing="0.08em"
                        fill="#7C7465"
                        fontWeight="600"
                      >
                        内部空洞 · 场外
                      </text>
                    </g>
                  </g>
                );
              })}
              <FenceLabel
                fence={fence}
                selected={isSelected}
                project={project}
              />
            </g>
          );
        })}

        {/* Tracks */}
        {analysis.tracks.map((track) => {
          const active = !selectedStay
            ? selectedVehicleId === "all" || selectedVehicleId === track.vehicle_id
            : track.vehicle_id === selectedStay.vehicle_id;
          const opacities = selectedStay
            ? track.vehicle_id === selectedStay.vehicle_id
              ? 0.9
              : 0.16
            : selectedVehicleId === "all"
              ? 0.56
              : selectedVehicleId === track.vehicle_id
                ? 0.95
                : 0.13;
          const segments = buildSegments(track, analysis.options.gap_break_seconds);
          return (
            <g key={`track-${track.vehicle_id}`} opacity={opacities}>
              {segments.map((segment, index) => (
                <path
                  key={`${track.vehicle_id}-seg-${index}`}
                  d={pathBetween(segment, project)}
                  fill="none"
                  stroke={track.color}
                  strokeWidth={active ? 2.1 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          );
        })}

        {/* Highlighted dwell path */}
        {highlightedPath && selectedStay && (
          <g>
            <path
              d={pathBetween(highlightedPath, project)}
              fill="none"
              stroke="#FFFDF7"
              strokeWidth="7"
              strokeLinecap="round"
              opacity="0.88"
            />
            <path
              d={pathBetween(highlightedPath, project)}
              fill="none"
              stroke={selectedStay.geofence_color}
              strokeWidth="3.3"
              strokeLinecap="round"
            />
          </g>
        )}

        {/* Signal gaps */}
        {analysis.tracks.map((track) => {
          const active = selectedStay
            ? track.vehicle_id === selectedStay.vehicle_id
            : selectedVehicleId === "all" || selectedVehicleId === track.vehicle_id;
          return track.gaps.map((gap) => {
            const [x1, y1] = project(gap.from.x, gap.from.y);
            const [x2, y2] = project(gap.to.x, gap.to.y);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const label = `${Math.floor(gap.gap_seconds / 60)} 分中断`;
            return (
              <g key={`gap-${gap.id}`} opacity={active ? 0.95 : 0.25}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#B4442C"
                  strokeWidth={active ? 1.6 : 1.1}
                  strokeDasharray="6 5"
                />
                {active && (
                  <g transform={`translate(${mx}, ${my})`}>
                    <rect x="-41" y="-12" width="82" height="19" rx="9.5" fill="#FFF9F4" stroke="#E0B7A8" strokeWidth="0.9" />
                    <text x="0" y="1.8" textAnchor="middle" fontSize="9" fontWeight="650" fill="#A64B32">
                      {label}
                    </text>
                  </g>
                )}
              </g>
            );
          });
        })}

        {/* Points */}
        {analysis.tracks.map((track) => {
          const isMainVehicle = selectedStay
            ? selectedStay.vehicle_id === track.vehicle_id
            : selectedVehicleId === "all" || selectedVehicleId === track.vehicle_id;
          return track.points.map((point) => {
            const [sx, sy] = project(point.x, point.y);
            if (sx < -20 || sy < -20 || sx > size.width + 20 || sy > size.height + 20) {
              return null;
            }
            const sample = isMainVehicle ? sampleById.get(point.id) : undefined;
            const opacity = isMainVehicle ? 1 : 0.24;
            if (!point.valid) {
              const conflict = point.issue === "timestamp_conflict";
              return (
                <g key={`pt-${point.id}`} opacity={selectedVehicleId === "all" || selectedVehicleId === track.vehicle_id || isMainVehicle ? 1 : 0.4}>
                  {conflict ? (
                    <g stroke="#B4442C" strokeWidth="1.8">
                      <line x1={sx - 4} y1={sy - 4} x2={sx + 4} y2={sy + 4} />
                      <line x1={sx + 4} y1={sy - 4} x2={sx - 4} y2={sy + 4} />
                    </g>
                  ) : (
                    <circle cx={sx} cy={sy} r="4.6" fill="none" stroke="#AE9670" strokeWidth="1.2" strokeDasharray="2.2 1.7" />
                  )}
                  <circle
                    cx={sx}
                    cy={sy}
                    r="8"
                    fill="transparent"
                    onMouseEnter={(event) => handlePointHover(event, point, track)}
                    onMouseLeave={() => setHovered(null)}
                  />
                </g>
              );
            }
            const color = sample ? CLASS_COLOR[sample.classification] : track.color;
            const radius = sample ? 4.5 : isMainVehicle ? 2.7 : 1.8;
            return (
              <g key={`pt-${point.id}`} opacity={opacity}>
                {sample && <circle cx={sx} cy={sy} r={radius + 1.3} fill="#FFFDF8" opacity="0.9" />}
                <circle cx={sx} cy={sy} r={radius} fill={color} stroke={sample ? "#FFFDF8" : "none"} strokeWidth={sample ? 0.8 : 0} />
                <circle
                  cx={sx}
                  cy={sy}
                  r="9"
                  fill="transparent"
                  onMouseEnter={(event) => handlePointHover(event, point, track)}
                  onMouseLeave={() => setHovered(null)}
                />
              </g>
            );
          });
        })}

        {/* Entry / exit pair evidence */}
        {selectedStay && (
          <StayMarkers
            stay={selectedStay}
            track={selectedTrack}
            project={project}
            width={size.width}
            height={size.height}
          />
        )}
      </svg>

      <div className="map-overlay-top-left">
        <div className="map-kicker">
          <span className="live-dot" />
          本地空间画布
          <span className="map-kicker-sep" />
          无在线底图
        </div>
        <div className="map-title-row">
          <h1>场站围栏与车辆轨迹</h1>
          <span className="map-count">{analysis.geofences.length} 围栏 · {analysis.tracks.length} 轨迹</span>
        </div>
        <div className="map-subline">
          {selectedStay
            ? `${selectedStay.geofence_name} · ${vehicleShort(selectedStay.vehicle_label)} · 判定窗口`
            : selectedVehicleId === "all"
              ? "当前显示全部场站、全部车辆与信号中断位置"
              : `${vehicleShort(analysis.tracks.find((track) => track.vehicle_id === selectedVehicleId)?.label ?? "")} · 单轨迹视图`}
        </div>
      </div>

      <div className="map-tools" data-no-pan>
        <button type="button" className="map-tool" onClick={() => zoomAt(1.28, size.width / 2, size.height / 2)} title="放大">
          <Icon name="plus" size={17} />
        </button>
        <button type="button" className="map-tool" onClick={() => zoomAt(1 / 1.28, size.width / 2, size.height / 2)} title="缩小">
          <Icon name="minus" size={17} />
        </button>
        <span className="map-tool-rule" />
        <button type="button" className="map-tool" onClick={handleFit} title="适应视图">
          <Icon name="fit" size={17} />
        </button>
      </div>

      <div className="map-compass" aria-hidden="true">
        <span>N</span>
        <svg width="22" height="30" viewBox="0 0 22 30">
          <path d="M11 2L16 21L11 17L6 21L11 2Z" fill="#46574E" />
          <path d="M11 2L11 17L6 21L11 2Z" fill="#8A978C" />
        </svg>
      </div>

      <div className="map-legend">
        <div className="legend-row">
          {analysis.geofences.map((fence) => (
            <span className="legend-item" key={fence.id}>
              <i style={{ background: fence.color }} />
              {fence.name}
            </span>
          ))}
        </div>
        <div className="legend-row legend-secondary">
          <span className="legend-star"><i className="valid" />有效点</span>
          <span className="legend-star"><i className="buffer" />10m 缓冲</span>
          <span className="legend-star"><i className="invalid" />冲突点</span>
          <span className="legend-star"><i className="gap" />信号中断</span>
        </div>
        <div className="legend-note">虚线轮廓 = 10 米缓冲；内部斜线区域按场站外处理</div>
      </div>

      <div className="map-scale-card">
        <div className="scale-bar-wrap">
          <span className="scale-caption">比例</span>
          <div className="scale-bar">
            <span className="scale-tick" />
            <span className="scale-line" style={{ width: `${Math.round(scaleBar.pixels)}px` }} />
            <span className="scale-tick" />
          </div>
          <span className="scale-value">{scaleBar.metres >= 1000 ? `${scaleBar.metres / 1000} km` : `${scaleBar.metres} m`}</span>
        </div>
        <span className="map-crs">AEQD / m · EPSG:4326 → 本地</span>
      </div>

      {hovered && (
        <div className="map-tooltip" style={{ left: hovered.left, top: hovered.top }}>
          <div className="tooltip-head">
            <span className={`tooltip-dot ${hovered.point.valid ? "ok" : "bad"}`} />
            <strong>{hovered.track.vehicle_id}</strong>
            <span>{formatTime(hovered.point.timestamp)}</span>
          </div>
          <div className="tooltip-meta">
            {hovered.sample ? (
              <span className={`tooltip-class class-${hovered.sample.classification}`}>
                {CLASS_LABEL[hovered.sample.classification]}
              </span>
            ) : !hovered.point.valid ? (
              <span className="tooltip-class class-bad">
                {hovered.point.issue === "duplicate" ? "重复点 · 已合并" : "同时刻位置冲突"}
              </span>
            ) : (
              <span className="tooltip-class">有效 GPS 点</span>
            )}
            {hovered.sample?.gap_seconds != null && (
              <span className="tooltip-gap">Δ {hovered.sample.gap_seconds}s</span>
            )}
          </div>
          <div className="tooltip-coords">
            <span>seq {hovered.point.sequence ?? "—"}</span>
            <span>{hovered.point.x.toFixed(1)} / {hovered.point.y.toFixed(1)} m</span>
          </div>
        </div>
      )}
    </div>
  );
}

function buildSegments(track: Track, gapBreakSeconds: number): TrackPoint[][] {
  const points = track.points.filter((point) => point.valid);
  if (points.length < 2) return [];
  const segments: TrackPoint[][] = [[points[0]]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const gap =
      (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000;
    if (gap >= gapBreakSeconds) {
      segments.push([current]);
    } else {
      segments[segments.length - 1].push(current);
    }
  }
  return segments.filter((segment) => segment.length > 1);
}

function FenceLabel({
  fence,
  selected,
  project,
}: {
  fence: Geofence;
  selected: boolean;
  project: (x: number, y: number) => [number, number];
}) {
  const [x, y] = project(fence.centroid.x, fence.centroid.y);
  const hasOverlap = fence.overlaps.length > 0;
  const labelWidth = Math.max(fence.name.length * 13 + 36, hasOverlap ? 143 : 0);
  return (
    <g transform={`translate(${x - labelWidth / 2}, ${y - 31})`} pointerEvents="none">
      <rect
        width={labelWidth}
        height={hasOverlap ? 40 : 27}
        rx="6"
        fill="#FFFCF5"
        fillOpacity="0.94"
        stroke={selected ? fence.color : "#CFC7B7"}
        strokeWidth={selected ? 1.5 : 0.8}
      />
      <rect width="4" height={hasOverlap ? 40 : 27} rx="2" fill={fence.color} />
      <circle cx="13" cy="13.5" r="3.1" fill={fence.color} />
      <text x="21" y="17.4" fontSize="10.5" fontWeight="650" fill="#23362F">
        {fence.name}
      </text>
      {hasOverlap && (
        <text x="21" y="31.5" fontSize="8" fill="#8A7E6C" letterSpacing="0.03em">
          重叠 {fence.overlaps.length} 座 · {formatArea(fence.area_m2)}
        </text>
      )}
    </g>
  );
}

function StayMarkers({
  stay,
  track,
  project,
  width,
  height,
}: {
  stay: Stay;
  track: Track | null;
  project: (x: number, y: number) => [number, number];
  width: number;
  height: number;
}) {
  if (!track) return null;
  const entryPair = stay.entry_pair_ids ?? [];
  const exitPair = stay.exit_pair_ids ?? [];
  const entrySecond = entryPair[1]
    ? track.points.find((point) => point.id === entryPair[1])
    : null;
  const exitSecond = exitPair[1]
    ? track.points.find((point) => point.id === exitPair[1])
    : null;
  const exitPoint = stay.exit_trigger;
  const lastPoint = stay.last_seen_point;

  const entry = project(stay.entry_trigger.x, stay.entry_trigger.y);
  const second = entrySecond ? project(entrySecond.x, entrySecond.y) : null;
  const exit = exitPoint ? project(exitPoint.x, exitPoint.y) : null;
  const last = project(lastPoint.x, lastPoint.y);
  const exitSuffix = exitSecond ? project(exitSecond.x, exitSecond.y) : null;

  const entryLabelX = entry[0] > width - 206 ? entry[0] - 164 : entry[0] + 17;
  const entryLabelY = clamp(entry[1] - 42, 28, height - 130);
  const exitLabelX = exit
    ? exit[0] > width - 206
      ? exit[0] - 164
      : exit[0] + 17
    : last[0] + 17;
  const exitLabelY = exit
    ? clamp(exit[1] + 20, 48, height - 68)
    : clamp(last[1] - 30, 28, height - 86);

  return (
    <g>
      {exit && (
        <line
          x1={entry[0]}
          y1={entry[1]}
          x2={exit[0]}
          y2={exit[1]}
          stroke={stay.geofence_color}
          strokeWidth="1"
          opacity="0.2"
        />
      )}
      {second && (
        <g>
          <line x1={entry[0]} y1={entry[1]} x2={second[0]} y2={second[1]} stroke="#CBAE92" strokeWidth="1" strokeDasharray="3 2" />
          <circle cx={second[0]} cy={second[1]} r="5" fill="#FFFCF6" stroke="#947A5D" strokeWidth="1.3" />
          <text x={second[0]} y={second[1] + 2.8} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#7E674E">2</text>
        </g>
      )}
      {exitSuffix && (
        <g>
          <line x1={exit![0]} y1={exit![1]} x2={exitSuffix[0]} y2={exitSuffix[1]} stroke="#CBAEA2" strokeWidth="1" strokeDasharray="3 2" />
          <circle cx={exitSuffix[0]} cy={exitSuffix[1]} r="4.2" fill="#FFFCF6" stroke="#A67C6E" strokeWidth="1.1" />
          <text x={exitSuffix[0]} y={exitSuffix[1] + 2.6} textAnchor="middle" fontSize="7" fontWeight="700" fill="#7E584E">2</text>
        </g>
      )}

      <g filter="url(#marker-shadow)">
        <circle cx={entry[0]} cy={entry[1]} r="9.5" fill="#0F766E" stroke="#FFFDF8" strokeWidth="2.3" />
        <path
          d={`M ${entry[0] - 3.8} ${entry[1] - 3.8} L ${entry[0] + 2.6} ${entry[1]} L ${entry[0] - 3.8} ${entry[1] + 3.8} Z`}
          fill="#FFFDF8"
        />
      </g>
      <g transform={`translate(${entryLabelX}, ${entryLabelY})`} filter="url(#marker-shadow)">
        <rect width="151" height="40" rx="7" fill="#FFFDF8" stroke="#A8C8BE" strokeWidth="1" />
        <rect x="0" y="0" width="3" height="40" rx="1.5" fill="#0F766E" />
        <text x="11" y="15" fontSize="8" fontWeight="700" letterSpacing="0.08em" fill="#6C7C74">进入 · 时间回记</text>
        <text x="11" y="30" fontSize="12.5" fontWeight="700" fill="#1F3730" fontFamily="ui-monospace, monospace">
          {formatTime(stay.entry_trigger.timestamp)}
        </text>
        <text x="102" y="30" fontSize="8.5" fill="#8A7C68">
          +{stay.entry_gap_seconds}s
        </text>
      </g>
      {(exit || stay.status !== "complete") && (
        <g filter="url(#marker-shadow)">
          {exit ? (
            <>
              <circle cx={exit[0]} cy={exit[1]} r="9.5" fill="#B4523B" stroke="#FFFDF8" strokeWidth="2.3" />
              <path d={`M ${exit[0] - 3.2} ${exit[1] - 4} L ${exit[0] + 3.3} ${exit[1] - 4} L ${exit[0] + 3.3} ${exit[1] + 2} L ${exit[0] - 3.2} ${exit[1] + 2} Z`} fill="#FFFDF8" />
            </>
          ) : (
            <>
              <circle cx={last[0]} cy={last[1]} r="8.5" fill={stay.status === "ongoing" ? "#356D8D" : "#A87929"} stroke="#FFFDF8" strokeWidth="2" />
              <path d={`M ${last[0] - 3} ${last[1]} L ${last[0] + 3} ${last[1]} M ${last[0]} ${last[1] - 3} L ${last[0]} ${last[1] + 3}`} stroke="#FFFDF8" strokeWidth="1.4" />
            </>
          )}
        </g>
      )}
      <g transform={`translate(${exitLabelX}, ${exitLabelY})`} filter="url(#marker-shadow)">
        {exit ? (
          <>
            <rect width="155" height="39" rx="7" fill="#FFFDF8" stroke="#D8B3A6" strokeWidth="1" />
            <rect x="0" y="0" width="3" height="39" rx="1.5" fill="#B4523B" />
            <text x="11" y="14.5" fontSize="8" fontWeight="700" letterSpacing="0.08em" fill="#8B7067">退出 · 时间回记</text>
            <text x="11" y="29.5" fontSize="12.5" fontWeight="700" fill="#1F3730" fontFamily="ui-monospace, monospace">
              {formatTime(exitPoint?.timestamp)}
            </text>
            <text x="105" y="29.5" fontSize="8.5" fill="#8A7C68">+{stay.exit_gap_seconds}s</text>
          </>
        ) : (
          <>
            <rect width="155" height="39" rx="7" fill="#FFFDF8" stroke="#D2C5AA" strokeWidth="1" />
            <rect x="0" y="0" width="3" height="39" rx="1.5" fill={stay.status === "ongoing" ? "#356D8D" : "#A87929"} />
            <text x="11" y="14.5" fontSize="8" fontWeight="700" letterSpacing="0.08em" fill="#8B7866">
              {stay.status === "ongoing" ? "轨迹结束 · 进行中" : "断档前最后点"}
            </text>
            <text x="11" y="29.5" fontSize="12.5" fontWeight="700" fill="#1F3730" fontFamily="ui-monospace, monospace">
              {formatTime(lastPoint.timestamp)}
            </text>
          </>
        )}
      </g>
    </g>
  );
}
