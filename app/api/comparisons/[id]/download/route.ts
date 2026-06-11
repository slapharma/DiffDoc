import { NextResponse } from "next/server";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/comparisons/[id]/download?doc=a|b
 *
 * Redirects to a short-lived signed Storage URL for the original document,
 * with a content-disposition that restores the uploaded filename.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const doc = new URL(request.url).searchParams.get("doc");
  if (!UUID_RE.test(id) || (doc !== "a" && doc !== "b")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: comparison, error } = await supabase
    .from("comparisons")
    .select("doc_a_path, doc_a_name, doc_b_path, doc_b_name")
    .eq("id", id)
    .maybeSingle();
  if (error || !comparison) {
    return NextResponse.json({ error: "Comparison not found." }, { status: 404 });
  }

  const path = doc === "a" ? comparison.doc_a_path : comparison.doc_b_path;
  const name = doc === "a" ? comparison.doc_a_name : comparison.doc_b_name;
  if (!path) {
    return NextResponse.json({ error: "Document not available." }, { status: 404 });
  }

  const { data, error: signError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60, { download: name ?? undefined });
  if (signError || !data) {
    return NextResponse.json(
      { error: `Could not create download link: ${signError?.message ?? "unknown"}` },
      { status: 502 },
    );
  }

  await supabase.from("audit_events").insert({
    comparison_id: id,
    event_type: "document_downloaded",
    payload_jsonb: { role: doc === "a" ? "primary" : "comparator", filename: name },
  });

  return NextResponse.redirect(data.signedUrl);
}
