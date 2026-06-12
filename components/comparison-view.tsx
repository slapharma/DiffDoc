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
  Download,
  GitCompare,
  Hash,
  LayoutGrid,
  MessageSquare,
  Pencil,
  RotateCcw,
  Save,
  Search,
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

export type CommentRow = {
  id: string;
  doc_side: "a" | "b";
  location: { offset: number; length: number };
  text: string;
  resolved: boolean;
  created_at: string;
};

export type EditRow = {
  id: string;
  doc_side: "a" | "b";
  location: { offset: number; length: number };
  before_text: string | null;
  after_text: string | null;
  created_at: string;
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
  comments: CommentRow[];
  edits: EditRow[];
};

type ModeId = "side_by_side" | "summary_first";

const MODE_META: Record<ModeId, { label: string; icon: typeof GitCompare }> = {
  side_by_side: { label: "Side-by-side", icon: GitCompare },
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

type SelectionAction = {
  pane: Pane;
  offset: number;
  length: number;
  text: string;
  x: number;
  y: number;
};

type ComposerState = SelectionAction & { kind: "comment" | "edit"; value: string };

export function ComparisonView({ data }: { data: ComparisonData }) {
  const { comparison, parsed } = data;
  const [mode, setMode] = useState<ModeId>("side_by_side");
  const [selected, setSelected] = useState<RegisterEntry | null>(null);
  const [syncOn, setSyncOn] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [flash, setFlash] = useState<{ pane: Pane; index: number } | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Annotations: comments on both documents, edits on Primary only.
  const [comments, setComments] = useState<CommentRow[]>(data.comments);
  const [edits, setEdits] = useState<EditRow[]>(data.edits);
  const [selAction, setSelAction] = useState<SelectionAction | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const selActionRef = useRef<SelectionAction | null>(null);
  selActionRef.current = selAction;
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(["flagged", "added", "removed", "changed"]),
  );
  const [activeActions, setActiveActions] = useState<Set<ChangeAction>>(
    () => new Set(ALL_ACTIONS),
  );

  // Task title (editable, persisted via PATCH).
  const defaultTitle = `${comparison.doc_a_name ?? "Primary"} vs ${comparison.doc_b_name ?? "Comparator"}`;
  const [title, setTitle] = useState(comparison.title ?? defaultTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);

  // Search.
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Jump-to targets: pages for PDFs, headings for DOCX. Primary drives
  // navigation; fall back to the Comparator when Primary has neither.
  const jump = useMemo<{ side: Pane; targets: JumpTarget[] }>(() => {
    const primary = jumpTargets(parsed.doc_a.paragraphs, parsed.chunks, "a");
    if (primary.length > 0) return { side: "a", targets: primary };
    return { side: "b", targets: jumpTargets(parsed.doc_b.paragraphs, parsed.chunks, "b") };
  }, [parsed]);

  const visible = entries.filter(
    (e) => activeCategories.has(e.category) && activeActions.has(e.action),
  );
  const shown = visible.slice(0, MAX_REGISTER_ENTRIES);

  // Aligned-sections was removed as a feature; mid-similarity comparisons
  // recommend side-by-side until the AI layer lands.
  const recommended: ModeId =
    comparison.view_mode === "summary_first" ? "summary_first" : "side_by_side";
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
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function handlePaneScroll(pane: Pane) {
    // Only the pane the user is interacting with drives the sync; the echo
    // scroll event from the follower pane is ignored, so there is no
    // feedback loop and no timing locks. The mapping is O(log n) with no
    // layout reads, so it runs synchronously — scroll events are already
    // frame-aligned and deferring to rAF only adds lag.
    if (selActionRef.current) setSelAction(null); // selection bar drifts on scroll
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

  async function persistTitle(next: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/comparisons/${comparison.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) return;
    const previous = title;
    setTitle(next); // optimistic
    if (!(await persistTitle(next))) setTitle(previous);
  }

  async function saveTask() {
    setSaveState("saving");
    const ok = await persistTitle(title);
    setSaveState(ok ? "saved" : "idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveState("idle"), 2000);
  }

  function downloadReport() {
    setDownloadOpen(false);
    if (mode !== "summary_first") {
      setMode("summary_first");
      // let the report render before opening the print dialog
      setTimeout(() => window.print(), 450);
    } else {
      window.print();
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

  /**
   * Text selection inside a pane offers Comment (both documents) and Edit
   * (Primary only). v1 constraint: the selection must stay within a single
   * rendered span so it maps to one contiguous range of the side's text.
   */
  function handleSelection(pane: Pane) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelAction(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const spanOf = (node: Node | null) =>
      (node instanceof Element ? node : node?.parentElement)?.closest?.(
        "[data-off]",
      ) as HTMLElement | null;
    const startSpan = spanOf(range.startContainer);
    const endSpan = spanOf(range.endContainer);
    if (!startSpan || startSpan !== endSpan) {
      setSelAction(null);
      return;
    }
    if (!startSpan.dataset.chunk?.startsWith(`${pane}-`)) return;
    const base = Number(startSpan.dataset.off);
    const offset = base + Math.min(range.startOffset, range.endOffset);
    const length = Math.abs(range.endOffset - range.startOffset);
    if (length === 0) {
      setSelAction(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelAction({
      pane,
      offset,
      length,
      text: range.toString(),
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  function openComposer(kind: "comment" | "edit") {
    if (!selAction) return;
    setComposer({
      ...selAction,
      kind,
      value: kind === "edit" ? selAction.text : "",
    });
    setSelAction(null);
    window.getSelection()?.removeAllRanges();
  }

  async function submitComposer() {
    if (!composer || composerBusy) return;
    const value = composer.value.trim();
    if (!value) return;
    setComposerBusy(true);
    try {
      if (composer.kind === "comment") {
        const res = await fetch(`/api/comparisons/${comparison.id}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doc_side: composer.pane,
            location: { offset: composer.offset, length: composer.length },
            text: value,
          }),
        });
        if (res.ok) {
          const { comment } = await res.json();
          setComments((prev) => [...prev, comment]);
        }
      } else {
        const res = await fetch(`/api/comparisons/${comparison.id}/edits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doc_side: "a",
            location: { offset: composer.offset, length: composer.length },
            before_text: composer.text,
            after_text: value,
          }),
        });
        if (res.ok) {
          const { edit } = await res.json();
          setEdits((prev) => [...prev, edit]);
        }
      }
      setComposer(null);
    } finally {
      setComposerBusy(false);
    }
  }

  async function toggleResolve(comment: CommentRow) {
    const next = !comment.resolved;
    setComments((prev) =>
      prev.map((c) => (c.id === comment.id ? { ...c, resolved: next } : c)),
    ); // optimistic
    const res = await fetch(
      `/api/comparisons/${comparison.id}/comments/${comment.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: next }),
      },
    );
    if (!res.ok) {
      setComments((prev) =>
        prev.map((c) => (c.id === comment.id ? { ...c, resolved: !next } : c)),
      );
    }
  }

  function jumpToComment(comment: CommentRow) {
    const index = chunkAtOffset(parsed.chunks, comment.doc_side, comment.location.offset);
    if (index === null) return;
    if (mode !== "side_by_side") setMode("side_by_side");
    revealChunk(comment.doc_side, index, syncOn);
    flashChunk(comment.doc_side, index);
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
      <header className="border-b border-line px-6 py-2.5 flex items-center justify-between gap-6 print-hide">
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
              <button type="submit" className="p-1 text-leaf-deep hover:bg-leaf-wash rounded cursor-pointer" aria-label="Save title">
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setEditingTitle(false)}
                className="p-1 text-ink-faint hover:bg-paper-deep rounded cursor-pointer"
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
              className="group flex items-center gap-2 min-w-0 text-base font-display font-bold text-ink hover:text-ink-soft cursor-pointer"
            >
              <span className="truncate">{title}</span>
              <Pencil className="w-3 h-3 text-ink-faint group-hover:text-leaf-deep flex-shrink-0" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 relative">
          <button
            onClick={() => void saveTask()}
            disabled={saveState === "saving"}
            className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-[0.12em] rounded-lg border border-ink/60 text-ink bg-white hover:bg-paper-deep transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {saveState === "saved" ? (
              <>
                <Check className="w-3.5 h-3.5 text-leaf-deep" /> Saved
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" /> Save
              </>
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setDownloadOpen((v) => !v)}
              className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-[0.12em] rounded-lg bg-leaf text-white hover:bg-leaf-deep transition-colors cursor-pointer flex items-center gap-1.5"
              aria-haspopup="menu"
              aria-expanded={downloadOpen}
            >
              <Download className="w-3.5 h-3.5" /> Download
              <ChevronDown className="w-3 h-3" />
            </button>
            {downloadOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDownloadOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-line rounded-lg shadow-lg py-1 w-56" role="menu">
                  <a
                    href={`/api/comparisons/${comparison.id}/download?doc=a`}
                    onClick={() => setDownloadOpen(false)}
                    className="block px-3 py-2 text-sm text-ink hover:bg-leaf-wash cursor-pointer"
                    role="menuitem"
                  >
                    <span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-leaf-deep block">Primary</span>
                    <span className="truncate block">{comparison.doc_a_name ?? "Document A"}</span>
                  </a>
                  <a
                    href={`/api/comparisons/${comparison.id}/download?doc=b`}
                    onClick={() => setDownloadOpen(false)}
                    className="block px-3 py-2 text-sm text-ink hover:bg-leaf-wash cursor-pointer"
                    role="menuitem"
                  >
                    <span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-leaf-deep block">Comparator</span>
                    <span className="truncate block">{comparison.doc_b_name ?? "Document B"}</span>
                  </a>
                  <button
                    onClick={downloadReport}
                    className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-leaf-wash cursor-pointer"
                    role="menuitem"
                  >
                    <span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-leaf-deep block">Report</span>
                    <span className="block">Audit report (PDF)</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <a
            href="/tasks"
            className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-[0.12em] rounded-lg text-ink-soft hover:text-ink hover:bg-paper-deep transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> My Tasks
          </a>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex print-expand">
        <aside className="w-72 border-r border-line bg-white flex flex-col print-hide">
          {/* View switcher */}
          <div className="p-3 border-b border-line">
            <div className="flex items-center gap-1 bg-paper rounded-lg p-0.5 border border-line">
              {(Object.keys(MODE_META) as ModeId[]).map((id) => {
                const Icon = MODE_META[id].icon;
                const active = mode === id;
                return (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {MODE_META[id].label}
                  </button>
                );
              })}
            </div>
            {similarity != null && (
              <p className="mt-2 text-center text-[11px] text-ink-soft font-serif italic">
                <span className="font-mono not-italic font-bold text-leaf-deep">{similarity}%</span>{" "}
                similar · recommends {MODE_META[recommended].label}
              </p>
            )}
          </div>

          {/* Tools */}
          <div className="p-3 border-b border-line space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
              Tools
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
              className="flex items-center bg-paper border border-line rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-leaf"
            >
              <Search className="w-3.5 h-3.5 text-ink-faint ml-3 flex-shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search text…"
                aria-label="Search text"
                className="px-2 py-1.5 text-xs w-full focus:outline-none bg-transparent min-w-0"
              />
              {query && (
                <button type="button" onClick={clearSearch} className="p-1 text-ink-faint hover:text-ink cursor-pointer flex-shrink-0" aria-label="Clear search">
                  <X className="w-3 h-3" />
                </button>
              )}
            </form>
            <div className="flex items-center gap-1.5">
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as SearchScope)}
                className="flex-1 text-xs text-ink-soft bg-paper border border-line rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
                aria-label="Search scope"
              >
                <option value="both">Search: Both</option>
                <option value="a">Search: Primary</option>
                <option value="b">Search: Comparator</option>
              </select>
              {matches.length > 0 ? (
                <div className="flex items-center gap-0.5 text-xs text-ink-soft flex-shrink-0">
                  <span className="font-mono text-leaf-deep font-bold">
                    {matchIndex + 1}/{matches.length}
                  </span>
                  <button onClick={() => goToMatch(matchIndex - 1)} className="p-1 hover:bg-paper-deep rounded cursor-pointer" aria-label="Previous match">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => goToMatch(matchIndex + 1)} className="p-1 hover:bg-paper-deep rounded cursor-pointer" aria-label="Next match">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : lastSearch.current ? (
                <span className="text-[11px] text-ink-faint font-serif italic flex-shrink-0">No matches</span>
              ) : null}
            </div>
            {jump.targets.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  handleJumpSelect(e.target.value);
                  e.target.value = "";
                }}
                className="w-full text-xs text-ink bg-paper border border-line rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
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
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={scrollBothToTop}
                title="Scroll both documents back to the top"
                className="px-2 py-1.5 text-[11px] font-medium rounded-lg border bg-white text-ink-soft border-line hover:border-ink/40 flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <ArrowUpToLine className="w-3 h-3" />
                Top
              </button>
              <button
                onClick={alignPanes}
                title="Align the other document to your current reading position"
                className="px-2 py-1.5 text-[11px] font-medium rounded-lg border bg-white text-ink-soft border-line hover:border-ink/40 flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <Crosshair className="w-3 h-3" />
                Align
              </button>
              <button
                onClick={() => setSyncOn((v) => !v)}
                title="Move in sync: both documents scroll together and clicking a change aligns both panes."
                aria-pressed={syncOn}
                className={`px-2 py-1.5 text-[11px] font-medium rounded-lg border flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                  syncOn
                    ? "bg-ink text-paper border-ink"
                    : "bg-white text-ink-soft border-line hover:border-ink/40"
                }`}
              >
                <ArrowLeftRight className={`w-3 h-3 ${syncOn ? "text-leaf-ring" : ""}`} />
                Sync
              </button>
            </div>
          </div>

          {/* Notes: comments on either document */}
          {comments.length > 0 && (
            <div className="p-3 border-b border-line">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                  Notes
                </h3>
                <span className="font-mono text-xs font-bold text-note">
                  {comments.filter((c) => !c.resolved).length} open
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1.5">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border border-line bg-paper ${
                      c.resolved ? "opacity-50" : ""
                    }`}
                  >
                    <button
                      onClick={() => jumpToComment(c)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                      title="Show in document"
                    >
                      <span className="text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-note block">
                        {ROLE_LABEL[c.doc_side]}
                      </span>
                      <span
                        className={`text-xs font-serif text-ink leading-snug line-clamp-2 ${
                          c.resolved ? "line-through" : ""
                        }`}
                      >
                        {c.text}
                      </span>
                    </button>
                    <button
                      onClick={() => void toggleResolve(c)}
                      title={c.resolved ? "Reopen" : "Resolve"}
                      aria-label={c.resolved ? "Reopen comment" : "Resolve comment"}
                      className="p-1 rounded hover:bg-paper-deep cursor-pointer flex-shrink-0"
                    >
                      {c.resolved ? (
                        <RotateCcw className="w-3 h-3 text-ink-faint" />
                      ) : (
                        <Check className="w-3 h-3 text-leaf-deep" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Register */}
          <div className="p-3 border-b border-line">
            <div className="flex items-baseline justify-between mb-1.5">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                Proof marks
              </h3>
              <span className="font-mono text-lg font-bold text-leaf-deep leading-none">
                {entries.length}
              </span>
            </div>
            <div className="flex items-center gap-2 mb-2 text-[10px] font-mono uppercase tracking-wider">
              <button
                onClick={() => {
                  setActiveCategories(new Set(CATEGORY_CHIP.map((c) => c.id)));
                  setActiveActions(new Set(ALL_ACTIONS));
                }}
                className="text-leaf-deep hover:text-leaf cursor-pointer"
              >
                Select all
              </button>
              <span className="text-line">·</span>
              <button
                onClick={() => {
                  setActiveCategories(new Set());
                  setActiveActions(new Set());
                }}
                className="text-ink-faint hover:text-ink cursor-pointer"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mb-2.5">
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
                  className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-line hover:bg-paper-deep/60 transition-colors cursor-pointer ${borderClass} ${
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
          {mode === "side_by_side" ? (
            <div className="flex h-full gap-4 p-4 pt-3">
              <DocPane
                pane="a"
                label={comparison.doc_a_name ?? "Document A"}
                doc={parsed.doc_a}
                chunks={parsed.chunks}
                selectedIndex={selectedIndices.a}
                flashIndex={flash?.pane === "a" ? flash.index : null}
                edits={edits.filter((e) => e.doc_side === "a")}
                comments={comments.filter((c) => c.doc_side === "a" && !c.resolved)}
                scrollRef={paneARef}
                onScroll={() => handlePaneScroll("a")}
                onActivate={() => {
                  activePane.current = "a";
                }}
                onContextMenu={(e) => handleContextMenu("a", e)}
                onMouseUp={() => handleSelection("a")}
              />
              <DocPane
                pane="b"
                label={comparison.doc_b_name ?? "Document B"}
                doc={parsed.doc_b}
                chunks={parsed.chunks}
                selectedIndex={selectedIndices.b}
                flashIndex={flash?.pane === "b" ? flash.index : null}
                edits={[]}
                comments={comments.filter((c) => c.doc_side === "b" && !c.resolved)}
                scrollRef={paneBRef}
                onScroll={() => handlePaneScroll("b")}
                onActivate={() => {
                  activePane.current = "b";
                }}
                onContextMenu={(e) => handleContextMenu("b", e)}
                onMouseUp={() => handleSelection("b")}
              />
            </div>
          ) : (
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
        </main>
      </div>

      {selAction && !composer && (
        <div
          className="fixed z-50 bg-ink text-paper rounded-lg shadow-lg flex items-center overflow-hidden"
          style={{
            left: Math.max(8, Math.min(selAction.x - 90, window.innerWidth - 200)),
            top: Math.max(8, selAction.y - 44),
          }}
        >
          <button
            onClick={() => openComposer("comment")}
            className="px-3 py-2 text-xs font-medium flex items-center gap-1.5 hover:bg-ink/80 cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5 text-note" /> Comment
          </button>
          {selAction.pane === "a" && (
            <>
              <span className="w-px h-4 bg-paper/20" />
              <button
                onClick={() => openComposer("edit")}
                className="px-3 py-2 text-xs font-medium flex items-center gap-1.5 hover:bg-ink/80 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-pen-wash" /> Edit
              </button>
            </>
          )}
        </div>
      )}

      {composer && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setComposer(null)} />
          <div
            className="fixed z-50 bg-white border border-ink/20 rounded-lg shadow-xl p-3 w-80"
            style={{
              left: Math.max(8, Math.min(composer.x - 160, window.innerWidth - 340)),
              top: Math.min(composer.y + 14, window.innerHeight - 220),
            }}
          >
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-ink-faint mb-1.5">
              {composer.kind === "comment"
                ? `Comment · ${ROLE_LABEL[composer.pane]}`
                : "Edit · Primary"}
            </div>
            <p className="text-xs font-serif italic text-ink-soft mb-2 line-clamp-2">
              “{composer.text.trim().slice(0, 90)}
              {composer.text.trim().length > 90 ? "…" : ""}”
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitComposer();
              }}
            >
              {composer.kind === "comment" ? (
                <textarea
                  autoFocus
                  value={composer.value}
                  onChange={(e) => setComposer({ ...composer, value: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && setComposer(null)}
                  placeholder="Add a note…"
                  rows={3}
                  maxLength={2000}
                  className="w-full text-sm font-serif border border-line rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-note resize-none"
                />
              ) : (
                <textarea
                  autoFocus
                  value={composer.value}
                  onChange={(e) => setComposer({ ...composer, value: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && setComposer(null)}
                  placeholder="Replacement text…"
                  rows={3}
                  maxLength={5000}
                  className="w-full text-sm font-serif border border-line rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-pen resize-none"
                />
              )}
              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setComposer(null)}
                  className="px-3 py-1.5 text-xs text-ink-soft hover:text-ink cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={composerBusy || !composer.value.trim()}
                  className={`px-4 py-1.5 text-xs font-medium rounded-lg text-white disabled:opacity-40 cursor-pointer ${
                    composer.kind === "comment"
                      ? "bg-note hover:bg-note/85"
                      : "bg-pen hover:bg-pen/85"
                  }`}
                >
                  {composer.kind === "comment" ? "Add comment" : "Save edit"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

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
              className="w-full text-left px-3 py-1.5 hover:bg-leaf-wash flex items-center gap-2 text-ink cursor-pointer"
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
      className={`px-2 py-0.5 text-xs rounded-lg border flex items-center gap-1 cursor-pointer transition-colors ${
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
  edits,
  comments,
  scrollRef,
  onScroll,
  onActivate,
  onContextMenu,
  onMouseUp,
}: {
  pane: Pane;
  label: string;
  doc: ComparisonData["parsed"]["doc_a"];
  chunks: DiffChunk[];
  selectedIndex: number | null;
  flashIndex: number | null;
  edits: EditRow[];
  comments: CommentRow[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
}) {
  const meta = doc.metadata;
  const paragraphs = doc.paragraphs;
  const hidden = pane === "a" ? "insert" : "delete";

  /**
   * Render one segment, split at edit/comment boundaries. Edits show the
   * original struck in editor's violet with the replacement inked in after;
   * commented ranges get a dotted amber underline. Plain segments take the
   * fast path.
   */
  function renderSegment(
    seg: { text: string; op: DiffChunk["op"]; chunkIndex: number; start: number },
    keyBase: string,
  ) {
    const baseCls = segmentClass(
      seg.op,
      selectedIndex === seg.chunkIndex,
      flashIndex === seg.chunkIndex,
    );
    const segStart = seg.start;
    const segEnd = seg.start + seg.text.length;
    const segEdits = edits.filter(
      (e) => e.location.offset < segEnd && e.location.offset + e.location.length > segStart,
    );
    const segComments = comments.filter(
      (c) => c.location.offset < segEnd && c.location.offset + c.location.length > segStart,
    );
    if (segEdits.length === 0 && segComments.length === 0) {
      return (
        <span
          key={keyBase}
          data-chunk={`${pane}-${seg.chunkIndex}`}
          data-off={segStart}
          className={baseCls}
        >
          {seg.text}
        </span>
      );
    }

    const cuts = new Set<number>([segStart, segEnd]);
    for (const r of [...segEdits, ...segComments]) {
      cuts.add(Math.max(segStart, r.location.offset));
      cuts.add(Math.min(segEnd, r.location.offset + r.location.length));
    }
    const points = [...cuts].sort((x, y) => x - y);
    const out: React.ReactNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const s = points[i];
      const e = points[i + 1];
      if (e <= s) continue;
      const inEdit = segEdits.find(
        (ed) => ed.location.offset <= s && ed.location.offset + ed.location.length >= e,
      );
      const inComment = segComments.find(
        (c) => c.location.offset <= s && c.location.offset + c.location.length >= e,
      );
      let cls = baseCls;
      if (inEdit) cls += " line-through decoration-pen text-ink-faint bg-pen-wash";
      if (inComment)
        cls += " underline decoration-dotted decoration-note decoration-2 underline-offset-4";
      out.push(
        <span
          key={`${keyBase}.${i}`}
          data-chunk={`${pane}-${seg.chunkIndex}`}
          data-off={s}
          className={cls}
          title={inComment ? inComment.text : undefined}
        >
          {seg.text.slice(s - segStart, e - segStart)}
        </span>,
      );
      for (const ed of segEdits) {
        if (ed.location.offset + ed.location.length === e && ed.after_text) {
          out.push(
            <span
              key={`${keyBase}.${i}.after`}
              className="text-pen bg-pen-wash rounded px-0.5 font-medium"
              title="Edited on Primary"
            >
              {ed.after_text}
            </span>,
          );
        }
      }
    }
    return out;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Stamp badge above the document — outlined, inked slightly off-true */}
      <div className="flex items-end justify-between px-1 pb-2">
        <div
          className={`flex flex-col px-3 py-1.5 border-[1.5px] border-ink/70 rounded bg-white/70 min-w-0 max-w-[75%] ${
            pane === "a" ? "-rotate-1" : "rotate-1"
          }`}
        >
          <span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-leaf-deep">
            {ROLE_LABEL[pane]}
          </span>
          <span className="font-medium text-ink truncate text-xs">{label}</span>
        </div>
        <span className="text-[11px] text-ink-faint font-mono pb-0.5 flex-shrink-0">
          {meta?.pageCount ? `${meta.pageCount} pp · ` : ""}
          {meta?.wordCount ? `${meta.wordCount.toLocaleString()} words` : ""}
        </span>
      </div>
      <div className="flex-1 flex flex-col bg-white min-h-0 rounded-xl border border-line overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onPointerDown={onActivate}
          onWheel={onActivate}
          onTouchStart={onActivate}
          onContextMenu={onContextMenu}
          onMouseUp={onMouseUp}
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
                    {segments.map((s, si) => renderSegment(s, `${pi}-${si}`))}
                  </p>
                );
              })
            ) : (
              // Fallback for comparisons processed before paragraph skeletons
              // were stored: continuous chunk stream.
              <div className="text-ink leading-relaxed whitespace-pre-wrap break-words">
                {chunks.map((chunk, index) => {
                  if (chunk.op === hidden) return null;
                  return renderSegment(
                    {
                      text: chunk.text,
                      op: chunk.op,
                      chunkIndex: index,
                      start: pane === "a" ? chunk.offsetA : chunk.offsetB,
                    },
                    `f${index}`,
                  );
                })}
              </div>
            )}
          </div>
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
