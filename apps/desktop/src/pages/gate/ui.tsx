import type { ReactNode } from "react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

/** Score ring: SVG so the arc has rounded caps and animates smoothly. */
export function Ring({ score, size = 56, stroke = 5, label }: { score: number; size?: number; stroke?: number; label?: boolean }) {
  const lvl = score >= 85 ? "strong" : score >= 65 ? "moderate" : "weak";
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={`g-ring ${lvl}`} style={{ width: size, height: size }} role="img" aria-label={`${Math.round(score)}% match`}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="g-ring-track" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} className="g-ring-arc" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, score)) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <b style={{ fontSize: size * 0.27 }}>{Math.round(score)}%</b>
      {label && <i>{lvl}</i>}
    </div>
  );
}

/** A filter pill that shows "Label: Value" and uses a native select (accessible, keyboard friendly) stretched over it. */
export function FilterSelect({ icon, label, value, options, onChange }: { icon?: ReactNode; label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const current = options.find(([v]) => v === value)?.[1] ?? options[0][1];
  return (
    <label className={`g-filter ${value !== "any" ? "on" : ""}`}>
      {icon}
      <span>{label}: <b>{current}</b></span>
      <ChevronDownIcon />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}
