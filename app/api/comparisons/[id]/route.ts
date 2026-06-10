import { NextResponse } from "next/server";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";

export const runtime = "nodejs";
// This endpoint is polled for live status — it must never serve a cached
// response.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/comparisons/[id] — comparison row + differences, and (once
 * processing is complete) the parsed chunk stream the UI renders from.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid comparison id." }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: comparison, error } = await supabase
    .from("comparisons")
    .select(
      "id, doc_a_name, doc_b_name, doc_a_hash, doc_b_hash, similarity_score, view_mode, status, created_at",
    )
    .eq("id", id)
    .single();
  if (error || !comparison) {
    return NextResponse.json({ error: "Comparison not found." }, { status: 404 });
  }

  if (comparison.status !== "complete") {
    return NextResponse.json({ comparison, differences: [], parsed: null });
  }

  const [{ data: differences, error: diffError }, parsed] = await Promise.all([
    supabase
      .from("differences")
      .select("id, location_a, location_b, type, classification, ai_summary, flagged")
      .eq("comparison_id", id)
      .order("created_at", { ascending: true }),
    downloadParsed(id),
  ]);
  if (diffError) {
    return NextResponse.json({ error: diffError.message }, { status: 500 });
  }

  return NextResponse.json({ comparison, differences: differences ?? [], parsed });
}

async function downloadParsed(comparisonId: string): Promise<unknown | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(`parsed/${comparisonId}/chunks.json`);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}
