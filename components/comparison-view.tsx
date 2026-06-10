"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  FileText,
  GitCompare,
  Hash,
  Layers,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";

/** Mirrors lib/diff DiffChunk — duplicated here to keep this a client-only import. */
export type Chunk = {
  op: "equal" | "insert" | "delete";
  text: string;
  offsetA: number;
  offsetB: number;
};

export type ComparisonData = {
  comparison: {
    id: string;
    doc_a_name: string | null;
    doc_b_name: string | null;
    doc_a_hash: string | null;
    doc_b_hash: string | null;
    similarity_score: number | null;
    view_mode: string | null;
    created_at: string;
  };
  parsed: {
    doc_a: { metadata?: { pageCount?: number; wordCount?: number } };
    doc_b: { metadata?: { pageCount?: number; wordCount?: number } };
    chunks: Chunk[];
  };
};

type ModeId = "side_by_side" | "aligned_sections" | "summary_first";

const MODE_META: Record<ModeId, { label: string; icon: typeof GitCompare }> = {
  side_by_side: { label: "Side-by-side", icon: GitCompare },
  aligned_sections: { label: "Aligned sections", icon: Layers },
  summary_first: { label: "Summary-first", icon: BookOpen },
};

export function ComparisonView({ data }: { data: ComparisonData }) {
  const { comparison, parsed } = data;
  const [mode, setMode] = useState<ModeId>("side_by_side");
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);

  const changes = useMemo(
    () =>
      parsed.chunks
        .map((chunk, index) => ({ chunk, index }))
        .filter(({ chunk }) => chunk.op !== "equal" && chunk.text.trim().length > 0),
    [parsed.chunks],
  );

  const recommended = (comparison.view_mode ?? "side_by_side") as ModeId;
  const similarity = comparison.similarity_score;

  function jumpTo(index: number, op: Chunk["op"]) {
    setSelectedChunk(index);
    const pane = op === "delete" ? "a" : "b";
    document
      .getElementById(`chunk-${pane}-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      <header className="border-b border-stone-200 bg-white">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 bg-stone-900 rounded-sm flex items-center justify-center">
                <GitCompare className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-mono font-semibold tracking-tight text-base">diffdoc</span>
            </a>
            <div className="px-3 py-1.5 rounded-md bg-stone-100 text-stone-700 flex items-center gap-2 text-sm">
              <FileText className="w-3.5 h-3.5" />
              <span className="font-medium">{comparison.doc_a_name ?? "Document A"}</span>
              <span className="text-stone-400">vs</span>
              <span className="font-medium">{comparison.doc_b_name ?? "Document B"}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-gradient-to-r from-amber-50 to-stone-50 border-t border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-stone-700">
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span>
              Recommended view{" "}
              <span className="font-semibold text-stone-900">
                {MODE_META[recommended]?.label ?? recommended}
              </span>
              {similarity != null && (
                <>
                  {" "}
                  · similarity{" "}
                  <span className="font-mono font-semibold">{similarity}%</span>
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-md p-0.5">
            {(Object.keys(MODE_META) as ModeId[]).map((id) => {
              const Icon = MODE_META[id].icon;
              const active = mode === id;
              return (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1.5 transition-colors ${
                    active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {MODE_META[id].label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="flex" style={{ height: "calc(100vh - 116px)" }}>
        <aside className="w-72 border-r border-stone-200 bg-white flex flex-col">
          <div className="p-4 border-b border-stone-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Differences
            </h3>
            <span className="font-mono text-xs text-stone-400">{changes.length} total</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {changes.length === 0 && (
              <p className="p-4 text-sm text-stone-500">
                No differences found — the documents are textually identical.
              </p>
            )}
            {changes.map(({ chunk, index }) => {
              const isSelected = selectedChunk === index;
              const insert = chunk.op === "insert";
              return (
                <button
                  key={index}
                  onClick={() => jumpTo(index, chunk.op)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-stone-100 hover:bg-stone-50 transition-colors ${
                    insert ? "border-l-green-500 bg-green-50/40" : "border-l-red-500 bg-red-50/40"
                  } ${isSelected ? "ring-1 ring-stone-900 bg-stone-50" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {insert ? (
                      <Plus className="w-3 h-3 text-green-700" />
                    ) : (
                      <Minus className="w-3 h-3 text-red-700" />
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-stone-400">
                      {insert ? "Added in B" : "Removed from A"}
                    </span>
                  </div>
                  <p className="text-sm text-stone-800 leading-snug line-clamp-2">
                    {snippet(chunk.text)}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden bg-stone-50">
          {mode === "side_by_side" ? (
            <div className="flex h-full">
              <ChunkPane
                pane="a"
                label={comparison.doc_a_name ?? "Document A"}
                meta={parsed.doc_a.metadata}
                chunks={parsed.chunks}
                selectedChunk={selectedChunk}
              />
              <div className="w-px bg-stone-200" />
              <ChunkPane
                pane="b"
                label={comparison.doc_b_name ?? "Document B"}
                meta={parsed.doc_b.metadata}
                chunks={parsed.chunks}
                selectedChunk={selectedChunk}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center px-6">
                <Sparkles className="w-8 h-8 text-amber-700 mx-auto mb-3" />
                <h2 className="font-semibold text-stone-900 mb-2">
                  {MODE_META[mode].label} arrives with the AI layer
                </h2>
                <p className="text-sm text-stone-600 mb-4">
                  Semantic alignment and thematic summaries are part of the next build phase.
                  Side-by-side shows every literal change today.
                </p>
                <button
                  onClick={() => setMode("side_by_side")}
                  className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-md hover:bg-stone-800"
                >
                  Back to side-by-side
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="border-t border-stone-200 bg-white px-6 py-2 flex items-center justify-between text-xs text-stone-500 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Hash className="w-3 h-3" />
            {shortHash(comparison.doc_a_hash)} vs {shortHash(comparison.doc_b_hash)}
          </span>
          <span>{new Date(comparison.created_at).toLocaleString()}</span>
        </div>
        <span>v0.1.0-beta</span>
      </footer>
    </div>
  );
}

function ChunkPane({
  pane,
  label,
  meta,
  chunks,
  selectedChunk,
}: {
  pane: "a" | "b";
  label: string;
  meta?: { pageCount?: number; wordCount?: number };
  chunks: Chunk[];
  selectedChunk: number | null;
}) {
  const hidden = pane === "a" ? "insert" : "delete";
  return (
    <div className="flex-1 flex flex-col bg-white min-w-0">
      <div className="px-6 py-2.5 border-b border-stone-100 bg-stone-50/50">
        <div className="text-sm font-medium text-stone-900 truncate">{label}</div>
        <div className="text-xs text-stone-500">
          {meta?.pageCount ? `${meta.pageCount} pages · ` : ""}
          {meta?.wordCount ? `${meta.wordCount.toLocaleString()} words` : ""}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto font-serif text-stone-800 leading-relaxed whitespace-pre-wrap break-words">
          {chunks.map((chunk, index) => {
            if (chunk.op === hidden) return null;
            const isSelected = selectedChunk === index;
            const cls =
              chunk.op === "equal"
                ? ""
                : chunk.op === "delete"
                  ? "bg-red-100 text-red-900 rounded line-through decoration-red-500"
                  : "bg-green-100 text-green-900 rounded";
            return (
              <span
                key={index}
                id={`chunk-${pane}-${index}`}
                className={`${cls} ${isSelected && chunk.op !== "equal" ? "ring-2 ring-stone-900" : ""}`}
              >
                {chunk.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function snippet(text: string, max = 90): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : "—";
}
