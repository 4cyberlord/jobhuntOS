import type { ReactNode } from "react";

const tile = (bg: string, fg: string, text: string): ReactNode => (
  <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill={bg} /><text x="20" y="26.5" textAnchor="middle" fontSize="19" fontWeight="700" fontFamily="-apple-system,Helvetica,Arial" fill={fg}>{text}</text></svg>
);
const white = (children: ReactNode) => <svg viewBox="0 0 40 40">{children}</svg>;

const LOGOS: Record<string, ReactNode> = {
  google: (
    <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
  ),
  microsoft: <svg viewBox="0 0 40 40"><rect x="5" y="5" width="14.5" height="14.5" fill="#F25022" /><rect x="20.5" y="5" width="14.5" height="14.5" fill="#7FBA00" /><rect x="5" y="20.5" width="14.5" height="14.5" fill="#00A4EF" /><rect x="20.5" y="20.5" width="14.5" height="14.5" fill="#FFB900" /></svg>,
  amazon: <svg viewBox="0 0 40 40"><text x="20" y="25" textAnchor="middle" fontSize="27" fontWeight="800" fontFamily="Helvetica,Arial" fill="#111">a</text><path d="M9 29c7 4.5 16 4.5 22 .5" fill="none" stroke="#FF9900" strokeWidth="2.6" strokeLinecap="round" /><path d="M29 27.2l3.4 2.1-.5-3.9" fill="none" stroke="#FF9900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  meta: <svg viewBox="0 0 40 40"><path d="M8 26c0-7 4.4-13 8-13 5 0 8.6 14 14 14 3.2 0 4.2-4 4.2-7 0-4-2.3-7-5-7-3.5 0-8.5 14-13.7 14C10.7 27 8 26.3 8 26z" fill="none" stroke="#0A7CFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  stripe: tile("#635BFF", "#fff", "S"),
  notion: <svg viewBox="0 0 40 40"><rect x="6" y="5" width="28" height="30" rx="4" fill="#fff" stroke="#111" strokeWidth="2.4" /><path d="M14 28V13l12 14V12" fill="none" stroke="#111" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" /></svg>,
  airbnb: <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#FF385C" /><path d="M20 10.5c-1.5 0-2.6 1.1-3.4 2.7l-5.7 11.5c-1 2.2.1 4.9 2.6 5.2 1.5.1 2.8-.6 3.9-2l2.6-3.3 2.6 3.3c1.1 1.4 2.4 2.1 3.9 2 2.5-.3 3.6-3 2.6-5.2l-5.7-11.5c-.8-1.6-1.9-2.7-3.4-2.7zm0 7.2c1.2 0 2 1 2 2.2s-1 3-2 4.3c-1-1.3-2-3-2-4.3s.8-2.2 2-2.2z" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
  netflix: <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#000" /><path d="M13 9v22M27 9v22M13 9l14 22" fill="none" stroke="#E50914" strokeWidth="4.6" strokeLinejoin="round" /></svg>,
  apple: <svg viewBox="0 0 40 40"><path d="M26.4 21.3c0-3.2 2.6-4.7 2.7-4.8-1.5-2.2-3.8-2.5-4.6-2.5-1.9-.2-3.8 1.1-4.8 1.1-1 0-2.5-1.1-4.100-1.1-2.100 0-4.100 1.300-5.200 3.200-2.200 3.900-.6 9.600 1.600 12.700 1 1.500 2.300 3.200 3.900 3.200 1.600-.100 2.200-1 4.100-1 1.900 0 2.400 1 4.100 1 1.700 0 2.800-1.600 3.800-3.100 1.200-1.700 1.700-3.400 1.700-3.500-.1 0-3.300-1.300-3.300-5.100zM23.300 11.900c.8-1 1.400-2.400 1.200-3.900-1.200.1-2.700.8-3.500 1.800-.8.900-1.400 2.300-1.300 3.700 1.400.1 2.800-.7 3.600-1.600z" fill="#111" /></svg>,
  linkedin: tile("#0A66C2", "#fff", "in"),
  linear: tile("#5E6AD2", "#fff", "L"),
  figma: <svg viewBox="0 0 40 40"><rect x="12" y="5" width="8" height="9" rx="4" fill="#F24E1E" /><rect x="20" y="5" width="8" height="9" rx="4" fill="#FF7262" /><rect x="12" y="14" width="8" height="9" rx="4" fill="#A259FF" /><circle cx="24" cy="18.500" r="4.500" fill="#1ABCFE" /><rect x="12" y="23" width="8" height="9" rx="4" fill="#0ACF83" /></svg>,
  anthropic: tile("#F4F1EA", "#191919", "A"),
  openai: <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#111" /><circle cx="20" cy="20" r="8.500" fill="none" stroke="#fff" strokeWidth="2.800" /><circle cx="20" cy="20" r="3" fill="#fff" /></svg>,
  databricks: tile("#FF3621", "#fff", "◆"),
  uber: <svg viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#000" /><text x="20" y="25" textAnchor="middle" fontSize="12.5" fontWeight="700" fontFamily="-apple-system,Helvetica,Arial" fill="#fff">Uber</text></svg>,
  snowflake: tile("#29B5E8", "#fff", "❄"),
  shopify: tile("#95BF47", "#fff", "S"),
  canva: tile("#7D2AE8", "#fff", "C"),
  palantir: tile("#101113", "#fff", "P"),
  doordash: tile("#FF3008", "#fff", "D"),
  spotify: <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#1ED760" /><path d="M11 15.500c6-1.800 13-1.200 18.500 1.700M12 20.500c5.200-1.500 11-1 15.500 1.500M13 25c4.300-1.200 8.600-.8 12.200 1.200" fill="none" stroke="#111" strokeWidth="2.200" strokeLinecap="round" /></svg>,
  greenhouse: tile("#24A47F", "#fff", "g"),
  workday: tile("#FFF", "#F5A623", "W"),
  indeed: tile("#2164F3", "#fff", "i"),
};

const ALIASES: Record<string, string> = {
  "google careers": "google", "microsoft careers": "microsoft", "amazon jobs": "amazon", "stripe jobs": "stripe", "meta careers": "meta",
};
const PALETTE = ["#2f7cf6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#ec4899", "#64748b"];

export function Logo({ name, size = 36 }: { name: string; size?: number }) {
  const key = ALIASES[name.toLowerCase()] ?? name.toLowerCase().split(/[\s.]/)[0];
  const known = LOGOS[key];
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className="logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }} aria-hidden="true">
      {known ?? tile(PALETTE[hash % PALETTE.length], "#fff", (name.trim()[0] ?? "?").toUpperCase())}
    </span>
  );
}
