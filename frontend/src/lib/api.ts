import type { Analysis, DemoResponse, GeoJSONFeatureCollection, RawTrack } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") message = payload.detail;
      else if (Array.isArray(payload.errors) && payload.errors[0]?.msg) {
        message = payload.errors[0].msg;
      }
    } catch {
      // Keep the HTTP fallback when the body is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export function fetchDemo(): Promise<DemoResponse> {
  return request<DemoResponse>("/api/demo");
}

export function analyzeGeojson(
  geojson: GeoJSONFeatureCollection | Record<string, unknown>,
  tracks: RawTrack[],
): Promise<Analysis> {
  return request<Analysis>("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ geojson, tracks }),
  });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
