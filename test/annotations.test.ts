import { describe, expect, it } from "vitest";
import {
  escapeXml,
  tidy,
  annotationBlocks,
  annotationSummary,
  buildDocxAppendix,
  type ExportAnnotation,
} from "../lib/export/annotations";

const COMMENT: ExportAnnotation = {
  kind: "comment",
  role: "Comparator",
  quote: "exclusive distribution rights",
  body: "Check against the 2025 SOP",
  resolved: false,
  createdAt: "2026-06-11T10:00:00Z",
};
const EDIT: ExportAnnotation = {
  kind: "edit",
  role: "Primary",
  quote: "20mg",
  body: "40mg",
  resolved: false,
  createdAt: "2026-06-11T09:00:00Z",
};

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f",
    );
  });
});

describe("tidy", () => {
  it("collapses whitespace and truncates", () => {
    expect(tidy("  a\n\n b   c ")).toBe("a b c");
    expect(tidy("x".repeat(400)).endsWith("…")).toBe(true);
    expect(tidy("x".repeat(400)).length).toBe(301);
  });
});

describe("annotationSummary", () => {
  it("counts and pluralises", () => {
    expect(annotationSummary([EDIT, COMMENT, COMMENT])).toBe("1 edit and 2 comments");
    expect(annotationSummary([EDIT])).toBe("1 edit");
    expect(annotationSummary([])).toBe("no annotations");
  });
});

describe("annotationBlocks", () => {
  it("renders edits as original/replacement", () => {
    const [b] = annotationBlocks([EDIT]);
    expect(b.heading).toBe("1. Edit · Primary");
    expect(b.lines).toEqual([
      { label: "Original", value: "20mg" },
      { label: "Replaced with", value: "40mg" },
    ]);
  });

  it("marks resolved comments and quotes the source", () => {
    const [b] = annotationBlocks([{ ...COMMENT, resolved: true }]);
    expect(b.heading).toBe("1. Comment · Comparator (resolved)");
    expect(b.lines[0]).toEqual({ label: "On text", value: "exclusive distribution rights" });
    expect(b.lines[1]).toEqual({ label: "Note", value: "Check against the 2025 SOP" });
  });
});

describe("buildDocxAppendix", () => {
  const xml = buildDocxAppendix([EDIT, COMMENT], {
    title: "ANATOP v3 review",
    generatedAt: "2026-06-11 13:00 UTC",
  });

  it("starts with a page break and the heading", () => {
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain("DiffDoc Annotations");
  });

  it("includes every annotation's escaped content", () => {
    expect(xml).toContain("40mg");
    expect(xml).toContain("Check against the 2025 SOP");
    expect(xml).toContain("ANATOP v3 review");
  });

  it("escapes XML-hostile characters in annotation text", () => {
    const out = buildDocxAppendix(
      [{ ...COMMENT, body: "a < b & c" }],
      { title: "t", generatedAt: "now" },
    );
    expect(out).toContain("a &lt; b &amp; c");
    expect(out).not.toContain("a < b & c");
  });

  it("is well-formed paragraph XML (balanced w:p tags)", () => {
    const opens = (xml.match(/<w:p>/g) ?? []).length;
    const closes = (xml.match(/<\/w:p>/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(2);
  });
});
