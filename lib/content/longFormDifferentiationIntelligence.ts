import type { CompanyContext } from '../blog/runBlogGeneration';
import type { ContentPlan, SectionGenerationResult } from './longFormPlanningEngine';
import type { SearchIntent } from './longFormSeoIntelligence';
import type { LongFormContentType } from './longFormContentTypeConfig';

export type ContentPositioningType =
  | 'beginner_friendly'
  | 'expert_level'
  | 'contrarian'
  | 'framework_first'
  | 'data_driven'
  | 'opinionated'
  | 'comparison_heavy';

export interface ContentPositioning {
  primary: ContentPositioningType;
  secondary: ContentPositioningType;
  rationale: string;
}

export interface CompetitorContentProfile {
  commonAngles: string[];
  commonStructures: string[];
  missingGaps: string[];
  overusedPatterns: string[];
}

export interface DifferentiationStrategy {
  avoid: string[];
  emphasize: string[];
  uniqueHookStrategy: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function deriveContentPositioning(input: {
  topic: string;
  contentType: LongFormContentType;
  formatType?: string;
  searchIntent: SearchIntent;
  companyContext?: CompanyContext;
}): ContentPositioning {
  const haystack = normalize([
    input.topic,
    input.contentType,
    input.formatType,
    input.companyContext?.brand_voice,
    input.companyContext?.competitiveAdvantages,
    input.companyContext?.authorityDomains?.join(' '),
  ].filter(Boolean).join(' '));

  let primary: ContentPositioningType = 'framework_first';
  if (input.searchIntent === 'comparison') primary = 'comparison_heavy';
  else if (/\b(myth|myths|wrong|mistake|mistakes|contrarian|unpopular|truth|broken)\b/.test(haystack)) primary = 'contrarian';
  else if (/\b(data|benchmark|research|report|statistics|study|whitepaper)\b/.test(haystack)) primary = 'data_driven';
  else if (input.contentType === 'guide') primary = 'framework_first';
  else if (input.contentType === 'article') primary = 'opinionated';
  else if (input.contentType === 'story') primary = 'beginner_friendly';

  let secondary: ContentPositioningType = 'opinionated';
  if (primary === 'comparison_heavy') secondary = 'framework_first';
  else if (primary === 'data_driven') secondary = 'expert_level';
  else if (primary === 'contrarian') secondary = 'framework_first';
  else if (input.searchIntent === 'informational') secondary = 'beginner_friendly';

  if (primary === secondary) secondary = 'opinionated';

  return {
    primary,
    secondary,
    rationale: `Selected ${primary} with ${secondary} support based on ${input.searchIntent} intent, content type, format, and available brand authority signals.`,
  };
}

export function simulateCompetitorContentProfile(input: {
  topic: string;
  searchIntent: SearchIntent;
  positioning: ContentPositioning;
}): CompetitorContentProfile {
  const comparisonPatterns = input.searchIntent === 'comparison' || input.positioning.primary === 'comparison_heavy';
  return {
    commonAngles: comparisonPatterns
      ? [
          'generic feature-by-feature comparison',
          'surface-level pros and cons',
          'unsupported best-option verdict',
        ]
      : [
          `basic definition of ${input.topic}`,
          'generic benefits overview',
          'high-level best practices without operating detail',
        ],
    commonStructures: comparisonPatterns
      ? ['intro', 'comparison table', 'pros and cons', 'winner verdict', 'FAQ']
      : ['what it is', 'why it matters', 'tips or steps', 'examples', 'FAQ'],
    missingGaps: [
      'clear decision criteria',
      'named original framework',
      'implementation failure modes',
      'brand-specific point of view',
      'examples tied to audience context',
    ],
    overusedPatterns: [
      'opening with a broad market statement',
      'repeating the same benefit in multiple sections',
      'using vague advice without tradeoffs',
      'ending with a generic summary',
    ],
  };
}

export function buildDifferentiationStrategy(input: {
  topic: string;
  positioning: ContentPositioning;
  competitorProfile: CompetitorContentProfile;
  companyContext?: CompanyContext;
}): DifferentiationStrategy {
  const companyAngle = input.companyContext?.uniqueValue
    || input.companyContext?.competitiveAdvantages
    || input.companyContext?.coreProblemStatement
    || `a sharper operating perspective on ${input.topic}`;
  return {
    avoid: input.competitorProfile.overusedPatterns,
    emphasize: [
      ...input.competitorProfile.missingGaps.slice(0, 4),
      `position the argument around ${input.positioning.primary}`,
      `connect recommendations to ${companyAngle}`,
    ],
    uniqueHookStrategy:
      input.positioning.primary === 'contrarian'
        ? `Open by challenging the default advice around ${input.topic}, then explain what serious operators should do instead.`
        : input.positioning.primary === 'framework_first'
        ? `Open with the cost of unstructured thinking, then introduce the model early.`
        : input.positioning.primary === 'data_driven'
        ? `Open with an evidence tension or measurable consequence before recommendations.`
        : input.positioning.primary === 'comparison_heavy'
        ? `Open with the decision trap most comparisons miss, then frame criteria before options.`
        : `Open with a specific audience tension and make the brand POV clear within the first section.`,
  };
}

export function scoreDifferentiation(input: {
  plan: ContentPlan;
  sections: SectionGenerationResult[];
  positioning: ContentPositioning;
  competitorProfile: CompetitorContentProfile;
  differentiationStrategy: DifferentiationStrategy;
}): { score: number; weakSections: string[] } {
  const fullText = stripHtml(input.sections.map((section) => section.html).join('\n')).toLowerCase();
  const introText = stripHtml(input.sections[0]?.html || '').toLowerCase();
  const frameworkSignal = input.plan.framework.name && fullText.includes(input.plan.framework.name.toLowerCase());
  const positioningSignals = [
    input.positioning.primary.replace('_', ' '),
    input.positioning.secondary.replace('_', ' '),
    'common assumption',
    'instead',
    'tradeoff',
    'framework',
    'criteria',
    'failure mode',
  ].filter((signal) => fullText.includes(signal));
  const avoidedPatterns = input.competitorProfile.overusedPatterns.filter((pattern) => !fullText.includes(pattern.toLowerCase()));
  const gapCoverage = input.competitorProfile.missingGaps.filter((gap) => {
    const terms = normalize(gap).split(/\s+/).filter((term) => term.length > 4);
    return terms.some((term) => fullText.includes(term));
  });
  const hookStrength = input.differentiationStrategy.uniqueHookStrategy
    .split(/\s+/)
    .filter((term) => term.length > 5)
    .some((term) => introText.includes(normalize(term)))
    || /wrong|miss|trap|instead|cost|tension|criteria|model|framework/.test(introText);
  const score = clampScore(
    (frameworkSignal ? 22 : 8)
    + (Math.min(1, positioningSignals.length / 4) * 28)
    + (Math.min(1, gapCoverage.length / 3) * 25)
    + (Math.min(1, avoidedPatterns.length / Math.max(1, input.competitorProfile.overusedPatterns.length)) * 15)
    + (hookStrength ? 10 : 2),
  );
  const weakSections = input.sections
    .filter((section, index) => {
      const text = stripHtml(section.html).toLowerCase();
      if (index === 0 && !hookStrength) return true;
      if (/framework|model|criteria/i.test(section.section_title) && !text.includes(input.plan.framework.name.toLowerCase())) return true;
      if (/insight|miss|mistake|verdict|implication/i.test(section.section_title) && !/common assumption|instead|tradeoff|miss|failure mode/i.test(text)) return true;
      return false;
    })
    .map((section) => section.section_title);
  return { score, weakSections };
}
