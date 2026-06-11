import type { DiffChunk } from "./types";

/**
 * Side-scoped text utilities for search and jump-to navigation. A "side" is
 * one document's plain-text projection: pane A (Primary) renders equal +
 * delete chunks, pane B (Comparator) renders equal + insert chunks, and the
 * chunk offsets (offsetA/offsetB) are positions in that projection.
 */
export type Side = "a" | "b";

function lengthOn(chunk: DiffChunk, side: Side): number {
  if (chunk.op === "equal") return chunk.text.length;
  if (side === "a") return chunk.op === "delete" ? chunk.text.length : 0;
  return chunk.op === "insert" ? chunk.text.length : 0;
}

/** Reconstruct one document's full text from the chunk stream. */
export function sideText(chunks: DiffChunk[], side: Side): string {
  let out = "";
  for (const chunk of chunks) {
    if (lengthOn(chunk, side) > 0) out += chunk.text;
  }
  return out;
}

/** Index of the chunk containing `offset` in the side's text, or null. */
export function chunkAtOffset(
  chunks: DiffChunk[],
  side: Side,
  offset: number,
): number | null {
  // Chunk side-offsets are monotonically non-decreasing; binary search the
  // last chunk starting at or before `offset`, then walk back over any
  // zero-width chunks at the same position.
  let lo = 0;
  let hi = chunks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = side === "a" ? chunks[mid].offsetA : chunks[mid].offsetB;
    if (start <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = found; i >= 0; i--) {
    const start = side === "a" ? chunks[i].offsetA : chunks[i].offsetB;
    const length = lengthOn(chunks[i], side);
    if (length > 0 && start <= offset && offset < start + length) return i;
    if (start + length < offset) break;
  }
  return null;
}

export type SearchMatch = { side: Side; offset: number };

export const MAX_MATCHES_PER_SIDE = 200;

/** Case-insensitive substring search over one side's text. */
export function searchSide(
  chunks: DiffChunk[],
  side: Side,
  query: string,
): SearchMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const text = sideText(chunks, side).toLowerCase();
  const matches: SearchMatch[] = [];
  let from = 0;
  while (matches.length < MAX_MATCHES_PER_SIDE) {
    const at = text.indexOf(q, from);
    if (at === -1) break;
    matches.push({ side, offset: at });
    from = at + Math.max(1, q.length);
  }
  return matches;
}

export type JumpTarget = { label: string; offset: number };

type SkeletonParagraph = { style: string; offset: number; length: number; page?: number };

const MAX_JUMP_TARGETS = 60;

/**
 * Build jump-to entries for one document: pages when the parser provided
 * page numbers (PDFs), otherwise top-level headings (DOCX).
 */
export function jumpTargets(
  paragraphs: SkeletonParagraph[] | undefined,
  chunks: DiffChunk[],
  side: Side,
): JumpTarget[] {
  if (!paragraphs || paragraphs.length === 0) return [];

  const hasPages = paragraphs.some((p) => p.page !== undefined);
  const targets: JumpTarget[] = [];

  if (hasPages) {
    let lastPage: number | undefined;
    for (const p of paragraphs) {
      if (p.page !== undefined && p.page !== lastPage) {
        lastPage = p.page;
        targets.push({ label: `Page ${p.page}`, offset: p.offset });
        if (targets.length >= MAX_JUMP_TARGETS) break;
      }
    }
    return targets;
  }

  const text = sideText(chunks, side);
  for (const p of paragraphs) {
    if (p.style !== "heading1" && p.style !== "heading2") continue;
    const label = text.slice(p.offset, p.offset + p.length).trim().replace(/\s+/g, " ");
    if (!label) continue;
    targets.push({
      label: label.length > 48 ? `${label.slice(0, 48)}…` : label,
      offset: p.offset,
    });
    if (targets.length >= MAX_JUMP_TARGETS) break;
  }
  return targets;
}
