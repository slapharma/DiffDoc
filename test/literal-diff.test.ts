import { describe, expect, it } from "vitest";
import { changedChunks, literalDiff } from "@/lib/diff";

describe("literalDiff", () => {
  it("reports similarity = 1 for identical strings", () => {
    const result = literalDiff("the quick brown fox", "the quick brown fox");
    expect(result.similarity).toBe(1);
    expect(changedChunks(result)).toEqual([]);
  });

  it("reports similarity < 1 for different strings", () => {
    const result = literalDiff(
      "Recommended dose: 20mg twice daily.",
      "Recommended dose: 40mg twice daily.",
    );
    expect(result.similarity).toBeLessThan(1);
    expect(result.similarity).toBeGreaterThan(0.8);

    const changes = changedChunks(result);
    const deletedText = changes.filter((c) => c.op === "delete").map((c) => c.text).join("");
    const insertedText = changes.filter((c) => c.op === "insert").map((c) => c.text).join("");
    expect(deletedText).toContain("2");
    expect(insertedText).toContain("4");
  });

  it("anchors chunks to offsets in both inputs", () => {
    const a = "alpha bravo charlie";
    const b = "alpha BRAVO charlie";
    const result = literalDiff(a, b);
    for (const chunk of result.chunks) {
      expect(chunk.offsetA).toBeGreaterThanOrEqual(0);
      expect(chunk.offsetB).toBeGreaterThanOrEqual(0);
      expect(chunk.offsetA).toBeLessThanOrEqual(a.length);
      expect(chunk.offsetB).toBeLessThanOrEqual(b.length);
    }
  });

  it("detects a pure insertion at the end", () => {
    const a = "first line";
    const b = "first line\nsecond line";
    const result = literalDiff(a, b);
    const inserts = result.chunks.filter((c) => c.op === "insert");
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.map((i) => i.text).join("")).toContain("second line");
  });

  it("reports similarity ~ 0 for entirely different content", () => {
    const result = literalDiff(
      "Standard operating procedure for product X dosing.",
      "Quarterly safety review schedule and reporting cadence.",
    );
    expect(result.similarity).toBeLessThan(0.5);
  });
});
