import { describe, expect, it } from "vitest";
import { pairChanges, textSimilarity } from "../lib/pipeline/actions";
import { literalDiff } from "../lib/diff/literal";
import type { DiffChunk } from "../lib/diff/types";

describe("pairChanges", () => {
  it("pairs adjacent delete+insert into one classified change", () => {
    const chunks: DiffChunk[] = [
      { op: "equal", text: "The dose is ", offsetA: 0, offsetB: 0 },
      { op: "delete", text: "20mg", offsetA: 12, offsetB: 12 },
      { op: "insert", text: "40mg", offsetA: 16, offsetB: 12 },
      { op: "equal", text: " daily.", offsetA: 16, offsetB: 16 },
    ];
    const entries = pairChanges(chunks);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("modification");
    expect(entries[0].before).toBe("20mg");
    expect(entries[0].after).toBe("40mg");
    expect(entries[0].deleteIndex).toBe(1);
    expect(entries[0].insertIndex).toBe(2);
  });

  it("classifies dissimilar substitutions as replacement", () => {
    const chunks: DiffChunk[] = [
      { op: "delete", text: "physician approval", offsetA: 0, offsetB: 0 },
      { op: "insert", text: "automated workflow", offsetA: 18, offsetB: 0 },
    ];
    expect(pairChanges(chunks)[0].action).toBe("replacement");
  });

  it("classifies case/punctuation-only changes as formatting", () => {
    const chunks: DiffChunk[] = [
      { op: "delete", text: "Hello,  World", offsetA: 0, offsetB: 0 },
      { op: "insert", text: "hello world", offsetA: 13, offsetB: 0 },
    ];
    expect(pairChanges(chunks)[0].action).toBe("formatting");
  });

  it("emits pure inserts and deletes as addition/deletion", () => {
    const chunks: DiffChunk[] = [
      { op: "insert", text: "New section.", offsetA: 0, offsetB: 0 },
      { op: "equal", text: " body ", offsetA: 0, offsetB: 12 },
      { op: "delete", text: "Old appendix.", offsetA: 6, offsetB: 18 },
    ];
    const entries = pairChanges(chunks);
    expect(entries.map((e) => e.action)).toEqual(["addition", "deletion"]);
  });

  it("drops whitespace-only unpaired changes", () => {
    const chunks: DiffChunk[] = [
      { op: "insert", text: "   ", offsetA: 0, offsetB: 0 },
      { op: "equal", text: "same", offsetA: 0, offsetB: 3 },
    ];
    expect(pairChanges(chunks)).toHaveLength(0);
  });

  it("handles a real diff producing a paired modification", () => {
    const { chunks } = literalDiff(
      "Storage between 2 and 30 degrees.",
      "Storage between 15 and 25 degrees.",
    );
    const entries = pairChanges(chunks);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(["modification", "replacement", "formatting"]).toContain(e.action);
    }
  });
});

describe("textSimilarity", () => {
  it("is 1 for identical, near 0 for unrelated", () => {
    expect(textSimilarity("dose", "dose")).toBe(1);
    expect(textSimilarity("apple", "reboot")).toBeLessThan(0.2);
  });
});
