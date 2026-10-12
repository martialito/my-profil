import PDFDocument from 'pdfkit';

/** Standard PDF fonts only cover Windows-1252: map common characters outside it. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2192\u21d2]/g, '->')
    .replace(/[\u2010-\u2012]/g, '-')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[^\t\n\r\x20-\x7E\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/g, '');
}

export function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void, meta: { title: string; author: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 56, right: 56 }, info: { Title: pdfSafe(meta.title), Author: pdfSafe(meta.author) } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-06" → "Jun 2025", "2025" → "2025". */
export function formatMonth(d?: string): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return d;
  return m[2] ? `${MONTHS[+m[2] - 1]} ${m[1]}` : m[1]!;
}

export function formatRange(start?: string, end?: string, current?: boolean): string {
  const s = formatMonth(start);
  const e = current ? 'Present' : formatMonth(end);
  return s && e ? `${s} – ${e}` : s || e;
}
