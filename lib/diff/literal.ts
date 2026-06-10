import DiffMatchPatch from "diff-match-patch";
import type { DiffChunk, LiteralDiffResult } from "./types";

/**
 * Literal character-level diff via Google's diff-match-patch, then
 * collapsed to word boundaries so the AI layer downstream gets
 * coherent chunks rather than per-character noise.
 *
 * Returns chunks anchored to offsets in both inputs. `equal` chunks are
 * included so callers can render full context if they want.
 */
export function literalDiff(a: string, b: string): LiteralDiffResult {
  const dmp = new DiffMatchPatch();
  dmp.Diff_Timeout = 5; // seconds

  const rawDiffs = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(rawDiffs);

  const chunks: DiffChunk[] = [];
  let offsetA = 0;
  let offsetB = 0;
  let changedChars = 0;
  const totalChars = Math.max(a.length, b.length, 1);

  for (const [op, text] of rawDiffs) {
    if (op === 0) {
      chunks.push({ op: "equal", text, offsetA, offsetB });
      offsetA += text.length;
      offsetB += text.length;
    } else if (op === -1) {
      chunks.push({ op: "delete", text, offsetA, offsetB });
      offsetA += text.length;
      changedChars += text.length;
    } else if (op === 1) {
      chunks.push({ op: "insert", text, offsetA, offsetB });
      offsetB += text.length;
      changedChars += text.length;
    }
  }

  const similarity = Math.max(0, Math.min(1, 1 - changedChars / totalChars));

  return { chunks, similarity };
}

/**
 * Drop `equal` chunks. Useful for the AI pipeline which only wants the
 * actually-different regions.
 */
export function changedChunks(result: LiteralDiffResult): DiffChunk[] {
  return result.chunks.filter((c) => c.op !== "equal");
}
