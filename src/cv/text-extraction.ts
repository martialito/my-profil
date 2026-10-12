import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export type CvFileType = 'pdf' | 'docx';

/** Detects the real file type from magic bytes (never trust the extension alone). */
export function detectCvFileType(buf: Buffer): CvFileType | undefined {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // DOCX = ZIP container containing word/document.xml
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('word/'))) return 'docx';
  return undefined;
}

export async function extractText(buf: Buffer, type: CvFileType): Promise<string> {
  if (type === 'pdf') {
    // Copy: pdf.js may transfer/detach the buffer it receives; the original must stay intact.
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await parser.getText();
      return cleanup(result.text);
    } finally {
      await parser.destroy();
    }
  }
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
  return cleanup(value);
}

function cleanup(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/-- \d+ of \d+ --/g, '') // pdf-parse page separators
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
