import type { DocumentFormat } from "@/lib/document/types";

/** Hard byte cap per file. Page-count tier gating is enforced later (Phase 2). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** Minimum bytes we need from the head of a file to check its signature. */
export const MAGIC_HEAD_BYTES = 8;

export type ValidationResult =
  | { ok: true; format: DocumentFormat }
  | { ok: false; error: string };

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a .docx is a zip container
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * Validate an uploaded file by extension, size, and magic bytes. The magic-byte
 * check guards against a file with a spoofed or mismatched extension.
 */
export function validateUpload(
  filename: string,
  size: number,
  head: Uint8Array,
): ValidationResult {
  const lower = filename.toLowerCase();
  let format: DocumentFormat;
  if (lower.endsWith(".docx")) format = "docx";
  else if (lower.endsWith(".pdf")) format = "pdf";
  else
    return {
      ok: false,
      error: `Unsupported file type: "${filename}". Only .docx and .pdf are accepted.`,
    };

  if (size === 0) return { ok: false, error: `"${filename}" is empty.` };
  if (size > MAX_FILE_BYTES)
    return {
      ok: false,
      error: `"${filename}" is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${
        MAX_FILE_BYTES / 1024 / 1024
      } MB.`,
    };

  if (format === "docx" && !startsWith(head, ZIP_MAGIC))
    return { ok: false, error: `"${filename}" is not a valid .docx file (bad signature).` };
  if (format === "pdf" && !startsWith(head, PDF_MAGIC))
    return { ok: false, error: `"${filename}" is not a valid .pdf file (bad signature).` };

  return { ok: true, format };
}
