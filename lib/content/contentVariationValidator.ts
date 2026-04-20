export interface ContentSectionCandidate {
  id: string;
  label?: string;
  text: string;
}

export interface DuplicateSectionPair {
  leftId: string;
  rightId: string;
  similarity: number;
}

export interface LowVariationSectionIssue {
  sectionId: string;
  similarityToPrevious: number;
  repeatedAgainstId?: string;
  missingNewConcept: boolean;
}

export interface ContentVariationValidationResult {
  duplicateContentDetected: boolean;
  lowVariationDetected: boolean;
  duplicateSectionPairs: DuplicateSectionPair[];
  lowVariationSections: LowVariationSectionIssue[];
  maxSectionSimilarity: number;
  sectionCount: number;
  validationMode: 'long_form' | 'mid_form' | 'short_form';
}

export interface ContentVariationValidationOptions {
  contentType?: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'do',
  'for', 'from', 'had', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its',
  'more', 'not', 'of', 'on', 'or', 'our', 'that', 'the', 'their', 'them',
  'there', 'these', 'they', 'this', 'those', 'to', 'was', 'we', 'were', 'what',
  'when', 'which', 'who', 'will', 'with', 'you', 'your',
]);

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token: string): string {
  const cleaned = token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (cleaned.length <= 2) return '';
  if (STOP_WORDS.has(cleaned)) return '';
  if (cleaned.endsWith('ing') && cleaned.length > 6) return cleaned.slice(0, -3);
  if (cleaned.endsWith('ed') && cleaned.length > 5) return cleaned.slice(0, -2);
  if (cleaned.endsWith('es') && cleaned.length > 5) return cleaned.slice(0, -2);
  if (cleaned.endsWith('s') && cleaned.length > 4) return cleaned.slice(0, -1);
  return cleaned;
}

function tokenize(text: string): string[] {
  return stripHtml(text)
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 4);
}

function toTokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function buildCandidatesFromText(contentText: string): ContentSectionCandidate[] {
  const normalized = contentText
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(ul|ol|section|article|div)>/gi, '\n\n');

  return normalized
    .split(/\n\s*\n+/)
    .map((text, index) => ({ id: `section_${index + 1}`, text: stripHtml(text) }))
    .filter((section) => section.text.split(/\s+/).filter(Boolean).length >= 12);
}

export function getContentValidationMode(contentType?: string): 'long_form' | 'mid_form' | 'short_form' {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (['blog', 'article', 'guide', 'whitepaper', 'story'].includes(normalized)) return 'long_form';
  if (['newsletter', 'case_study', 'case study'].includes(normalized)) return 'mid_form';
  return 'short_form';
}

export function validateContentVariation(
  sectionsOrContent: ContentSectionCandidate[] | string,
  options: ContentVariationValidationOptions = {},
): ContentVariationValidationResult {
  const validationMode = getContentValidationMode(options.contentType);
  const sections = Array.isArray(sectionsOrContent)
    ? sectionsOrContent
        .map((section) => ({
          ...section,
          text: stripHtml(section.text),
        }))
        .filter((section) => section.text.split(/\s+/).filter(Boolean).length >= 12)
    : buildCandidatesFromText(sectionsOrContent);

  if (sections.length < 2) {
    return {
      duplicateContentDetected: false,
      lowVariationDetected: false,
      duplicateSectionPairs: [],
      lowVariationSections: [],
      maxSectionSimilarity: 0,
      sectionCount: sections.length,
      validationMode,
    };
  }

  if (validationMode === 'short_form') {
    return {
      duplicateContentDetected: false,
      lowVariationDetected: false,
      duplicateSectionPairs: [],
      lowVariationSections: [],
      maxSectionSimilarity: 0,
      sectionCount: sections.length,
      validationMode,
    };
  }

  const tokenSets = sections.map((section) => toTokenSet(section.text));
  const duplicateSectionPairs: DuplicateSectionPair[] = [];
  const lowVariationSections: LowVariationSectionIssue[] = [];
  const seenConcepts = new Set<string>();
  let maxSectionSimilarity = 0;
  const duplicateThreshold = validationMode === 'mid_form' ? 0.8 : 0.7;
  const lowVariationThreshold = validationMode === 'mid_form' ? 0.7 : 0.55;

  for (let index = 0; index < sections.length; index += 1) {
    const currentTokens = tokenSets[index];
    let maxSimilarityToPrevious = 0;
    let repeatedAgainstId: string | undefined;

    for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
      const similarity = jaccardSimilarity(currentTokens, tokenSets[previousIndex]);
      if (similarity > maxSectionSimilarity) maxSectionSimilarity = similarity;
      if (similarity > maxSimilarityToPrevious) {
        maxSimilarityToPrevious = similarity;
        repeatedAgainstId = sections[previousIndex].id;
      }
      if (similarity >= duplicateThreshold) {
        duplicateSectionPairs.push({
          leftId: sections[previousIndex].id,
          rightId: sections[index].id,
          similarity,
        });
      }
    }

    const newConcepts = Array.from(currentTokens).filter((token) => !seenConcepts.has(token));
    const missingNewConcept = newConcepts.length === 0;
    const tooSimilarToPrevious = maxSimilarityToPrevious >= lowVariationThreshold;
    if (
      validationMode === 'long_form' &&
      index > 0 &&
      (missingNewConcept || (tooSimilarToPrevious && newConcepts.length < 2))
    ) {
      lowVariationSections.push({
        sectionId: sections[index].id,
        similarityToPrevious: maxSimilarityToPrevious,
        repeatedAgainstId,
        missingNewConcept,
      });
    }

    for (const token of currentTokens) {
      seenConcepts.add(token);
    }
  }

  return {
    duplicateContentDetected: duplicateSectionPairs.length > 0,
    lowVariationDetected: lowVariationSections.length > 0,
    duplicateSectionPairs,
    lowVariationSections,
    maxSectionSimilarity,
    sectionCount: sections.length,
    validationMode,
  };
}
