import { describe, expect, it } from "vitest";
import { passes, NO_FILTERS } from "./filters";
import type { GateOpportunity } from "../../lib/types";

const opportunity = (receivedAt: number) => ({
  id: "gate-test", receivedAt, envelope: { opportunity: { location: {} }, eligibility: {}, source: {} },
} as unknown as GateOpportunity);

describe("GATE found-time filter", () => {
  const now = Date.UTC(2026, 9, 5, 12);

  it("supports precise hourly windows through 24 hours", () => {
    expect(passes(opportunity(now - 59 * 60_000), { ...NO_FILTERS, found: "1h" }, now)).toBe(true);
    expect(passes(opportunity(now - 61 * 60_000), { ...NO_FILTERS, found: "1h" }, now)).toBe(false);
    expect(passes(opportunity(now - 23 * 60 * 60_000), { ...NO_FILTERS, found: "24h" }, now)).toBe(true);
    expect(passes(opportunity(now - 25 * 60 * 60_000), { ...NO_FILTERS, found: "24h" }, now)).toBe(false);
  });
});
