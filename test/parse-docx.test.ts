import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "@/lib/document";

const FIXTURE = resolve(__dirname, "fixtures/buildplan.docx");

describe("parseDocument (DOCX)", () => {
  it("parses a real DOCX into structured sections", async () => {
    const buf = await readFile(FIXTURE);
    const doc = await parseDocument(buf, { filename: "buildplan.docx" });

    expect(doc.metadata.format).toBe("docx");
    expect(doc.metadata.filename).toBe("buildplan.docx");
    expect(doc.metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.metadata.wordCount).toBeGreaterThan(500);
    expect(doc.plainText.length).toBeGreaterThan(2000);
  });

  it("preserves expected source phrases at >95% fidelity", async () => {
    const buf = await readFile(FIXTURE);
    const doc = await parseDocument(buf, { filename: "buildplan.docx" });

    const expectedPhrases = [
      "DiffDeck",
      "AI-powered document comparison",
      "Executive summary",
      "Scope",
      "Architecture",
      "Build phases",
      "Key risks & mitigations",
      "Commercial model",
      "Phase 1 — Core engine",
      "Phase 5 — Commercial wrapper",
    ];

    const found = expectedPhrases.filter((p) => doc.plainText.includes(p));
    const fidelity = found.length / expectedPhrases.length;
    expect(fidelity).toBeGreaterThanOrEqual(0.95);
  });

  it("identifies sections from heading paragraphs", async () => {
    const buf = await readFile(FIXTURE);
    const doc = await parseDocument(buf, { filename: "buildplan.docx" });

    expect(doc.sections.length).toBeGreaterThan(1);
    const namedHeadings = doc.sections
      .map((s) => s.heading)
      .filter((h): h is string => h !== null);
    expect(namedHeadings.length).toBeGreaterThan(0);
  });

  it("assigns monotonically non-decreasing offsets to paragraphs", async () => {
    const buf = await readFile(FIXTURE);
    const doc = await parseDocument(buf, { filename: "buildplan.docx" });

    let prev = -1;
    for (const section of doc.sections) {
      for (const p of section.paragraphs) {
        expect(p.offset).toBeGreaterThanOrEqual(prev);
        prev = p.offset;
      }
    }
  });
});
