import type { BlogGenerationOutput } from '../../../lib/blog/blogGenerationEngine';
import { validateContentDuplication } from './contentDuplicationValidator';
import type { OrganizationPerspective } from './organizationPerspectiveEngine';

export interface FinalBlogOutcomeValidationResult {
  score: number;
  passed: boolean;
  titleScore: number;
  bodyScore: number;
  actionScore: number;
  povAlignmentScore: number;
  duplicationScore: number;
  issues: string[];
}

interface BodyShapeScore {
  score: number;
  issues: string[];
}

const TEMPLATE_LEAK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Hook Intro', pattern: /\bhook intro\b/i },
  { label: 'H2-led', pattern: /\bh2-led\b/i },
  { label: 'key insights body', pattern: /\bkey insights?\s+body\b/i },
  { label: 'An Executive Perspective', pattern: /\ban executive perspective\b/i },
  { label: 'Category entry guide', pattern: /\bcategory entry guide\b/i },
  { label: 'Category entry strategy', pattern: /\bcategory entry strategy\b/i },
  { label: 'A practical editorial body', pattern: /\ba practical editorial body\b/i },
  { label: 'Opening Thesis', pattern: /\bopening thesis\b/i },
];

const EXECUTIVE_ACTION_TERMS = [
  'decide',
  'decision',
  'prioritize',
  'sequence',
  'measure',
  'owner',
  'budget',
  'risk',
  'governance',
  'tradeoff',
  'resource allocation',
  'operating model',
  'next step',
  'review',
];

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(value: string): number {
  return stripHtml(value).split(/\s+/).filter(Boolean).length;
}

function editorialH2Count(contentHtml: string): number {
  return [...contentHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => stripHtml(match[1] ?? '').toLowerCase())
    .filter((heading) => !/^(summary|conclusion|references|sources|further reading|faq)$/.test(heading))
    .length;
}

function templateLeaks(value: string): string[] {
  return TEMPLATE_LEAK_PATTERNS
    .filter((item) => item.pattern.test(value))
    .map((item) => item.label);
}

function containsTemplateLeak(value: string): boolean {
  return templateLeaks(value).length > 0;
}

function scoreTitle(output: BlogGenerationOutput): number {
  const title = output.title.trim();
  let score = 100;
  if (title.length < 36 || title.length > 96) score -= 18;
  if (containsTemplateLeak(title)) score -= 42;
  if (!/\b(how|why|what|when|where|before|after|without|leaders?|buyers?|founders?|ceos?|cmos?|directors?|vp|strategy|framework|decision|risk|growth|evaluate)\b/i.test(title)) {
    score -= 18;
  }
  if (title.includes(':') && title.split(':').some((part) => part.trim().length < 12)) score -= 8;
  if (output.excerpt.toLowerCase().includes(title.toLowerCase())) score -= 8;
  return Math.max(0, score);
}

function scoreBodyShape(contentHtml: string): BodyShapeScore {
  const h2Count = editorialH2Count(contentHtml);
  const paragraphCount = (contentHtml.match(/<p\b/gi) ?? []).length;
  const totalWords = wordCount(contentHtml);
  const compactArticle = totalWords < 1000;
  const minimumWords = compactArticle ? 650 : 900;
  const excessiveH2WordFloor = compactArticle ? 1200 : 1700;
  const leaks = templateLeaks(contentHtml);
  const issues: string[] = [];
  let score = 100;
  if (leaks.length > 0) {
    score -= 48;
    issues.push(`Template/scaffold text leaked into body: ${leaks.join(', ')}`);
  }
  if (h2Count < 3) {
    score -= 18;
    issues.push(`Too few H2 sections (${h2Count} < 3)`);
  }
  if (paragraphCount < Math.max(8, h2Count * 2)) {
    score -= 16;
    issues.push(`Too few paragraphs for section count (${paragraphCount} paragraphs, ${h2Count} H2 sections)`);
  }
  if (totalWords < minimumWords) {
    score -= 18;
    issues.push(`Body too short (${totalWords} words < ${minimumWords})`);
  }
  if (h2Count >= 6 && totalWords < excessiveH2WordFloor) {
    score -= 12;
    issues.push(`Too many H2 sections for article length (${h2Count} H2 sections, ${totalWords} words)`);
  }
  return {
    score: Math.max(0, score),
    issues,
  };
}

function scoreActionability(contentHtml: string): number {
  const text = stripHtml(contentHtml).toLowerCase();
  const matched = EXECUTIVE_ACTION_TERMS.filter((term) => text.includes(term));
  const recommendationSignals = text.match(/\b(should|must|avoid|stop|start|compare|choose|assign|review|measure|prioritize)\b/g) ?? [];
  return Math.min(100, matched.length * 7 + recommendationSignals.length * 4);
}

function scorePovAlignment(contentHtml: string, perspective: OrganizationPerspective): number {
  const text = stripHtml(contentHtml).toLowerCase();
  const fragments = [
    perspective.companyViewpoint,
    perspective.marketObservation,
    perspective.strategicRecommendation,
    perspective.tradeoffAnalysis,
    perspective.proprietaryInsight,
  ];
  const matched = fragments.filter((fragment) => {
    const terms = stripHtml(fragment)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 5)
      .slice(0, 8);
    return terms.length > 0 && terms.filter((term) => text.includes(term)).length >= Math.min(3, terms.length);
  }).length;
  return Math.min(100, matched * 20);
}

export function validateFinalBlogOutcome(input: {
  output: BlogGenerationOutput;
  organizationPerspective: OrganizationPerspective;
}): FinalBlogOutcomeValidationResult {
  const titleScore = scoreTitle(input.output);
  const bodyShape = scoreBodyShape(input.output.content_html);
  const bodyScore = bodyShape.score;
  const actionScore = scoreActionability(input.output.content_html);
  const povAlignmentScore = scorePovAlignment(input.output.content_html, input.organizationPerspective);
  const duplication = validateContentDuplication(input.output.content_html);
  const duplicationScore = Math.max(0, 100 - duplication.score);
  const issues: string[] = [];

  if (titleScore < 78) issues.push(`Title quality ${titleScore} < 78`);
  if (bodyScore < 82) issues.push(`Body shape ${bodyScore} < 82 (${bodyShape.issues.join('; ') || 'body structure below threshold'})`);
  if (actionScore < 75) issues.push(`Executive actionability ${actionScore} < 75`);
  if (povAlignmentScore < 80) issues.push(`POV/body alignment ${povAlignmentScore} < 80`);
  if (!duplication.passed) issues.push(`Duplicate structure ${duplication.score} > 25`);

  const score = Math.round(
    (titleScore * 0.18)
    + (bodyScore * 0.24)
    + (actionScore * 0.22)
    + (povAlignmentScore * 0.24)
    + (duplicationScore * 0.12),
  );

  return {
    score,
    passed: issues.length === 0 && score >= 82,
    titleScore,
    bodyScore,
    actionScore,
    povAlignmentScore,
    duplicationScore,
    issues,
  };
}
