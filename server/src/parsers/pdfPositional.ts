/**
 * Positional PDF text extraction.
 *
 * `pdf-parse` collapses tabular data into a single text stream that destroys
 * column information. For bank statements where sign depends on which column
 * an amount appears in (Deposits vs Withdrawals), we need x/y coordinates of
 * every text fragment. This module wraps `pdfjs-dist` to provide that.
 */
// pdfjs-dist 4+ is ESM-only; use dynamic import to load it from CJS-compiled output.
type PdfJsModule = {
  getDocument: (opts: {
    data: Uint8Array;
    disableFontFace?: boolean;
    standardFontDataUrl?: string;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{
          items: Array<{ str: string; transform: number[]; width: number }>;
        }>;
      }>;
      destroy: () => Promise<void>;
    }>;
  };
};

/**
 * Resolve the on-disk path to pdfjs-dist's bundled standard PostScript fonts
 * and return it as a `file://` URL (with trailing slash) that pdfjs will use
 * to load fonts during text extraction. Without this, pdfjs logs:
 *   "Warning: UnknownErrorException: Ensure that the `standardFontDataUrl`
 *    API parameter is provided."
 */
let cachedFontUrl: string | null = null;
function standardFontDataUrl(): string {
  if (cachedFontUrl) return cachedFontUrl;
  // require.resolve lets us locate pdfjs-dist regardless of hoisting layout.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgPath: string = require.resolve('pdfjs-dist/package.json');
  // pkgPath = .../node_modules/pdfjs-dist/package.json
  const pkgDir = pkgPath.slice(0, -'/package.json'.length);
  cachedFontUrl = `file://${pkgDir}/standard_fonts/`;
  return cachedFontUrl;
}

let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (new Function('m', 'return import(m)') as (m: string) => Promise<PdfJsModule>)(
      'pdfjs-dist/legacy/build/pdf.mjs'
    );
  }
  return pdfjsPromise;
}

export interface PositionedText {
  /** Raw text content of this fragment */
  text: string;
  /** X coordinate (in PDF points, origin: bottom-left) */
  x: number;
  /** Y coordinate (in PDF points, origin: bottom-left) */
  y: number;
  /** Width of this text run in PDF points */
  width: number;
  /** 1-based page number */
  page: number;
}

export interface PositionedLine {
  /** Page this line belongs to (1-based) */
  page: number;
  /** Y coordinate of the line (averaged) */
  y: number;
  /** Text fragments on this line, sorted by x ascending */
  items: PositionedText[];
}

/**
 * Extract every text fragment from the PDF along with its position.
 * Fragments are returned in page order; within a page they reflect pdfjs's
 * native ordering (which is roughly top-to-bottom, left-to-right but not
 * guaranteed — use `groupByLine` to organize).
 */
export async function extractPositionedText(buffer: Buffer): Promise<PositionedText[]> {
  const pdfjs = await loadPdfjs();
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data: uint8,
    disableFontFace: true,
    standardFontDataUrl: standardFontDataUrl(),
  }).promise;
  const items: PositionedText[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items as Array<{
      str: string;
      transform: number[];
      width: number;
    }>) {
      if (!item.str || !item.str.trim()) continue;
      const [, , , , x, y] = item.transform;
      items.push({ text: item.str, x, y, width: item.width, page: pageNum });
    }
  }

  await doc.destroy();
  return items;
}

/**
 * Group positioned text fragments into lines based on Y coordinate.
 * Fragments whose Y values differ by less than `yTolerance` are considered
 * the same line. Lines are returned in top-to-bottom order per page.
 */
export function groupByLine(items: PositionedText[], yTolerance = 2): PositionedLine[] {
  const lines: PositionedLine[] = [];

  // Group by page first
  const byPage = new Map<number, PositionedText[]>();
  for (const item of items) {
    if (!byPage.has(item.page)) byPage.set(item.page, []);
    byPage.get(item.page)!.push(item);
  }

  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const pageItems = byPage.get(page)!;
    // Sort by Y descending (PDF origin is bottom-left, so top of page = higher Y)
    const sorted = [...pageItems].sort((a, b) => b.y - a.y);

    const pageLines: PositionedLine[] = [];
    for (const item of sorted) {
      const existing = pageLines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
      if (existing) {
        existing.items.push(item);
        existing.y = (existing.y + item.y) / 2;
      } else {
        pageLines.push({ page, y: item.y, items: [item] });
      }
    }

    // Within each line, sort by X ascending
    for (const line of pageLines) {
      line.items.sort((a, b) => a.x - b.x);
    }
    lines.push(...pageLines);
  }

  return lines;
}
