import type { BlogGenerationOutput } from '../../../lib/blog/blogGenerationEngine';
import { validateContentDuplication } from './contentDuplicationValidator';
import type { OrganizationPerspective } from './organizationPerspectiveEngine';
import {
  getQualityProfile,
  duplicationFailsProfile,
  type QualityProfile,
  type TitleRubric,
} from './qualityProfiles';
import { evaluatePhase1QualityGates, type Phase1GateTrigger } from './phase1QualityGates';

export interface FinalBlogOutcomeValidationResult {
  score: number;
  passed: boolean;
  titleScore: number;
  bodyScore: number;
  actionScore: number;
  povAlignmentScore: number;
  duplicationScore: number;
  issues: string[];
  /**
   * Phase 1 false-positive prevention gates that fired (publishing artifacts,
   * placeholders, undelivered frameworks, unfulfilled title promises). Empty
   * for a clean article. Each fired gate is also a blocking issue and caps
   * `score`. Surfaced for telemetry / editor diagnostics.
   */
  gates: Phase1GateTrigger[];
  /** Framework subscore ceiling when the framework-delivery gate fired, else null. */
  frameworkScoreCap: number | null;
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

// Executive-keyword rubric (blog/article/guide) — the original behavior.
const EXECUTIVE_TITLE_KEYWORDS = /\b(how|why|what|when|where|before|after|without|leaders?|buyers?|founders?|ceos?|cmos?|directors?|vp|strategy|framework|decision|risk|growth|evaluate)\b/i;

function scoreTitle(output: BlogGenerationOutput, rubric: TitleRubric = 'executive'): number {
  const title = output.title.trim();
  let score = 100;
  // Length bounds differ by rubric: inbox titles are short, formal titles can
  // run longer; executive keeps the original 36–96 window.
  const [minLen, maxLen] = rubric === 'inbox' ? [12, 80] : rubric === 'formal' ? [24, 120] : [36, 96];
  if (title.length < minLen || title.length > maxLen) score -= 18;
  if (containsTemplateLeak(title)) score -= 42;
  // The executive-keyword requirement is a blog/thought-leadership convention.
  // Formal (whitepaper) and inbox (newsletter) titles are not penalized for
  // lacking it — a descriptive whitepaper title or a "Weekly … Update" issue
  // title is correct for those formats.
  if (rubric === 'executive' && !EXECUTIVE_TITLE_KEYWORDS.test(title)) {
    score -= 18;
  }
  if (title.includes(':') && title.split(':').some((part) => part.trim().length < 12)) score -= 8;
  if (output.excerpt.toLowerCase().includes(title.toLowerCase())) score -= 8;
  return Math.max(0, score);
}

function scoreBodyShape(contentHtml: string, enforceWordFloor: boolean = true): BodyShapeScore {
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
  // Blog body word-floor assumptions — skipped for formats (newsletter) where
  // short, scannable sections are by design. `enforceWordFloor` defaults to
  // true so every existing caller is byte-identical.
  if (enforceWordFloor && totalWords < minimumWords) {
    score -= 18;
    issues.push(`Body too short (${totalWords} words < ${minimumWords})`);
  }
  if (enforceWordFloor && h2Count >= 6 && totalWords < excessiveH2WordFloor) {
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
  /** Content-type quality profile. Omitted → default (byte-identical to before). */
  profile?: QualityProfile;
}): FinalBlogOutcomeValidationResult {
  const profile = input.profile ?? getQualityProfile();
  const titleScore = scoreTitle(input.output, profile.titleRubric);
  const bodyShape = scoreBodyShape(input.output.content_html, profile.enforceBodyWordFloor);
  const bodyScore = bodyShape.score;
  const actionScore = scoreActionability(input.output.content_html);
  const povAlignmentScore = scorePovAlignment(input.output.content_html, input.organizationPerspective);
  const duplication = validateContentDuplication(input.output.content_html);
  const duplicationScore = Math.max(0, 100 - duplication.score);
  // `issues` is the full advisory list (still reported in telemetry/diagnostics).
  // `blockingIssues` is the subset that HARD-FAILS the gate. A marginal title is
  // deliberately advisory-only: the title is already weighted into the aggregate
  // `score` below (0.18), it is the single most-editable field (the writer
  // refines it in the editor on handoff), and a strong overall blog should not
  // be discarded over a few title-rubric points. A structurally broken title
  // (template / placeholder leak) DOES still hard-block. Body shape,
  // actionability, POV alignment, and duplication all remain hard.
  const issues: string[] = [];
  const blockingIssues: string[] = [];
  const addIssue = (message: string, blocking: boolean) => {
    issues.push(message);
    if (blocking) blockingIssues.push(message);
  };

  if (titleScore < profile.thresholds.titleScore) {
    addIssue(
      `Title quality ${titleScore} < ${profile.thresholds.titleScore}`,
      containsTemplateLeak(input.output.title.trim()),
    );
  }
  if (bodyScore < profile.thresholds.bodyScore) addIssue(`Body shape ${bodyScore} < ${profile.thresholds.bodyScore} (${bodyShape.issues.join('; ') || 'body structure below threshold'})`, true);
  if (actionScore < profile.thresholds.actionScore) addIssue(`Executive actionability ${actionScore} < ${profile.thresholds.actionScore}`, true);
  if (povAlignmentScore < profile.thresholds.povAlignmentScore) addIssue(`POV/body alignment ${povAlignmentScore} < ${profile.thresholds.povAlignmentScore}`, true);
  if (duplicationFailsProfile(duplication, profile)) addIssue(`Duplicate structure ${duplication.score} > ${profile.thresholds.duplicationMaxScore}`, true);

  const baseScore = Math.round(
    (titleScore * 0.18)
    + (bodyScore * 0.24)
    + (actionScore * 0.22)
    + (povAlignmentScore * 0.24)
    + (duplicationScore * 0.12),
  );

  // Phase 1 false-positive prevention gates. Additive: a clean article triggers
  // nothing and `score` is unchanged. A fired gate is a HARD-BLOCK (added to
  // blockingIssues) and caps the reported score so a structurally strong but
  // defective article cannot surface as high quality. Aggregate weights are
  // deliberately NOT changed here (Phase 1 scope).
  const gateReport = evaluatePhase1QualityGates({
    title: input.output.title,
    contentHtml: input.output.content_html,
  });
  const gates = gateReport.triggered;
  for (const gate of gates) {
    addIssue(gate.issue, true);
  }
  const score = gateReport.scoreCap !== null ? Math.min(baseScore, gateReport.scoreCap) : baseScore;

  return {
    score,
    passed: blockingIssues.length === 0 && score >= profile.thresholds.finalOutcomeAggregate,
    titleScore,
    bodyScore,
    actionScore,
    povAlignmentScore,
    duplicationScore,
    issues,
    gates,
    frameworkScoreCap: gateReport.frameworkScoreCap,
  };
}
