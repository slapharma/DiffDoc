import { NextResponse } from "next/server";
import { getServiceClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";
import { sideText } from "@/lib/diff/navigate";
import { annotateDocx } from "@/lib/export/docx";
import { annotatePdf } from "@/lib/export/pdf";
import type { ExportAnnotation } from "@/lib/export/annotations";
import type { DiffChunk } from "@/lib/diff/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPE: Record<"docx" | "pdf", string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

/**
 * GET /api/comparisons/[id]/download?doc=a|b
 *
 * If the document has reviewer annotations (comments on either side, edits on
 * the Primary), this returns an annotated copy with a "DiffDoc Annotations"
 * appendix; otherwise it 307-redirects to a short-lived signed URL of the
 * untouched original.
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
  const side = doc as "a" | "b";

  const supabase = getServiceClient();
  const { data: comparison, error } = await supabase
    .from("comparisons")
    .select("title, doc_a_path, doc_a_name, doc_b_path, doc_b_name")
    .eq("id", id)
    .maybeSingle();
  if (error || !comparison) {
    return NextResponse.json({ error: "Comparison not found." }, { status: 404 });
  }

  const path = side === "a" ? comparison.doc_a_path : comparison.doc_b_path;
  const name = (side === "a" ? comparison.doc_a_name : comparison.doc_b_name) ?? "document";
  if (!path) {
    return NextResponse.json({ error: "Document not available." }, { status: 404 });
  }

  // Gather annotations for this side: comments (both sides) and edits (Primary).
  const [commentsRes, editsRes] = await Promise.all([
    supabase
      .from("comments")
      .select("location, text, resolved, created_at")
      .eq("comparison_id", id)
      .eq("doc_side", side)
      .order("created_at", { ascending: true }),
    side === "a"
      ? supabase
          .from("edits")
          .select("location, before_text, after_text, created_at")
          .eq("comparison_id", id)
          .eq("doc_side", "a")
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const comments = commentsRes.data ?? [];
  const edits = (editsRes.data ?? []) as {
    location: { offset: number; length: number };
    before_text: string | null;
    after_text: string | null;
    created_at: string;
  }[];
  const count = comments.length + edits.length;

  await supabase.from("audit_events").insert({
    comparison_id: id,
    event_type: "document_downloaded",
    payload_jsonb: {
      role: side === "a" ? "primary" : "comparator",
      filename: name,
      annotated: count > 0,
      annotation_count: count,
    },
  });

  // Fast path: no annotations → redirect to the pristine original.
  if (count === 0) {
    const { data, error: signError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(path, 60, { download: name });
    if (signError || !data) {
      return NextResponse.json(
        { error: `Could not create download link: ${signError?.message ?? "unknown"}` },
        { status: 502 },
      );
    }
    return NextResponse.redirect(data.signedUrl);
  }

  // Annotated path: build the copy server-side.
  const dl = await supabase.storage.from(DOCUMENTS_BUCKET).download(path);
  if (dl.error || !dl.data) {
    return NextResponse.json({ error: "Original document could not be read." }, { status: 502 });
  }
  const original = Buffer.from(await dl.data.arrayBuffer());

  // Reconstruct each comment's quoted text from the stored chunk stream.
  let chunks: DiffChunk[] = [];
  const parsed = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(`parsed/${id}/chunks.json`);
  if (parsed.data) {
    try {
      chunks = (JSON.parse(await parsed.data.text()).chunks ?? []) as DiffChunk[];
    } catch {
      chunks = [];
    }
  }
  const text = sideText(chunks, side);
  const role: "Primary" | "Comparator" = side === "a" ? "Primary" : "Comparator";

  const annotations: ExportAnnotation[] = [
    ...edits.map((e) => ({
      kind: "edit" as const,
      role,
      quote: e.before_text ?? "",
      body: e.after_text ?? "",
      resolved: false,
      createdAt: e.created_at,
    })),
    ...comments.map((c) => ({
      kind: "comment" as const,
      role,
      quote: text.slice(c.location.offset, c.location.offset + c.location.length),
      body: c.text,
      resolved: c.resolved,
      createdAt: c.created_at,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const ext: "docx" | "pdf" = path.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
  const meta = {
    title: comparison.title ?? `${comparison.doc_a_name ?? "Primary"} vs ${comparison.doc_b_name ?? "Comparator"}`,
    generatedAt: `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`,
  };

  const annotated =
    ext === "pdf"
      ? await annotatePdf(original, annotations, meta)
      : await annotateDocx(original, annotations, meta);

  const downloadName = annotatedFilename(name, ext);
  return new NextResponse(new Uint8Array(annotated), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE[ext],
      "Content-Disposition": contentDisposition(downloadName),
      "Cache-Control": "no-store",
    },
  });
}

/** Insert " (annotated)" before the extension. */
function annotatedFilename(name: string, ext: "docx" | "pdf"): string {
  const dot = name.toLowerCase().lastIndexOf(`.${ext}`);
  const stem = dot > 0 ? name.slice(0, dot) : name.replace(/\.(docx|pdf)$/i, "");
  return `${stem} (annotated).${ext}`;
}

/** RFC 5987 content-disposition with an ASCII fallback for non-ASCII names. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
