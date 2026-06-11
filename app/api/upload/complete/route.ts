import { NextResponse } from "next/server";
import { sha256 } from "@/lib/document/util";
import { validateUpload, MAGIC_HEAD_BYTES } from "@/lib/upload/validate";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/upload/complete
 *
 * Second leg of the direct-to-Storage flow: after the browser has uploaded
 * both files to the paths minted by /api/upload/init, this validates the real
 * bytes (size, magic numbers), hashes them, and creates the comparison row.
 * Invalid uploads are deleted from Storage.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { comparison_id?: unknown; doc_a_name?: unknown; doc_b_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const comparisonId = typeof body.comparison_id === "string" ? body.comparison_id : "";
  if (!UUID_RE.test(comparisonId)) {
    return NextResponse.json({ error: "comparison_id is required." }, { status: 400 });
  }

  const supabase = getServiceClient();
  const sides = [
    { side: "a" as const, name: body.doc_a_name },
    { side: "b" as const, name: body.doc_b_name },
  ];

  const files: { side: "a" | "b"; name: string; path: string; hash: string }[] = [];
  const uploadedPaths: string[] = [];

  for (const { side, name } of sides) {
    if (typeof name !== "string" || !name) {
      return NextResponse.json({ error: `doc_${side}_name is required.` }, { status: 400 });
    }
    const lower = name.toLowerCase();
    const ext = lower.endsWith(".docx") ? "docx" : lower.endsWith(".pdf") ? "pdf" : null;
    if (!ext) {
      return NextResponse.json({ error: `Unsupported file type: "${name}".` }, { status: 400 });
    }
    const path = `originals/${comparisonId}/${side}.${ext}`;
    uploadedPaths.push(path);

    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
    if (error || !data) {
      await cleanup(supabase, uploadedPaths);
      return NextResponse.json(
        { error: `Uploaded file for doc_${side} was not found — please retry.` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    const result = validateUpload(name, buffer.byteLength, buffer.subarray(0, MAGIC_HEAD_BYTES));
    if (!result.ok) {
      await cleanup(supabase, uploadedPaths);
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    files.push({ side, name, path, hash: sha256(buffer) });
  }

  const [a, b] = files;
  const { error: insertError } = await supabase.from("comparisons").insert({
    id: comparisonId,
    doc_a_path: a.path,
    doc_a_hash: a.hash,
    doc_a_name: a.name,
    doc_b_path: b.path,
    doc_b_hash: b.hash,
    doc_b_name: b.name,
    status: "pending",
  });
  if (insertError) {
    await cleanup(supabase, uploadedPaths);
    return NextResponse.json(
      { error: `Could not create comparison: ${insertError.message}` },
      { status: 500 },
    );
  }

  const { error: auditError } = await supabase.from("audit_events").insert({
    comparison_id: comparisonId,
    event_type: "comparison_created",
    payload_jsonb: {
      // doc_a is the Primary document, doc_b the Comparator — this role
      // convention is fixed and referenced by all feature/action events.
      doc_a: { role: "primary", filename: a.name, sha256: a.hash },
      doc_b: { role: "comparator", filename: b.name, sha256: b.hash },
    },
  });
  if (auditError) {
    console.error(`audit_events insert failed for ${comparisonId}:`, auditError.message);
  }

  return NextResponse.json({ comparison_id: comparisonId, status: "pending" }, { status: 201 });
}

async function cleanup(
  supabase: ReturnType<typeof getServiceClient>,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
  if (error) {
    console.error("Failed to clean up uploads:", paths, error.message);
  }
}
