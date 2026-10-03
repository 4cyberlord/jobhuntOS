import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

export type MenuItem = { label: string; icon?: ReactNode; onClick?: () => void; danger?: boolean; children?: MenuItem[]; hidden?: boolean; sep?: boolean };

/** Click-to-open popover menu rendered in a portal (never clipped by scroll panes). */
export function Menu({ trigger, items, align = "right", label }: { trigger: (props: { onClick: (e: React.MouseEvent) => void; "aria-haspopup": "menu"; "aria-expanded": boolean }) => ReactNode; items: MenuItem[]; align?: "left" | "right"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<MenuItem[][]>([]);
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean }>({ top: 0, left: 0, flip: false });
  const anchor = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 224;
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ top: r.bottom + 6, left, flip: false });
  };
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    const h = pop.current.offsetHeight;
    const r = anchor.current?.getBoundingClientRect();
    if (r && r.bottom + 6 + h > window.innerHeight - 8) setPos((p) => ({ ...p, top: Math.max(8, r.top - h - 6), flip: true }));
  }, [open, stack]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", () => setOpen(false));
    return () => { window.removeEventListener("mousedown", close, true); window.removeEventListener("keydown", esc); window.removeEventListener("scroll", scroll, true); };
  }, [open]);

  const level = stack.length ? stack[stack.length - 1] : items;
  return (
    <>
      <span ref={anchor} className="docs-menu-anchor">
        {trigger({
          onClick: (e) => { e.stopPropagation(); place(); setStack([]); setOpen((o) => !o); },
          "aria-haspopup": "menu",
          "aria-expanded": open,
        })}
      </span>
      {open && createPortal(
        <div ref={pop} className="docs-menu" role="menu" aria-label={label} style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          {stack.length > 0 && <button className="docs-menu-back" onClick={() => setStack(stack.slice(0, -1))}><ChevronLeftIcon />Back</button>}
          {level.filter((i) => !i.hidden).map((it, i) =>
            it.sep ? <hr key={i} /> : (
              <button key={it.label + i} role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { if (it.children) setStack([...stack, it.children]); else { setOpen(false); it.onClick?.(); } }}>
                {it.icon}
                <span>{it.label}</span>
                {it.children && <em>›</em>}
              </button>
            ),
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
