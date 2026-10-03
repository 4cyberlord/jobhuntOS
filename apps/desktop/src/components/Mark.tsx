import { useId } from "react";

/** The Job Hunt OS mark: a person beside a rising leaf. `tile` draws the gradient app-icon square behind it. */
export function Mark({ size = 40, tile = true }: { size?: number; tile?: boolean }) {
  const id = useId().replace(/:/g, "");
  const glyph = (
    <>
      <circle cx="93" cy="108" r="22" />
      <path d="M58 142c0-4 3-5 7-4l33 10c12 4 20 12 20 26v40c0 3-2 4-4 4-32 0-56-18-56-46Z" />
      <path d="M130 100c0-10 8-16 20-21l40-19c5-2 8 0 8 6v104c0 30-28 48-58 48h-6c-3 0-4-2-4-4Z" />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="Job Hunt OS" className="jh-mark">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3ad3ff" /><stop offset=".45" stopColor="#1a6bff" /><stop offset="1" stopColor="#6a1bff" /></linearGradient>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#12d0ff" /><stop offset=".5" stopColor="#1a6bff" /><stop offset="1" stopColor="#5a14f5" /></linearGradient>
        <linearGradient id={`w${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" /><stop offset=".6" stopColor="#eaf2ff" /><stop offset="1" stopColor="#b9c8ff" /></linearGradient>
      </defs>
      {tile && <rect width="256" height="256" rx="62" fill={`url(#t${id})`} />}
      <g fill={tile ? `url(#w${id})` : `url(#g${id})`} transform={tile ? "translate(0 0)" : "translate(0 0)"}>{glyph}</g>
    </svg>
  );
}
