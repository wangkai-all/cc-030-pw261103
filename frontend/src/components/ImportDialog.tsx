import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

interface ImportDialogProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onImport: (geojson: Record<string, unknown>, filename: string) => Promise<void>;
}

interface Preview {
  filename: string;
  size: number;
  kind: string;
  featureCount: number;
  names: string[];
  hasHoles: boolean;
  geometryTypes: string[];
}

function inspectGeojson(value: unknown, filename: string, size: number): Preview {
  if (!value || typeof value !== "object") {
    throw new Error("文件内容不是有效的 JSON 对象。");
  }
  const candidate = value as Record<string, unknown>;
  const kind = String(candidate.type ?? "Unknown");
  let features: Record<string, unknown>[] = [];
  if (kind === "FeatureCollection") {
    if (!Array.isArray(candidate.features)) throw new Error("FeatureCollection 缺少 features 数组。");
    features = candidate.features as Record<string, unknown>[];
  } else if (kind === "Feature") {
    features = [candidate];
  } else if (kind === "Polygon" || kind === "MultiPolygon") {
    features = [{ type: "Feature", properties: {}, geometry: candidate }];
  } else {
    throw new Error("仅支持 GeoJSON FeatureCollection、Feature、Polygon 或 MultiPolygon。");
  }
  if (!features.length) throw new Error("GeoJSON 中没有可导入的场站要素。");

  const names: string[] = [];
  const geometryTypes: string[] = [];
  let hasHoles = false;
  features.forEach((feature, index) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const name = props.name ?? props.station_name ?? props.title;
    if (typeof name === "string" && name.trim()) names.push(name);
    const geometry = feature.geometry as Record<string, unknown> | undefined;
    if (!geometry) return;
    const type = String(geometry.type ?? "");
    geometryTypes.push(type);
    const coordinates = geometry.coordinates;
    if (type === "Polygon" && Array.isArray(coordinates) && coordinates.length > 1) {
      hasHoles = true;
    }
    if (
      type === "MultiPolygon" &&
      Array.isArray(coordinates) &&
      coordinates.some((polygon) => Array.isArray(polygon) && polygon.length > 1)
    ) {
      hasHoles = true;
    }
    if (names.length <= index) names.push(`场站 ${index + 1}`);
  });

  return {
    filename,
    size,
    kind,
    featureCount: features.length,
    names: names.slice(0, 5),
    hasHoles,
    geometryTypes,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImportDialog({ open, busy, onClose, onImport }: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [geojson, setGeojson] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setGeojson(null);
    setError(null);
    setDragActive(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const handleFile = async (file: File) => {
    setError(null);
    setPreview(null);
    setGeojson(null);
    if (!/\.(geojson|json)$/i.test(file.name)) {
      setError("请选择 .geojson 或 .json 文件。");
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const result = inspectGeojson(parsed, file.name, file.size);
      setGeojson(parsed);
      setPreview(result);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "无法读取该文件。");
    }
  };

  const submit = async () => {
    if (!geojson || !preview) return;
    setError(null);
    try {
      await onImport(geojson, preview.filename);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "导入失败。");
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <header className="modal-head">
          <div>
            <span className="micro-label">GEOJSON IMPORT</span>
            <h2 id="import-title">导入场站围栏</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="modal-body">
          <p className="modal-intro">
            围栏以 WGS 84 经纬度导入，分析时统一投影到本地米制平面。导入后将使用当前轨迹重新计算全部驻留记录。
          </p>

          <div className="feature-pills">
            <span><Icon name="grid" size={13} />Polygon / MultiPolygon</span>
            <span><Icon name="layers" size={13} />支持内环空洞</span>
            <span><Icon name="target" size={13} />允许相互重叠</span>
            <span><Icon name="locate" size={13} />WGS 84 经纬度</span>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.currentTarget.value = "";
            }}
          />

          {!preview && (
            <button
              type="button"
              className={`dropzone ${dragActive ? "dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const file = event.dataTransfer.files?.[0];
                if (file) void handleFile(file);
              }}
            >
              <span className="dropzone-icon"><Icon name="upload" size={22} /></span>
              <strong>拖入 GeoJSON，或点击选择文件</strong>
              <small>只在本机读取；不会上传至第三方底图或外部服务</small>
              <span className="dropzone-filetypes">.geojson / .json</span>
            </button>
          )}

          {preview && (
            <div className="import-preview">
              <div className="import-file-row">
                <span className="import-file-icon"><Icon name="file" size={18} /></span>
                <div>
                  <strong>{preview.filename}</strong>
                  <small>{formatBytes(preview.size)} · {preview.kind}</small>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setPreview(null);
                    setGeojson(null);
                    setError(null);
                    inputRef.current?.click();
                  }}
                >
                  重新选择
                </button>
              </div>
              <div className="import-stats">
                <div>
                  <strong>{preview.featureCount}</strong>
                  <span>场站要素</span>
                </div>
                <div>
                  <strong>{preview.hasHoles ? "有" : "无"}</strong>
                  <span>内部空洞</span>
                </div>
                <div>
                  <strong>{new Set(preview.geometryTypes).size > 1 ? "混合" : preview.geometryTypes[0]?.replace("Multi", "Multi ") ?? "—"}</strong>
                  <span>几何类型</span>
                </div>
              </div>
              <div className="import-names">
                <span>场站名称</span>
                <p>{preview.names.join(" · ")}{preview.featureCount > 5 ? ` 等 ${preview.featureCount} 座` : ""}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="inline-error">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </div>
          )}

          <p className="import-footnote">
            <Icon name="info" size={14} />
            若要素未提供 <code>id</code> 或 <code>name</code>，系统将自动生成稳定标识与「场站 N」名称。几何会自动修复为有效多边形。
          </p>
        </div>

        <footer className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => void submit()}
            disabled={!geojson || busy}
          >
            {busy ? <span className="button-spinner" /> : <Icon name="upload" size={15} />}
            {busy ? "正在重算…" : "导入并重新分析"}
          </button>
        </footer>
      </div>
    </div>
  );
}
