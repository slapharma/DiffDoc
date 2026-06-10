import type { DiffChunk } from "@/lib/diff/types";

/** Shape of a `differences` table insert (Phase 1 — no AI classification yet). */
export type DifferenceRow = {
  comparison_id: string;
  location_a: { offset: number; length: number };
  location_b: { offset: number; length: number };
  type: "insert" | "delete";
};

/** Safety cap so a pathological diff can't write unbounded rows. */
export const MAX_DIFFERENCE_ROWS = 2000;

/**
 * Map non-equal diff chunks to `differences` rows. An insert exists only in
 * doc B (zero-length anchor in A); a delete only in doc A (zero-length anchor
 * in B). The anchors are character offsets into each document's plain-text
 * projection, matching how comments and edits will anchor later.
 */
export function chunksToDifferenceRows(
  comparisonId: string,
  chunks: DiffChunk[],
): DifferenceRow[] {
  const rows: DifferenceRow[] = [];
  for (const chunk of chunks) {
    if (chunk.op === "equal") continue;
    if (rows.length >= MAX_DIFFERENCE_ROWS) break;
    rows.push({
      comparison_id: comparisonId,
      location_a: {
        offset: chunk.offsetA,
        length: chunk.op === "delete" ? chunk.text.length : 0,
      },
      location_b: {
        offset: chunk.offsetB,
        length: chunk.op === "insert" ? chunk.text.length : 0,
      },
      type: chunk.op,
    });
  }
  return rows;
}
