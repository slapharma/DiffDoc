import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EDIT_LENGTH = 5000;

/**
 * POST /api/comparisons/[id]/edits
 * body: { doc_side: "a", location: { offset, length }, before_text, after_text }
 *
 * In-place edits are only allowed on the Primary document (doc_side "a") —
 * the Comparator is the incoming document under review and stays read-only.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid comparison id." }, { status: 400 });
  }

  let body: {
    doc_side?: unknown;
    location?: unknown;
    before_text?: unknown;
    after_text?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  if (body.doc_side !== "a") {
    return NextResponse.json(
      { error: "Editing is only allowed on the Primary document." },
      { status: 403 },
    );
  }
  const location = body.location as { offset?: unknown; length?: unknown } | undefined;
  const before = typeof body.before_text === "string" ? body.before_text : null;
  const after = typeof body.after_text === "string" ? body.after_text : null;
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
  if (before === null || after === null || after.length > MAX_EDIT_LENGTH) {
    return NextResponse.json(
      { error: `before_text and after_text are required (after up to ${MAX_EDIT_LENGTH} chars).` },
      { status: 400 },
    );
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("edits")
    .insert({
      comparison_id: id,
      doc_side: "a",
      location: { offset: location.offset, length: location.length },
      before_text: before,
      after_text: after,
    })
    .select("id, doc_side, location, before_text, after_text, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: `Could not save edit: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  await supabase.from("audit_events").insert({
    comparison_id: id,
    event_type: "edit_made",
    payload_jsonb: {
      edit_id: data.id,
      role: "primary",
      location: data.location,
      before_text: before,
      after_text: after,
    },
  });

  return NextResponse.json({ edit: data }, { status: 201 });
}
