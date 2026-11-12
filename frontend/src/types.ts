export type StayStatus = "complete" | "incomplete" | "ongoing";

export interface TrackPoint {
  id: string;
  timestamp: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  valid: boolean;
  issue: "duplicate" | "timestamp_conflict" | null;
  sequence: number | null;
}

export interface TrackGap {
  id: string;
  after_point_id: string;
  before_point_id: string;
  start_time: string;
  end_time: string;
  gap_seconds: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  breaks_stay: boolean;
  affected_stay_ids: string[];
}

export interface Track {
  vehicle_id: string;
  label: string;
  scenario: string;
  description: string;
  color: string;
  points: TrackPoint[];
  gaps: TrackGap[];
  quality: {
    input: number;
    valid: number;
    duplicate: number;
    conflict: number;
    gaps: number;
  };
  stay_count: number;
  stay_counts: Record<StayStatus, number>;
  average_complete_seconds: number;
}

export interface PolygonGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface Geofence {
  id: string;
  name: string;
  description: string;
  color: string;
  geometry: PolygonGeometry;
  buffer_geometry: PolygonGeometry;
  centroid: { x: number; y: number };
  bounds: [number, number, number, number];
  area_m2: number;
  overlaps: string[];
}

export interface TriggerPoint {
  id: string;
  timestamp: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  sequence: number | null;
}

export type Classification = "inside" | "buffer" | "outside" | "hole";

export interface StaySample extends TriggerPoint {
  classification: Classification;
  gap_seconds: number | null;
  action: string;
}

export interface StayEvent {
  type: string;
  severity: "success" | "warning" | "danger" | "info";
  timestamp: string;
  point_id: string;
  evidence_ids: string[];
  title: string;
  detail: string;
  metric: string;
  next_point_id?: string;
}

export interface Stay {
  id: string;
  vehicle_id: string;
  vehicle_label: string;
  vehicle_color: string;
  vehicle_scenario: string;
  geofence_id: string;
  geofence_name: string;
  geofence_color: string;
  status: StayStatus;
  status_label: string;
  status_note: string;
  enter_time: string;
  exit_time: string | null;
  last_seen_time: string;
  duration_seconds: number;
  observed_duration_seconds: number;
  entry_point_id: string;
  exit_point_id: string | null;
  entry_trigger: TriggerPoint;
  exit_trigger: TriggerPoint | null;
  last_seen_point: TriggerPoint;
  entry_pair_ids: string[];
  exit_pair_ids: string[] | null;
  entry_gap_seconds: number;
  exit_gap_seconds: number | null;
  samples: StaySample[];
  events: StayEvent[];
  rule_tags: string[];
  break_gap: {
    after_point_id: string;
    before_point_id: string;
    gap_seconds: number;
  } | null;
  geofence_overlaps: string[];
  concurrent_stay_ids: string[];
}

export interface Anomaly {
  id: string;
  kind: "duplicate" | "timestamp_conflict";
  severity: "info" | "warning";
  vehicle_id: string;
  timestamp: string;
  point_ids: string[];
  retained_point_id: string | null;
  message: string;
  detail: string;
  coordinates?: { lon: number; lat: number }[];
}

export interface Statistics {
  total_points: number;
  valid_points: number;
  duplicate_points: number;
  conflict_points: number;
  anomaly_groups: number;
  total_stays: number;
  complete_stays: number;
  incomplete_stays: number;
  ongoing_stays: number;
  average_complete_seconds: number;
  total_vehicles: number;
  total_fences: number;
  per_fence: {
    geofence_id: string;
    stay_count: number;
    complete_count: number;
    average_complete_seconds: number;
  }[];
}

export interface Analysis {
  generated_at: string;
  projection: {
    name: string;
    crs: string;
    lon_0: number;
    lat_0: number;
    units: string;
    description: string;
  };
  options: {
    buffer_m: number;
    enter_confirm_seconds: number;
    exit_confirm_seconds: number;
    gap_break_seconds: number;
  };
  geofences: Geofence[];
  tracks: Track[];
  stays: Stay[];
  anomalies: Anomaly[];
  statistics: Statistics;
}

export interface RawTrackPoint {
  id?: string;
  timestamp: string;
  lon: number;
  lat: number;
}

export interface RawTrack {
  vehicle_id: string;
  label?: string;
  scenario?: string;
  color?: string;
  description?: string;
  points: RawTrackPoint[];
}

export interface Dataset {
  name: string;
  region: string;
  date: string;
  description: string;
  geojson: GeoJSONFeatureCollection;
  tracks: RawTrack[];
}

export interface GeoJSONFeature {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  name?: string;
  features: GeoJSONFeature[];
}

export interface DemoResponse {
  dataset: Dataset;
  analysis: Analysis;
}

export type FocusRequest =
  | { kind: "all"; nonce: number }
  | { kind: "stay"; stayId: string; nonce: number }
  | { kind: "vehicle"; vehicleId: string; nonce: number };
