import { NextResponse } from "next/server";
import { processComparison } from "@/lib/pipeline/process";

export const runtime = "nodejs";
// Interim home for processing: fine for small documents. Heavy documents move
// to the Railway worker (same pipeline module) when it lands.
export const maxDuration = 60;

/** POST /api/process — body: { comparison_id }. Runs the parse + diff pipeline. */
export async function POST(request: Request): Promise<Response> {
  let comparisonId: string;
  try {
    const body = await request.json();
    comparisonId = body.comparison_id;
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }
  if (typeof comparisonId !== "string" || !comparisonId) {
    return NextResponse.json({ error: "comparison_id is required." }, { status: 400 });
  }

  const result = await processComparison(comparisonId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }
  return NextResponse.json({
    comparison_id: comparisonId,
    status: "complete",
    similarity_score: result.similarityScore,
    view_mode: result.viewMode,
    difference_count: result.differenceCount,
  });
}
