import { Document, Packer, Paragraph } from 'docx';
import PDFDocument from 'pdfkit';

/** Fictional CV used to generate PDF/DOCX fixtures at test time. */
export const SAMPLE_CV_LINES = [
  'Alex Martin',
  'Marketing & Hospitality Student',
  'alex.martin@example.com | +33 6 12 34 56 78 | linkedin.com/in/alex-martin-example',
  '',
  'EXPERIENCE',
  'Front Office Intern — Hotel Lumière',
  'Jun 2025 - Nov 2025',
  '• Raised guest satisfaction score by 12%',
  '• Handled 40 check-ins per day',
  '',
  'Marketing Assistant — Brand & Co',
  'January 2024 – June 2024',
  '• Managed Instagram account (5k followers)',
  '',
  'EDUCATION',
  'ESSEC Business School',
  'Master in Management',
  '09/2024 - 12/2027',
  '',
  'SKILLS',
  'Excel, Google Analytics, Canva',
  '',
  'LANGUAGES',
  'English (C1), French (Native)',
];

export async function sampleDocx(lines = SAMPLE_CV_LINES): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((l) => new Paragraph(l)) }] });
  return Packer.toBuffer(doc);
}

export function samplePdf(lines = SAMPLE_CV_LINES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    // Replace the bullet glyph: the standard PDF fonts can't encode it reliably.
    for (const l of lines) doc.fontSize(11).text(l.replace('•', '-') || ' ');
    doc.end();
  });
}
