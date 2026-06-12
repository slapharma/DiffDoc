import JSZip from "jszip";
import { buildDocxAppendix, type ExportAnnotation } from "./annotations";

/**
 * Append a "DiffDoc Annotations" section to a .docx and return the new bytes.
 * The original document body is untouched; the appendix is inserted just
 * before the trailing section properties so it lands on its own page.
 *
 * Falls back to the original bytes if the file isn't a parseable .docx.
 */
export async function annotateDocx(
  original: Buffer,
  annotations: ExportAnnotation[],
  meta: { title: string; generatedAt: string },
): Promise<Buffer> {
  if (annotations.length === 0) return original;
  try {
    const zip = await JSZip.loadAsync(original);
    const docFile = zip.file("word/document.xml");
    if (!docFile) return original;
    const xml = await docFile.async("string");

    const appendix = buildDocxAppendix(annotations, meta);

    // Insert before the body-level <w:sectPr> (the last one, which is a direct
    // child of <w:body>) so the appendix is part of the document flow; if
    // there's no sectPr, insert before </w:body>.
    const sectPrIdx = xml.lastIndexOf("<w:sectPr");
    let next: string;
    if (sectPrIdx !== -1) {
      next = xml.slice(0, sectPrIdx) + appendix + xml.slice(sectPrIdx);
    } else {
      next = xml.replace("</w:body>", `${appendix}</w:body>`);
    }
    if (next === xml) return original; // nothing changed — bail safely

    zip.file("word/document.xml", next);
    const out = await zip.generateAsync({ type: "nodebuffer" });
    return out;
  } catch {
    return original;
  }
}
