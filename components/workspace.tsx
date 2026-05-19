"use client";

import { useState } from "react";
import {
  FileText,
  MessageSquare,
  Edit3,
  Download,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Sparkles,
  GitCompare,
  Layers,
  BookOpen,
  Hash,
  Calendar,
  User,
} from "lucide-react";

type ModeId = "side-by-side" | "aligned" | "summary";

type Mode = {
  id: ModeId;
  label: string;
  similarity: number;
  icon: typeof GitCompare;
  desc: string;
};

const MODES: Mode[] = [
  {
    id: "side-by-side",
    label: "Side-by-side",
    similarity: 87,
    icon: GitCompare,
    desc: ">75% similar — version comparison",
  },
  {
    id: "aligned",
    label: "Aligned sections",
    similarity: 58,
    icon: Layers,
    desc: "40-75% — semantic alignment",
  },
  {
    id: "summary",
    label: "Summary-first",
    similarity: 22,
    icon: BookOpen,
    desc: "<40% — thematic comparison",
  },
];

export function Workspace() {
  const [mode, setMode] = useState<ModeId>("side-by-side");
  const [selectedDiff, setSelectedDiff] = useState<number | null>(null);
  const [filterTags, setFilterTags] = useState<string[]>([
    "substantive",
    "flagged",
    "minor",
    "structural",
    "cosmetic",
  ]);
  const [expandedSection, setExpandedSection] = useState<number>(0);

  const currentMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      <header className="border-b border-stone-200 bg-white">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-stone-900 rounded-sm flex items-center justify-center">
                <GitCompare
                  className="w-4 h-4 text-white"
                  strokeWidth={2.5}
                />
              </div>
              <span className="font-mono font-semibold tracking-tight text-base">
                diffdoc
              </span>
            </div>
            <nav className="flex items-center gap-1 text-sm">
              <div className="px-3 py-1.5 rounded-md bg-stone-100 text-stone-700 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                <span className="font-medium">SOP-2024-v3.docx</span>
                <span className="text-stone-400">vs</span>
                <span className="font-medium">SOP-2025-v1.docx</span>
              </div>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4" /> 4 comments
            </button>
            <button className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 flex items-center gap-1.5">
              <Edit3 className="w-4 h-4" /> 2 edits
            </button>
            <div className="w-px h-5 bg-stone-200 mx-1" />
            <button className="px-4 py-1.5 text-sm font-medium bg-stone-900 text-white rounded-md hover:bg-stone-800 flex items-center gap-1.5">
              <Download className="w-4 h-4" /> Export bundle
            </button>
          </div>
        </div>

        <div className="px-6 py-3 bg-gradient-to-r from-amber-50 to-stone-50 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-700" />
                <span className="text-sm text-stone-700">
                  AI recommends{" "}
                  <span className="font-semibold text-stone-900">
                    {currentMode.label}
                  </span>{" "}
                  · similarity score{" "}
                  <span className="font-mono font-semibold">
                    {currentMode.similarity}%
                  </span>
                </span>
              </div>
              <span className="text-stone-300">·</span>
              <span className="text-xs text-stone-500">
                {currentMode.desc}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-md p-0.5">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded flex items-center gap-1.5 transition-colors ${
                      active
                        ? "bg-stone-900 text-white"
                        : "text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <div className="flex" style={{ height: "calc(100vh - 116px)" }}>
        <DifferenceRegister
          filterTags={filterTags}
          setFilterTags={setFilterTags}
          selectedDiff={selectedDiff}
          setSelectedDiff={setSelectedDiff}
        />

        <main className="flex-1 overflow-hidden bg-stone-50">
          {mode === "side-by-side" && (
            <SideBySideView selectedDiff={selectedDiff} />
          )}
          {mode === "aligned" && (
            <AlignedView
              expandedSection={expandedSection}
              setExpandedSection={setExpandedSection}
            />
          )}
          {mode === "summary" && <SummaryView />}
        </main>
      </div>

      <footer className="border-t border-stone-200 bg-white px-6 py-2 flex items-center justify-between text-xs text-stone-500 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Hash className="w-3 h-3" /> a7c3f...8b21
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3" /> 2026-05-15 14:32 BST
          </span>
          <span className="flex items-center gap-1.5">
            <User className="w-3 h-3" /> cflack@slapharma.com
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>Claude Sonnet 4.6</span>
          <span>·</span>
          <span>v0.1.0-beta</span>
        </div>
      </footer>
    </div>
  );
}

type DiffType = "flagged" | "substantive" | "minor" | "structural" | "cosmetic";

type DiffEntry = {
  id: number;
  type: DiffType;
  section: string;
  summary: string;
  tag: string;
  flagged?: boolean;
};

type Tag = {
  id: DiffType;
  label: string;
  count: number;
  color: "red" | "amber" | "blue" | "purple" | "stone";
};

const TAGS: Tag[] = [
  { id: "flagged", label: "Flagged", count: 3, color: "red" },
  { id: "substantive", label: "Substantive", count: 8, color: "amber" },
  { id: "minor", label: "Minor", count: 11, color: "blue" },
  { id: "structural", label: "Structural", count: 2, color: "purple" },
  { id: "cosmetic", label: "Cosmetic", count: 3, color: "stone" },
];

const DIFFS: DiffEntry[] = [
  {
    id: 1,
    type: "flagged",
    section: "§2.1",
    summary: "Dosing changed: 20mg → 40mg",
    tag: "Numerical change",
    flagged: true,
  },
  {
    id: 2,
    type: "substantive",
    section: "§2.1",
    summary: "Indication broadened to include paediatric patients",
    tag: "Scope expansion",
  },
  {
    id: 3,
    type: "flagged",
    section: "§3.4",
    summary: 'Negation introduced: "must not" added',
    tag: "Polarity reversal",
    flagged: true,
  },
  {
    id: 4,
    type: "substantive",
    section: "§4.0",
    summary: "Storage temperature window narrowed",
    tag: "Range change",
  },
  {
    id: 5,
    type: "minor",
    section: "§5.2",
    summary: 'Synonym substitution: "physician" → "clinician"',
    tag: "Semantic equivalent",
  },
  {
    id: 6,
    type: "structural",
    section: "§7",
    summary: 'New section added: "Post-market surveillance"',
    tag: "Addition",
  },
  {
    id: 7,
    type: "minor",
    section: "§5.4",
    summary: "Reordering of contraindications list",
    tag: "Order change",
  },
  {
    id: 8,
    type: "cosmetic",
    section: "§1",
    summary: "Header style updated",
    tag: "Formatting",
  },
];

function DifferenceRegister({
  filterTags,
  setFilterTags,
  selectedDiff,
  setSelectedDiff,
}: {
  filterTags: string[];
  setFilterTags: (t: string[]) => void;
  selectedDiff: number | null;
  setSelectedDiff: (id: number | null) => void;
}) {
  return (
    <aside className="w-72 border-r border-stone-200 bg-white flex flex-col">
      <div className="p-4 border-b border-stone-100">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Differences
          </h3>
          <span className="font-mono text-xs text-stone-400">27 total</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {TAGS.map((t) => {
            const active = filterTags.includes(t.id);
            const colorMap: Record<Tag["color"], string> = {
              red: active
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-white border-stone-200 text-stone-400",
              amber: active
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-white border-stone-200 text-stone-400",
              blue: active
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-white border-stone-200 text-stone-400",
              purple: active
                ? "bg-purple-50 border-purple-200 text-purple-700"
                : "bg-white border-stone-200 text-stone-400",
              stone: active
                ? "bg-stone-100 border-stone-300 text-stone-700"
                : "bg-white border-stone-200 text-stone-400",
            };
            return (
              <button
                key={t.id}
                onClick={() =>
                  setFilterTags(
                    active
                      ? filterTags.filter((x) => x !== t.id)
                      : [...filterTags, t.id],
                  )
                }
                className={`px-2 py-0.5 text-xs rounded-full border ${colorMap[t.color]} flex items-center gap-1`}
              >
                {t.label}{" "}
                <span className="font-mono">{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {DIFFS.map((diff) => {
          const typeColor: Record<DiffType, string> = {
            flagged: "border-l-red-500 bg-red-50/40",
            substantive: "border-l-amber-500 bg-amber-50/40",
            minor: "border-l-blue-400 bg-white",
            structural: "border-l-purple-500 bg-purple-50/40",
            cosmetic: "border-l-stone-300 bg-white",
          };
          const isSelected = selectedDiff === diff.id;
          return (
            <button
              key={diff.id}
              onClick={() => setSelectedDiff(isSelected ? null : diff.id)}
              className={`w-full text-left px-3 py-2.5 border-l-2 border-b border-stone-100 hover:bg-stone-50 transition-colors ${typeColor[diff.type]} ${isSelected ? "ring-1 ring-stone-900 bg-stone-50" : ""}`}
            >
              <div className="flex items-start gap-2">
                {diff.flagged && (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-stone-500 font-semibold">
                      {diff.section}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-stone-400">
                      {diff.tag}
                    </span>
                  </div>
                  <p className="text-sm text-stone-800 leading-snug">
                    {diff.summary}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function SideBySideView({ selectedDiff }: { selectedDiff: number | null }) {
  return (
    <div className="flex h-full">
      <DocPane
        side="left"
        label="SOP-2024-v3.docx"
        subtitle="Original · 12 pages"
        highlighted={selectedDiff}
      />
      <div className="w-px bg-stone-200" />
      <DocPane
        side="right"
        label="SOP-2025-v1.docx"
        subtitle="Revised · 14 pages"
        highlighted={selectedDiff}
      />
    </div>
  );
}

function DocPane({
  side,
  label,
  subtitle,
}: {
  side: "left" | "right";
  label: string;
  subtitle: string;
  highlighted: number | null;
}) {
  return (
    <div className="flex-1 flex flex-col bg-white">
      <div className="px-6 py-2.5 border-b border-stone-100 bg-stone-50/50 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-stone-900">{label}</div>
          <div className="text-xs text-stone-500">{subtitle}</div>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-white rounded">
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-white rounded">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto font-serif">
          <h2 className="text-xl font-bold text-stone-900 mb-1">
            Section 2.1 — Dosing Regimen
          </h2>
          <p className="text-xs text-stone-500 mb-4 font-sans">
            Page 3 of {side === "left" ? "12" : "14"}
          </p>

          <p className="text-stone-800 leading-relaxed mb-4">
            The recommended starting dose for adult patients is{" "}
            {side === "left" ? (
              <span className="bg-red-100 text-red-900 px-1 rounded line-through decoration-red-500">
                20mg
              </span>
            ) : (
              <span className="bg-green-100 text-green-900 px-1 rounded font-medium">
                40mg
              </span>
            )}{" "}
            administered orally twice daily.{" "}
            {side === "right" && (
              <span className="bg-green-100 text-green-900 px-1 rounded">
                For paediatric patients aged 6–17, refer to Table 2.1b.
              </span>
            )}
          </p>

          <p className="text-stone-800 leading-relaxed mb-4">
            Patients with renal impairment should have the dose adjusted as
            detailed in Section 3.4. The clinician should monitor liver
            function tests at baseline and at week 4.
          </p>

          <h3 className="text-base font-semibold text-stone-900 mt-6 mb-2">
            Section 3.4 — Renal Adjustment
          </h3>
          <p className="text-stone-800 leading-relaxed mb-4">
            In patients with creatinine clearance below 30 mL/min, the dose{" "}
            {side === "left" ? (
              <span className="bg-red-100 text-red-900 px-1 rounded line-through decoration-red-500">
                should be
              </span>
            ) : (
              <span className="bg-green-100 text-green-900 px-1 rounded font-medium">
                must not be
              </span>
            )}{" "}
            increased above 80mg per day.
          </p>

          <p className="text-stone-800 leading-relaxed mb-4">
            Liver function monitoring is required for all patients receiving
            doses above 60mg/day.
          </p>

          <h3 className="text-base font-semibold text-stone-900 mt-6 mb-2">
            Section 5.2 — Healthcare Provider Responsibilities
          </h3>
          <p className="text-stone-800 leading-relaxed mb-4">
            The treating{" "}
            {side === "left" ? (
              <span className="bg-blue-50 text-blue-900 px-1 rounded line-through decoration-blue-400">
                physician
              </span>
            ) : (
              <span className="bg-blue-50 text-blue-900 px-1 rounded">
                clinician
              </span>
            )}{" "}
            must document all dose changes in the patient record within 24
            hours.
          </p>

          {side === "right" && (
            <>
              <h3 className="text-base font-semibold text-stone-900 mt-6 mb-2 bg-green-50 px-2 py-1 rounded">
                Section 7 — Post-market Surveillance{" "}
                <span className="text-xs font-normal text-green-700">NEW</span>
              </h3>
              <p className="text-stone-800 leading-relaxed mb-4 bg-green-50/50 px-2 py-1 rounded">
                All adverse events should be reported within 15 days via the
                MHRA Yellow Card scheme. The marketing authorisation holder
                will conduct quarterly review of safety signals.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type AlignedSection = {
  title: string;
  matchScore: number;
  leftSection: string;
  rightSection: string;
  summary: string;
  leftContent?: string;
  rightContent?: string;
  changes: number;
  unmatched?: "left" | "right";
};

const ALIGNED_SECTIONS: AlignedSection[] = [
  {
    title: "Dosing & Administration",
    matchScore: 78,
    leftSection: "§2.1 — Dosing Regimen",
    rightSection: "§3 — Administration Schedule",
    summary:
      "Both documents cover dosing but use different organisational structures. Doc B introduces a paediatric subsection absent from Doc A.",
    leftContent: "Adult dose: 20mg twice daily. Renal adjustment per §3.4.",
    rightContent:
      "Adult dose: 40mg twice daily. Paediatric dose: see Table 3.2. Renal patients: §5.1.",
    changes: 3,
  },
  {
    title: "Storage Conditions",
    matchScore: 92,
    leftSection: "§4.0",
    rightSection: "§6.1",
    summary:
      "Near-identical content with minor temperature range narrowing (2-30°C → 15-25°C) and one new humidity requirement.",
    changes: 2,
  },
  {
    title: "Contraindications",
    matchScore: 65,
    leftSection: "§5.4",
    rightSection: "§4.2",
    summary:
      "Same set of contraindications but reordered and reworded. One contraindication (severe hepatic impairment) is new in Doc B.",
    changes: 4,
  },
  {
    title: "Post-market Surveillance",
    matchScore: 0,
    leftSection: "— not present —",
    rightSection: "§7",
    summary:
      "New section in Doc B with no counterpart in Doc A. Covers Yellow Card reporting, quarterly safety reviews, and PSUR obligations.",
    changes: 1,
    unmatched: "right",
  },
  {
    title: "Appendix A: Trial Data",
    matchScore: 0,
    leftSection: "§A",
    rightSection: "— not present —",
    summary:
      "Removed in Doc B. Trial data has been moved to a separate clinical study report (referenced in §1.3).",
    changes: 1,
    unmatched: "left",
  },
];

function AlignedView({
  expandedSection,
  setExpandedSection,
}: {
  expandedSection: number;
  setExpandedSection: (n: number) => void;
}) {
  return (
    <div className="h-full overflow-y-auto px-8 py-6 bg-stone-50">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-stone-900 mb-1 font-serif">
            Aligned sections
          </h2>
          <p className="text-sm text-stone-600">
            AI has matched sections across both documents by meaning rather
            than position. Click a pair to compare.
          </p>
        </div>

        <div className="space-y-3">
          {ALIGNED_SECTIONS.map((sec, i) => (
            <div
              key={i}
              className="bg-white border border-stone-200 rounded-lg overflow-hidden"
            >
              <button
                onClick={() =>
                  setExpandedSection(expandedSection === i ? -1 : i)
                }
                className="w-full p-4 flex items-center gap-4 hover:bg-stone-50 transition-colors text-left"
              >
                {expandedSection === i ? (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-stone-400" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-stone-900">
                      {sec.title}
                    </h3>
                    {sec.unmatched ? (
                      <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full font-medium">
                        Unmatched
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-stone-700"
                            style={{ width: `${sec.matchScore}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-stone-500">
                          {sec.matchScore}%
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-stone-500">
                    <span className="font-mono">{sec.leftSection}</span>
                    <span>↔</span>
                    <span className="font-mono">{sec.rightSection}</span>
                    <span className="text-stone-300">·</span>
                    <span>
                      {sec.changes}{" "}
                      {sec.changes === 1 ? "change" : "changes"}
                    </span>
                  </div>
                </div>
              </button>

              {expandedSection === i && (
                <div className="border-t border-stone-100 bg-stone-50/50 p-4">
                  <div className="mb-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded">
                    <Sparkles className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-stone-800">{sec.summary}</p>
                  </div>
                  {!sec.unmatched && sec.leftContent && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white p-3 rounded border border-stone-200">
                        <div className="font-mono text-xs uppercase tracking-wide text-stone-400 mb-2">
                          Doc A · {sec.leftSection}
                        </div>
                        <p className="text-sm text-stone-800 font-serif">
                          {sec.leftContent}
                        </p>
                      </div>
                      <div className="bg-white p-3 rounded border border-stone-200">
                        <div className="font-mono text-xs uppercase tracking-wide text-stone-400 mb-2">
                          Doc B · {sec.rightSection}
                        </div>
                        <p className="text-sm text-stone-800 font-serif">
                          {sec.rightContent}
                        </p>
                      </div>
                    </div>
                  )}
                  {sec.unmatched && (
                    <div
                      className={`p-3 rounded border ${
                        sec.unmatched === "left"
                          ? "bg-red-50 border-red-100"
                          : "bg-green-50 border-green-100"
                      }`}
                    >
                      <div className="font-mono text-xs uppercase tracking-wide text-stone-500 mb-1">
                        Only in Doc {sec.unmatched === "left" ? "A" : "B"}
                      </div>
                      <p className="text-sm text-stone-800">
                        This content has no semantic match in the other
                        document.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type DocProfile = {
  label: string;
  type: string;
  audience: string;
  length: string;
  reading: string;
  framework: string;
};

const DOC_PROFILES: DocProfile[] = [
  {
    label: "SOP-2024-v3.docx",
    type: "Standard Operating Procedure",
    audience: "Clinical staff",
    length: "12 pages · ~4,200 words",
    reading: "University level",
    framework: "GxP / ICH E6",
  },
  {
    label: "PIL-2025-v1.docx",
    type: "Patient Information Leaflet",
    audience: "General public",
    length: "4 pages · ~1,100 words",
    reading: "Year 9 / age 14",
    framework: "EU 2001/83/EC Annex IIIa",
  },
];

type ThemeRow = {
  theme: string;
  a: string;
  b: string;
  overlap: "High" | "Medium" | "Low" | "None";
};

const THEMES: ThemeRow[] = [
  {
    theme: "Indications & use",
    a: "Detailed clinical criteria for prescribing",
    b: 'Simplified "what this medicine is for" statement',
    overlap: "High",
  },
  {
    theme: "Dosing information",
    a: "Full posology with renal/hepatic adjustments",
    b: "How to take section with patient-friendly phrasing",
    overlap: "Medium",
  },
  {
    theme: "Adverse events",
    a: "Reporting obligations & MedDRA coding",
    b: "Common side effects in plain language",
    overlap: "Low",
  },
  {
    theme: "Storage",
    a: "Pharmacy-level storage and handling",
    b: "Home storage advice for patients",
    overlap: "Medium",
  },
  {
    theme: "Regulatory context",
    a: "GxP compliance framework",
    b: "Patient rights and reporting routes",
    overlap: "None",
  },
];

function SummaryView() {
  const overlapColor: Record<ThemeRow["overlap"], string> = {
    High: "bg-green-100 text-green-800",
    Medium: "bg-amber-100 text-amber-800",
    Low: "bg-orange-100 text-orange-800",
    None: "bg-stone-100 text-stone-600",
  };

  return (
    <div className="h-full overflow-y-auto bg-stone-50">
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8 p-6 bg-white border border-stone-200 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span className="text-xs uppercase tracking-wider text-stone-500 font-semibold">
              Executive summary · generated by Claude
            </span>
          </div>
          <p
            className="text-stone-800 leading-relaxed mb-3 font-serif"
            style={{ fontSize: "17px" }}
          >
            These two documents have{" "}
            <strong>limited thematic overlap</strong> and likely should not be
            compared section-by-section. Doc A is a clinical Standard
            Operating Procedure for an established product; Doc B is a Patient
            Information Leaflet for a different product in the same
            therapeutic class.
          </p>
          <p
            className="text-stone-700 leading-relaxed font-serif"
            style={{ fontSize: "15px" }}
          >
            They share common ground only in dosing terminology and a small
            overlap in adverse event language. The reading level, intended
            audience, and regulatory framework differ substantially.
          </p>
        </div>

        <h3 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">
          Document profiles
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-8">
          {DOC_PROFILES.map((doc, i) => (
            <div
              key={i}
              className="bg-white border border-stone-200 rounded-lg p-5"
            >
              <div className="text-sm font-semibold text-stone-900 mb-3">
                {doc.label}
              </div>
              <dl className="space-y-2 text-sm">
                {(
                  Object.entries(doc).slice(1) as [
                    keyof DocProfile,
                    string,
                  ][]
                ).map(([k, v]) => (
                  <div key={k} className="flex">
                    <dt className="w-24 font-mono text-xs uppercase tracking-wide text-stone-400 pt-0.5">
                      {k}
                    </dt>
                    <dd className="flex-1 text-stone-800">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <h3 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">
          Thematic comparison · click to explore
        </h3>
        <div className="space-y-2 mb-8">
          {THEMES.map((t, i) => (
            <button
              key={i}
              className="w-full bg-white border border-stone-200 rounded-lg p-4 hover:border-stone-300 transition-colors text-left flex items-center gap-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h4 className="font-medium text-stone-900">{t.theme}</h4>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${overlapColor[t.overlap]}`}
                  >
                    {t.overlap} overlap
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-stone-600 mt-2">
                  <div>
                    <span className="font-mono text-stone-400">A → </span>
                    {t.a}
                  </div>
                  <div>
                    <span className="font-mono text-stone-400">B → </span>
                    {t.b}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300" />
            </button>
          ))}
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold text-stone-900 text-sm mb-1">
              Side-by-side view available, but not recommended
            </div>
            <p className="text-sm text-stone-700">
              These documents differ substantially in audience and purpose. A
              line-by-line diff would produce noise rather than insight.
              Switch to side-by-side anyway if you want to override.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
