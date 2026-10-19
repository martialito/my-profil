/** HTML → readable text, and section extraction (requirements / responsibilities). */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Convert HTML (possibly entity-escaped, as returned by Greenhouse) to plain text with "• " bullets. */
export function htmlToText(html: string): string {
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // Greenhouse escapes its HTML once
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|li|section|tr)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|section|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const REQ_HEAD = /(requirements?|qualifications?|what you(?:'|’)?ll (?:need|bring)|what you bring|who you are|you (?:have|bring|are)|about you|skills|must[- ]haves?|nice to have|preferred|ideal candidate|we(?:'|’)re looking for|profil recherch)/i;
const RESP_HEAD = /(responsibilit|what you(?:'|’)?ll (?:do|work on)|what you will do|the role|your role|duties|day[- ]to[- ]day|you will|in this role|missions?|key tasks)/i;

/** Split text into requirement / responsibility bullet lists based on section headings. */
export function extractSections(text: string): { requirements: string[]; responsibilities: string[] } {
  const requirements: string[] = [];
  const responsibilities: string[] = [];
  let current: string[] | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = /^[•\-*·▪●]\s*/.test(line);
    if (!isBullet && line.length <= 80) {
      if (RESP_HEAD.test(line)) {
        current = responsibilities;
        continue;
      }
      if (REQ_HEAD.test(line)) {
        current = requirements;
        continue;
      }
      if (/[:?]$/.test(line) || line === line.toUpperCase()) current = undefined; // another heading
    }
    if (isBullet && current) {
      const item = line.replace(/^[•\-*·▪●]\s*/, '').trim();
      if (item && item.length <= 400 && !current.includes(item)) current.push(item);
    }
  }
  return { requirements, responsibilities };
}
