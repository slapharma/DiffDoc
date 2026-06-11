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

export function ReportView({
  title,
  createdAt,
  similarity,
  primary,
  comparator,
  entries,
}: {
  title: string;
  createdAt: string;
  similarity: number | null;
  primary: DocProfile;
  comparator: DocProfile;
  entries: ReportEntry[];
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
    <div className="h-full overflow-y-auto bg-stone-50 print-expand">
      <div className="max-w-4xl mx-auto px-8 py-8 print:px-0">
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-1">
              Comparison report
            </div>
            <h1 className="text-3xl font-bold font-serif text-stone-900">{title}</h1>
            <p className="text-sm text-stone-500 mt-1">
              Generated {new Date(createdAt).toLocaleString()} · literal comparison
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="print-hide px-4 py-2 bg-stone-900 text-white rounded-md text-sm font-medium flex items-center gap-2 hover:bg-stone-800"
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
            <div key={doc.role} className="bg-white border border-stone-200 rounded-lg p-5">
              <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">
                {doc.role}
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 mb-3">
                <FileText className="w-4 h-4 text-stone-400" />
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
        <div className="bg-white border border-stone-200 rounded-lg divide-y divide-stone-100 mb-8">
          {[...actionCounts.entries()]
            .sort((x, y) => y[1] - x[1])
            .map(([action, count]) => (
              <div key={action} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-stone-800">{ACTION_LABELS[action]}</span>
                <span className="font-mono text-stone-600">{count}</span>
              </div>
            ))}
          {entries.length === 0 && (
            <p className="px-4 py-3 text-sm text-stone-500">
              No differences — the documents are textually identical.
            </p>
          )}
        </div>

        {flagged.length > 0 && (
          <>
            <SectionTitle>
              Flagged changes{" "}
              <span className="font-normal normal-case text-stone-400">
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
                <p className="text-xs text-stone-400 text-center">
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

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3 mb-8">
          <Sparkles className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-stone-700">
            <span className="font-semibold text-stone-900">Methodology.</span> This report is
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
    <h2 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">
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
        highlight ? "bg-red-50 border-red-200" : "bg-white border-stone-200"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
        {label}
      </div>
      <div className={`text-3xl font-bold font-mono mt-1 ${highlight ? "text-red-700" : "text-stone-900"}`}>
        {value}
      </div>
      <div className="text-xs text-stone-500 mt-0.5">{sub}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex">
      <dt className="w-20 font-mono text-xs uppercase tracking-wide text-stone-400 pt-0.5">
        {k}
      </dt>
      <dd className={`flex-1 text-stone-800 ${mono ? "font-mono text-xs pt-0.5" : ""}`}>{v}</dd>
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
    tone === "red" ? "border-l-red-500" : tone === "green" ? "border-l-green-500" : "border-l-stone-400";
  return (
    <div className={`bg-white border border-stone-200 border-l-2 ${border} rounded-lg px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-1">
        {ACTION_LABELS[entry.action]}
        {entry.reasons.length > 0 &&
          ` · ${entry.reasons.map((r) => FLAG_LABELS[r]).join(" · ")}`}
      </div>
      <div className="text-sm text-stone-800 font-serif">
        {entry.before !== undefined && (
          <span className={entry.after !== undefined ? "line-through text-red-800 bg-red-50 px-1 rounded" : ""}>
            {clip(entry.before)}
          </span>
        )}
        {entry.before !== undefined && entry.after !== undefined && (
          <span className="text-stone-400 mx-1.5">→</span>
        )}
        {entry.after !== undefined && (
          <span className={entry.before !== undefined ? "bg-green-50 text-green-900 px-1 rounded" : ""}>
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
