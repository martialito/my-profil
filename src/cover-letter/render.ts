import { Document, Packer, Paragraph, TextRun } from 'docx';
import { pdfSafe, pdfToBuffer } from '../documents/render-utils.js';

export interface LetterDoc {
  /** Plain text: greeting, paragraphs, sign-off and signature separated by blank lines. */
  text: string;
  senderName: string;
  senderContact: string;
  date: string;
  recipient: string[];
}

export async function letterToDocx(l: LetterDoc): Promise<Buffer> {
  const p = (text: string, opts: { bold?: boolean; after?: number } = {}) =>
    new Paragraph({ spacing: { after: opts.after ?? 200 }, children: [new TextRun({ text, bold: opts.bold, size: 22 })] });
  const children = [
    p(l.senderName, { bold: true, after: 0 }),
    p(l.senderContact, { after: 240 }),
    p(l.date, { after: 240 }),
    ...l.recipient.map((r, i) => p(r, { after: i === l.recipient.length - 1 ? 240 : 0 })),
    ...l.text.trim().split(/\n\n+/).map((block) => new Paragraph({ spacing: { after: 200 }, children: block.split('\n').map((line, i) => new TextRun({ text: line, size: 22, break: i > 0 ? 1 : 0 })) })),
  ];
  const doc = new Document({
    creator: l.senderName,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1200, right: 1200 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

export function letterToPdf(l: LetterDoc): Promise<Buffer> {
  return pdfToBuffer(
    (doc) => {
      const t = pdfSafe;
      doc.font('Helvetica-Bold').fontSize(11).text(t(l.senderName));
      doc.font('Helvetica').fontSize(9.5).text(t(l.senderContact)).moveDown(1);
      doc.fontSize(10.5).text(t(l.date)).moveDown(1);
      l.recipient.forEach((r) => doc.text(t(r)));
      doc.moveDown(1);
      for (const block of l.text.trim().split(/\n\n+/)) {
        doc.font('Helvetica').fontSize(10.5).text(t(block), { align: 'left', lineGap: 2 }).moveDown(0.8);
      }
    },
    { title: `${l.senderName} - Cover letter`, author: l.senderName },
  );
}
