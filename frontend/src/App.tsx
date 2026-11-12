import { useCallback, useEffect, useMemo, useState } from "react";
import type { Analysis, Dataset, FocusRequest, GeoJSONFeatureCollection, Stay, StayStatus } from "./types";
import { fetchDemo, analyzeGeojson } from "./lib/api";
import {
  formatDateCN,
  formatDuration,
  formatDurationCompact,
  formatTimeShort,
  vehicleRole,
  vehicleShort,
} from "./lib/format";
import { BrandMark, Icon } from "./components/Icon";
import { MapCanvas } from "./components/MapCanvas";
import { DetailPanel } from "./components/DetailPanel";
import { ImportDialog } from "./components/ImportDialog";
import { QualityDialog } from "./components/QualityDialog";
import { RulesDialog } from "./components/RulesDialog";
import { StatusBadge } from "./components/StatusBadge";

type StatusFilter = "all" | StayStatus;
type ToastState = { message: string; tone: "success" | "info" };

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "complete", label: "完整" },
  { key: "incomplete", label: "不完整" },
  { key: "ongoing", label: "进行中" },
];

export function App() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStayId, setSelectedStayId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [focus, setFocus] = useState<FocusRequest>({ kind: "all", nonce: 0 });
  const [importOpen, setImportOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [imported, setImported] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const applyDataset = useCallback((nextDataset: Dataset, nextAnalysis: Analysis, importedSource = false) => {
    setDataset(nextDataset);
    setAnalysis(nextAnalysis);
    setSelectedVehicleId("all");
    setStatusFilter("all");
    const preferred =
      nextAnalysis.stays.find((stay) => stay.status === "complete") ?? nextAnalysis.stays[0] ?? null;
    setSelectedStayId(preferred?.id ?? null);
    setImported(importedSource);
    setFocus((previous) => ({ kind: "all", nonce: previous.nonce + 1 }));
  }, []);

  const loadDemo = useCallback(async (restore = false) => {
    setLoading(true);
    setBootError(null);
    try {
      const data = await fetchDemo();
      applyDataset(data.dataset, data.analysis, false);
      if (restore) setToast({ message: "已恢复内置四场景示例场站与轨迹", tone: "info" });
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "无法连接分析服务");
    } finally {
      setLoading(false);
    }
  }, [applyDataset]);

  useEffect(() => {
    void loadDemo();
  }, [loadDemo]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedStay = useMemo(
    () => analysis?.stays.find((stay) => stay.id === selectedStayId) ?? null,
    [analysis, selectedStayId],
  );

  const sortedStays = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.stays].sort(
      (left, right) => new Date(left.enter_time).getTime() - new Date(right.enter_time).getTime(),
    );
  }, [analysis]);

  const filteredStays = useMemo(() => {
    return sortedStays.filter((stay) => {
      if (selectedVehicleId !== "all" && stay.vehicle_id !== selectedVehicleId) return false;
      if (statusFilter !== "all" && stay.status !== statusFilter) return false;
      return true;
    });
  }, [sortedStays, selectedVehicleId, statusFilter]);

  const requestFocusAll = () => {
    setFocus((previous) => ({ kind: "all", nonce: previous.nonce + 1 }));
  };

  const selectStay = (stay: Stay) => {
    setSelectedStayId(stay.id);
    setFocus((previous) => ({ kind: "stay", stayId: stay.id, nonce: previous.nonce + 1 }));
  };

  const selectVehicle = (vehicleId: string | "all") => {
    setSelectedVehicleId(vehicleId);
    setStatusFilter("all");
    if (selectedStay && vehicleId !== "all" && selectedStay.vehicle_id !== vehicleId) {
      setSelectedStayId(null);
    }
    if (vehicleId === "all") requestFocusAll();
    else setFocus((previous) => ({ kind: "vehicle", vehicleId, nonce: previous.nonce + 1 }));
  };

  const focusSelectedStay = () => {
    if (!selectedStay) return;
    setFocus((previous) => ({ kind: "stay", stayId: selectedStay.id, nonce: previous.nonce + 1 }));
  };

  const handleImport = async (geojson: Record<string, unknown>, filename: string) => {
    if (!dataset) return;
    setImportBusy(true);
    try {
      const nextAnalysis = await analyzeGeojson(geojson, dataset.tracks);
      const name = filename.replace(/\.(geojson|json)$/i, "");
      const nextDataset: Dataset = {
        ...dataset,
        name,
        region: "自定义围栏",
        description: `从 ${filename} 导入 · 使用当前四组场景轨迹重新计算`,
        geojson: geojson as unknown as GeoJSONFeatureCollection,
      };
      applyDataset(nextDataset, nextAnalysis, true);
      setImportOpen(false);
      setToast({
        message: nextAnalysis.stays.length
          ? `已导入 ${nextAnalysis.geofences.length} 座围栏，识别 ${nextAnalysis.stays.length} 条驻留记录`
          : `已导入 ${nextAnalysis.geofences.length} 座围栏，当前轨迹未落在新围栏内`,
        tone: "success",
      });
    } finally {
      setImportBusy(false);
    }
  };

  const inspectVehicleFromQuality = (vehicleId: string) => {
    setQualityOpen(false);
    selectVehicle(vehicleId);
  };

  if (loading && !analysis) {
    return (
      <div className="boot-screen">
        <div className="boot-grid" />
        <div className="boot-mark"><BrandMark size={56} /></div>
        <span className="boot-kicker">GEOFENCE DWELL ENGINE</span>
        <h1>正在建立本地空间画布</h1>
        <p>解析围栏几何 · 投影米制平面 · 回放 GPS 轨迹</p>
        <div className="boot-progress"><span /></div>
        <div className="boot-foot">SVG LOCAL RENDER <i /> SHAPELY + PYPROJ <i /> FASTAPI</div>
      </div>
    );
  }

  if (bootError || !analysis || !dataset) {
    return (
      <div className="boot-screen boot-error">
        <div className="boot-mark"><BrandMark size={56} /></div>
        <span className="boot-kicker">SERVICE UNAVAILABLE</span>
        <h1>无法载入分析数据</h1>
        <p>{bootError ?? "分析服务没有返回可用数据。"}</p>
        <button type="button" className="button primary" onClick={() => void loadDemo()}>
          <Icon name="refresh" size={16} />
          重试连接
        </button>
      </div>
    );
  }

  const stats = analysis.statistics;
  const completeAverage = formatDurationCompact(stats.average_complete_seconds);
  const averageDetail = formatDuration(stats.average_complete_seconds);
  const activeVehicle = analysis.tracks.find((track) => track.vehicle_id === selectedVehicleId);
  const metricAll = stats.total_points;
  const excluded = stats.incomplete_stays + stats.ongoing_stays;

  const countFor = (filter: StatusFilter) => {
    const scoped =
      selectedVehicleId === "all"
        ? sortedStays
        : sortedStays.filter((stay) => stay.vehicle_id === selectedVehicleId);
    if (filter === "all") return scoped.length;
    return scoped.filter((stay) => stay.status === filter).length;
  };

  return (
    <div className={`app ${selectedStay ? "has-detail" : "no-detail"}`}>
      <header className="app-header">
        <div className="brand-block">
          <BrandMark size={42} />
          <div className="brand-copy">
            <span className="brand-eyebrow">GEOFENCE DWELL INTELLIGENCE</span>
            <h1>场站驻留研判台</h1>
          </div>
        </div>

        <div className="header-center">
          <span className="header-context-label">当前场景</span>
          <strong>{dataset.name}</strong>
          <span className="header-sep" />
          <span className="header-context-meta">{dataset.region} · {formatDateCN(dataset.date)}</span>
        </div>

        <div className="header-actions">
          <div className="engine-status">
            <span className="live-dot" />
            {loading ? "重算中" : "分析就绪"}
          </div>
          <button type="button" className="header-link" onClick={() => setRulesOpen(true)}>
            <Icon name="info" size={14} />
            判定口径
          </button>
          <button
            type="button"
            className="header-icon-button"
            onClick={() => void loadDemo(true)}
            title="恢复内置示例"
            disabled={loading}
          >
            <Icon name="rotate" size={16} />
          </button>
          <a className="header-icon-button" href="/docs" target="_blank" rel="noreferrer" title="API 文档">
            <Icon name="external" size={15} />
          </a>
          <button type="button" className="button primary header-import" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={15} />
            导入围栏
          </button>
        </div>
      </header>

      <main className={`workspace ${selectedStay ? "has-detail" : ""}`}>
        <aside className="left-rail">
          <div className="rail-scroll">
            <section className="scene-block">
              <div className="rail-overline">
                <span className="live-dot" />
                CURRENT SCENE
                <span className="rail-overline-right">WGS 84</span>
              </div>
              <div className="scene-title-row">
                <h2>{dataset.name}</h2>
                {imported && <span className="imported-badge">已导入</span>}
              </div>
              <div className="scene-meta-row">
                <span>{dataset.region}</span>
                <span className="dot-sep" />
                <span>{formatDateCN(dataset.date)}</span>
                <span className="dot-sep" />
                <span>{metricAll} 个点</span>
              </div>
              <button type="button" className="quality-summary" onClick={() => setQualityOpen(true)}>
                <span className={`quality-status ${stats.anomaly_groups ? "warn" : "ok"}`}>
                  <Icon name={stats.anomaly_groups ? "alert" : "shield"} size={13} />
                </span>
                <span className="quality-summary-text">
                  <strong>{stats.valid_points} 有效点</strong>
                  <small>
                    去重 {stats.duplicate_points} · 冲突 {stats.conflict_points} ·
                    {stats.anomaly_groups ? ` ${stats.anomaly_groups} 组异常` : " 质量正常"}
                  </small>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            </section>

            <section className="metric-section">
              <button
                type="button"
                className={`metric-card metric-complete ${statusFilter === "complete" ? "active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === "complete" ? "all" : "complete")}
              >
                <span className="metric-icon"><Icon name="check" size={14} /></span>
                <strong>{stats.complete_stays}</strong>
                <span className="metric-label">完整驻留</span>
                <small>计入平均</small>
              </button>
              <div className="metric-card metric-average">
                <span className="metric-icon"><Icon name="clock" size={14} /></span>
                <strong>{completeAverage}</strong>
                <span className="metric-label">平均时长</span>
                <small>{averageDetail}</small>
              </div>
              <button
                type="button"
                className={`metric-card metric-incomplete ${statusFilter === "incomplete" ? "active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === "incomplete" ? "all" : "incomplete")}
              >
                <strong>{stats.incomplete_stays}</strong>
                <span className="metric-label">不完整</span>
                <small>断档中断</small>
              </button>
              <button
                type="button"
                className={`metric-card metric-ongoing ${statusFilter === "ongoing" ? "active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === "ongoing" ? "all" : "ongoing")}
              >
                <strong>{stats.ongoing_stays}</strong>
                <span className="metric-label">进行中</span>
                <small>尚未离开</small>
              </button>
              <p className="metric-footnote">
                平均仅统计完整驻留；{excluded} 条未完成记录已排除。
              </p>
            </section>

            <section className="vehicle-section">
              <div className="section-head">
                <div>
                  <span className="rail-overline">TRACK SCENARIOS</span>
                  <h3>轨迹场景</h3>
                </div>
                <button
                  type="button"
                  className={`all-vehicles-button ${selectedVehicleId === "all" ? "active" : ""}`}
                  onClick={() => selectVehicle("all")}
                >
                  全部
                </button>
              </div>
              <div className="vehicle-grid">
                {analysis.tracks.map((track) => {
                  const active = selectedVehicleId === track.vehicle_id;
                  return (
                    <button
                      type="button"
                      key={track.vehicle_id}
                      className={`vehicle-card ${active ? "active" : ""}`}
                      onClick={() => selectVehicle(track.vehicle_id)}
                      title={track.description}
                      style={{ borderColor: active ? track.color : undefined }}
                    >
                      <span className="vehicle-card-top">
                        <i className="vehicle-dot" style={{ background: track.color }} />
                        <strong>{vehicleShort(track.label)}</strong>
                        {track.quality.conflict > 0 && <Icon name="alert" size={11} className="vehicle-warn" />}
                        {track.quality.gaps > 0 && <Icon name="signal" size={11} className="vehicle-gap" />}
                      </span>
                      <span className="vehicle-scenario">{track.scenario}</span>
                      <span className="vehicle-card-meta">
                        {vehicleRole(track.label) || "园区车辆"} · {track.stay_count} 条记录
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="stays-section">
              <div className="section-head stays-head">
                <div>
                  <span className="rail-overline">DWELL RECORDS</span>
                  <h3>驻留记录 <span className="count-badge">{filteredStays.length}</span></h3>
                </div>
                {(selectedVehicleId !== "all" || statusFilter !== "all") && (
                  <button type="button" className="clear-filter" onClick={() => { setSelectedVehicleId("all"); setStatusFilter("all"); requestFocusAll(); }}>
                    清除
                  </button>
                )}
              </div>
              <div className="stay-filters">
                {FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.key}
                    className={statusFilter === filter.key ? "active" : ""}
                    onClick={() => setStatusFilter(filter.key)}
                  >
                    {filter.label}
                    <span>{countFor(filter.key)}</span>
                  </button>
                ))}
              </div>

              {filteredStays.length ? (
                <div className="stay-list">
                  {filteredStays.map((stay) => (
                    <StayRow
                      key={stay.id}
                      stay={stay}
                      selected={selectedStayId === stay.id}
                      onSelect={() => selectStay(stay)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span><Icon name="search" size={19} /></span>
                  <strong>没有匹配的驻留记录</strong>
                  <p>尝试切换车辆或状态筛选。当前筛选条件不会修改分析结果。</p>
                </div>
              )}
            </section>
          </div>
        </aside>

        <section className="map-region">
          <MapCanvas
            analysis={analysis}
            selectedStay={selectedStay}
            selectedVehicleId={selectedVehicleId}
            focus={focus}
          />
          <div className="map-corner-note">
            <span className="corner-live" />
            {activeVehicle ? activeVehicle.scenario : "全场景"}
            <span className="corner-divider" />
            本地 SVG 绘制
          </div>
        </section>

        {selectedStay && (
          <DetailPanel
            analysis={analysis}
            stay={selectedStay}
            onClose={() => setSelectedStayId(null)}
            onFocus={focusSelectedStay}
            onSelectStay={(stayId) => {
              const stay = analysis.stays.find((item) => item.id === stayId);
              if (stay) selectStay(stay);
            }}
            onOpenQuality={() => setQualityOpen(true)}
          />
        )}
      </main>

      <ImportDialog
        open={importOpen}
        busy={importBusy}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />
      <QualityDialog
        open={qualityOpen}
        anomalies={analysis.anomalies}
        tracks={analysis.tracks}
        onClose={() => setQualityOpen(false)}
        onInspectVehicle={inspectVehicleFromQuality}
      />
      <RulesDialog open={rulesOpen} analysis={analysis} onClose={() => setRulesOpen(false)} />

      {toast && (
        <div className={`toast toast-${toast.tone}`}>
          <span className="toast-icon">
            <Icon name={toast.tone === "success" ? "check" : "info"} size={15} />
          </span>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function StayRow({ stay, selected, onSelect }: { stay: Stay; selected: boolean; onSelect: () => void }) {
  const tags = stayHints(stay);
  return (
    <button
      type="button"
      className={`stay-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <span className="stay-color" style={{ background: stay.geofence_color }} />
      <span className="stay-main">
        <span className="stay-topline">
          <strong>{stay.geofence_name}</strong>
          <StatusBadge status={stay.status} compact />
        </span>
        <span className="stay-vehicle-line">
          <i style={{ background: stay.vehicle_color }} />
          {vehicleShort(stay.vehicle_label)}
          <span className="stay-time-range">
            {formatTimeShort(stay.enter_time)}
            <span>–</span>
            {stay.exit_time ? formatTimeShort(stay.exit_time) : "未结束"}
          </span>
        </span>
        <span className="stay-bottomline">
          <span className="stay-duration">{formatDurationCompact(stay.duration_seconds)}</span>
          <span className="stay-tags">
            {tags.map((tag) => <em key={tag.label} className={tag.tone}>{tag.label}</em>)}
          </span>
          <Icon name="chevron-right" size={14} className="stay-chevron" />
        </span>
      </span>
    </button>
  );
}

function stayHints(stay: Stay): { label: string; tone: string }[] {
  if (stay.status === "incomplete") return [{ label: "断档 · 不计均值", tone: "warn" }, { label: "不跨缺口", tone: "" }];
  if (stay.status === "ongoing") return [{ label: "未离场 · 不计均值", tone: "info" }, { label: "持续中", tone: "" }];
  const hints: { label: string; tone: string }[] = [];
  if (stay.events.some((event) => event.type === "buffer_hold")) hints.push({ label: "缓冲保持", tone: "warn" });
  if (stay.events.some((event) => event.type === "hole_outside")) hints.push({ label: "空洞场外", tone: "violet" });
  if (stay.concurrent_stay_ids.length > 0) hints.push({ label: "重叠独立", tone: "" });
  if (!hints.length) hints.push({ label: "双点确认", tone: "ok" });
  return hints.slice(0, 2);
}
