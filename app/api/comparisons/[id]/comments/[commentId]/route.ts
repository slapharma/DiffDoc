import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/comparisons/[id]/comments/[commentId] — body: { resolved }. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; commentId: string } },
): Promise<Response> {
  const { id, commentId } = params;
  if (!UUID_RE.test(id) || !UUID_RE.test(commentId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  let resolved: unknown;
  try {
    ({ resolved } = await request.json());
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }
  if (typeof resolved !== "boolean") {
    return NextResponse.json({ error: "resolved must be a boolean." }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ resolved })
    .eq("id", commentId)
    .eq("comparison_id", id)
    .select("id, doc_side, location, text, resolved, created_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Comment not found." }, { status: 404 });
  }

  await supabase.from("audit_events").insert({
    comparison_id: id,
    event_type: resolved ? "comment_resolved" : "comment_reopened",
    payload_jsonb: { comment_id: commentId },
  });

  return NextResponse.json({ comment: data });
}
