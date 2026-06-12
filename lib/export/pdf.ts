import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { annotationBlocks, annotationSummary, type ExportAnnotation } from "./annotations";

/**
 * Append "DiffDoc Annotations" page(s) to a PDF and return the new bytes.
 * The original pages are untouched. Falls back to the original bytes if the
 * file can't be loaded (e.g. encrypted).
 */
export async function annotatePdf(
  original: Buffer,
  annotations: ExportAnnotation[],
  meta: { title: string; generatedAt: string },
): Promise<Buffer> {
  if (annotations.length === 0) return original;
  try {
    const doc = await PDFDocument.load(original, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN = 56;
    const MAX_W = PAGE_W - MARGIN * 2;
    const ink = rgb(0.137, 0.133, 0.188);
    const soft = rgb(0.43, 0.42, 0.49);
    const leaf = rgb(0.043, 0.541, 0.329);

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const newPage = () => {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    };
    const ensure = (needed: number) => {
      if (y - needed < MARGIN) newPage();
    };

    // Greedy word-wrap to the page width for the given font/size.
    const wrap = (text: string, f: typeof font, size: number): string[] => {
      const words = text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";
      for (const w of words) {
        const trial = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(trial, size) > MAX_W && line) {
          lines.push(line);
          line = w;
        } else {
          line = trial;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : [""];
    };

    const draw = (text: string, f: typeof font, size: number, color = ink, indent = 0) => {
      for (const ln of wrap(text, f, size)) {
        ensure(size + 5);
        page.drawText(ln, { x: MARGIN + indent, y, size, font: f, color });
        y -= size + 5;
      }
    };

    draw("DiffDoc Annotations", bold, 20, ink);
    y -= 4;
    draw(`${meta.title} · generated ${meta.generatedAt}`, font, 9, soft);
    draw(
      `Reviewer annotations made in DiffDoc (${annotationSummary(
        annotations,
      )}). The pages before this appendix are the original, unmodified document.`,
      font,
      9,
      soft,
    );
    y -= 12;

    for (const block of annotationBlocks(annotations)) {
      ensure(40);
      y -= 6;
      draw(block.heading, bold, 11, leaf);
      for (const line of block.lines) {
        draw(`${line.label}:`, bold, 9, soft, 0);
        draw(line.value, font, 10, ink, 12);
        y -= 2;
      }
    }

    const out = await doc.save();
    return Buffer.from(out);
  } catch {
    return original;
  }
}
