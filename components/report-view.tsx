"use client";

import { Download, FileText, Sparkles } from "lucide-react";
import { ACTION_LABELS, type ChangeAction, type ChangeEntry } from "@/lib/pipeline/actions";
import { FLAG_LABELS, type FlagReason } from "@/lib/pipeline/flags";

type DocProfile = {
  role: string;
  name: string;
  metadata?: { pageCount?: number; wordCount?: number };
  hash: string | null;
};

export type ReportEntry = ChangeEntry & { reasons: FlagReason[] };

export type ReportComment = {
  role: string;
  quote: string;
  text: string;
  resolved: boolean;
};

export type ReportEdit = { quote: string; replacement: string };

export function ReportView({
  title,
  createdAt,
  similarity,
  primary,
  comparator,
  entries,
  comments = [],
  edits = [],
}: {
  title: string;
  createdAt: string;
  similarity: number | null;
  primary: DocProfile;
  comparator: DocProfile;
  entries: ReportEntry[];
  comments?: ReportComment[];
  edits?: ReportEdit[];
}) {
  const flagged = entries.filter((e) => e.reasons.length > 0);
  const actionCounts = new Map<ChangeAction, number>();
  for (const e of entries) actionCounts.set(e.action, (actionCounts.get(e.action) ?? 0) + 1);
  const reasonCounts = new Map<FlagReason, number>();
  for (const e of flagged) for (const r of e.reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);

  const largestAdditions = entries
    .filter((e) => e.action === "addition")
    .sort((x, y) => (y.after?.length ?? 0) - (x.after?.length ?? 0))
    .slice(0, 5);
  const largestDeletions = entries
    .filter((e) => e.action === "deletion")
    .sort((x, y) => (y.before?.length ?? 0) - (x.before?.length ?? 0))
    .slice(0, 5);

  return (
    <div className="h-full overflow-y-auto bg-paper print-expand">
      <div className="max-w-4xl mx-auto px-8 py-8 print:px-0">
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-faint font-bold mb-1">
              Comparison report
            </div>
            <h1 className="text-3xl font-bold font-display text-ink">{title}</h1>
            <p className="text-sm font-serif italic text-ink-soft mt-1">
              Generated {new Date(createdAt).toLocaleString()} · literal comparison
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="print-hide px-4 py-2 bg-leaf text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-leaf-deep"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Similarity"
            value={similarity != null ? `${similarity}%` : "—"}
            sub="character-level"
          />
          <StatCard label="Changes" value={String(entries.length)} sub="logical changes" />
          <StatCard
            label="Flagged"
            value={String(flagged.length)}
            sub="high-risk patterns"
            highlight={flagged.length > 0}
          />
        </div>

        <SectionTitle>Documents</SectionTitle>
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[primary, comparator].map((doc) => (
            <div key={doc.role} className="bg-white border border-line rounded-xl p-5">
              <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink-faint font-bold mb-1">
                {doc.role}
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3">
                <FileText className="w-4 h-4 text-ink-faint" />
                <span className="truncate">{doc.name}</span>
              </div>
              <dl className="space-y-1.5 text-sm">
                {doc.metadata?.pageCount !== undefined && (
                  <Row k="Pages" v={String(doc.metadata.pageCount)} />
                )}
                {doc.metadata?.wordCount !== undefined && (
                  <Row k="Words" v={doc.metadata.wordCount.toLocaleString()} />
                )}
                <Row k="SHA-256" v={doc.hash ? `${doc.hash.slice(0, 16)}…` : "—"} mono />
              </dl>
            </div>
          ))}
        </div>

        <SectionTitle>Changes by action</SectionTitle>
        <div className="bg-white border border-line rounded-xl divide-y divide-line mb-8">
          {[...actionCounts.entries()]
            .sort((x, y) => y[1] - x[1])
            .map(([action, count]) => (
              <div key={action} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink font-serif">{ACTION_LABELS[action]}</span>
                <span className="font-mono text-leaf-deep font-bold">{count}</span>
              </div>
            ))}
          {entries.length === 0 && (
            <p className="px-4 py-3 text-sm font-serif italic text-ink-soft">
              No differences — the documents are textually identical.
            </p>
          )}
        </div>

        {flagged.length > 0 && (
          <>
            <SectionTitle>
              Flagged changes{" "}
              <span className="font-normal normal-case text-ink-faint">
                ({[...reasonCounts.entries()]
                  .map(([r, c]) => `${FLAG_LABELS[r].toLowerCase()} ×${c}`)
                  .join(", ")})
              </span>
            </SectionTitle>
            <div className="space-y-2 mb-8">
              {flagged.slice(0, 12).map((entry, i) => (
                <HighlightCard key={i} entry={entry} tone="red" />
              ))}
              {flagged.length > 12 && (
                <p className="text-xs text-ink-faint text-center font-serif italic">
                  + {flagged.length - 12} more flagged changes in the workspace view
                </p>
              )}
            </div>
          </>
        )}

        {(largestAdditions.length > 0 || largestDeletions.length > 0) && (
          <>
            <SectionTitle>Largest additions &amp; removals</SectionTitle>
            <div className="space-y-2 mb-8">
              {largestAdditions.map((entry, i) => (
                <HighlightCard key={`a${i}`} entry={entry} tone="green" />
              ))}
              {largestDeletions.map((entry, i) => (
                <HighlightCard key={`d${i}`} entry={entry} tone="stone" />
              ))}
            </div>
          </>
        )}

        {edits.length > 0 && (
          <>
            <SectionTitle>
              Editor&apos;s changes to Primary{" "}
              <span className="font-normal normal-case text-ink-faint">({edits.length})</span>
            </SectionTitle>
            <div className="space-y-2 mb-8">
              {edits.map((e, i) => (
                <div
                  key={i}
                  className="bg-white border border-line border-l-2 border-l-pen rounded-xl px-4 py-3"
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-pen mb-1">
                    Edit · Primary
                  </div>
                  <div className="text-sm text-ink font-serif">
                    <span className="line-through text-ink-faint bg-paper-deep px-1 rounded decoration-pen">
                      {clip(e.quote) || "(empty)"}
                    </span>
                    <span className="text-ink-faint mx-1.5">→</span>
                    <span className="bg-pen-wash text-pen px-1 rounded font-medium">
                      {clip(e.replacement) || "(deleted)"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {comments.length > 0 && (
          <>
            <SectionTitle>
              Reviewer notes{" "}
              <span className="font-normal normal-case text-ink-faint">
                ({comments.filter((c) => !c.resolved).length} open
                {comments.some((c) => c.resolved)
                  ? `, ${comments.filter((c) => c.resolved).length} resolved`
                  : ""}
                )
              </span>
            </SectionTitle>
            <div className="space-y-2 mb-8">
              {comments.map((c, i) => (
                <div
                  key={i}
                  className={`bg-white border border-line border-l-2 border-l-note rounded-xl px-4 py-3 ${
                    c.resolved ? "opacity-60" : ""
                  }`}
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-note mb-1">
                    {c.role}
                    {c.resolved ? " · resolved" : ""}
                  </div>
                  <p className="text-xs font-serif italic text-ink-soft mb-1">
                    “{clip(c.quote, 120)}”
                  </p>
                  <p className={`text-sm text-ink font-serif ${c.resolved ? "line-through" : ""}`}>
                    {c.text}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="p-4 bg-leaf-wash border border-leaf/30 rounded-xl flex items-start gap-3 mb-8">
          <Sparkles className="w-5 h-5 text-leaf-deep mt-0.5 flex-shrink-0" />
          <div className="text-sm font-serif text-ink-soft">
            <span className="font-semibold not-italic text-ink">Methodology.</span> This report is
            based on a literal character-level comparison (diff-match-patch) of the extracted
            text, with local heuristics flagging numbers, dates, and negations. AI semantic
            classification and plain-English summaries arrive in the next build phase.
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-faint font-bold mb-3">
      {children}
    </h2>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-5 border ${
        highlight ? "bg-flag-wash border-flag/40" : "bg-white border-line"
      }`}
    >
      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink-faint font-bold">
        {label}
      </div>
      <div className={`text-3xl font-bold font-mono mt-1 ${highlight ? "text-flag" : "text-ink"}`}>
        {value}
      </div>
      <div className="text-xs font-serif italic text-ink-soft mt-0.5">{sub}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex">
      <dt className="w-20 font-mono text-xs uppercase tracking-wide text-ink-faint pt-0.5">
        {k}
      </dt>
      <dd className={`flex-1 text-ink ${mono ? "font-mono text-xs pt-0.5" : ""}`}>{v}</dd>
    </div>
  );
}

function HighlightCard({
  entry,
  tone,
}: {
  entry: ReportEntry;
  tone: "red" | "green" | "stone";
}) {
  const border =
    tone === "red" ? "border-l-flag" : tone === "green" ? "border-l-leaf" : "border-l-ink-faint";
  return (
    <div className={`bg-white border border-line border-l-2 ${border} rounded-lg px-4 py-3`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-1">
        {ACTION_LABELS[entry.action]}
        {entry.reasons.length > 0 &&
          ` · ${entry.reasons.map((r) => FLAG_LABELS[r]).join(" · ")}`}
      </div>
      <div className="text-sm text-ink font-serif">
        {entry.before !== undefined && (
          <span className={entry.after !== undefined ? "line-through text-ink-soft bg-paper-deep px-1 rounded decoration-ink-faint" : ""}>
            {clip(entry.before)}
          </span>
        )}
        {entry.before !== undefined && entry.after !== undefined && (
          <span className="text-ink-faint mx-1.5">→</span>
        )}
        {entry.after !== undefined && (
          <span className={entry.before !== undefined ? "bg-leaf-wash text-leaf-deep px-1 rounded" : ""}>
            {clip(entry.after)}
          </span>
        )}
      </div>
    </div>
  );
}

function clip(text: string, max = 160): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
