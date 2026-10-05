import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Route = "dashboard" | "kanban" | "opportunities" | "companies" | "contacts" | "calendar" | "documents" | "vault" | "gate" | "inbox" | "insights" | "notifications" | "settings";
export const ROUTES: Route[] = ["dashboard", "kanban", "opportunities", "companies", "contacts", "calendar", "documents", "vault", "gate", "inbox", "insights", "notifications", "settings"];
/** The first-run destination when there is no valid deep link. */
export const DEFAULT_ROUTE: Route = "gate";

export type ModalState =
  | { kind: "job"; preset?: Record<string, unknown> }
  | { kind: "company" }
  | { kind: "contact"; preset?: Record<string, unknown> }
  | { kind: "event"; preset?: Record<string, unknown>; editId?: string }
  | { kind: "credential"; preset?: Record<string, unknown>; editId?: string }
  | { kind: "vault-unlock"; resolve: (ok: boolean) => void }
  | null;

type Toast = { id: number; text: string; tone: "ok" | "warn" };
type UI = {
  route: Route;
  params: Record<string, string>;
  navigate: (r: Route, params?: Record<string, string>) => void;
  back: () => void;
  forward: () => void;
  jobId?: string;
  openJob: (id?: string) => void;
  modal: ModalState;
  openModal: (m: ModalState) => void;
  closeModal: () => void;
  toasts: Toast[];
  toast: (text: string, tone?: "ok" | "warn") => void;
  /** text typed in the global header search; pages that list things filter by it */
  search: string;
  setSearch: (s: string) => void;
};
const Ctx = createContext<UI | null>(null);

const fromHash = (): Route => {
  const h = window.location.hash.replace(/^#\/?/, "").split("?")[0] as Route;
  return ROUTES.includes(h) ? h : DEFAULT_ROUTE;
};

export function UIProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(fromHash);
  const [params, setParams] = useState<Record<string, string>>({});
  const [jobId, openJob] = useState<string | undefined>();
  const [modal, openModal] = useState<ModalState>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const on = () => setRoute(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const navigate = useCallback((r: Route, p: Record<string, string> = {}) => {
    setParams(p);
    setSearch("");
    openJob(undefined);
    if (window.location.hash !== `#/${r}`) window.location.hash = `/${r}`;
    else setRoute(r);
  }, []);
  const toast = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  // global shortcuts: ⌘K palette, Esc closes the top layer
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "f")) {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      } else if (e.key === "Escape") {
        openModal((m) => (m ? (m.kind === "vault-unlock" ? (m.resolve(false), null) : null) : m));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const value = useMemo<UI>(
    () => ({
      route, params, navigate, back: () => window.history.back(), forward: () => window.history.forward(), jobId, openJob, modal, openModal,
      closeModal: () => openModal(null), toasts, toast, search, setSearch,
    }),
    [route, params, navigate, jobId, modal, toasts, toast, search],
  );
  // Expose toast for non-hook callers (e.g. Kanban email sync button) without breaking hook rules
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__jhosToast = toast;
    return () => { delete (window as unknown as Record<string, unknown>).__jhosToast; };
  }, [toast]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useUI() {
  const c = useContext(Ctx);
  if (!c) throw new Error("UIProvider missing");
  return c;
}

/** Ask the user to unlock (or create) the vault. Resolves true when the vault is unlocked. */
export function useRequireVault() {
  const { openModal } = useUI();
  return useCallback(() => new Promise<boolean>((resolve) => openModal({ kind: "vault-unlock", resolve })), [openModal]);
}
