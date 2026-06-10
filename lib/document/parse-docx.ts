import mammoth from "mammoth";
import type {
  ParsedDocument,
  Paragraph,
  ParagraphStyle,
  Run,
  Section,
} from "./types";
import { countWords, sha256 } from "./util";

const HEADING_STYLE_RE = /^heading\s*(\d+)$/i;
const LIST_STYLE_RE = /list/i;
const QUOTE_STYLE_RE = /quote/i;

function classifyParagraphStyle(
  styleName: string | undefined,
): { style: ParagraphStyle; headingLevel: number | null } {
  if (!styleName) return { style: "body", headingLevel: null };
  const m = HEADING_STYLE_RE.exec(styleName);
  if (m) {
    const level = Math.min(4, Math.max(1, parseInt(m[1], 10)));
    const style = (`heading${level}` as ParagraphStyle);
    return { style, headingLevel: level };
  }
  if (LIST_STYLE_RE.test(styleName)) return { style: "list", headingLevel: null };
  if (QUOTE_STYLE_RE.test(styleName)) return { style: "quote", headingLevel: null };
  return { style: "body", headingLevel: null };
}

/**
 * mammoth's `convertToHtml` preserves structure better than `extractRawText`,
 * but we don't actually want HTML — we want a plain-text projection plus
 * paragraph/run/section structure. We use mammoth's `documentToMarkdown`-like
 * style maps via a custom transform, but for v1 we lean on raw HTML and a
 * single-pass tokenizer because it's the most reliable across mammoth versions.
 */
export async function parseDocx(
  buffer: Buffer,
  filename: string,
): Promise<ParsedDocument> {
  const notes: string[] = [];
  let degraded = false;

  const result = await mammoth.convertToHtml({ buffer });
  for (const msg of result.messages) {
    if (msg.type === "warning" || msg.type === "error") {
      notes.push(`mammoth: ${msg.message}`);
      if (msg.type === "error") degraded = true;
    }
  }

  const { paragraphs, plainText } = htmlToParagraphs(result.value);

  const sections = groupIntoSections(paragraphs);

  return {
    metadata: {
      filename,
      format: "docx",
      wordCount: countWords(plainText),
      sha256: sha256(buffer),
      degraded,
      notes,
    },
    sections,
    plainText,
  };
}

/**
 * Walk mammoth's HTML output and emit Paragraphs with character offsets
 * into the final plain-text projection. We use a tiny DOM-free tokenizer
 * so this works in both Node and edge runtimes.
 */
function htmlToParagraphs(html: string): {
  paragraphs: Paragraph[];
  plainText: string;
} {
  const paragraphs: Paragraph[] = [];
  let cursor = 0;
  const plainOut: string[] = [];

  const blockRe = /<(h[1-4]|p|li|blockquote)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[3];

    let style: ParagraphStyle = "body";
    if (tag === "h1") style = "heading1";
    else if (tag === "h2") style = "heading2";
    else if (tag === "h3") style = "heading3";
    else if (tag === "h4") style = "heading4";
    else if (tag === "li") style = "list";
    else if (tag === "blockquote") style = "quote";

    const runs = extractRuns(inner, cursor);
    const text = runs.map((r) => r.text).join("");
    if (!text) continue;

    const paragraph: Paragraph = {
      style,
      runs,
      offset: cursor,
      length: text.length,
    };
    paragraphs.push(paragraph);
    plainOut.push(text);
    plainOut.push("\n");
    cursor += text.length + 1;
  }

  return { paragraphs, plainText: plainOut.join("") };
}

function extractRuns(inner: string, baseOffset: number): Run[] {
  const runs: Run[] = [];
  let local = 0;

  const tokenRe = /<(\/?)(b|strong|i|em|u)\b[^>]*>|<[^>]+>|([^<]+)/gi;
  const stack: { tag: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(inner)) !== null) {
    if (m[3] !== undefined) {
      const text = decodeEntities(m[3]);
      if (!text) continue;
      const style = stackToStyle(stack);
      runs.push({
        text,
        offset: baseOffset + local,
        ...(style ? { style } : {}),
      });
      local += text.length;
      continue;
    }
    const closing = m[1] === "/";
    const tag = (m[2] || "").toLowerCase();
    if (!tag) continue;
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.splice(i, 1);
          break;
        }
      }
    } else {
      stack.push({ tag });
    }
  }

  if (runs.length === 0) {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ""));
    if (text) runs.push({ text, offset: baseOffset });
  }
  return runs;
}

function stackToStyle(stack: { tag: string }[]) {
  let bold = false;
  let italic = false;
  let underline = false;
  for (const s of stack) {
    if (s.tag === "b" || s.tag === "strong") bold = true;
    else if (s.tag === "i" || s.tag === "em") italic = true;
    else if (s.tag === "u") underline = true;
  }
  if (!bold && !italic && !underline) return undefined;
  return { ...(bold && { bold }), ...(italic && { italic }), ...(underline && { underline }) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function groupIntoSections(paragraphs: Paragraph[]): Section[] {
  const sections: Section[] = [];
  let current: Section = {
    heading: null,
    level: 0,
    paragraphs: [],
    offset: 0,
    length: 0,
  };

  for (const p of paragraphs) {
    const level = headingLevel(p.style);
    if (level !== null) {
      if (current.paragraphs.length > 0 || current.heading !== null) {
        finalize(current);
        sections.push(current);
      }
      current = {
        heading: p.runs.map((r) => r.text).join(""),
        level,
        paragraphs: [],
        offset: p.offset,
        length: 0,
      };
      continue;
    }
    // Only the implicit pre-heading section takes its offset from the first
    // body paragraph; a headed section's offset is its heading's position.
    if (current.paragraphs.length === 0 && current.heading === null) {
      current.offset = p.offset;
    }
    current.paragraphs.push(p);
  }
  finalize(current);
  if (current.paragraphs.length > 0 || current.heading !== null) {
    sections.push(current);
  }
  return sections;
}

function finalize(section: Section) {
  if (section.paragraphs.length === 0) return;
  const last = section.paragraphs[section.paragraphs.length - 1];
  section.length = last.offset + last.length - section.offset;
}

function headingLevel(style: ParagraphStyle): number | null {
  if (style === "heading1") return 1;
  if (style === "heading2") return 2;
  if (style === "heading3") return 3;
  if (style === "heading4") return 4;
  return null;
}

// silence unused warning — classifyParagraphStyle is kept for the
// upcoming style-map path where we transform directly from mammoth
// document nodes rather than HTML.
void classifyParagraphStyle;
