import { describe, expect, it } from "vitest";
import { sideText, chunkAtOffset, searchSide, jumpTargets } from "../lib/diff/navigate";
import { literalDiff } from "../lib/diff/literal";
import type { DiffChunk } from "../lib/diff/types";

const CHUNKS: DiffChunk[] = [
  { op: "equal", text: "The dose is ", offsetA: 0, offsetB: 0 },
  { op: "delete", text: "20mg", offsetA: 12, offsetB: 12 },
  { op: "insert", text: "40mg", offsetA: 16, offsetB: 12 },
  { op: "equal", text: " daily.", offsetA: 16, offsetB: 16 },
];

describe("sideText", () => {
  it("reconstructs each side", () => {
    expect(sideText(CHUNKS, "a")).toBe("The dose is 20mg daily.");
    expect(sideText(CHUNKS, "b")).toBe("The dose is 40mg daily.");
  });
});

describe("chunkAtOffset", () => {
  it("finds the chunk containing an offset, skipping zero-width chunks", () => {
    expect(chunkAtOffset(CHUNKS, "a", 0)).toBe(0);
    expect(chunkAtOffset(CHUNKS, "a", 13)).toBe(1); // inside "20mg"
    expect(chunkAtOffset(CHUNKS, "b", 13)).toBe(2); // inside "40mg"
    expect(chunkAtOffset(CHUNKS, "a", 18)).toBe(3); // inside " daily."
  });

  it("returns null past the end", () => {
    expect(chunkAtOffset(CHUNKS, "a", 999)).toBeNull();
  });

  it("agrees with sideText on a real diff", () => {
    const { chunks } = literalDiff(
      "alpha beta gamma delta epsilon",
      "alpha BETA gamma zeta epsilon",
    );
    const text = sideText(chunks, "b");
    const at = text.indexOf("zeta");
    const idx = chunkAtOffset(chunks, "b", at);
    expect(idx).not.toBeNull();
    expect(chunks[idx!].text.toLowerCase()).toContain("zeta"[0]);
  });
});

describe("searchSide", () => {
  it("finds case-insensitive matches with side offsets", () => {
    const matches = searchSide(CHUNKS, "a", "DOSE");
    expect(matches).toEqual([{ side: "a", offset: 4 }]);
  });

  it("finds side-specific text", () => {
    expect(searchSide(CHUNKS, "a", "20mg")).toHaveLength(1);
    expect(searchSide(CHUNKS, "b", "20mg")).toHaveLength(0);
    expect(searchSide(CHUNKS, "b", "40mg")).toHaveLength(1);
  });

  it("returns nothing for an empty query", () => {
    expect(searchSide(CHUNKS, "a", "")).toHaveLength(0);
  });
});

describe("jumpTargets", () => {
  it("uses pages when present", () => {
    const paragraphs = [
      { style: "body", offset: 0, length: 10, page: 1 },
      { style: "body", offset: 11, length: 10, page: 1 },
      { style: "body", offset: 22, length: 10, page: 2 },
    ];
    const targets = jumpTargets(paragraphs, CHUNKS, "a");
    expect(targets).toEqual([
      { label: "Page 1", offset: 0 },
      { label: "Page 2", offset: 22 },
    ]);
  });

  it("falls back to headings without pages", () => {
    const text = "Introduction. Body text here. Conclusion!";
    const chunks: DiffChunk[] = [{ op: "equal", text, offsetA: 0, offsetB: 0 }];
    const paragraphs = [
      { style: "heading1", offset: 0, length: 13 },
      { style: "body", offset: 14, length: 15 },
      { style: "heading2", offset: 30, length: 11 },
    ];
    const targets = jumpTargets(paragraphs, chunks, "a");
    expect(targets.map((t) => t.label)).toEqual(["Introduction.", "Conclusion!"]);
  });

  it("returns empty without paragraphs", () => {
    expect(jumpTargets(undefined, CHUNKS, "a")).toHaveLength(0);
  });
});
