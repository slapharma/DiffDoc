import { describe, expect, it } from "vitest";
import { projectRange } from "../lib/diff/project";
import { literalDiff } from "../lib/diff/literal";
import type { DiffChunk } from "../lib/diff/types";

describe("projectRange", () => {
  // A: "The dose is 20mg daily." (23 chars)
  // B: "The dose is 40mg daily."
  const chunks: DiffChunk[] = [
    { op: "equal", text: "The dose is ", offsetA: 0, offsetB: 0 },
    { op: "delete", text: "20mg", offsetA: 12, offsetB: 12 },
    { op: "insert", text: "40mg", offsetA: 16, offsetB: 12 },
    { op: "equal", text: " daily.", offsetA: 16, offsetB: 16 },
  ];

  it("reconstructs side A exactly (equal + delete)", () => {
    const text = projectRange(chunks, "a", 0, 23).map((s) => s.text).join("");
    expect(text).toBe("The dose is 20mg daily.");
  });

  it("reconstructs side B exactly (equal + insert)", () => {
    const text = projectRange(chunks, "b", 0, 23).map((s) => s.text).join("");
    expect(text).toBe("The dose is 40mg daily.");
  });

  it("slices a sub-range mid-chunk", () => {
    const segments = projectRange(chunks, "a", 4, 14);
    expect(segments.map((s) => s.text).join("")).toBe("dose is 20");
    expect(segments.map((s) => s.op)).toEqual(["equal", "delete"]);
  });

  it("keeps chunk indices for UI anchors", () => {
    const segments = projectRange(chunks, "b", 0, 23);
    expect(segments.map((s) => s.chunkIndex)).toEqual([0, 2, 3]);
  });

  it("returns nothing for an empty range", () => {
    expect(projectRange(chunks, "a", 5, 5)).toHaveLength(0);
  });

  it("round-trips a real diff over multi-paragraph text", () => {
    const a = "Heading\nFirst paragraph stays.\nSecond paragraph removed.\n";
    const b = "Heading\nFirst paragraph stays.\nA new third paragraph.\n";
    const { chunks: real } = literalDiff(a, b);
    expect(projectRange(real, "a", 0, a.length).map((s) => s.text).join("")).toBe(a);
    expect(projectRange(real, "b", 0, b.length).map((s) => s.text).join("")).toBe(b);
  });
});
