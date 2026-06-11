"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpToLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Crosshair,
  GitCompare,
  Hash,
  Layers,
  Pencil,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { projectRange } from "@/lib/diff/project";
import {
  measureAnchors,
  mapY,
  contentY,
  nearestAnchorPosition,
  type AnchorMap,
} from "@/lib/diff/scroll-map";
import {
  chunkAtOffset,
  jumpTargets,
  searchSide,
  type JumpTarget,
  type SearchMatch,
} from "@/lib/diff/navigate";
import { detectFlags, FLAG_LABELS, type FlagReason } from "@/lib/pipeline/flags";
import {
  pairChanges,
  ACTION_LABELS,
  type ChangeAction,
  type ChangeEntry,
} from "@/lib/pipeline/actions";
import type { DiffChunk } from "@/lib/diff/types";
import { ReportView } from "./report-view";
import { BuildStamp } from "./build-stamp";
import { Wordmark } from "./wordmark";

export type ParagraphSkeleton = {
  style: string;
  offset: number;
  length: number;
  page?: number;
};

export type ComparisonData = {
  comparison: {
    id: string;
    title: string | null;
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
  summary_first: { label: "Report", icon: BookOpen },
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
  { id: "flagged", label: "Flagged", activeClass: "bg-flag-wash border-flag/40 text-flag" },
  { id: "added", label: "Added", activeClass: "bg-leaf-wash border-leaf/40 text-leaf-deep" },
  { id: "removed", label: "Removed", activeClass: "bg-paper-deep border-ink/30 text-ink" },
  { id: "changed", label: "Changed", activeClass: "bg-white border-leaf-deep/50 text-leaf-deep" },
];

const ALL_ACTIONS: ChangeAction[] = [
  "modification",
  "replacement",
  "formatting",
  "addition",
  "deletion",
];

type Pane = "a" | "b";

const ROLE_LABEL: Record<Pane, string> = { a: "Primary", b: "Comparator" };

type SearchScope = "a" | "b" | "both";

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

  // Task title (item 7): editable, saved via PATCH.
  const defaultTitle = `${comparison.doc_a_name ?? "Primary"} vs ${comparison.doc_b_name ?? "Comparator"}`;
  const [title, setTitle] = useState(comparison.title ?? defaultTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);

  // Search (item 3).
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("both");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const lastSearch = useRef<{ query: string; scope: SearchScope } | null>(null);

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

  // Jump-to targets (item 2): pages for PDFs, headings for DOCX. Primary
  // drives navigation; fall back to the Comparator when Primary has neither.
  const jump = useMemo<{ side: Pane; targets: JumpTarget[] }>(() => {
    const primary = jumpTargets(parsed.doc_a.paragraphs, parsed.chunks, "a");
    if (primary.length > 0) return { side: "a", targets: primary };
    return { side: "b", targets: jumpTargets(parsed.doc_b.paragraphs, parsed.chunks, "b") };
  }, [parsed]);

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

  function flashChunk(pane: Pane, index: number) {
    setFlash({ pane, index });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1800);
  }

  /** Center one pane on a chunk and (optionally) align the other pane. */
  function revealChunk(pane: Pane, index: number, alignOther: boolean) {
    const container = paneEl(pane);
    const el = spanIn(pane, index);
    if (!container || !el) return;
    activePane.current = null;
    const y = contentY(container, el);
    centerOn(pane, y);
    if (alignOther && anchorsRef.current) {
      const other: Pane = pane === "a" ? "b" : "a";
      const map = anchorsRef.current;
      const mapped = pane === "a" ? mapY(map.aTops, map.bTops, y) : mapY(map.bTops, map.aTops, y);
      centerOn(other, mapped);
    }
  }

  function jumpTo(entry: RegisterEntry) {
    setSelected(entry);
    activePane.current = null;
    const map = anchorsRef.current;

    const positions: Partial<Record<Pane, number>> = {};
    for (const { pane, own } of [
      { pane: "a" as Pane, own: entry.deleteIndex },
      { pane: "b" as Pane, own: entry.insertIndex },
    ]) {
      const container = paneEl(pane);
      if (container && own !== undefined) {
        const el = spanIn(pane, own);
        if (el) positions[pane] = contentY(container, el);
      }
    }
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

  function handleJumpSelect(value: string) {
    const offset = Number(value);
    if (Number.isNaN(offset)) return;
    const index = chunkAtOffset(parsed.chunks, jump.side, offset);
    if (index === null) return;
    if (mode !== "side_by_side") setMode("side_by_side");
    revealChunk(jump.side, index, true);
  }

  function runSearch() {
    const q = query.trim();
    if (!q) return;
    const same =
      lastSearch.current?.query === q && lastSearch.current?.scope === scope;
    if (same && matches.length > 0) {
      goToMatch((matchIndex + 1) % matches.length);
      return;
    }
    const found: SearchMatch[] = [
      ...(scope !== "b" ? searchSide(parsed.chunks, "a", q) : []),
      ...(scope !== "a" ? searchSide(parsed.chunks, "b", q) : []),
    ];
    lastSearch.current = { query: q, scope };
    setMatches(found);
    if (found.length > 0) {
      if (mode !== "side_by_side") setMode("side_by_side");
      goToMatch(0, found);
    } else {
      setMatchIndex(-1);
    }
  }

  function goToMatch(i: number, list: SearchMatch[] = matches) {
    if (list.length === 0) return;
    const wrapped = ((i % list.length) + list.length) % list.length;
    setMatchIndex(wrapped);
    const match = list[wrapped];
    const index = chunkAtOffset(parsed.chunks, match.side, match.offset);
    if (index === null) return;
    revealChunk(match.side, index, syncOn);
    flashChunk(match.side, index);
  }

  function clearSearch() {
    setQuery("");
    setMatches([]);
    setMatchIndex(-1);
    lastSearch.current = null;
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) return;
    setTitle(next); // optimistic
    try {
      const res = await fetch(`/api/comparisons/${comparison.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTitle(title); // revert on failure
    }
  }

  function handleContextMenu(pane: Pane, e: React.MouseEvent) {
    const target = (e.target as HTMLElement).closest?.("[data-chunk]") as HTMLElement | null;
    if (!target?.dataset.chunk) return;
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
    if (targetIndex !== null) flashChunk(other, targetIndex);
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

  return (
    <div className="h-screen flex flex-col bg-paper text-ink font-sans">
      <header className="border-b border-line print-hide">
        {/* Row 1 — identity: logo, task title, documents */}
        <div className="px-6 py-2.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-5 min-w-0">
            <span className="flex-shrink-0">
              <Wordmark size="text-xl" />
            </span>
            <div className="w-px h-5 bg-line flex-shrink-0" />
            {editingTitle ? (
              <form
                className="flex items-center gap-1.5 min-w-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveTitle();
                }}
              >
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setEditingTitle(false)}
                  maxLength={120}
                  className="text-base font-display font-bold text-ink bg-white border border-line rounded px-2 py-1 w-80 focus:outline-none focus:ring-1 focus:ring-leaf"
                />
                <button type="submit" className="p-1 text-leaf-deep hover:bg-leaf-wash rounded" aria-label="Save title">
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTitle(false)}
                  className="p-1 text-ink-faint hover:bg-paper-deep rounded"
                  aria-label="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setTitleDraft(title);
                  setEditingTitle(true);
                }}
                title="Rename this comparison"
                className="group flex items-center gap-2 min-w-0 text-base font-display font-bold text-ink hover:text-ink-soft"
              >
                <span className="truncate">{title}</span>
                <Pencil className="w-3 h-3 text-ink-faint group-hover:text-leaf-deep flex-shrink-0" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs flex-shrink-0">
            <DocBadge role="Primary" name={comparison.doc_a_name} />
            <ArrowLeftRight className="w-3 h-3 text-ink-faint" />
            <DocBadge role="Comparator" name={comparison.doc_b_name} />
          </div>
        </div>

        {/* Row 2 — toolbar: search, jump, navigation, views */}
        <div className="px-6 py-2 border-t border-line flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
              className="flex items-center bg-white border border-line rounded-full overflow-hidden"
            >
              <Search className="w-3.5 h-3.5 text-ink-faint ml-3 flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search text…"
                className="px-2 py-1.5 text-xs w-44 focus:outline-none bg-transparent"
              />
              {query && (
                <button type="button" onClick={clearSearch} className="p-1 text-ink-faint hover:text-ink" aria-label="Clear search">
                  <X className="w-3 h-3" />
                </button>
              )}
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as SearchScope)}
                className="text-xs text-ink-soft bg-paper-deep border-l border-line px-2 py-1.5 focus:outline-none"
                aria-label="Search scope"
              >
                <option value="both">Both</option>
                <option value="a">Primary</option>
                <option value="b">Comparator</option>
              </select>
            </form>
            {matches.length > 0 && (
              <div className="flex items-center gap-0.5 text-xs text-ink-soft">
                <span className="font-mono text-leaf-deep font-bold">
                  {matchIndex + 1}/{matches.length}
                </span>
                <button onClick={() => goToMatch(matchIndex - 1)} className="p-1 hover:bg-paper-deep rounded" aria-label="Previous match">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => goToMatch(matchIndex + 1)} className="p-1 hover:bg-paper-deep rounded" aria-label="Next match">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {lastSearch.current && matches.length === 0 && (
              <span className="text-xs text-ink-faint font-serif italic">No matches</span>
            )}
            {jump.targets.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  handleJumpSelect(e.target.value);
                  e.target.value = "";
                }}
                className="text-xs text-ink bg-white border border-line rounded-full px-3 py-1.5 max-w-48 focus:outline-none"
                aria-label="Jump to"
              >
                <option value="" disabled>
                  Jump to…
                </option>
                {jump.targets.map((t, i) => (
                  <option key={i} value={t.offset}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-ink-soft flex items-center gap-1.5 mr-1">
              {similarity != null && (
                <>
                  <span className="font-mono font-bold text-leaf-deep">{similarity}%</span>
                  <span className="font-serif italic">similar ·</span>
                </>
              )}
              <span className="font-serif italic">
                recommends{" "}
                <span className="font-medium not-italic text-ink">
                  {MODE_META[recommended]?.label ?? recommended}
                </span>
              </span>
            </span>
            <button
              onClick={scrollBothToTop}
              title="Scroll both documents back to the top"
              className="px-3 py-1 text-xs font-medium rounded-full border bg-white text-ink-soft border-line hover:border-ink/40 flex items-center gap-1.5 transition-colors"
            >
              <ArrowUpToLine className="w-3 h-3" />
              Top
            </button>
            <button
              onClick={alignPanes}
              title="Align the other document to your current reading position"
              className="px-3 py-1 text-xs font-medium rounded-full border bg-white text-ink-soft border-line hover:border-ink/40 flex items-center gap-1.5 transition-colors"
            >
              <Crosshair className="w-3 h-3" />
              Align
            </button>
            <button
              onClick={() => setSyncOn((v) => !v)}
              title="When on, both documents scroll together and clicking a change aligns both panes."
              className={`px-3 py-1 text-xs font-medium rounded-full border flex items-center gap-1.5 transition-colors ${
                syncOn
                  ? "bg-ink text-paper border-ink"
                  : "bg-white text-ink-soft border-line hover:border-ink/40"
              }`}
            >
              <ArrowLeftRight className={`w-3 h-3 ${syncOn ? "text-leaf-ring" : ""}`} />
              Move in sync
            </button>
            <div className="flex items-center gap-4 ml-2">
              {(Object.keys(MODE_META) as ModeId[]).map((id) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className={`relative pb-1 text-xs transition-colors ${
                      active
                        ? "font-semibold text-ink"
                        : "text-ink-faint hover:text-ink-soft"
                    }`}
                  >
                    {MODE_META[id].label}
                    {active && (
                      <span className="absolute left-0 right-0 -bottom-0.5 h-[3px] bg-leaf rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex print-expand">
        <aside className="w-72 border-r border-line bg-white flex flex-col print-hide">
          <div className="p-4 border-b border-line">
            <div className="flex items-baseline justify-between mb-2.5">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                Proof marks
              </h3>
              <span className="font-mono text-lg font-bold text-leaf-deep leading-none">
                {entries.length}
              </span>
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
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint mb-1.5">
              Action
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_ACTIONS.filter((a) => actionCounts[a] > 0).map((action) => (
                <FilterChip
                  key={action}
                  label={ACTION_LABELS[action]}
                  count={actionCounts[action]}
                  active={activeActions.has(action)}
                  activeClass="bg-leaf-wash border-leaf/40 text-leaf-deep"
                  onClick={() => toggleIn(activeActions, action, setActiveActions)}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 && (
              <p className="p-4 text-sm font-serif italic text-ink-soft">
                No differences found — the documents are textually identical.
              </p>
            )}
            {shown.map((entry) => {
              const isSelected = selected?.id === entry.id;
              const borderClass =
                entry.category === "flagged"
                  ? "border-l-flag bg-flag-wash/50"
                  : entry.category === "added"
                    ? "border-l-leaf bg-leaf-wash/50"
                    : entry.category === "changed"
                      ? "border-l-leaf-deep bg-white"
                      : "border-l-ink-faint bg-white";
              return (
                <button
                  key={entry.id}
                  onClick={() => {
                    if (mode !== "side_by_side") setMode("side_by_side");
                    jumpTo(entry);
                  }}
                  className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-line hover:bg-paper-deep/60 transition-colors ${borderClass} ${
                    isSelected ? "ring-1 ring-ink bg-paper-deep/60" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <EntryIcon entry={entry} />
                    <span className="text-[10px] font-mono uppercase tracking-wider text-ink-faint truncate">
                      {entryTag(entry)}
                    </span>
                  </div>
                  <p className="text-sm font-serif text-ink leading-snug line-clamp-2">
                    {entrySnippet(entry)}
                  </p>
                </button>
              );
            })}
            {visible.length > MAX_REGISTER_ENTRIES && (
              <p className="p-3 text-xs text-ink-faint text-center font-serif italic">
                Showing first {MAX_REGISTER_ENTRIES} of {visible.length} differences.
              </p>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-hidden bg-paper print-expand">
          {mode === "side_by_side" && (
            <div className="flex h-full gap-4 p-4">
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
          )}
          {mode === "summary_first" && (
            <ReportView
              title={title}
              createdAt={comparison.created_at}
              similarity={similarity}
              primary={{
                role: "Primary",
                name: comparison.doc_a_name ?? "Document A",
                metadata: parsed.doc_a.metadata,
                hash: comparison.doc_a_hash,
              }}
              comparator={{
                role: "Comparator",
                name: comparison.doc_b_name ?? "Document B",
                metadata: parsed.doc_b.metadata,
                hash: comparison.doc_b_hash,
              }}
              entries={entries}
            />
          )}
          {mode === "aligned_sections" && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md text-center px-6">
                <Sparkles className="w-8 h-8 text-leaf mx-auto mb-3" />
                <h2 className="font-display font-bold text-lg text-ink mb-2">
                  Aligned sections arrives with the AI layer
                </h2>
                <p className="text-sm font-serif text-ink-soft mb-5">
                  Semantic section alignment is part of the next build phase. Side-by-side
                  shows every literal change today.
                </p>
                <button
                  onClick={() => setMode("side_by_side")}
                  className="px-5 py-2 text-sm font-medium bg-ink text-paper rounded-full hover:bg-ink/85"
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
            className="fixed z-50 bg-white border border-ink/20 rounded-lg shadow-lg py-1 text-sm"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 260),
              top: Math.min(ctxMenu.y, window.innerHeight - 60),
            }}
          >
            <button
              onClick={() => locateInOther(ctxMenu)}
              className="w-full text-left px-3 py-1.5 hover:bg-leaf-wash flex items-center gap-2 text-ink"
            >
              <Crosshair className="w-3.5 h-3.5 text-leaf-deep" />
              Locate in {ROLE_LABEL[ctxMenu.pane === "a" ? "b" : "a"]}
            </button>
          </div>
        </>
      )}

      <footer className="border-t border-line px-6 py-2 flex items-center justify-between text-xs text-ink-faint font-mono print-hide">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Hash className="w-3 h-3" />
            {shortHash(comparison.doc_a_hash)} ⇄ {shortHash(comparison.doc_b_hash)}
          </span>
          <span>{new Date(comparison.created_at).toLocaleString()}</span>
        </div>
        <BuildStamp />
      </footer>
    </div>
  );
}

/** Stamp-style document badge: outlined, slightly rotated, like an inked stamp. */
function DocBadge({ role, name }: { role: string; name: string | null }) {
  return (
    <div className="flex flex-col px-3 py-1.5 border-[1.5px] border-ink/70 rounded min-w-0 max-w-56 -rotate-1 bg-white/60">
      <span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-leaf-deep flex-shrink-0">
        {role}
      </span>
      <span className="font-medium text-ink truncate text-xs">{name ?? "—"}</span>
    </div>
  );
}

/** Proofreader's marks: ⌃ inserted, ⌫ struck, ↻ replaced. */
function EntryIcon({ entry }: { entry: RegisterEntry }) {
  const glyph =
    entry.action === "addition" ? "⌃" : entry.action === "deletion" ? "⌫" : "↻";
  const color =
    entry.category === "flagged"
      ? "text-flag"
      : entry.action === "deletion"
        ? "text-ink-soft"
        : "text-leaf-deep";
  return (
    <span className={`font-mono font-bold text-sm leading-none flex-shrink-0 ${color}`}>
      {glyph}
    </span>
  );
}

function entryTag(entry: RegisterEntry): string {
  const action =
    entry.action === "addition"
      ? "Added in Comparator"
      : entry.action === "deletion"
        ? "Removed from Primary"
        : ACTION_LABELS[entry.action];
  return entry.reasons.length > 0
    ? `${action} · ${entry.reasons.map((r) => FLAG_LABELS[r]).join(" · ")}`
    : action;
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
        active ? activeClass : "bg-white border-line text-ink-faint"
      }`}
    >
      {label} <span className="font-mono">{count}</span>
    </button>
  );
}

const PARAGRAPH_CLASS: Record<string, string> = {
  heading1: "font-display text-2xl font-bold text-ink mt-6 mb-2",
  heading2: "font-display text-xl font-bold text-ink mt-5 mb-2",
  heading3: "text-base font-semibold text-ink mt-4 mb-1.5",
  heading4: "text-sm font-semibold text-ink mt-3 mb-1",
  body: "text-ink leading-relaxed mb-3",
  list: "text-ink leading-relaxed mb-1 pl-5",
  quote: "text-ink-soft italic border-l-2 border-line pl-3 mb-3",
};

/**
 * Proof-mark styling: insertions read as green-inked additions (underlined),
 * deletions as quietly struck text. Red is reserved for flagged risk in the
 * register, not for ordinary removals.
 */
function segmentClass(
  op: DiffChunk["op"],
  isSelected: boolean,
  isFlashing: boolean,
): string {
  const base =
    op === "equal"
      ? ""
      : op === "delete"
        ? "bg-paper-deep text-ink-soft rounded line-through decoration-ink-faint"
        : "bg-leaf-wash text-leaf-deep rounded underline decoration-leaf decoration-2 underline-offset-2";
  if (isFlashing) return `${base} ring-2 ring-leaf bg-leaf-wash animate-pulse`;
  return isSelected && op !== "equal" ? `${base} ring-2 ring-ink` : base;
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
    <div className="flex-1 flex flex-col bg-white min-w-0 rounded-xl border border-line overflow-hidden">
      <div className="px-6 py-2.5 border-b border-line flex items-center gap-2.5">
        <span
          className={`text-[9px] font-mono font-bold uppercase tracking-[0.2em] px-2 py-1 rounded ${
            pane === "a" ? "bg-ink text-paper" : "bg-leaf-wash text-leaf-deep"
          }`}
        >
          {ROLE_LABEL[pane]}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink truncate">{label}</div>
          <div className="text-[11px] text-ink-faint font-mono">
            {meta?.pageCount ? `${meta.pageCount} pages · ` : ""}
            {meta?.wordCount ? `${meta.wordCount.toLocaleString()} words` : ""}
          </div>
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
            <div className="text-ink leading-relaxed whitespace-pre-wrap break-words">
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
