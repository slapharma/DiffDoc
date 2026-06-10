import type { DiffChunk, DiffOp } from "./types";

/**
 * A slice of one document's text with its diff state, produced by projecting
 * the chunk stream onto a character range (typically one paragraph).
 */
export type Segment = {
  text: string;
  op: DiffOp;
  /** Index of the source chunk in the full stream — used for UI anchors. */
  chunkIndex: number;
};

/** Characters a chunk occupies in one side's plain-text projection. */
function lengthOn(chunk: DiffChunk, side: "a" | "b"): number {
  if (chunk.op === "equal") return chunk.text.length;
  if (side === "a") return chunk.op === "delete" ? chunk.text.length : 0;
  return chunk.op === "insert" ? chunk.text.length : 0;
}

/**
 * Project the diff chunk stream onto `[start, end)` of one document's plain
 * text. Chunks that don't exist on that side (inserts for A, deletes for B)
 * have zero width and are skipped. Used to render a paragraph with its
 * highlights without storing paragraph text twice.
 */
export function projectRange(
  chunks: DiffChunk[],
  side: "a" | "b",
  start: number,
  end: number,
): Segment[] {
  const segments: Segment[] = [];
  if (start >= end) return segments;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const length = lengthOn(chunk, side);
    if (length === 0) continue;
    const chunkStart = side === "a" ? chunk.offsetA : chunk.offsetB;
    const chunkEnd = chunkStart + length;
    if (chunkEnd <= start) continue;
    if (chunkStart >= end) break;
    const from = Math.max(start, chunkStart);
    const to = Math.min(end, chunkEnd);
    segments.push({
      text: chunk.text.slice(from - chunkStart, to - chunkStart),
      op: chunk.op,
      chunkIndex: i,
    });
  }
  return segments;
}
