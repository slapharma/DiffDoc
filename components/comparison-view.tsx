"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpToLine,
  BookOpen,
  Crosshair,
  FileText,
  GitCompare,
  Hash,
  Layers,
  Minus,
  Plus,
  Repeat,
  Sparkles,
} from "lucide-react";
import { projectRange } from "@/lib/diff/project";
import {
  measureAnchors,
  mapY,
  contentY,
  nearestAnchorPosition,
  type AnchorMap,
} from "@/lib/diff/scroll-map";
import { detectFlags, FLAG_LABELS, type FlagReason } from "@/lib/pipeline/flags";
import {
  pairChanges,
  ACTION_LABELS,
  type ChangeAction,
  type ChangeEntry,
} from "@/lib/pipeline/actions";
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

type Category = "flagged" | "added" | "removed" | "changed";

type RegisterEntry = ChangeEntry & {
  id: number;
  category: Category;
  reasons: FlagReason[];
};

const MAX_REGISTER_ENTRIES = 500;
/** Viewport offset (px from pane top) used as the sync reading line. */
const PROBE = 120;

const CATEGORY_CHIP: { id: Category; label: string; activeClass: string }[] = [
  { id: "flagged", label: "Flagged", activeClass: "bg-red-50 border-red-200 text-red-700" },
  { id: "added", label: "Added", activeClass: "bg-green-50 border-green-200 text-green-800" },
  { id: "removed", label: "Removed", activeClass: "bg-stone-100 border-stone-300 text-stone-700" },
  { id: "changed", label: "Changed", activeClass: "bg-amber-50 border-amber-200 text-amber-800" },
];

const ALL_ACTIONS: ChangeAction[] = [
  "modification",
  "replacement",
  "formatting",
  "addition",
  "deletion",
];

type Pane = "a" | "b";

type ContextMenuState = { x: number; y: number; pane: Pane; index: number };

export function ComparisonView({ data }: { data: ComparisonData }) {
  const { comparison, parsed } = data;
  const [mode, setMode] = useState<ModeId>("side_by_side");
  const [selected, setSelected] = useState<RegisterEntry | null>(null);
  const [syncOn, setSyncOn] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [flash, setFlash] = useState<{ pane: Pane; index: number } | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(["flagged", "added", "removed", "changed"]),
  );
  const [activeActions, setActiveActions] = useState<Set<ChangeAction>>(
    () => new Set(ALL_ACTIONS),
  );

  const paneARef = useRef<HTMLDivElement>(null);
  const paneBRef = useRef<HTMLDivElement>(null);
  const anchorsRef = useRef<AnchorMap | null>(null);
  /** The pane the user is physically scrolling — the only sync source. */
  const activePane = useRef<Pane | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entries = useMemo<RegisterEntry[]>(
    () =>
      pairChanges(parsed.chunks).map((change, id) => {
        const reasons = detectFlags(`${change.before ?? ""} ${change.after ?? ""}`);
        const category: Category =
          reasons.length > 0
            ? "flagged"
            : change.action === "addition"
              ? "added"
              : change.action === "deletion"
                ? "removed"
                : "changed";
        return { ...change, id, category, reasons };
      }),
    [parsed.chunks],
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<Category, number> = { flagged: 0, added: 0, removed: 0, changed: 0 };
    for (const e of entries) counts[e.category]++;
    return counts;
  }, [entries]);

  const actionCounts = useMemo(() => {
    const counts = {} as Record<ChangeAction, number>;
    for (const a of ALL_ACTIONS) counts[a] = 0;
    for (const e of entries) counts[e.action]++;
    return counts;
  }, [entries]);

  const visible = entries.filter(
    (e) => activeCategories.has(e.category) && activeActions.has(e.action),
  );
  const shown = visible.slice(0, MAX_REGISTER_ENTRIES);

  const recommended = (comparison.view_mode ?? "side_by_side") as ModeId;
  const similarity = comparison.similarity_score;

  function paneEl(pane: Pane) {
    return pane === "a" ? paneARef.current : paneBRef.current;
  }

  // Measure alignment anchors once per layout, not per scroll. Re-measure on
  // content size changes (fonts, images, container resize).
  useEffect(() => {
    if (mode !== "side_by_side") return;
    const a = paneARef.current;
    const b = paneBRef.current;
    if (!a || !b) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const remeasure = () => {
      anchorsRef.current = measureAnchors(a, b);
    };
    remeasure();

    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(remeasure, 150);
    });
    if (a.firstElementChild) observer.observe(a.firstElementChild);
    if (b.firstElementChild) observer.observe(b.firstElementChild);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [mode, data]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  function handlePaneScroll(pane: Pane) {
    // Only the pane the user is interacting with drives the sync; the echo
    // scroll event from the follower pane is ignored, so there is no
    // feedback loop and no timing locks. The mapping is O(log n) with no
    // layout reads, so it runs synchronously — scroll events are already
    // frame-aligned and deferring to rAF only adds lag.
    if (!syncOn || mode !== "side_by_side") return;
    if (activePane.current !== pane) return;
    const map = anchorsRef.current;
    const src = paneEl(pane);
    const dst = paneEl(pane === "a" ? "b" : "a");
    if (!map || !src || !dst) return;
    const y = src.scrollTop + PROBE;
    const mapped =
      pane === "a" ? mapY(map.aTops, map.bTops, y) : mapY(map.bTops, map.aTops, y);
    dst.scrollTop = Math.max(0, mapped - PROBE);
  }

  function scrollPaneTo(pane: Pane, top: number, smooth = true) {
    paneEl(pane)?.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }

  /** Center a content-space Y in a pane's viewport. */
  function centerOn(pane: Pane, y: number) {
    const el = paneEl(pane);
    if (!el) return;
    scrollPaneTo(pane, y - el.clientHeight / 2);
  }

  function spanIn(pane: Pane, index: number): HTMLElement | null {
    return paneEl(pane)?.querySelector(`[data-chunk="${pane}-${index}"]`) ?? null;
  }

  function jumpTo(entry: RegisterEntry) {
    setSelected(entry);
    activePane.current = null; // programmatic scrolls must not trigger sync
    const map = anchorsRef.current;

    const sides: { pane: Pane; own?: number }[] = [
      { pane: "a", own: entry.deleteIndex },
      { pane: "b", own: entry.insertIndex },
    ];
    const positions: Partial<Record<Pane, number>> = {};
    for (const { pane, own } of sides) {
      const container = paneEl(pane);
      if (container && own !== undefined) {
        const el = spanIn(pane, own);
        if (el) positions[pane] = contentY(container, el);
      }
    }
    // Derive the missing side from the known one via the anchor map.
    if (map) {
      if (positions.a === undefined && positions.b !== undefined) {
        positions.a = mapY(map.bTops, map.aTops, positions.b);
      }
      if (positions.b === undefined && positions.a !== undefined) {
        positions.b = mapY(map.aTops, map.bTops, positions.a);
      }
    }
    for (const pane of ["a", "b"] as Pane[]) {
      const owns = pane === "a" ? entry.deleteIndex !== undefined : entry.insertIndex !== undefined;
      if (!syncOn && !owns) continue;
      if (positions[pane] !== undefined) centerOn(pane, positions[pane]!);
    }
  }

  function scrollBothToTop() {
    activePane.current = null;
    scrollPaneTo("a", 0);
    scrollPaneTo("b", 0);
  }

  function alignPanes() {
    const map = anchorsRef.current;
    const source = activePane.current ?? "a";
    const other: Pane = source === "a" ? "b" : "a";
    const src = paneEl(source);
    if (!map || !src) return;
    activePane.current = null;
    const y = src.scrollTop + PROBE;
    const mapped =
      source === "a" ? mapY(map.aTops, map.bTops, y) : mapY(map.bTops, map.aTops, y);
    scrollPaneTo(other, mapped - PROBE);
  }

  function handleContextMenu(pane: Pane, e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest?.("[data-chunk]") as HTMLElement | null;
    if (!target?.dataset.chunk) return; // fall back to the native menu
    e.preventDefault();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      pane,
      index: Number(target.dataset.chunk.split("-")[1]),
    });
  }

  function locateInOther(menu: ContextMenuState) {
    setCtxMenu(null);
    const other: Pane = menu.pane === "a" ? "b" : "a";
    const container = paneEl(other);
    if (!container) return;
    activePane.current = null;

    // Prefer the exact chunk if it exists in the other pane; otherwise the
    // nearest chunk that does.
    let targetIndex: number | null = null;
    for (let distance = 0; distance < 80 && targetIndex === null; distance++) {
      for (const k of distance === 0 ? [menu.index] : [menu.index - distance, menu.index + distance]) {
        if (k < 0) continue;
        if (spanIn(other, k)) {
          targetIndex = k;
          break;
        }
      }
    }

    let y: number | null = null;
    if (targetIndex !== null) {
      const el = spanIn(other, targetIndex);
      if (el) y = contentY(container, el);
    } else if (anchorsRef.current) {
      y = nearestAnchorPosition(anchorsRef.current, other, menu.index);
    }
    if (y === null) return;
    centerOn(other, y);

    if (targetIndex !== null) {
      setFlash({ pane: other, index: targetIndex });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1800);
    }
  }

  function toggleIn<T>(set: Set<T>, value: T, update: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  }

  const selectedIndices = {
    a: selected?.deleteIndex ?? null,
    b: selected?.insertIndex ?? null,
  };

  const otherDocName = (pane: Pane) =>
    pane === "a"
      ? comparison.doc_b_name ?? "Document B"
      : comparison.doc_a_name ?? "Document A";

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
          <div className="flex items-center gap-2">
            <button
              onClick={scrollBothToTop}
              title="Scroll both documents back to the top"
              className="px-2.5 py-1 text-xs font-medium rounded-md border bg-white text-stone-600 border-stone-200 hover:bg-stone-50 flex items-center gap-1.5"
            >
              <ArrowUpToLine className="w-3 h-3" />
              Top
            </button>
            <button
              onClick={alignPanes}
              title="Align the other document to your current reading position"
              className="px-2.5 py-1 text-xs font-medium rounded-md border bg-white text-stone-600 border-stone-200 hover:bg-stone-50 flex items-center gap-1.5"
            >
              <Crosshair className="w-3 h-3" />
              Align
            </button>
            <button
              onClick={() => setSyncOn((v) => !v)}
              title="When on, both documents scroll together and clicking a change aligns both panes."
              className={`px-2.5 py-1 text-xs font-medium rounded-md border flex items-center gap-1.5 transition-colors ${
                syncOn
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
              }`}
            >
              <ArrowLeftRight className="w-3 h-3" />
              Move in sync
            </button>
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
            <div className="flex flex-wrap gap-1 mb-3">
              {CATEGORY_CHIP.map((chip) => (
                <FilterChip
                  key={chip.id}
                  label={chip.label}
                  count={categoryCounts[chip.id]}
                  active={activeCategories.has(chip.id)}
                  activeClass={chip.activeClass}
                  onClick={() => toggleIn(activeCategories, chip.id, setActiveCategories)}
                />
              ))}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
              Action
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_ACTIONS.filter((a) => actionCounts[a] > 0).map((action) => (
                <FilterChip
                  key={action}
                  label={ACTION_LABELS[action]}
                  count={actionCounts[action]}
                  active={activeActions.has(action)}
                  activeClass="bg-blue-50 border-blue-200 text-blue-800"
                  onClick={() => toggleIn(activeActions, action, setActiveActions)}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 && (
              <p className="p-4 text-sm text-stone-500">
                No differences found — the documents are textually identical.
              </p>
            )}
            {shown.map((entry) => {
              const isSelected = selected?.id === entry.id;
              const borderClass =
                entry.category === "flagged"
                  ? "border-l-red-500 bg-red-50/40"
                  : entry.category === "added"
                    ? "border-l-green-500 bg-green-50/40"
                    : entry.category === "changed"
                      ? "border-l-amber-500 bg-amber-50/40"
                      : "border-l-stone-400 bg-white";
              return (
                <button
                  key={entry.id}
                  onClick={() => jumpTo(entry)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-stone-100 hover:bg-stone-50 transition-colors ${borderClass} ${
                    isSelected ? "ring-1 ring-stone-900 bg-stone-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <EntryIcon entry={entry} />
                    <span className="text-[10px] uppercase tracking-wide text-stone-400 truncate">
                      {ACTION_LABELS[entry.action]}
                      {entry.reasons.length > 0 &&
                        ` · ${entry.reasons.map((r) => FLAG_LABELS[r]).join(" · ")}`}
                    </span>
                  </div>
                  <p className="text-sm text-stone-800 leading-snug line-clamp-2">
                    {entrySnippet(entry)}
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
                selectedIndex={selectedIndices.a}
                flashIndex={flash?.pane === "a" ? flash.index : null}
                scrollRef={paneARef}
                onScroll={() => handlePaneScroll("a")}
                onActivate={() => {
                  activePane.current = "a";
                }}
                onContextMenu={(e) => handleContextMenu("a", e)}
              />
              <div className="w-px bg-stone-200" />
              <DocPane
                pane="b"
                label={comparison.doc_b_name ?? "Document B"}
                doc={parsed.doc_b}
                chunks={parsed.chunks}
                selectedIndex={selectedIndices.b}
                flashIndex={flash?.pane === "b" ? flash.index : null}
                scrollRef={paneBRef}
                onScroll={() => handlePaneScroll("b")}
                onActivate={() => {
                  activePane.current = "b";
                }}
                onContextMenu={(e) => handleContextMenu("b", e)}
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

      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu(null);
            }}
          />
          <div
            className="fixed z-50 bg-white border border-stone-200 rounded-md shadow-lg py-1 text-sm"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 260),
              top: Math.min(ctxMenu.y, window.innerHeight - 60),
            }}
          >
            <button
              onClick={() => locateInOther(ctxMenu)}
              className="w-full text-left px-3 py-1.5 hover:bg-stone-50 flex items-center gap-2 text-stone-800"
            >
              <Crosshair className="w-3.5 h-3.5 text-stone-500" />
              Locate in {otherDocName(ctxMenu.pane)}
            </button>
          </div>
        </>
      )}

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

function EntryIcon({ entry }: { entry: RegisterEntry }) {
  if (entry.category === "flagged")
    return <AlertTriangle className="w-3 h-3 text-red-600 flex-shrink-0" />;
  if (entry.action === "addition")
    return <Plus className="w-3 h-3 text-green-700 flex-shrink-0" />;
  if (entry.action === "deletion")
    return <Minus className="w-3 h-3 text-stone-500 flex-shrink-0" />;
  return <Repeat className="w-3 h-3 text-amber-700 flex-shrink-0" />;
}

function entrySnippet(entry: RegisterEntry): string {
  if (entry.before !== undefined && entry.after !== undefined) {
    return `${snippet(entry.before, 42)} → ${snippet(entry.after, 42)}`;
  }
  return snippet(entry.before ?? entry.after ?? "", 90);
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

function segmentClass(
  op: DiffChunk["op"],
  isSelected: boolean,
  isFlashing: boolean,
): string {
  const base =
    op === "equal"
      ? ""
      : op === "delete"
        ? "bg-red-100 text-red-900 rounded line-through decoration-red-500"
        : "bg-green-100 text-green-900 rounded";
  if (isFlashing) return `${base} ring-2 ring-amber-500 bg-amber-100 animate-pulse`;
  return isSelected && op !== "equal" ? `${base} ring-2 ring-stone-900` : base;
}

function DocPane({
  pane,
  label,
  doc,
  chunks,
  selectedIndex,
  flashIndex,
  scrollRef,
  onScroll,
  onActivate,
  onContextMenu,
}: {
  pane: Pane;
  label: string;
  doc: ComparisonData["parsed"]["doc_a"];
  chunks: DiffChunk[];
  selectedIndex: number | null;
  flashIndex: number | null;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
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
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onActivate}
        onWheel={onActivate}
        onTouchStart={onActivate}
        onContextMenu={onContextMenu}
        className="flex-1 overflow-y-auto px-8 py-6"
      >
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
                      className={segmentClass(
                        s.op,
                        selectedIndex === s.chunkIndex,
                        flashIndex === s.chunkIndex,
                      )}
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
                    className={segmentClass(
                      chunk.op,
                      selectedIndex === index,
                      flashIndex === index,
                    )}
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
