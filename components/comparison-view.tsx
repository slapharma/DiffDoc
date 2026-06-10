"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  FileText,
  GitCompare,
  Hash,
  Layers,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { projectRange } from "@/lib/diff/project";
import { detectFlags, FLAG_LABELS, type FlagReason } from "@/lib/pipeline/flags";
import type { DiffChunk } from "@/lib/diff/types";

export type ParagraphSkeleton = {
  style: string;
  offset: number;
  length: number;
  page?: number;
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
    doc_a: {
      metadata?: { pageCount?: number; wordCount?: number };
      paragraphs?: ParagraphSkeleton[];
    };
    doc_b: {
      metadata?: { pageCount?: number; wordCount?: number };
      paragraphs?: ParagraphSkeleton[];
    };
    chunks: DiffChunk[];
  };
};

type ModeId = "side_by_side" | "aligned_sections" | "summary_first";

const MODE_META: Record<ModeId, { label: string; icon: typeof GitCompare }> = {
  side_by_side: { label: "Side-by-side", icon: GitCompare },
  aligned_sections: { label: "Aligned sections", icon: Layers },
  summary_first: { label: "Summary-first", icon: BookOpen },
};

type Category = "flagged" | "insert" | "delete";

type RegisterEntry = {
  chunk: DiffChunk;
  index: number;
  category: Category;
  reasons: FlagReason[];
};

const MAX_REGISTER_ENTRIES = 500;

export function ComparisonView({ data }: { data: ComparisonData }) {
  const { comparison, parsed } = data;
  const [mode, setMode] = useState<ModeId>("side_by_side");
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(["flagged", "insert", "delete"]),
  );

  const entries = useMemo<RegisterEntry[]>(
    () =>
      parsed.chunks
        .map((chunk, index) => ({ chunk, index }))
        .filter(({ chunk }) => chunk.op !== "equal" && chunk.text.trim().length > 0)
        .map(({ chunk, index }) => {
          const reasons = detectFlags(chunk.text);
          return {
            chunk,
            index,
            reasons,
            category: (reasons.length > 0
              ? "flagged"
              : chunk.op) as Category,
          };
        }),
    [parsed.chunks],
  );

  const counts = useMemo(() => {
    const c: Record<Category, number> = { flagged: 0, insert: 0, delete: 0 };
    for (const e of entries) c[e.category]++;
    return c;
  }, [entries]);

  const visible = entries.filter((e) => activeCategories.has(e.category));
  const shown = visible.slice(0, MAX_REGISTER_ENTRIES);

  const recommended = (comparison.view_mode ?? "side_by_side") as ModeId;
  const similarity = comparison.similarity_score;

  function toggleCategory(cat: Category) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function jumpTo(entry: RegisterEntry) {
    setSelectedChunk(entry.index);
    const pane = entry.chunk.op === "delete" ? "a" : "b";
    document
      .querySelector(`[data-chunk="${pane}-${entry.index}"]`)
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
          <div className="p-4 border-b border-stone-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Differences
              </h3>
              <span className="font-mono text-xs text-stone-400">{entries.length} total</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <FilterChip
                label="Flagged"
                count={counts.flagged}
                active={activeCategories.has("flagged")}
                activeClass="bg-red-50 border-red-200 text-red-700"
                onClick={() => toggleCategory("flagged")}
              />
              <FilterChip
                label="Added"
                count={counts.insert}
                active={activeCategories.has("insert")}
                activeClass="bg-green-50 border-green-200 text-green-800"
                onClick={() => toggleCategory("insert")}
              />
              <FilterChip
                label="Removed"
                count={counts.delete}
                active={activeCategories.has("delete")}
                activeClass="bg-stone-100 border-stone-300 text-stone-700"
                onClick={() => toggleCategory("delete")}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 && (
              <p className="p-4 text-sm text-stone-500">
                No differences found — the documents are textually identical.
              </p>
            )}
            {shown.map((entry) => {
              const isSelected = selectedChunk === entry.index;
              const insert = entry.chunk.op === "insert";
              const borderClass =
                entry.category === "flagged"
                  ? "border-l-red-500 bg-red-50/40"
                  : insert
                    ? "border-l-green-500 bg-green-50/40"
                    : "border-l-stone-400 bg-white";
              return (
                <button
                  key={entry.index}
                  onClick={() => jumpTo(entry)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-stone-100 hover:bg-stone-50 transition-colors ${borderClass} ${
                    isSelected ? "ring-1 ring-stone-900 bg-stone-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {entry.category === "flagged" ? (
                      <AlertTriangle className="w-3 h-3 text-red-600 flex-shrink-0" />
                    ) : insert ? (
                      <Plus className="w-3 h-3 text-green-700 flex-shrink-0" />
                    ) : (
                      <Minus className="w-3 h-3 text-stone-500 flex-shrink-0" />
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-stone-400 truncate">
                      {entry.reasons.length > 0
                        ? entry.reasons.map((r) => FLAG_LABELS[r]).join(" · ")
                        : insert
                          ? "Added in B"
                          : "Removed from A"}
                    </span>
                  </div>
                  <p className="text-sm text-stone-800 leading-snug line-clamp-2">
                    {snippet(entry.chunk.text)}
                  </p>
                </button>
              );
            })}
            {visible.length > MAX_REGISTER_ENTRIES && (
              <p className="p-3 text-xs text-stone-400 text-center">
                Showing first {MAX_REGISTER_ENTRIES} of {visible.length} differences.
              </p>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden bg-stone-50">
          {mode === "side_by_side" ? (
            <div className="flex h-full">
              <DocPane
                pane="a"
                label={comparison.doc_a_name ?? "Document A"}
                doc={parsed.doc_a}
                chunks={parsed.chunks}
                selectedChunk={selectedChunk}
              />
              <div className="w-px bg-stone-200" />
              <DocPane
                pane="b"
                label={comparison.doc_b_name ?? "Document B"}
                doc={parsed.doc_b}
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

function FilterChip({
  label,
  count,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-xs rounded-full border flex items-center gap-1 ${
        active ? activeClass : "bg-white border-stone-200 text-stone-400"
      }`}
    >
      {label} <span className="font-mono">{count}</span>
    </button>
  );
}

const PARAGRAPH_CLASS: Record<string, string> = {
  heading1: "text-2xl font-bold text-stone-900 mt-6 mb-2",
  heading2: "text-xl font-bold text-stone-900 mt-5 mb-2",
  heading3: "text-base font-semibold text-stone-900 mt-4 mb-1.5",
  heading4: "text-sm font-semibold text-stone-900 mt-3 mb-1",
  body: "text-stone-800 leading-relaxed mb-3",
  list: "text-stone-800 leading-relaxed mb-1 pl-5",
  quote: "text-stone-700 italic border-l-2 border-stone-300 pl-3 mb-3",
};

function segmentClass(op: DiffChunk["op"], isSelected: boolean): string {
  const base =
    op === "equal"
      ? ""
      : op === "delete"
        ? "bg-red-100 text-red-900 rounded line-through decoration-red-500"
        : "bg-green-100 text-green-900 rounded";
  return isSelected && op !== "equal" ? `${base} ring-2 ring-stone-900` : base;
}

function DocPane({
  pane,
  label,
  doc,
  chunks,
  selectedChunk,
}: {
  pane: "a" | "b";
  label: string;
  doc: ComparisonData["parsed"]["doc_a"];
  chunks: DiffChunk[];
  selectedChunk: number | null;
}) {
  const meta = doc.metadata;
  const paragraphs = doc.paragraphs;
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
        <div className="max-w-2xl mx-auto font-serif">
          {paragraphs && paragraphs.length > 0 ? (
            paragraphs.map((p, pi) => {
              const segments = projectRange(chunks, pane, p.offset, p.offset + p.length);
              if (segments.every((s) => s.text.trim().length === 0)) return null;
              return (
                <p key={pi} className={PARAGRAPH_CLASS[p.style] ?? PARAGRAPH_CLASS.body}>
                  {p.style === "list" && <span className="select-none">•&nbsp;</span>}
                  {segments.map((s, si) => (
                    <span
                      key={si}
                      data-chunk={`${pane}-${s.chunkIndex}`}
                      className={segmentClass(s.op, selectedChunk === s.chunkIndex)}
                    >
                      {s.text}
                    </span>
                  ))}
                </p>
              );
            })
          ) : (
            // Fallback for comparisons processed before paragraph skeletons
            // were stored: continuous chunk stream.
            <div className="text-stone-800 leading-relaxed whitespace-pre-wrap break-words">
              {chunks.map((chunk, index) => {
                if (chunk.op === hidden) return null;
                return (
                  <span
                    key={index}
                    data-chunk={`${pane}-${index}`}
                    className={segmentClass(chunk.op, selectedChunk === index)}
                  >
                    {chunk.text}
                  </span>
                );
              })}
            </div>
          )}
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
