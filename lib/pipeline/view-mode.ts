/** View mode values mirror the `view_mode` Postgres enum. */
export type ViewMode = "side_by_side" | "aligned_sections" | "summary_first";

/**
 * Build-plan thresholds: >75 side-by-side, 40–75 aligned sections,
 * <40 summary-first. The score is 0–100. This is a recommendation —
 * the UI always lets the user override.
 */
export function selectViewMode(similarityScore: number): ViewMode {
  if (similarityScore > 75) return "side_by_side";
  if (similarityScore >= 40) return "aligned_sections";
  return "summary_first";
}
