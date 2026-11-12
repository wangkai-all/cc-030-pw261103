import { useEffect, useMemo, useState } from "react";
import type { Analysis, Stay, StayEvent, StaySample } from "../types";
import {
  ACTION_LABEL,
  CLASSIFICATION_LABEL,
  formatCoordinate,
  formatDuration,
  formatDurationCompact,
  formatTime,
  formatTimeShort,
  vehicleRole,
  vehicleShort,
} from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { StatusBadge } from "./StatusBadge";

interface DetailPanelProps {
  analysis: Analysis;
  stay: Stay;
  onClose: () => void;
  onFocus: () => void;
  onSelectStay: (stayId: string) => void;
  onOpenQuality: () => void;
}

const EVENT_ICON: Record<string, IconName> = {
  entry_confirm: "play",
  exit_confirm: "flag",
  buffer_hold: "shield",
  outside_candidate: "target",
  hole_outside: "grid",
  gap_break: "signal",
  ongoing: "clock",
};

const SEVERITY_CLASS: Record<StayEvent["severity"], string> = {
  success: "event-success",
  warning: "event-warning",
  danger: "event-danger",
  info: "event-info",
};

export function DetailPanel({
  analysis,
  stay,
  onClose,
  onFocus,
  onSelectStay,
  onOpenQuality,
}: DetailPanelProps) {
  const [showSamples, setShowSamples] = useState(false);
  const fence = analysis.geofences.find((item) => item.id === stay.geofence_id);
  const anomalyGroups = analysis.anomalies.filter(
    (anomaly) => anomaly.vehicle_id === stay.vehicle_id,
  );

  useEffect(() => {
    setShowSamples(false);
  }, [stay.id]);

  const sampleCounts = useMemo(() => {
    return stay.samples.reduce(
      (counts, sample) => {
        counts[sample.classification] += 1;
        return counts;
      },
      { inside: 0, buffer: 0, outside: 0, hole: 0 },
    );
  }, [stay.samples]);

  const sampleById = useMemo(() => {
    const map = new Map<string, StaySample>();
    stay.samples.forEach((sample) => map.set(sample.id, sample));
    return map;
  }, [stay.samples]);

  const overlapNames = stay.geofence_overlaps
    .map((id) => analysis.geofences.find((item) => item.id === id)?.name)
    .filter(Boolean);
  const concurrentStays = stay.concurrent_stay_ids
    .map((id) => analysis.stays.find((item) => item.id === id))
    .filter((item): item is Stay => Boolean(item));

  const timeRange =
    stay.status === "complete"
      ? `${formatTimeShort(stay.enter_time)} → ${formatTimeShort(stay.exit_time)}`
      : stay.status === "ongoing"
        ? `${formatTimeShort(stay.enter_time)} → 轨迹结束`
        : `${formatTimeShort(stay.enter_time)} → 信号中断`;

  const averageExclusion =
    stay.status === "complete"
      ? "计入完整驻留平均"
      : "未计入平均时长";

  return (
    <aside className="detail-panel" aria-label="驻留判定详情">
      <div className="detail-accent" style={{ background: stay.geofence_color }} />
      <header className="detail-head">
        <div className="detail-overline">
          <span>驻留判定</span>
          <span className="detail-stay-id">{stay.id.toUpperCase()}</span>
          <button type="button" className="icon-button detail-close" onClick={onClose} aria-label="关闭详情">
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="detail-title-row">
          <h2>{stay.geofence_name}</h2>
          <StatusBadge status={stay.status} />
        </div>
        <div className="detail-vehicle">
          <span className="vehicle-dot" style={{ background: stay.vehicle_color }} />
          <strong>{vehicleShort(stay.vehicle_label)}</strong>
          <span>{vehicleRole(stay.vehicle_label) || stay.vehicle_scenario}</span>
          <span className="detail-scenario">{stay.vehicle_scenario}</span>
        </div>
      </header>

      <div className="detail-scroll">
        <section className="stay-summary">
          <div className="duration-line">
            <div>
              <span className="micro-label">驻留时长</span>
              <div className="duration-value">
                {formatDurationCompact(stay.duration_seconds)}
                <span>{formatDuration(stay.duration_seconds)}</span>
              </div>
            </div>
            <span className={`average-tag ${stay.status === "complete" ? "included" : "excluded"}`}>
              {stay.status === "complete" ? <Icon name="check" size={13} /> : <Icon name="info" size={13} />}
              {averageExclusion}
            </span>
          </div>

          <div className="stay-time-rail">
            <div className="time-point entry">
              <span className="time-label">进入</span>
              <strong>{formatTime(stay.enter_time)}</strong>
              <small>seq {stay.entry_trigger.sequence ?? "—"} · 回记点</small>
            </div>
            <div className="time-connector">
              <span />
              <em>{timeRange}</em>
            </div>
            <div className="time-point exit">
              <span className="time-label">退出</span>
              <strong>{stay.exit_time ? formatTime(stay.exit_time) : "尚未确认"}</strong>
              <small>
                {stay.exit_trigger
                  ? `seq ${stay.exit_trigger.sequence ?? "—"} · 回记点`
                  : stay.status === "ongoing"
                    ? "轨迹结束仍在内"
                    : "断档前最后时刻"}
              </small>
            </div>
          </div>

          <p className={`status-note status-note-${stay.status}`}>
            <Icon name={stay.status === "complete" ? "check" : "info"} size={14} />
            {stay.status_note}
          </p>
        </section>

        <section className="detail-section">
          <div className="section-heading">
            <div>
              <span className="micro-label">TRIGGER POINTS</span>
              <h3>触发进出的点</h3>
            </div>
            <button type="button" className="text-button" onClick={onFocus}>
              <Icon name="locate" size={14} />
              定位
            </button>
          </div>

          <div className="trigger-grid">
            <TriggerCard
              kind="entry"
              title="进入触发点"
              pointId={stay.entry_trigger.id}
              time={stay.entry_trigger.timestamp}
              x={stay.entry_trigger.x}
              y={stay.entry_trigger.y}
              sequence={stay.entry_trigger.sequence}
              pairGap={stay.entry_gap_seconds}
            />
            {stay.exit_trigger ? (
              <TriggerCard
                kind="exit"
                title="退出触发点"
                pointId={stay.exit_trigger.id}
                time={stay.exit_trigger.timestamp}
                x={stay.exit_trigger.x}
                y={stay.exit_trigger.y}
                sequence={stay.exit_trigger.sequence}
                pairGap={stay.exit_gap_seconds}
              />
            ) : (
              <div className={`trigger-card trigger-${stay.status}`}>
                <div className="trigger-title-row">
                  <span className={`trigger-icon ${stay.status}`}>
                    <Icon name={stay.status === "ongoing" ? "clock" : "signal"} size={15} />
                  </span>
                  <div>
                    <span className="micro-label">{stay.status === "ongoing" ? "NO EXIT" : "GAP BREAK"}</span>
                    <h4>{stay.status === "ongoing" ? "尚未确认离开" : "信号中断"}</h4>
                  </div>
                </div>
                <div className="trigger-time">
                  <strong>{formatTime(stay.last_seen_time)}</strong>
                  <span>最后有效点</span>
                </div>
                <div className="trigger-meta">
                  <span>seq {stay.last_seen_point.sequence ?? "—"}</span>
                  <span>X {formatCoordinate(stay.last_seen_point.x)} / Y {formatCoordinate(stay.last_seen_point.y)}</span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="detail-section">
          <div className="section-heading">
            <div>
              <span className="micro-label">DECISION TRACE</span>
              <h3>驻留判定过程</h3>
            </div>
            <span className="sample-total">{stay.samples.length} 个判定点</span>
          </div>

          <div className="classification-strip" aria-label="判定点分类分布">
            {stay.samples.map((sample) => (
              <span
                key={`${sample.id}-strip`}
                className={`strip-segment strip-${sample.classification} ${sample.action.startsWith("entry") || sample.action.startsWith("exit") ? "strip-trigger" : ""}`}
                style={{ flexGrow: 1 }}
                title={`${formatTime(sample.timestamp)} · ${CLASSIFICATION_LABEL[sample.classification]} · ${ACTION_LABEL[sample.action] ?? sample.action}`}
              >
              </span>
            ))}
          </div>
          <div className="classification-legend">
            {(Object.keys(sampleCounts) as Array<keyof typeof sampleCounts>).map((key) => (
              <span key={key}>
                <i className={`legend-swatch strip-${key}`} />
                {CLASSIFICATION_LABEL[key]} {sampleCounts[key]}
              </span>
            ))}
          </div>

          <div className="event-timeline">
            {stay.events.map((event, index) => (
              <div key={`${event.type}-${event.timestamp}-${index}`} className={`event-row ${SEVERITY_CLASS[event.severity]}`}>
                <div className="event-rail">
                  <span className="event-node">
                    <Icon name={EVENT_ICON[event.type] ?? "target"} size={13} />
                  </span>
                  {index < stay.events.length - 1 && <span className="event-line" />}
                </div>
                <div className="event-content">
                  <div className="event-head">
                    <strong>{event.title}</strong>
                    <span className="event-metric">{event.metric}</span>
                  </div>
                  <p>{event.detail}</p>
                  <div className="event-footer">
                    <span>{formatTime(event.timestamp)}</span>
                    <span className="event-evidence">
                      {event.evidence_ids
                        .map((id) => sampleById.get(id)?.sequence)
                        .filter((value): value is number => Boolean(value))
                        .map((sequence) => `#${sequence}`)
                        .join("  ")}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {showSamples && (
            <div className="sample-table-wrap">
              <table className="sample-table">
                <thead>
                  <tr>
                    <th>序</th>
                    <th>时刻</th>
                    <th>与上点</th>
                    <th>分类</th>
                    <th>处置</th>
                  </tr>
                </thead>
                <tbody>
                  {stay.samples.map((sample) => (
                    <tr
                      key={`${sample.id}-row`}
                      className={sample.action.includes("first") || sample.action.includes("second") ? "key-row" : ""}
                    >
                      <td>{sample.sequence}</td>
                      <td>{formatTime(sample.timestamp)}</td>
                      <td>{sample.gap_seconds == null ? "段首" : `${sample.gap_seconds}s`}</td>
                      <td>
                        <span className={`table-class class-${sample.classification}`}>
                          <i />
                          {CLASSIFICATION_LABEL[sample.classification]}
                        </span>
                      </td>
                      <td>{ACTION_LABEL[sample.action] ?? sample.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            className="sample-toggle"
            onClick={() => setShowSamples((value) => !value)}
          >
            <Icon name={showSamples ? "chevron-down" : "chevron-right"} size={14} />
            {showSamples ? "收起逐点明细" : `展开逐点明细（${stay.samples.length}）`}
          </button>
        </section>

        {(overlapNames.length > 0 || concurrentStays.length > 0) && (
          <section className="overlap-card">
            <div className="overlap-head">
              <span className="overlap-icon">
                <Icon name="layers" size={16} />
              </span>
              <div>
                <span className="micro-label">OVERLAP · INDEPENDENT</span>
                <h3>重叠围栏，独立判定</h3>
              </div>
            </div>
            <p>
              本围栏与 {overlapNames.join("、")} 的空间范围相交。每条驻留只归属于当前围栏，
              不合并、不互相抵消。
            </p>
            {concurrentStays.length > 0 && (
              <div className="concurrent-list">
                <span>同一车辆同时在场：</span>
                {concurrentStays.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="concurrent-chip"
                    onClick={() => onSelectStay(item.id)}
                  >
                    <i style={{ background: item.geofence_color }} />
                    {item.geofence_name}
                    <Icon name="chevron-right" size={11} />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {(anomalyGroups.length > 0 || fence?.description) && (
          <section className="context-card">
            {anomalyGroups.length > 0 && (
              <button type="button" className="quality-link" onClick={onOpenQuality}>
                <span className="quality-link-icon"><Icon name="alert" size={15} /></span>
                <span>
                  <strong>本车轨迹有 {anomalyGroups.length} 组异常点</strong>
                  <small>重复点已去重，同时刻冲突点未参与判定</small>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            )}
            {fence?.description && <p className="fence-note">{fence.description}</p>}
          </section>
        )}

        <section className="rule-section">
          <span className="micro-label">RULE EVIDENCE</span>
          <div className="rule-tags">
            {stay.rule_tags.map((tag) => (
              <span key={tag} className="rule-tag">
                <Icon name="check" size={11} />
                {tag}
              </span>
            ))}
          </div>
          <div className="parameter-note">
            <span>缓冲 {analysis.options.buffer_m} m</span>
            <span>双点 ≤ {analysis.options.enter_confirm_seconds}s</span>
            <span>断档 ≥ {analysis.options.gap_break_seconds}s</span>
          </div>
        </section>
      </div>
    </aside>
  );
}

function TriggerCard({
  kind,
  title,
  pointId,
  time,
  x,
  y,
  sequence,
  pairGap,
}: {
  kind: "entry" | "exit";
  title: string;
  pointId: string;
  time: string;
  x: number;
  y: number;
  sequence: number | null;
  pairGap: number | null;
}) {
  return (
    <div className={`trigger-card trigger-${kind}`}>
      <div className="trigger-title-row">
        <span className={`trigger-icon ${kind}`}>
          <Icon name={kind === "entry" ? "play" : "flag"} size={15} />
        </span>
        <div>
          <span className="micro-label">{kind === "entry" ? "ENTRY · BACKDATED" : "EXIT · BACKDATED"}</span>
          <h4>{title}</h4>
        </div>
      </div>
      <div className="trigger-time">
        <strong>{formatTime(time)}</strong>
        <span>{pairGap == null ? "单点" : `双点间隔 ${pairGap}s`}</span>
      </div>
      <div className="trigger-meta">
        <span>seq {sequence ?? "—"}</span>
        <span>X {formatCoordinate(x)} / Y {formatCoordinate(y)}</span>
      </div>
      <span className="trigger-point-id">{pointId}</span>
    </div>
  );
}
