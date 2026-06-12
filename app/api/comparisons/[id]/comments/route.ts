import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMMENT_LENGTH = 2000;

/**
 * POST /api/comparisons/[id]/comments
 * body: { doc_side: "a"|"b", location: { offset, length }, text }
 * Comments are allowed on both the Primary and the Comparator.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid comparison id." }, { status: 400 });
  }

  let body: { doc_side?: unknown; location?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const side = body.doc_side;
  const location = body.location as { offset?: unknown; length?: unknown } | undefined;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (side !== "a" && side !== "b") {
    return NextResponse.json({ error: "doc_side must be 'a' or 'b'." }, { status: 400 });
  }
  if (
    !location ||
    !Number.isInteger(location.offset) ||
    !Number.isInteger(location.length) ||
    (location.offset as number) < 0 ||
    (location.length as number) <= 0
  ) {
    return NextResponse.json(
      { error: "location must include a non-negative offset and positive length." },
      { status: 400 },
    );
  }
  if (!text || text.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `text must be 1–${MAX_COMMENT_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comments")
    .insert({
      comparison_id: id,
      doc_side: side,
      location: { offset: location.offset, length: location.length },
      text,
    })
    .select("id, doc_side, location, text, resolved, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: `Could not save comment: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  await supabase.from("audit_events").insert({
    comparison_id: id,
    event_type: "comment_added",
    payload_jsonb: {
      comment_id: data.id,
      role: side === "a" ? "primary" : "comparator",
      location: data.location,
      text,
    },
  });

  return NextResponse.json({ comment: data }, { status: 201 });
}
