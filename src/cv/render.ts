import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopPosition, TabStopType, TextRun } from 'docx';
import type { MasterCvContent } from '../models/master-cv.js';
import { formatRange, pdfSafe, pdfToBuffer } from '../documents/render-utils.js';

/**
 * ATS-friendly resume: single column, standard section headings, real text (no tables, images or text boxes).
 */
const CATEGORY_LABEL: Record<string, string> = { technical: 'Skills', language: 'Languages', certification: 'Certifications', soft: 'Strengths' };

function fullName(c: MasterCvContent): string {
  return [c.personal.firstName, c.personal.lastName].filter(Boolean).join(' ');
}

function contactLine(c: MasterCvContent): string {
  const p = c.personal;
  return [p.currentLocation, p.phone, p.email, p.linkedin, p.portfolio, p.website].filter(Boolean).join(' | ');
}

function skillLines(c: MasterCvContent): Array<[string, string]> {
  return (['technical', 'language', 'certification', 'soft'] as const)
    .map((cat) => [CATEGORY_LABEL[cat]!, c.skills.filter((s) => s.category === cat).map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(', ')] as [string, string])
    .filter(([, v]) => v);
}

/** Plain-text version (also used to check the generated files). */
export function resumeToText(c: MasterCvContent): string {
  const lines = [fullName(c), contactLine(c), ''];
  if (c.headline) lines.push(c.headline);
  if (c.summary) lines.push(c.summary, '');
  if (c.experiences.length) {
    lines.push('EXPERIENCE');
    for (const e of c.experiences) {
      lines.push(`${e.title} — ${e.company}${e.location ? `, ${e.location}` : ''}    ${formatRange(e.startDate, e.endDate, e.isCurrent)}`);
      e.achievements.forEach((a) => lines.push(`• ${a}`));
    }
    lines.push('');
  }
  if (c.education.length) {
    lines.push('EDUCATION');
    for (const e of c.education) {
      lines.push(`${[e.degree, e.field].filter(Boolean).join(', ') || 'Studies'} — ${e.school}    ${formatRange(e.startDate, e.endDate)}`);
      if (e.gpa) lines.push(`GPA: ${e.gpa}`);
    }
    lines.push('');
  }
  const sk = skillLines(c);
  if (sk.length) {
    lines.push('SKILLS');
    sk.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  }
  return lines.join('\n').trim() + '\n';
}

export async function resumeToDocx(c: MasterCvContent): Promise<Buffer> {
  const heading = (text: string) =>
    new Paragraph({
      spacing: { before: 200, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999', space: 2 } },
      children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })],
    });
  const entryHead = (left: string, right: string) =>
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      spacing: { before: 120 },
      children: [new TextRun({ text: left, bold: true, size: 21 }), new TextRun({ text: `\t${right}`, size: 20 })],
    });
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: fullName(c), bold: true, size: 32 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: contactLine(c), size: 19 })] }),
  ];
  if (c.headline) children.push(new Paragraph({ children: [new TextRun({ text: c.headline, bold: true, size: 21 })] }));
  if (c.summary) children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: c.summary, size: 21 })] }));
  if (c.experiences.length) {
    children.push(heading('Experience'));
    for (const e of c.experiences) {
      children.push(entryHead(`${e.title} — ${e.company}${e.location ? `, ${e.location}` : ''}`, formatRange(e.startDate, e.endDate, e.isCurrent)));
      e.achievements.forEach((a) => children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: a, size: 21 })] })));
    }
  }
  if (c.education.length) {
    children.push(heading('Education'));
    for (const e of c.education) {
      children.push(entryHead(`${[e.degree, e.field].filter(Boolean).join(', ') || 'Studies'} — ${e.school}`, formatRange(e.startDate, e.endDate)));
      if (e.gpa) children.push(new Paragraph({ children: [new TextRun({ text: `GPA: ${e.gpa}`, size: 20 })] }));
    }
  }
  const sk = skillLines(c);
  if (sk.length) {
    children.push(heading('Skills'));
    sk.forEach(([k, v]) => children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true, size: 21 }), new TextRun({ text: v, size: 21 })] })));
  }
  const doc = new Document({
    creator: fullName(c),
    title: `${fullName(c)} — Resume`,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

export function resumeToPdf(c: MasterCvContent): Promise<Buffer> {
  const name = fullName(c);
  return pdfToBuffer(
    (doc) => {
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const t = (s: string) => pdfSafe(s);
      doc.font('Helvetica-Bold').fontSize(18).text(t(name), { align: 'center' });
      doc.font('Helvetica').fontSize(9.5).text(t(contactLine(c)), { align: 'center' }).moveDown(0.6);
      if (c.headline) doc.font('Helvetica-Bold').fontSize(10.5).text(t(c.headline));
      if (c.summary) doc.font('Helvetica').fontSize(10).text(t(c.summary)).moveDown(0.3);
      const heading = (s: string) => {
        doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11).text(s.toUpperCase());
        const y = doc.y + 1;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + width, y).lineWidth(0.5).strokeColor('#999999').stroke();
        doc.moveDown(0.3);
      };
      const entry = (left: string, right: string) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(9.5).text(t(right), doc.page.margins.left, y, { width, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(10.5).text(t(left), doc.page.margins.left, y, { width: width - 110 });
      };
      if (c.experiences.length) {
        heading('Experience');
        for (const e of c.experiences) {
          entry(`${e.title} — ${e.company}${e.location ? `, ${e.location}` : ''}`, formatRange(e.startDate, e.endDate, e.isCurrent));
          doc.font('Helvetica').fontSize(10);
          e.achievements.forEach((a) => doc.text(t(`•  ${a}`), { indent: 8 }));
          doc.moveDown(0.3);
        }
      }
      if (c.education.length) {
        heading('Education');
        for (const e of c.education) {
          entry(`${[e.degree, e.field].filter(Boolean).join(', ') || 'Studies'} — ${e.school}`, formatRange(e.startDate, e.endDate));
          if (e.gpa) doc.font('Helvetica').fontSize(10).text(t(`GPA: ${e.gpa}`));
          doc.moveDown(0.3);
        }
      }
      const sk = skillLines(c);
      if (sk.length) {
        heading('Skills');
        sk.forEach(([k, v]) => doc.font('Helvetica-Bold').fontSize(10).text(`${t(k)}: `, { continued: true }).font('Helvetica').text(t(v)));
      }
    },
    { title: `${name} - Resume`, author: name },
  );
}
