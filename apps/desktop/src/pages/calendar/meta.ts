import type { EventKind } from "../../lib/types";

export const KINDS: { kind: EventKind; label: string; cal: string; color: string; soft: string }[] = [
  { kind: "interview", label: "Interview", cal: "Interviews", color: "var(--blue)", soft: "var(--blue-soft)" },
  { kind: "followup", label: "Follow-up", cal: "Follow-ups", color: "var(--green)", soft: "var(--green-soft)" },
  { kind: "deadline", label: "Application Deadline", cal: "Application Deadlines", color: "var(--red)", soft: "var(--red-soft)" },
  { kind: "assessment", label: "Assessment", cal: "Assessments", color: "var(--purple)", soft: "var(--purple-soft)" },
  { kind: "personal", label: "Personal", cal: "Personal", color: "var(--muted)", soft: "var(--panel-2)" },
];
export const kindMeta = (k: EventKind) => KINDS.find((x) => x.kind === k) ?? KINDS[4];
export const FORMATS = ["Video Call", "In Person", "Phone", "None"] as const;
