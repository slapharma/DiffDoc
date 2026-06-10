import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { MAX_FILE_BYTES } from "@/lib/upload/validate";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DeclaredFile = { name?: unknown; size?: unknown };

/**
 * POST /api/upload/init
 *
 * First leg of the direct-to-Storage upload flow. Files never pass through
 * this function (Vercel caps request bodies at 4.5 MB) — the browser uploads
 * straight to Supabase Storage using the signed upload URLs minted here, then
 * calls /api/upload/complete. Declared sizes are checked here for fast
 * feedback; the real bytes are re-validated server-side in the complete step.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { doc_a?: DeclaredFile; doc_b?: DeclaredFile };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const comparisonId = randomUUID();
  const supabase = getServiceClient();
  const out: Record<string, { path: string; token: string }> = {};

  for (const side of ["a", "b"] as const) {
    const declared = body[`doc_${side}`];
    const name = typeof declared?.name === "string" ? declared.name : null;
    const size = typeof declared?.size === "number" ? declared.size : null;
    if (!name || size === null) {
      return NextResponse.json(
        { error: `doc_${side} must include name and size.` },
        { status: 400 },
      );
    }

    const lower = name.toLowerCase();
    const ext = lower.endsWith(".docx") ? "docx" : lower.endsWith(".pdf") ? "pdf" : null;
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported file type: "${name}". Only .docx and .pdf are accepted.` },
        { status: 400 },
      );
    }
    if (size === 0) {
      return NextResponse.json({ error: `"${name}" is empty.` }, { status: 400 });
    }
    if (size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${
            MAX_FILE_BYTES / 1024 / 1024
          } MB.`,
        },
        { status: 400 },
      );
    }

    const path = `originals/${comparisonId}/${side}.${ext}`;
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json(
        { error: `Could not prepare upload: ${error?.message ?? "unknown error"}` },
        { status: 502 },
      );
    }
    out[`doc_${side}`] = { path: data.path, token: data.token };
  }

  return NextResponse.json({ comparison_id: comparisonId, ...out });
}
