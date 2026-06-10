import { parseDocument } from "@/lib/document";
import { literalDiff } from "@/lib/diff/literal";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";
import { selectViewMode } from "./view-mode";
import { chunksToDifferenceRows, MAX_DIFFERENCE_ROWS } from "./differences";

export type ProcessResult =
  | { ok: true; similarityScore: number; viewMode: string; differenceCount: number }
  | { ok: false; error: string };

/**
 * Process a pending comparison end-to-end: download both originals from
 * Storage, parse to the internal representation, run the literal diff, and
 * write results back (differences rows, similarity score, view mode, status).
 *
 * Framework-free by design — today this runs inside a Vercel API route for
 * small documents; the Railway worker will import the same function for the
 * heavy path. AI classification (Phase 2) slots in after the literal diff.
 */
export async function processComparison(comparisonId: string): Promise<ProcessResult> {
  const supabase = getServiceClient();

  // Atomically claim the comparison (pending -> processing). Both the upload
  // page and the comparison page may trigger processing; the status guard in
  // the WHERE clause ensures exactly one caller wins and the other no-ops.
  const { data: comparison, error: claimError } = await supabase
    .from("comparisons")
    .update({ status: "processing" })
    .eq("id", comparisonId)
    .eq("status", "pending")
    .select("id, doc_a_path, doc_a_name, doc_b_path, doc_b_name")
    .maybeSingle();
  if (claimError) {
    return { ok: false, error: `Could not claim comparison: ${claimError.message}` };
  }
  if (!comparison) {
    return { ok: false, error: "Comparison not found or not pending." };
  }
  if (!comparison.doc_a_path || !comparison.doc_b_path) {
    await supabase.from("comparisons").update({ status: "failed" }).eq("id", comparisonId);
    return { ok: false, error: "Comparison has no stored documents." };
  }

  try {
    const [bufA, bufB] = await Promise.all([
      downloadToBuffer(comparison.doc_a_path),
      downloadToBuffer(comparison.doc_b_path),
    ]);

    const [docA, docB] = await Promise.all([
      parseDocument(bufA, { filename: comparison.doc_a_name ?? comparison.doc_a_path }),
      parseDocument(bufB, { filename: comparison.doc_b_name ?? comparison.doc_b_path }),
    ]);

    const diff = literalDiff(docA.plainText, docB.plainText);
    const similarityScore = Math.round(diff.similarity * 10000) / 100; // 0..100, 2dp
    const viewMode = selectViewMode(similarityScore);

    // Persist the full chunk stream (including equal runs) so the UI can
    // reconstruct both documents without re-parsing. Paragraph skeletons
    // (style + offsets, no text — text comes from the chunks) let the UI
    // render headings and structure instead of a flat text wall.
    const chunksPayload = JSON.stringify({
      doc_a: {
        name: comparison.doc_a_name,
        metadata: docA.metadata,
        paragraphs: paragraphSkeletons(docA),
      },
      doc_b: {
        name: comparison.doc_b_name,
        metadata: docB.metadata,
        paragraphs: paragraphSkeletons(docB),
      },
      chunks: diff.chunks,
    });
    const { error: chunksError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(`parsed/${comparisonId}/chunks.json`, chunksPayload, {
        contentType: "application/json",
        upsert: true,
      });
    if (chunksError) throw new Error(`Failed to store parsed chunks: ${chunksError.message}`);

    const rows = chunksToDifferenceRows(comparisonId, diff.chunks);
    if (rows.length > 0) {
      const { error: rowsError } = await supabase.from("differences").insert(rows);
      if (rowsError) throw new Error(`Failed to store differences: ${rowsError.message}`);
    }

    const { error: updateError } = await supabase
      .from("comparisons")
      .update({
        similarity_score: similarityScore,
        view_mode: viewMode,
        status: "complete",
      })
      .eq("id", comparisonId);
    if (updateError) throw new Error(`Failed to finalise comparison: ${updateError.message}`);

    await supabase.from("audit_events").insert({
      comparison_id: comparisonId,
      event_type: "comparison_processed",
      payload_jsonb: {
        similarity_score: similarityScore,
        view_mode: viewMode,
        difference_count: rows.length,
        differences_truncated: rows.length >= MAX_DIFFERENCE_ROWS,
        doc_a: docA.metadata,
        doc_b: docB.metadata,
      },
    });

    return { ok: true, similarityScore, viewMode, differenceCount: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("comparisons").update({ status: "failed" }).eq("id", comparisonId);
    await supabase.from("audit_events").insert({
      comparison_id: comparisonId,
      event_type: "comparison_failed",
      payload_jsonb: { error: message },
    });
    return { ok: false, error: message };
  }
}

type ParagraphSkeleton = {
  style: string;
  offset: number;
  length: number;
  page?: number;
};

function paragraphSkeletons(doc: {
  sections: {
    heading: string | null;
    level: number;
    offset: number;
    paragraphs: { style: string; offset: number; length: number; page?: number }[];
  }[];
}): ParagraphSkeleton[] {
  return doc.sections.flatMap((section) => {
    const skeletons: ParagraphSkeleton[] = [];
    // Headings live on the section, not in its paragraph list — re-emit them
    // as paragraphs so the UI renders them in place.
    if (section.heading !== null) {
      skeletons.push({
        style: `heading${Math.min(4, Math.max(1, section.level))}`,
        offset: section.offset,
        length: section.heading.length,
      });
    }
    for (const { style, offset, length, page } of section.paragraphs) {
      skeletons.push({ style, offset, length, ...(page !== undefined ? { page } : {}) });
    }
    return skeletons;
  });
}

async function downloadToBuffer(path: string): Promise<Buffer> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) throw new Error(`Failed to download ${path}: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}
