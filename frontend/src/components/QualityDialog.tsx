import { useEffect } from "react";
import type { Anomaly, Track } from "../types";
import { formatTime, vehicleShort } from "../lib/format";
import { Icon } from "./Icon";

interface QualityDialogProps {
  open: boolean;
  anomalies: Anomaly[];
  tracks: Track[];
  onClose: () => void;
  onInspectVehicle: (vehicleId: string) => void;
}

export function QualityDialog({
  open,
  anomalies,
  tracks,
  onClose,
  onInspectVehicle,
}: QualityDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal quality-modal" role="dialog" aria-modal="true" aria-labelledby="quality-title">
        <header className="modal-head">
          <div>
            <span className="micro-label">TRACK QUALITY</span>
            <h2 id="quality-title">轨迹质量检查</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body">
          <div className="quality-pipeline">
            <span><b>01</b>按车辆 / 时间排序</span>
            <i><Icon name="arrow-right" size={12} /></i>
            <span><b>02</b>重复点去重</span>
            <i><Icon name="arrow-right" size={12} /></i>
            <span><b>03</b>同时刻冲突点整组剔除</span>
            <i><Icon name="arrow-right" size={12} /></i>
            <span><b>04</b>进入有效点序列</span>
          </div>

          {anomalies.length === 0 ? (
            <div className="quality-empty">
              <span><Icon name="check" size={18} /></span>
              <strong>没有发现重复点或同时刻位置冲突</strong>
              <p>当前轨迹可直接进入驻留判定。</p>
            </div>
          ) : (
            <div className="anomaly-list">
              {anomalies.map((anomaly) => {
                const track = tracks.find((item) => item.vehicle_id === anomaly.vehicle_id);
                return (
                  <article className={`anomaly-card anomaly-${anomaly.kind}`} key={anomaly.id}>
                    <div className="anomaly-head">
                      <span className={`anomaly-badge ${anomaly.kind}`}>
                        <Icon name={anomaly.kind === "duplicate" ? "layers" : "alert"} size={12} />
                        {anomaly.kind === "duplicate" ? "重复点" : "时刻冲突"}
                      </span>
                      <strong>{formatTime(anomaly.timestamp)}</strong>
                      <span className="anomaly-vehicle">
                        {track ? vehicleShort(track.label) : anomaly.vehicle_id}
                      </span>
                    </div>
                    <p>{anomaly.message}</p>
                    <small>{anomaly.detail}</small>
                    <div className="anomaly-points">
                      {anomaly.point_ids.map((id, index) => {
                        const coordinate = anomaly.coordinates?.[index];
                        return (
                          <span key={id}>
                            <code>{id}</code>
                            {coordinate ? (
                              <em>{coordinate.lon.toFixed(6)}, {coordinate.lat.toFixed(6)}</em>
                            ) : (
                              <em>已合并</em>
                            )}
                          </span>
                        );
                      })}
                    </div>
                    {'retained_point_id' in anomaly && anomaly.retained_point_id && (
                      <div className="anomaly-retained">
                        <Icon name="check" size={11} />保留 {anomaly.retained_point_id}
                      </div>
                    )}
                    <button
                      type="button"
                      className="text-button anomaly-focus"
                      onClick={() => onInspectVehicle(anomaly.vehicle_id)}
                    >
                      <Icon name="locate" size={13} />
                      在图上查看该车轨迹
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          <div className="quality-metrics">
            {tracks.map((track) => (
              <div className="quality-track-row" key={track.vehicle_id}>
                <span className="vehicle-dot" style={{ background: track.color }} />
                <strong>{vehicleShort(track.label)}</strong>
                <span>{track.scenario}</span>
                <em>{track.quality.valid} / {track.quality.input} 有效</em>
                {track.quality.duplicate > 0 && <b className="soft-badge">重 {track.quality.duplicate}</b>}
                {track.quality.conflict > 0 && <b className="soft-badge warning">冲 {track.quality.conflict}</b>}
              </div>
            ))}
          </div>
        </div>
        <footer className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
