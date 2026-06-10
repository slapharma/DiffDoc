import { describe, expect, it } from "vitest";
import { validateUpload, MAX_FILE_BYTES } from "../lib/upload/validate";

const DOCX_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe("validateUpload", () => {
  it("accepts a docx with a zip signature", () => {
    const result = validateUpload("contract.docx", 1024, DOCX_HEAD);
    expect(result).toEqual({ ok: true, format: "docx" });
  });

  it("accepts a pdf with a %PDF signature", () => {
    const result = validateUpload("report.PDF", 1024, PDF_HEAD);
    expect(result).toEqual({ ok: true, format: "pdf" });
  });

  it("rejects unsupported extensions", () => {
    const result = validateUpload("notes.txt", 1024, DOCX_HEAD);
    expect(result.ok).toBe(false);
  });

  it("rejects empty files", () => {
    const result = validateUpload("contract.docx", 0, new Uint8Array());
    expect(result.ok).toBe(false);
  });

  it("rejects files over the size cap", () => {
    const result = validateUpload("contract.docx", MAX_FILE_BYTES + 1, DOCX_HEAD);
    expect(result.ok).toBe(false);
  });

  it("accepts a file exactly at the size cap", () => {
    const result = validateUpload("contract.docx", MAX_FILE_BYTES, DOCX_HEAD);
    expect(result).toEqual({ ok: true, format: "docx" });
  });

  it("rejects a docx whose bytes are not a zip (spoofed extension)", () => {
    const result = validateUpload("malicious.docx", 1024, PDF_HEAD);
    expect(result.ok).toBe(false);
  });

  it("rejects a pdf whose bytes are not %PDF (spoofed extension)", () => {
    const result = validateUpload("malicious.pdf", 1024, DOCX_HEAD);
    expect(result.ok).toBe(false);
  });

  it("rejects when the head is shorter than the magic signature", () => {
    const result = validateUpload("tiny.pdf", 2, new Uint8Array([0x25, 0x50]));
    expect(result.ok).toBe(false);
  });
});
