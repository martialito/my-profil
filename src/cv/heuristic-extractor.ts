import type { Education, Experience, Skill, SkillCategory } from '../models/profile.js';
import { DATE_RANGE_RE, findDateRange } from './date-parsing.js';
import type { CvExtractionDraft } from './extraction-types.js';

/**
 * Rule-based CV parser. It only copies text that literally appears in the CV
 * and is intentionally conservative: anything it can't place goes into a
 * description field and a warning asks the candidate to verify it.
 */

type SectionKey = 'summary' | 'education' | 'experience' | 'skills' | 'languages' | 'certifications' | 'other';

const SECTION_PATTERNS: Array<[SectionKey, RegExp]> = [
  ['summary', /^(summary|profile|professional summary|about me|objective|profil|a propos|resume)$/],
  ['education', /^(education|academic background|formation|formations|etudes|parcours academique)$/],
  ['experience', /^(experience|experiences|work experience|professional experience|employment( history)?|experiences? professionnelles?|stages?|internships?)$/],
  ['skills', /^(skills|technical skills|competences|competences techniques|hard skills|soft skills|tools|outils|informatique)$/],
  ['languages', /^(languages|langues)$/],
  ['certifications', /^(certifications?|certificates?|licenses|certificats?)$/],
  ['other', /^(interests|hobbies|centres d'?interets?|loisirs|references|activities|activites|projects|projets|volunteering|benevolat)$/],
];

const strip = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[:•\-–—|]+$/g, '').trim();

function sectionOf(line: string): SectionKey | undefined {
  const s = strip(line);
  if (s.length > 40) return undefined;
  return SECTION_PATTERNS.find(([, re]) => re.test(s))?.[0];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,;|]*)?/gi;
const BULLET_RE = /^[•\-*–·▪●◦]\s*/;

function splitList(text: string): string[] {
  return text
    .split(/[,;•|·▪●\n]/)
    .map((s) => s.replace(BULLET_RE, '').replace(/^[^:]{1,30}:\s*/, '').trim())
    .filter((s) => s.length > 0 && s.length <= 60);
}

/**
 * Split a section into entries. Blank lines separate entries, but PDFs often lose them,
 * so a new entry also starts when a second date range appears: the header lines written
 * just before it (after the previous entry's bullets) move with it.
 */
function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  const hasRange = (l: string) => !BULLET_RE.test(l) && DATE_RANGE_RE.test(strip(l));
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    if (hasRange(line) && current.some(hasRange)) {
      // Trailing header lines (no bullet, no date) after the last bullet/date belong to the new entry.
      let cut = current.length;
      while (cut > 0 && !BULLET_RE.test(current[cut - 1]!) && !hasRange(current[cut - 1]!)) cut--;
      const carried = current.slice(cut);
      if (cut > 0) blocks.push(current.slice(0, cut));
      current = [...carried, line];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function removeRange(line: string): string {
  // Date tokens are ASCII-ish; strip them from an accent-stripped copy when they match.
  const range = findDateRange(line);
  if (!range) return line.trim();
  const idx = strip(line).indexOf(range.matched);
  const cleaned = idx >= 0 ? line.slice(0, idx) + line.slice(idx + range.matched.length) : line;
  return cleaned.replace(/[|,–—-]\s*$/, '').replace(/^\s*[|,–—-]/, '').trim();
}

function parseExperienceBlock(block: string[], warnings: string[]): Experience | undefined {
  const header = block.filter((l) => !BULLET_RE.test(l));
  const bullets = block.filter((l) => BULLET_RE.test(l)).map((l) => l.replace(BULLET_RE, '').trim());
  const rangeLine = block.find((l) => findDateRange(l));
  const range = rangeLine ? findDateRange(rangeLine) : undefined;
  const headerTexts = header.map(removeRange).filter(Boolean);
  if (headerTexts.length === 0) return undefined;

  // Common layouts: "Title — Company" / "Title at Company" / "Company \n Title".
  let title = headerTexts[0]!;
  let company = headerTexts[1] ?? '';
  const split = title.match(/^(.+?)\s+(?:—|–|-|\||@|at|chez)\s+(.+)$/i);
  if (split) {
    title = split[1]!.trim();
    company = split[2]!.trim();
  }
  if (!company) {
    warnings.push(`Experience "${title}": company could not be detected — please fill it in.`);
    company = '(to verify)';
  }
  const extraHeader = headerTexts.slice(split ? 1 : 2);
  return {
    company,
    title,
    location: undefined,
    startDate: range?.startDate,
    endDate: range?.endDate,
    isCurrent: range?.isCurrent ?? false,
    description: extraHeader.length ? extraHeader.join('\n') : undefined,
    achievements: bullets,
    technologies: [],
    skills: [],
  };
}

function parseEducationBlock(block: string[]): Education | undefined {
  const rangeLine = block.find((l) => findDateRange(l));
  const range = rangeLine ? findDateRange(rangeLine) : undefined;
  const texts = block.map((l) => removeRange(l.replace(BULLET_RE, ''))).filter(Boolean);
  if (!texts.length) return undefined;
  const schoolIdx = texts.findIndex((t) => /universit|college|school|ecole|école|institut|lycee|lycée|academy|business school/i.test(t));
  const school = texts[schoolIdx >= 0 ? schoolIdx : 0]!;
  const rest = texts.filter((_, i) => i !== (schoolIdx >= 0 ? schoolIdx : 0));
  const degree = rest.find((t) => /bachelor|master|mba|licence|bts|dut|but|bsc|msc|ba|ma|degree|diplome|diplôme|phd|doctorat|baccalaur/i.test(t));
  const gpa = texts.join(' ').match(/\b(?:gpa|moyenne)\s*[:-]?\s*([\d.,]+\s*(?:\/\s*[\d.,]+)?)/i)?.[1];
  const description = rest.filter((t) => t !== degree).join('\n') || undefined;
  return {
    school,
    degree,
    field: undefined,
    startDate: range?.startDate,
    endDate: range?.endDate,
    gpa,
    description,
  };
}

export function extractProfileHeuristically(text: string): CvExtractionDraft {
  const warnings: string[] = [];
  const lines = text.split('\n').map((l) => l.trim());

  // ── Contact block
  const email = text.match(EMAIL_RE)?.[0];
  const urls = [...text.matchAll(URL_RE)].map((m) => m[0]).filter((u) => !email || !email.includes(u.replace(/^https?:\/\//, '')));
  const linkedin = urls.find((u) => /linkedin\.com/i.test(u));
  const portfolio = urls.find((u) => /github\.com|behance\.net|dribbble\.com|portfolio/i.test(u));
  const website = urls.find((u) => u !== linkedin && u !== portfolio && /^(https?:\/\/|www\.)/i.test(u));
  const phoneLine = lines.find((l) => PHONE_RE.test(l) && !DATE_RANGE_RE.test(strip(l)) && (l.match(/\d/g)?.length ?? 0) >= 9);
  const phone = phoneLine?.match(PHONE_RE)?.[0].trim();

  const nameLine = lines
    .slice(0, 8)
    .find((l) => /^[\p{L}'’\- ]+$/u.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 4 && !sectionOf(l));
  let firstName: string | undefined;
  let lastName: string | undefined;
  if (nameLine) {
    const parts = nameLine.split(/\s+/);
    firstName = parts.slice(0, -1).join(' ');
    lastName = parts.at(-1);
  } else {
    warnings.push('Name not detected — please fill it in.');
  }

  // ── Sections
  const sections: Partial<Record<SectionKey, string[]>> = {};
  let current: SectionKey | undefined;
  const preamble: string[] = [];
  for (const line of lines) {
    const s = sectionOf(line);
    if (s) {
      current = s;
      sections[s] ??= [];
      continue;
    }
    if (current) sections[current]!.push(line);
    else preamble.push(line);
  }

  const headline = preamble.find(
    (l) => l && l !== nameLine && !EMAIL_RE.test(l) && !(phone && l.includes(phone)) && !URL_RE.test(l) && l.length < 90,
  );
  URL_RE.lastIndex = 0;
  const summary = sections.summary?.filter(Boolean).join(' ') || undefined;

  const experiences = splitBlocks(sections.experience ?? [])
    .map((b) => parseExperienceBlock(b, warnings))
    .filter((e): e is Experience => !!e);
  const education = splitBlocks(sections.education ?? [])
    .map(parseEducationBlock)
    .filter((e): e is Education => !!e);

  const skills: Skill[] = [];
  const addSkills = (category: SkillCategory, src?: string[]) => {
    for (const name of splitList((src ?? []).join('\n'))) {
      if (!skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) skills.push({ category, name, level: undefined });
    }
  };
  addSkills('technical', sections.skills);
  addSkills('language', sections.languages);
  addSkills('certification', sections.certifications);

  if (!sections.experience) warnings.push('No "Experience" section detected.');
  if (!sections.education) warnings.push('No "Education" section detected.');
  if (experiences.some((e) => !e.startDate)) warnings.push('Some experience dates could not be read — please check them.');
  warnings.push('Automatic extraction is approximate: review every field before saving.');

  return {
    personal: {
      firstName,
      lastName,
      email,
      phone,
      currentLocation: undefined,
      linkedin,
      portfolio,
      website,
    },
    headline,
    summary,
    education,
    experiences,
    skills,
    warnings,
  };
}
