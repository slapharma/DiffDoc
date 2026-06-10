import type { DiffChunk } from "@/lib/diff/types";

/**
 * Heuristic change-intent classification (no AI). diff-match-patch emits a
 * replacement as a delete chunk immediately followed by an insert chunk —
 * pairing them lets the register show "before -> after" as one change and
 * tag what kind of edit it was.
 */
export type ChangeAction =
  | "addition"
  | "deletion"
  | "modification" // same word/phrase lightly altered (inflection, typo, small edit)
  | "replacement" // substituted with different text
  | "formatting"; // only case / punctuation / whitespace differ

export const ACTION_LABELS: Record<ChangeAction, string> = {
  addition: "Addition",
  deletion: "Deletion",
  modification: "Word modification",
  replacement: "Word replacement",
  formatting: "Formatting",
};

export type ChangeEntry = {
  action: ChangeAction;
  /** Chunk indices into the full stream; a paired change has both. */
  deleteIndex?: number;
  insertIndex?: number;
  /** Removed text (doc A side), if any. */
  before?: string;
  /** Added text (doc B side), if any. */
  after?: string;
};

/** Strip everything except letters and digits, lowercased. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Dice coefficient over character bigrams, capped for long inputs. 0..1. */
export function textSimilarity(a: string, b: string): number {
  const A = a.slice(0, 200).toLowerCase();
  const B = b.slice(0, 200).toLowerCase();
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const mA = bigrams(A);
  const mB = bigrams(B);
  let common = 0;
  for (const [bg, count] of mA) common += Math.min(count, mB.get(bg) ?? 0);
  return (2 * common) / (A.length - 1 + B.length - 1);
}

const MODIFICATION_THRESHOLD = 0.5;

function classifyPair(before: string, after: string): ChangeAction {
  if (normalize(before) === normalize(after)) return "formatting";
  return textSimilarity(before, after) >= MODIFICATION_THRESHOLD
    ? "modification"
    : "replacement";
}

/**
 * Walk the chunk stream and emit one entry per logical change. Adjacent
 * delete+insert (either order) pairs into a single classified change;
 * whitespace-only changes that pair to nothing visible are dropped.
 */
export function pairChanges(chunks: DiffChunk[]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.op === "equal") continue;

    const next = chunks[i + 1];
    const isPair =
      next !== undefined &&
      next.op !== "equal" &&
      next.op !== chunk.op; // delete+insert or insert+delete

    if (isPair) {
      const del = chunk.op === "delete" ? chunk : next;
      const ins = chunk.op === "insert" ? chunk : next;
      const delIndex = chunk.op === "delete" ? i : i + 1;
      const insIndex = chunk.op === "insert" ? i : i + 1;
      if ((del.text + ins.text).trim().length > 0) {
        entries.push({
          action: classifyPair(del.text, ins.text),
          deleteIndex: delIndex,
          insertIndex: insIndex,
          before: del.text,
          after: ins.text,
        });
      }
      i++; // consume the partner chunk
      continue;
    }

    if (chunk.text.trim().length === 0) continue;
    if (chunk.op === "delete") {
      entries.push({ action: "deletion", deleteIndex: i, before: chunk.text });
    } else {
      entries.push({ action: "addition", insertIndex: i, after: chunk.text });
    }
  }
  return entries;
}
