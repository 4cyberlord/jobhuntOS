import { useEffect, type ReactNode } from "react";
import { XMarkIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-head-actions">{children}</div>}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="modal-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><XMarkIcon /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function Progress({ value, max = 100, tone = "blue" }: { value: number; max?: number; tone?: "blue" | "green" | "amber" | "purple" | "red" }) {
  return (
    <span className={`progress ${tone}`}>
      <i style={{ width: `${Math.min(100, (value / Math.max(max, 1)) * 100)}%` }} />
    </span>
  );
}

export function SearchField({ value, onChange, placeholder, kbd }: { value: string; onChange: (v: string) => void; placeholder: string; kbd?: string }) {
  return (
    <label className="search-field">
      <MagnifyingGlassIcon />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {kbd && <kbd>{kbd}</kbd>}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label: Record<string, string> = { pending_review: "New", saved: "Saved", preparing: "Preparing", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", dismissed: "Dismissed" };
  return <span className={`pill st-${status}`}>{label[status] ?? status}</span>;
}
