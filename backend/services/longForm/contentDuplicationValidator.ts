export interface ContentDuplicationValidationResult {
  score: number;
  passed: boolean;
  repeatedSectionPairs: Array<{ a: string; b: string; overlap: number }>;
  repeatedParagraphPairs: Array<{ a: string; b: string; overlap: number; aOpening: string; bOpening: string }>;
  repeatedConceptFrames: Array<{ frame: string; sections: string[] }>;
  repeatedOpenings: string[];
  repeatedParagraphStems: string[];
  repeatedParagraphStemGroups: Array<{ stem: string; sections: string[] }>;
  repeatedHookRestarts: Array<{ section: string; overlap: number; opening: string }>;
  issues: string[];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): Set<string> {
  const stop = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'their', 'because', 'should', 'would', 'could', 'about', 'there', 'where', 'which', 'while']);
  return new Set(stripHtml(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 4 && !stop.has(token)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return Number((intersection / (a.size + b.size - intersection)).toFixed(3));
}

function splitSections(contentHtml: string): Array<{ title: string; html: string }> {
  const parts = contentHtml.split(/(<h2\b[^>]*>[\s\S]*?<\/h2>)/gi);
  const sections: Array<{ title: string; html: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    const heading = stripHtml(parts[i] ?? '');
    const body = parts[i + 1] ?? '';
    if (!heading || /^(summary|references|sources|faq)$/i.test(heading)) continue;
    sections.push({ title: heading, html: body });
  }
  return sections;
}

function removeKeyInsights(value: string): string {
  return value.replace(/<div[^>]*class=["'][^"']*key-insights[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
}

function firstSentence(value: string): string {
  return stripHtml(value).split(/(?<=[.!?])\s+/)[0]?.trim() ?? '';
}

function paragraphTexts(value: string): string[] {
  const matches = [...value.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  if (matches.length === 0) return [];
  return matches.map((match) => stripHtml(match[1] ?? '')).filter((text) => text.length > 40);
}

function paragraphStem(value: string): string {
  const stop = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'their']);
  return stripHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stop.has(token))
    .slice(0, 7)
    .join(' ');
}

function paragraphOpening(value: string): string {
  return stripHtml(value).split(/\s+/).slice(0, 14).join(' ');
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared;
}

const CONCEPT_GROUPS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'decision', pattern: /\b(decision|decide|choose|choice|criteria|evaluate|compare)\b/i },
  { label: 'ownership', pattern: /\b(owner|ownership|accountable|responsible|team|role)\b/i },
  { label: 'measurement', pattern: /\b(metric|measure|signal|proof|evidence|dashboard|review|progress)\b/i },
  { label: 'risk', pattern: /\b(risk|failure|constraint|avoid|prevent|tradeoff|downside)\b/i },
  { label: 'execution', pattern: /\b(execute|execution|workflow|operating|implementation|sequence|next step|action)\b/i },
  { label: 'resources', pattern: /\b(budget|fund|investment|resource|capacity|cost|time)\b/i },
  { label: 'strategy', pattern: /\b(strategy|strategic|priority|prioritize|outcome|growth|revenue|pipeline)\b/i },
  { label: 'framework', pattern: /\b(framework|model|methodology|scorecard|matrix|system)\b/i },
  { label: 'market', pattern: /\b(market|buyer|customer|audience|competitor|category|demand)\b/i },
  { label: 'governance', pattern: /\b(governance|cadence|review rhythm|policy|standard|approval)\b/i },
];

function conceptFrame(value: string): string {
  const labels = CONCEPT_GROUPS
    .filter((group) => group.pattern.test(value))
    .map((group) => group.label)
    .sort();
  return labels.length >= 4 ? labels.join('|') : '';
}

export function validateContentDuplication(contentHtml: string): ContentDuplicationValidationResult {
  const sections = splitSections(contentHtml);
  const repeatedSectionPairs: ContentDuplicationValidationResult['repeatedSectionPairs'] = [];
  const repeatedParagraphPairs: ContentDuplicationValidationResult['repeatedParagraphPairs'] = [];
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      const overlap = jaccard(tokenize(sections[i].html), tokenize(sections[j].html));
      if (overlap >= 0.42) {
        repeatedSectionPairs.push({ a: sections[i].title, b: sections[j].title, overlap });
      }
    }
  }

  const sectionParagraphs = sections.flatMap((section) => paragraphTexts(section.html).map((paragraph) => ({
    section: section.title,
    paragraph,
    tokens: tokenize(paragraph),
  })));
  for (let i = 0; i < sectionParagraphs.length; i += 1) {
    for (let j = i + 1; j < sectionParagraphs.length; j += 1) {
      const a = sectionParagraphs[i];
      const b = sectionParagraphs[j];
      if (a.section === b.section) continue;
      const overlap = jaccard(a.tokens, b.tokens);
      const shared = sharedTokenCount(a.tokens, b.tokens);
      if (overlap >= 0.32 && shared >= 10) {
        repeatedParagraphPairs.push({
          a: a.section,
          b: b.section,
          overlap,
          aOpening: paragraphOpening(a.paragraph),
          bOpening: paragraphOpening(b.paragraph),
        });
      }
    }
  }

  const firstH2Index = contentHtml.search(/<h2\b/i);
  const introHtml = firstH2Index >= 0 ? removeKeyInsights(contentHtml.slice(0, firstH2Index)) : '';
  const introTokens = tokenize(firstSentence(introHtml) || introHtml);
  const repeatedHookRestarts = sections
    .map((section) => {
      const opening = firstSentence(section.html);
      return {
        section: section.title,
        opening,
        overlap: jaccard(introTokens, tokenize(opening)),
      };
    })
    .filter((item) => introTokens.size > 0 && item.opening.length > 40 && item.overlap >= 0.34);

  const openings = sections
    .map((section) => stripHtml(section.html).split(/\s+/).slice(0, 9).join(' ').toLowerCase())
    .filter((opening) => opening.length > 20);
  const counts = new Map<string, number>();
  for (const opening of openings) counts.set(opening, (counts.get(opening) ?? 0) + 1);
  const repeatedOpenings = [...counts.entries()].filter(([, count]) => count > 1).map(([opening]) => opening);

  const paragraphStemSections = new Map<string, Set<string>>();
  for (const section of sections) {
    for (const paragraph of paragraphTexts(section.html)) {
      const stem = paragraphStem(paragraph);
      if (stem.length <= 24) continue;
      const existing = paragraphStemSections.get(stem) ?? new Set<string>();
      existing.add(section.title);
      paragraphStemSections.set(stem, existing);
    }
  }
  const repeatedParagraphStemGroups = [...paragraphStemSections.entries()]
    .map(([stem, stemSections]) => ({ stem, sections: [...stemSections] }))
    .filter((item) => item.sections.length > 1);
  const repeatedParagraphStems = repeatedParagraphStemGroups.map((item) => item.stem);

  const conceptFrameSections = new Map<string, Set<string>>();
  for (const section of sections) {
    for (const paragraph of paragraphTexts(section.html)) {
      const frame = conceptFrame(paragraph);
      if (!frame) continue;
      const existing = conceptFrameSections.get(frame) ?? new Set<string>();
      existing.add(section.title);
      conceptFrameSections.set(frame, existing);
    }
  }
  const repeatedConceptFrames = [...conceptFrameSections.entries()]
    .map(([frame, frameSections]) => ({ frame, sections: [...frameSections] }))
    .filter((item) => item.sections.length > 1);

  const issues: string[] = [];
  if (repeatedSectionPairs.length > 0) issues.push('Sections repeat too much semantic substance.');
  if (repeatedParagraphPairs.length > 0) issues.push('Paragraphs repeat the same idea under different headings.');
  if (repeatedOpenings.length > 0) issues.push('Sections use repeated paragraph openings.');
  if (repeatedParagraphStems.length > 0) issues.push('Paragraphs reuse the same structural setup across sections.');
  if (repeatedConceptFrames.length > 0) issues.push('Sections reuse the same executive decision frame without adding a distinct idea.');
  if (repeatedHookRestarts.length > 0) issues.push('Sections restart the hook/intro instead of advancing the argument.');

  const score = Math.min(
    100,
    repeatedSectionPairs.length * 28
    + repeatedParagraphPairs.length * 20
    + repeatedOpenings.length * 18
    + repeatedParagraphStems.length * 18
    + repeatedConceptFrames.length * 16
    + repeatedHookRestarts.length * 22,
  );
  return {
    score,
    passed: score <= 25,
    repeatedSectionPairs,
    repeatedParagraphPairs,
    repeatedConceptFrames,
    repeatedOpenings,
    repeatedParagraphStems,
    repeatedParagraphStemGroups,
    repeatedHookRestarts,
    issues,
  };
}
