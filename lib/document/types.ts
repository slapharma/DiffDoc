/**
 * Internal document representation.
 *
 * Both DOCX and PDF parsers emit a `Document` so downstream code (diff,
 * AI classification, UI rendering, exports) is format-agnostic.
 *
 * Offsets are character positions into the document's full plain-text
 * projection — they're what `diff-match-patch` returns and what
 * comments/edits anchor to.
 */

export type DocumentFormat = "docx" | "pdf";

export type ParagraphStyle =
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "body"
  | "list"
  | "quote";

export type RunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

export type Run = {
  text: string;
  style?: RunStyle;
  offset: number;
};

export type Paragraph = {
  style: ParagraphStyle;
  runs: Run[];
  offset: number;
  length: number;
  page?: number;
};

export type Section = {
  /** Heading text, or null if this is the implicit pre-heading section. */
  heading: string | null;
  level: number;
  paragraphs: Paragraph[];
  offset: number;
  length: number;
};

export type DocumentMetadata = {
  filename: string;
  format: DocumentFormat;
  pageCount?: number;
  wordCount: number;
  sha256: string;
  /** True if the parser had to fall back from its preferred path. */
  degraded: boolean;
  /** Free-text notes from the parser about anything lossy. */
  notes: string[];
};

export type ParsedDocument = {
  metadata: DocumentMetadata;
  sections: Section[];
  /** Full plain-text projection — the canonical thing we diff. */
  plainText: string;
};
