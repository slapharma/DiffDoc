import { describe, expect, it } from "vitest";
import { selectViewMode } from "../lib/pipeline/view-mode";
import {
  chunksToDifferenceRows,
  MAX_DIFFERENCE_ROWS,
} from "../lib/pipeline/differences";
import type { DiffChunk } from "../lib/diff/types";

describe("selectViewMode", () => {
  it("recommends side-by-side above 75", () => {
    expect(selectViewMode(87)).toBe("side_by_side");
    expect(selectViewMode(75.01)).toBe("side_by_side");
    expect(selectViewMode(100)).toBe("side_by_side");
  });

  it("recommends aligned sections between 40 and 75 inclusive", () => {
    expect(selectViewMode(75)).toBe("aligned_sections");
    expect(selectViewMode(58)).toBe("aligned_sections");
    expect(selectViewMode(40)).toBe("aligned_sections");
  });

  it("recommends summary-first below 40", () => {
    expect(selectViewMode(39.99)).toBe("summary_first");
    expect(selectViewMode(0)).toBe("summary_first");
  });
});

describe("chunksToDifferenceRows", () => {
  const ID = "00000000-0000-0000-0000-000000000001";

  it("skips equal chunks and maps insert/delete anchors", () => {
    const chunks: DiffChunk[] = [
      { op: "equal", text: "The dose is ", offsetA: 0, offsetB: 0 },
      { op: "delete", text: "20mg", offsetA: 12, offsetB: 12 },
      { op: "insert", text: "40mg", offsetA: 16, offsetB: 12 },
      { op: "equal", text: " daily.", offsetA: 16, offsetB: 16 },
    ];
    const rows = chunksToDifferenceRows(ID, chunks);
    expect(rows).toHaveLength(2);

    const [del, ins] = rows;
    expect(del.type).toBe("delete");
    expect(del.location_a).toEqual({ offset: 12, length: 4 });
    expect(del.location_b).toEqual({ offset: 12, length: 0 });

    expect(ins.type).toBe("insert");
    expect(ins.location_a).toEqual({ offset: 16, length: 0 });
    expect(ins.location_b).toEqual({ offset: 12, length: 4 });
  });

  it("returns no rows for identical documents", () => {
    const chunks: DiffChunk[] = [
      { op: "equal", text: "same", offsetA: 0, offsetB: 0 },
    ];
    expect(chunksToDifferenceRows(ID, chunks)).toHaveLength(0);
  });

  it("caps output at MAX_DIFFERENCE_ROWS", () => {
    const chunks: DiffChunk[] = Array.from({ length: MAX_DIFFERENCE_ROWS + 50 }, (_, i) => ({
      op: "insert" as const,
      text: "x",
      offsetA: i,
      offsetB: i,
    }));
    expect(chunksToDifferenceRows(ID, chunks)).toHaveLength(MAX_DIFFERENCE_ROWS);
  });
});
