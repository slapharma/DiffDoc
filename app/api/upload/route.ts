import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sha256 } from "@/lib/document/util";
import { validateUpload, MAGIC_HEAD_BYTES } from "@/lib/upload/validate";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";
import type { DocumentFormat } from "@/lib/document/types";

// Parsing happens in the Railway worker, but this route still needs the Node
// runtime for node:crypto and Buffer.
export const runtime = "nodejs";

const CONTENT_TYPE: Record<DocumentFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

type PreparedFile = {
  side: "a" | "b";
  filename: string;
  format: DocumentFormat;
  buffer: Buffer;
  hash: string;
  storagePath: string;
};

/**
 * POST /api/upload
 *
 * Accepts multipart/form-data with two files (`doc_a`, `doc_b`), validates and
 * hashes each, writes the originals to Storage, and inserts a `comparisons` row
 * in `pending` state. The heavy parse + diff is handled later by the Railway
 * worker; this route just gets the bytes safely persisted.
 */
export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with doc_a and doc_b files." },
      { status: 400 },
    );
  }

  const comparisonId = randomUUID();
  const sides = [
    { field: "doc_a", side: "a" as const },
    { field: "doc_b", side: "b" as const },
  ];

  const prepared: PreparedFile[] = [];
  for (const { field, side } of sides) {
    const entry = form.get(field);
    if (!(entry instanceof File)) {
      return NextResponse.json(
        { error: `Missing file field "${field}".` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await entry.arrayBuffer());
    const result = validateUpload(
      entry.name,
      buffer.byteLength,
      buffer.subarray(0, MAGIC_HEAD_BYTES),
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    prepared.push({
      side,
      filename: entry.name,
      format: result.format,
      buffer,
      hash: sha256(buffer),
      storagePath: `originals/${comparisonId}/${side}.${result.format}`,
    });
  }

  const supabase = getServiceClient();

  // Write both originals to Storage. Track what we've written so we can roll
  // back if a later step fails, avoiding orphaned objects.
  const uploaded: string[] = [];
  for (const file of prepared) {
    const { error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(file.storagePath, file.buffer, {
        contentType: CONTENT_TYPE[file.format],
        upsert: false,
      });
    if (error) {
      await cleanup(supabase, uploaded);
      return NextResponse.json(
        { error: `Storage upload failed: ${error.message}` },
        { status: 502 },
      );
    }
    uploaded.push(file.storagePath);
  }

  const [a, b] = prepared;
  const { error: insertError } = await supabase.from("comparisons").insert({
    id: comparisonId,
    doc_a_path: a.storagePath,
    doc_a_hash: a.hash,
    doc_a_name: a.filename,
    doc_b_path: b.storagePath,
    doc_b_hash: b.hash,
    doc_b_name: b.filename,
    status: "pending",
  });
  if (insertError) {
    await cleanup(supabase, uploaded);
    return NextResponse.json(
      { error: `Could not create comparison: ${insertError.message}` },
      { status: 500 },
    );
  }

  // audit_events is the source of truth for the report's actions log. A failure
  // here shouldn't fail the upload — log and continue.
  const { error: auditError } = await supabase.from("audit_events").insert({
    comparison_id: comparisonId,
    event_type: "comparison_created",
    payload_jsonb: {
      doc_a: { filename: a.filename, format: a.format, sha256: a.hash },
      doc_b: { filename: b.filename, format: b.format, sha256: b.hash },
    },
  });
  if (auditError) {
    console.error(`audit_events insert failed for ${comparisonId}:`, auditError.message);
  }

  // TODO(step 3): enqueue the Railway worker to parse + diff this comparison.

  return NextResponse.json(
    { comparison_id: comparisonId, status: "pending" },
    { status: 201 },
  );
}

/** Best-effort removal of objects already written when a later step fails. */
async function cleanup(
  supabase: ReturnType<typeof getServiceClient>,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
  if (error) {
    console.error("Failed to clean up orphaned uploads:", paths, error.message);
  }
}
