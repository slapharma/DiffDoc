import type { DocumentFormat, ParsedDocument } from "./types";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";

export type ParseOptions = {
  filename: string;
  format?: DocumentFormat;
};

export async function parseDocument(
  buffer: Buffer,
  opts: ParseOptions,
): Promise<ParsedDocument> {
  const format = opts.format ?? inferFormat(opts.filename);
  switch (format) {
    case "docx":
      return parseDocx(buffer, opts.filename);
    case "pdf":
      return parsePdf(buffer, opts.filename);
  }
}

function inferFormat(filename: string): DocumentFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  throw new Error(
    `Unsupported file extension on "${filename}". Only .docx and .pdf are supported in v1.`,
  );
}

export * from "./types";
