const GENERIC_OPENINGS = [
  "in today's fast-paced landscape",
  'in the evolving world of',
  'businesses today face',
  'navigating a complex environment',
  'in today\'s digital age',
  'in an increasingly competitive',
  'now more than ever',
  'the importance of',
  'it is essential to understand',
];

const GENERIC_PHRASES = [
  'best practices',
  'unlock success',
  'drive growth',
  'stay ahead of the curve',
  'game-changer',
  'rapidly changing landscape',
  'competitive advantage',
  'seamless experience',
  'robust solution',
  'leverage technology',
];

export interface GenericContentDetectionResult {
  score: number;
  passed: boolean;
  openingMatched: string[];
  genericPhrases: string[];
  replacementDirection: string;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstWords(value: string, count: number): string {
  return value.split(/\s+/).slice(0, count).join(' ').toLowerCase();
}

export function detectGenericContent(contentHtml: string): GenericContentDetectionResult {
  const text = stripHtml(contentHtml);
  const lower = text.toLowerCase();
  const opening = firstWords(text, 60);
  const openingMatched = GENERIC_OPENINGS.filter((phrase) => opening.includes(phrase));
  const genericPhrases = GENERIC_PHRASES.filter((phrase) => lower.includes(phrase));
  const paragraphCount = Math.max(1, (contentHtml.match(/<p\b/gi) ?? []).length);
  const densityPenalty = Math.min(40, Math.round((genericPhrases.length / paragraphCount) * 35));
  const score = Math.min(100, openingMatched.length * 35 + densityPenalty + Math.min(25, genericPhrases.length * 3));

  return {
    score,
    passed: score < 30,
    openingMatched,
    genericPhrases,
    replacementDirection: 'Open with a market observation, customer insight, operational challenge, strategic tension, or proprietary finding.',
  };
}
