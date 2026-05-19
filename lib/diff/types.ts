export type DiffOp = "equal" | "insert" | "delete";

/**
 * One literal-level diff chunk, anchored to character offsets in both
 * documents' plain-text projections.
 */
export type DiffChunk = {
  op: DiffOp;
  text: string;
  offsetA: number;
  offsetB: number;
};

export type LiteralDiffResult = {
  chunks: DiffChunk[];
  /** Cheap similarity score: 1 - (changed chars / total chars). 0..1. */
  similarity: number;
};
