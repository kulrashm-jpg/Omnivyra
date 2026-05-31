import type { CompanyContext } from '../../../lib/blog/blogRunnerTypes';
import type { BlogAngle } from '../../../lib/blog/blogGenerationEngine';

export interface OrganizationPerspective {
  companyViewpoint: string;
  marketObservation: string;
  strategicRecommendation: string;
  tradeoffAnalysis: string;
  proprietaryInsight: string;
  primaryAudience: string;
}

export interface OrganizationPerspectiveInput {
  topic: string;
  companyContext?: CompanyContext;
  selectedAngle?: BlogAngle;
  answers?: Record<string, string>;
}

const EXECUTIVE_AUDIENCES = [
  'Founder',
  'CEO',
  'CMO',
  'VP',
  'Director',
  'Department Head',
  'Strategic Buyer',
];

function clean(value: string | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(values: Array<string | undefined>, fallback: string): string {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return fallback;
}

function inferExecutiveAudience(input: OrganizationPerspectiveInput): string {
  const explicit = clean(input.answers?.audience || input.answers?.target_audience || input.companyContext?.audience);
  const explicitLower = explicit.toLowerCase();
  const matched = EXECUTIVE_AUDIENCES.find((audience) => explicitLower.includes(audience.toLowerCase()));
  if (matched) return matched;
  if (explicitLower.includes('founder')) return 'Founder';
  if (explicitLower.includes('chief') || explicitLower.includes('executive')) return 'CEO';
  if (explicitLower.includes('marketing')) return 'CMO';
  if (explicitLower.includes('leader') || explicitLower.includes('head')) return 'Department Head';
  return 'Strategic Buyer';
}

export function buildOrganizationPerspective(input: OrganizationPerspectiveInput): OrganizationPerspective {
  const context = input.companyContext;
  const companyName = clean(context?.companyName) || 'the organization';
  const topic = clean(input.topic) || 'this topic';
  const audience = inferExecutiveAudience(input);
  const coreProblem = firstNonEmpty(
    [
      context?.coreProblemStatement,
      context?.problemImpact,
      context?.painSymptoms?.join('; '),
      input.answers?.campaign_objective,
    ],
    `teams treat ${topic} as a content problem instead of an operating decision`,
  );
  const differentiator = firstNonEmpty(
    [
      context?.uniqueValue,
      context?.competitiveAdvantages,
      context?.transformationMechanism,
      context?.keyMessages,
    ],
    `its first-hand view of how ${topic} changes commercial execution`,
  );
  const transformation = firstNonEmpty(
    [
      context?.desiredTransformation,
      context?.lifeAfterSolution,
      context?.growthPriorities,
      context?.goals,
    ],
    `make ${topic} measurable, owned, and tied to business outcomes`,
  );
  const marketObservation = firstNonEmpty(
    [
      context?.awarenessGap,
      context?.lifeWithProblem,
      context?.recommendationContext?.strategic_focus,
      context?.recommendationContext?.key_threat,
      input.selectedAngle?.angle_summary,
    ],
    `most teams can explain ${topic}, but cannot translate it into repeatable executive decisions`,
  );

  return {
    companyViewpoint: `${companyName} believes ${topic} matters because ${coreProblem}.`,
    marketObservation: `${companyName} observes a recurring pattern: ${marketObservation}.`,
    strategicRecommendation: `${audience}s should use ${topic} to ${transformation}, not simply publish more educational content.`,
    tradeoffAnalysis: `Avoid generic best-practice coverage that hides tradeoffs; it makes ${topic} sound interchangeable and prevents leaders from seeing what to stop, sequence, or measure.`,
    proprietaryInsight: `${companyName}'s difficult-to-copy insight is ${differentiator}, applied to the specific operating tension behind ${topic}.`,
    primaryAudience: audience,
  };
}

export function renderOrganizationPerspectiveForPrompt(perspective: OrganizationPerspective): string {
  return [
    '## ORGANIZATIONAL POV LAYER (MANDATORY)',
    `Primary executive audience: ${perspective.primaryAudience}`,
    `Company viewpoint: ${perspective.companyViewpoint}`,
    `Market observation: ${perspective.marketObservation}`,
    `Strategic recommendation: ${perspective.strategicRecommendation}`,
    `Tradeoff analysis: ${perspective.tradeoffAnalysis}`,
    `Proprietary insight: ${perspective.proprietaryInsight}`,
    '',
    'Every major section must use at least one of these points. The article fails if a competitor could replace the company name and keep the article unchanged.',
  ].join('\n');
}
