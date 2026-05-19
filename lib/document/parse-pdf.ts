import pdfParse from "pdf-parse";
import type { ParsedDocument, Paragraph, Section } from "./types";
import { countWords, sha256 } from "./util";

/**
 * v1 PDF parsing: text-layer only, no OCR (per build plan scope).
 * Each line that pdf-parse returns becomes one paragraph. Page numbers
 * are tracked via pdf-parse's per-page callback.
 */
export async function parsePdf(
  buffer: Buffer,
  filename: string,
): Promise<ParsedDocument> {
  const notes: string[] = [];
  const pageTexts: string[] = [];

  const result = await pdfParse(buffer, {
    pagerender: (pageData) =>
      pageData
        .getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false,
        })
        .then((tc: { items: { str: string }[] }) => {
          const text = tc.items.map((i) => i.str).join(" ");
          pageTexts.push(text);
          return text;
        }),
  });

  if (!result.text || result.text.trim().length === 0) {
    notes.push("PDF has no extractable text layer — OCR not supported in v1.");
  }

  const { paragraphs, plainText } = textToParagraphs(pageTexts);
  const sections: Section[] = paragraphs.length
    ? [
        {
          heading: null,
          level: 0,
          paragraphs,
          offset: 0,
          length: paragraphs[paragraphs.length - 1].offset +
            paragraphs[paragraphs.length - 1].length,
        },
      ]
    : [];

  return {
    metadata: {
      filename,
      format: "pdf",
      pageCount: result.numpages,
      wordCount: countWords(plainText),
      sha256: sha256(buffer),
      degraded: notes.length > 0,
      notes,
    },
    sections,
    plainText,
  };
}

function textToParagraphs(pageTexts: string[]): {
  paragraphs: Paragraph[];
  plainText: string;
} {
  const paragraphs: Paragraph[] = [];
  const plainOut: string[] = [];
  let cursor = 0;

  pageTexts.forEach((pageText, pageIdx) => {
    const lines = pageText.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      paragraphs.push({
        style: "body",
        runs: [{ text: line, offset: cursor }],
        offset: cursor,
        length: line.length,
        page: pageIdx + 1,
      });
      plainOut.push(line);
      plainOut.push("\n");
      cursor += line.length + 1;
    }
  });

  return { paragraphs, plainText: plainOut.join("") };
}
