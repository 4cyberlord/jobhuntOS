import { useState } from "react";
import type { WeekPoint } from "./metrics";

export type Focus = "apps" | "interviews" | "rate";
const W = 480, H = 214, L = 30, R = 34, T = 12, B = 28;

const niceMax = (v: number) => [4, 8, 12, 16, 20, 40, 60, 100, 200, 400, 1000].find((c) => c >= v) ?? Math.ceil(v / 100) * 100;

/** Hand-rolled combo chart: bars for applications / interviews (left axis), line for response rate (right axis, %). */
export function ComboChart({ points, focus = "apps", showApps = true, showInterviews = true, showRate = true }: { points: WeekPoint[]; focus?: Focus; showApps?: boolean; showInterviews?: boolean; showRate?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(showApps ? p.apps : 0, showInterviews ? p.interviews : 0))));
  const iw = W - L - R, ih = H - T - B;
  const band = iw / n;
  const bw = Math.min(14, band * 0.28);
  const y = (v: number) => T + ih - (v / max) * ih;
  const yr = (v: number) => T + ih - (v / 100) * ih;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const dim = (f: Focus) => (focus === "apps" || focus === f ? 1 : 0.28);
  const linePts = points.map((p, i) => (p.rate === null ? null : ([L + band * i + band / 2, yr(p.rate)] as const)));
  const path = linePts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(" ");
  const showEvery = n > 8 ? 2 : 1;
  const hp = hover !== null ? points[hover] : null;
  const label = points.map((p) => `${p.label}: ${p.apps} applications, ${p.interviews} interviews, ${p.rate ?? "n/a"}% response rate`).join(". ");
  return (
    <div className="dash-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="dash-chart" role="img" aria-label={`Weekly activity. ${label}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="dash-grid-line" />
            <text x={L - 7} y={y(t) + 3.5} textAnchor="end" className="dash-axis">{Math.round(t)}</text>
          </g>
        ))}
        {showRate && [0, 50, 100].map((t) => <text key={t} x={W - R + 7} y={yr(t) + 3.5} className="dash-axis dash-axis-r">{t}%</text>)}
        {points.map((p, i) => {
          const cx = L + band * i + band / 2;
          return (
            <g key={p.start} onMouseEnter={() => setHover(i)}>
              <rect x={cx - band / 2} y={T} width={band} height={ih} fill="transparent" />
              {hover === i && <rect x={cx - band / 2 + 2} y={T} width={band - 4} height={ih} className="dash-hover-band" />}
              {showApps && <rect x={cx - bw - 1} y={y(p.apps)} width={bw} height={Math.max(0, T + ih - y(p.apps))} rx={3} className="dash-bar-a" opacity={dim("apps")} />}
              {showInterviews && <rect x={cx + 1} y={y(p.interviews)} width={bw} height={Math.max(0, T + ih - y(p.interviews))} rx={3} className="dash-bar-i" opacity={dim("interviews")} />}
              {i % showEvery === 0 && <text x={cx} y={H - 8} textAnchor="middle" className="dash-axis">{p.label}</text>}
            </g>
          );
        })}
        {showRate && path && <path d={path} fill="none" className="dash-line" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" opacity={dim("rate")} />}
        {showRate && linePts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 4.5 : 3.2} className="dash-dot" opacity={dim("rate")} />)}
      </svg>
      {hp && hover !== null && (
        <div className="dash-tip" style={{ left: `${((L + band * hover + band / 2) / W) * 100}%` }}>
          <b>Week of {hp.label}</b>
          {showApps && <span><i className="dash-sw-a" />{hp.apps} applications</span>}
          {showInterviews && <span><i className="dash-sw-i" />{hp.interviews} interviews</span>}
          {showRate && <span><i className="dash-sw-r" />{hp.rate === null ? "—" : `${hp.rate}%`} response rate</span>}
        </div>
      )}
    </div>
  );
}

/** Simple single-series line chart (percent values 0-100). */
export function LineChart({ points, unit = "%" }: { points: { label: string; v: number | null }[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const iw = W - L - 12, ih = H - T - B, band = iw / n;
  const y = (v: number) => T + ih - (v / 100) * ih;
  const pts = points.map((p, i) => (p.v === null ? null : ([L + band * i + band / 2, y(p.v)] as const)));
  const path = pts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join(" ");
  return (
    <div className="dash-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="dash-chart" role="img" aria-label={`Trend: ${points.map((p) => `${p.label} ${p.v ?? "n/a"}${unit}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}><line x1={L} x2={W - 12} y1={y(t)} y2={y(t)} className="dash-grid-line" /><text x={L - 7} y={y(t) + 3.5} textAnchor="end" className="dash-axis">{t}{unit}</text></g>
        ))}
        {path && <path d={path} fill="none" className="dash-line" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={L + band * i} y={T} width={band} height={ih} fill="transparent" />
            {pts[i] && <circle cx={pts[i]![0]} cy={pts[i]![1]} r={hover === i ? 5 : 3.4} className="dash-dot" />}
            {hover === i && p.v !== null && <text x={pts[i]![0]} y={pts[i]![1] - 10} textAnchor="middle" className="dash-axis" style={{ fill: "var(--text)", fontWeight: 600 }}>{p.v}{unit}</text>}
            {(n <= 8 || i % 2 === 0) && <text x={L + band * i + band / 2} y={H - 8} textAnchor="middle" className="dash-axis">{p.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
