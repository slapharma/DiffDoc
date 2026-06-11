import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/comparisons — recent comparisons for the home-page list.
 * Pre-auth this is global; once Supabase Auth lands (Phase 5) it scopes to
 * the signed-in user.
 */
export async function GET(): Promise<Response> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comparisons")
    .select("id, title, doc_a_name, doc_b_name, similarity_score, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ comparisons: data ?? [] });
}
