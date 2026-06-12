/**
 * Shared, dependency-free helpers for building the "DiffDoc Annotations"
 * appendix that gets injected into downloaded documents.
 *
 * Why an appendix rather than precise inline marks: comments and edits are
 * anchored to offsets in the plain-text projection, which do not map cleanly
 * back onto original DOCX run-XML or PDF content streams. An appendix lists
 * every annotation against its quoted source text — auditable and exact —
 * without fabricating placement we can't guarantee.
 */

export type ExportAnnotation = {
  kind: "comment" | "edit";
  role: "Primary" | "Comparator";
  /** The source text the annotation refers to. */
  quote: string;
  /** Comment text, or the replacement text for an edit. */
  body: string;
  /** Comments only; always false for edits. */
  resolved: boolean;
  createdAt: string;
};

export type AnnotationBlock = {
  heading: string;
  /** Sub-lines: [label, value] pairs rendered as "Label: value". */
  lines: { label: string; value: string }[];
};

const COLLAPSE = /\s+/g;

export function tidy(text: string, max = 300): string {
  const t = text.replace(COLLAPSE, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Structured blocks for rendering (PDF page, or any list view). */
export function annotationBlocks(annotations: ExportAnnotation[]): AnnotationBlock[] {
  return annotations.map((a, i) => {
    const n = i + 1;
    if (a.kind === "edit") {
      return {
        heading: `${n}. Edit · ${a.role}`,
        lines: [
          { label: "Original", value: tidy(a.quote) || "(empty)" },
          { label: "Replaced with", value: tidy(a.body) || "(deleted)" },
        ],
      };
    }
    return {
      heading: `${n}. Comment · ${a.role}${a.resolved ? " (resolved)" : ""}`,
      lines: [
        { label: "On text", value: tidy(a.quote) || "(unanchored)" },
        { label: "Note", value: tidy(a.body) },
      ],
    };
  });
}

export function annotationSummary(annotations: ExportAnnotation[]): string {
  const comments = annotations.filter((a) => a.kind === "comment").length;
  const edits = annotations.filter((a) => a.kind === "edit").length;
  const parts: string[] = [];
  if (edits) parts.push(`${edits} edit${edits === 1 ? "" : "s"}`);
  if (comments) parts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  return parts.join(" and ") || "no annotations";
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A bold/sized run paragraph. size is in half-points (24 = 12pt). */
function docxPara(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): string {
  const rPr = [
    opts.bold ? "<w:b/>" : "",
    opts.size ? `<w:sz w:val="${opts.size}"/>` : "",
    opts.color ? `<w:color w:val="${opts.color}"/>` : "",
  ].join("");
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r>${
    rPr ? `<w:rPr>${rPr}</w:rPr>` : ""
  }<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Build the WordprocessingML body fragment for the annotations appendix —
 * a page break, heading, summary line, and one block per annotation.
 */
export function buildDocxAppendix(
  annotations: ExportAnnotation[],
  meta: { title: string; generatedAt: string },
): string {
  const out: string[] = [];
  // Page break onto a fresh page.
  out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  out.push(docxPara("DiffDoc Annotations", { bold: true, size: 32 }));
  out.push(
    docxPara(`${meta.title} · generated ${meta.generatedAt}`, { size: 18, color: "6E6C7E" }),
  );
  out.push(
    docxPara(
      `This appendix lists reviewer annotations made in DiffDoc (${annotationSummary(
        annotations,
      )}). The body text above is the original, unmodified document.`,
      { size: 18, color: "6E6C7E" },
    ),
  );

  for (const block of annotationBlocks(annotations)) {
    out.push(docxPara(block.heading, { bold: true, size: 22 }));
    for (const line of block.lines) {
      out.push(docxPara(`${line.label}: ${line.value}`, { size: 20 }));
    }
  }
  return out.join("");
}
