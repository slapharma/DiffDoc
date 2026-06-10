import { describe, expect, it } from "vitest";
import { detectFlags } from "../lib/pipeline/flags";

describe("detectFlags", () => {
  it("flags numeric changes", () => {
    expect(detectFlags("40mg administered twice daily")).toContain("number");
    expect(detectFlags("increase to 80")).toContain("number");
  });

  it("flags dates in numeric and written formats", () => {
    expect(detectFlags("effective 12/05/2026")).toContain("date");
    expect(detectFlags("expires 3rd March")).toContain("date");
    expect(detectFlags("review in May 2026")).toContain("date");
  });

  it("does not flag the modal verb 'may' as a date", () => {
    const reasons = detectFlags("patients may experience drowsiness");
    expect(reasons).not.toContain("date");
    expect(reasons).toHaveLength(0);
  });

  it("flags negations and polarity words", () => {
    expect(detectFlags("must not be increased")).toContain("negation");
    expect(detectFlags("use without supervision")).toContain("negation");
    expect(detectFlags("contraindicated in pregnancy")).toContain("negation");
  });

  it("distinguishes a date from a separate number in the same text", () => {
    const reasons = detectFlags("from 12 May 2026 take 40mg");
    expect(reasons).toContain("date");
    expect(reasons).toContain("number");
  });

  it("a pure date is not double-flagged as a number", () => {
    const reasons = detectFlags("deadline moved to 12/05/2026");
    expect(reasons).toContain("date");
    expect(reasons).not.toContain("number");
  });

  it("returns empty for neutral wording changes", () => {
    expect(detectFlags("the physician should record changes")).toHaveLength(0);
  });

  it("is not stateful across calls (g-flag regression)", () => {
    expect(detectFlags("12/05/2026")).toContain("date");
    expect(detectFlags("12/05/2026")).toContain("date");
  });
});
