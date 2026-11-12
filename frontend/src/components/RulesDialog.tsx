import { useEffect } from "react";
import type { Analysis } from "../types";
import { Icon } from "./Icon";

interface RulesDialogProps {
  open: boolean;
  analysis: Analysis;
  onClose: () => void;
}

const RULES = [
  {
    code: "01",
    title: "进入 · 连续双点在围栏内",
    detail: "两个相邻有效点都在围栏内，且间隔 ≤ 60 秒，才确认进入。进入时间回记到第一个点；点落在外边界上按内部处理。",
    icon: "play" as const,
  },
  {
    code: "02",
    title: "保持 · 10 米缓冲滞回",
    detail: "已经进入后，点落在边界外 10 米以内仍保持在场。距离在本地米制投影中计算，不对经纬度直接做减法。",
    icon: "shield" as const,
  },
  {
    code: "03",
    title: "退出 · 连续双点在缓冲外",
    detail: "连续两个有效点都在 10 米缓冲之外、间隔 ≤ 60 秒，才在第一个缓冲外点记录退出，边界缓冲内的单点不会触发退出。",
    icon: "flag" as const,
  },
  {
    code: "04",
    title: "空洞 · 始终按围栏外",
    detail: "GeoJSON 的多边形内环被视为场站外，不参与 10 米缓冲滞回。进入空洞后，连续两点即按场外确认退出。",
    icon: "grid" as const,
  },
  {
    code: "05",
    title: "断档 · 5 分钟不跨缺口",
    detail: "相邻有效点间隔 ≥ 5 分钟即断开轨迹。已开始的驻留标为不完整，不跨信号缺口补算；轨迹结束仍在内则标为进行中。",
    icon: "signal" as const,
  },
  {
    code: "06",
    title: "重叠 · 每座围栏独立判定",
    detail: "凹多边形、内部空洞与相互重叠的围栏都保留原始几何。每条驻留在各围栏上分别计算，不合并、不互相抵消。",
    icon: "layers" as const,
  },
];

export function RulesDialog({ open, analysis, onClose }: RulesDialogProps) {
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
      <div className="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <header className="modal-head">
          <div>
            <span className="micro-label">DECISION SPECIFICATION</span>
            <h2 id="rules-title">驻留判定口径</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body">
          <div className="rules-parameters">
            <div>
              <span>双点确认</span>
              <strong>≤ {analysis.options.enter_confirm_seconds}s</strong>
            </div>
            <div>
              <span>退出缓冲</span>
              <strong>{analysis.options.buffer_m} m</strong>
            </div>
            <div>
              <span>断档阈值</span>
              <strong>{analysis.options.gap_break_seconds / 60} min</strong>
            </div>
            <div>
              <span>投影</span>
              <strong>AEQD / m</strong>
            </div>
          </div>
          <div className="rule-list">
            {RULES.map((rule) => (
              <article className="rule-card" key={rule.code}>
                <span className="rule-code">{rule.code}</span>
                <span className="rule-icon"><Icon name={rule.icon} size={17} /></span>
                <div>
                  <h3>{rule.title}</h3>
                  <p>{rule.detail}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="rules-extra">
            <div>
              <Icon name="alert" size={15} />
              <span>进入前的数据整理：按车辆与时间排序，同刻同位置重复点合并，同刻位置冲突整组列异常且不参与判定。</span>
            </div>
            <div>
              <Icon name="clock" size={15} />
              <span>只有完整驻留进入平均时长统计；不完整与进行中记录保留展示，但不混入平均值。</span>
            </div>
          </div>
        </div>
        <footer className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            明白了
          </button>
        </footer>
      </div>
    </div>
  );
}
