import type { PersistedDecisionObject } from './decisionObjectService';
import { classifyDecisionType } from './decisionTypeRegistry';
import { impactScore } from './reportDecisionUtils';

type NarrativeTheme = 'content' | 'conversion' | 'authority' | 'trust';

export type ProblemNarrative = {
  theme: NarrativeTheme;
  label: string;
  score: number;
  frequency: number;
  average_impact: number;
  average_confidence: number;
  diagnosis: string;
  supporting_issue_types: string[];
};

export type PrimaryNarrative = {
  primary_problem: string;
  primary_theme: NarrativeTheme | null;
  secondary_problems: string[];
  ranked_problems: ProblemNarrative[];
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function themeLabel(theme: NarrativeTheme): string {
  switch (theme) {
    case 'content':
      return 'content coverage';
    case 'conversion':
      return 'conversion clarity';
    case 'authority':
      return 'authority strength';
    case 'trust':
      return 'trust signals';
    default:
      return 'market readiness';
  }
}

function inferTheme(decision: PersistedDecisionObject): NarrativeTheme {
  const issueType = String(decision.issue_type ?? '').toLowerCase();
  const actionType = String(decision.action_type ?? '').toLowerCase();
  const title = `${decision.title} ${decision.description} ${decision.recommendation}`.toLowerCase();
  const category = classifyDecisionType(issueType);

  if (category === 'authority') return 'authority';
  if (category === 'trust') return 'trust';
  if (category === 'content_strategy') return 'content';
  if (category === 'execution') return 'conversion';

  if (
    /(content|topic|cluster|coverage|blog|publish|seo|search|keyword|aeo|intent|geo|regional|local)/.test(
      `${issueType} ${title}`,
    )
  ) {
    return 'content';
  }

  if (/(proof|credib|testimonial|review|trust|case stud|brand|reputation)/.test(`${issueType} ${title}`)) {
    return 'trust';
  }

  if (/(authority|backlink|domain strength)/.test(`${issueType} ${title}`)) {
    return 'authority';
  }

  if (
    /(cta|journey|funnel|conversion|dropoff|lead|pricing|contact|demo|book|signup|flow|action)/.test(
      `${issueType} ${actionType} ${title}`,
    )
  ) {
    return 'conversion';
  }

  if (category === 'performance' || category === 'distribution' || category === 'velocity' || category === 'risk') {
    return 'conversion';
  }

  return 'content';
}

function buildDiagnosisForTheme(theme: NarrativeTheme, topDecisions: PersistedDecisionObject[]): string {
  const topTitles = topDecisions
    .map((decision) => String(decision.title ?? '').trim())
    .filter(Boolean);

  switch (theme) {
    case 'content':
      return topTitles[0]
        ? `The core problem is weak content coverage: ${topTitles[0].replace(/\.$/, '')}. This is limiting discoverability and making it harder to answer buyer questions with enough depth.`
        : 'The core problem is weak content coverage. The business is not giving buyers or search systems enough depth to consistently discover and trust the offer.';
    case 'conversion':
      return topTitles[0]
        ? `The core problem is conversion clarity: ${topTitles[0].replace(/\.$/, '')}. Buyers can reach the site, but the path from interest to action still has too much friction.`
        : 'The core problem is conversion clarity. Buyers are not being moved cleanly from interest to the next action, which suppresses lead quality and conversion efficiency.';
    case 'authority':
      return topTitles[0]
        ? `The core problem is authority strength: ${topTitles[0].replace(/\.$/, '')}. Competitiveness is being constrained because the business does not yet look strong enough in the market.`
        : 'The core problem is authority strength. The business is not yet sending enough authority signals to compete consistently against stronger peers.';
    case 'trust':
      return topTitles[0]
        ? `The core problem is trust signals: ${topTitles[0].replace(/\.$/, '')}. Buyers are being asked to move forward without enough visible proof or reassurance.`
        : 'The core problem is trust signals. The business is not giving buyers enough proof to feel confident moving toward a decision.';
    default:
      return 'The core problem is scattered execution pressure across the report, and the business needs a tighter operating focus.';
  }
}

function buildSecondaryProblem(theme: NarrativeTheme, topDecision: PersistedDecisionObject): string {
  const title = String(topDecision.title ?? '').trim() || topDecision.issue_type.replace(/_/g, ' ');

  switch (theme) {
    case 'content':
      return `${title} is reinforcing the broader content coverage problem.`;
    case 'conversion':
      return `${title} is creating extra friction in the path from interest to action.`;
    case 'authority':
      return `${title} is weakening how strongly the business competes in-market.`;
    case 'trust':
      return `${title} is reducing buyer confidence at decision time.`;
    default:
      return `${title} is contributing to the broader execution pressure.`;
  }
}

export function synthesizePrimaryNarrative(
  decisions: PersistedDecisionObject[],
): PrimaryNarrative {
  if (decisions.length === 0) {
    return {
      primary_problem:
        'The core problem is a lack of usable decision signals, so the first priority is building enough evidence to diagnose the business confidently.',
      primary_theme: null,
      secondary_problems: [],
      ranked_problems: [],
    };
  }

  const groups = new Map<NarrativeTheme, PersistedDecisionObject[]>();
  const topDecisionByTheme = new Map<NarrativeTheme, PersistedDecisionObject>();
  for (const decision of decisions) {
    const theme = inferTheme(decision);
    const current = groups.get(theme) ?? [];
    current.push(decision);
    groups.set(theme, current);
  }

  const rankedProblems = [...groups.entries()]
    .map(([theme, themeDecisions]) => {
      const sorted = [...themeDecisions].sort((left, right) => {
        const impactDelta = impactScore(right) - impactScore(left);
        if (impactDelta !== 0) return impactDelta;
        return Number(right.confidence_score ?? 0) - Number(left.confidence_score ?? 0);
      });
      const avgImpact = average(themeDecisions.map((decision) => impactScore(decision)));
      const avgConfidence = average(themeDecisions.map((decision) => Number(decision.confidence_score ?? 0)));
      const score = avgImpact * 0.5 + avgConfidence * 100 * 0.25 + themeDecisions.length * 12;

      topDecisionByTheme.set(theme, sorted[0]);

      return {
        theme,
        label: themeLabel(theme),
        score,
        frequency: themeDecisions.length,
        average_impact: avgImpact,
        average_confidence: avgConfidence,
        diagnosis: buildDiagnosisForTheme(theme, sorted.slice(0, 2)),
        supporting_issue_types: [...new Set(sorted.map((decision) => decision.issue_type))].slice(0, 4),
      } satisfies ProblemNarrative;
    })
    .sort((left, right) => right.score - left.score);

  const primary = rankedProblems[0];
  const secondaryProblems = rankedProblems
    .slice(1, 4)
    .map((problem) => buildSecondaryProblem(problem.theme, topDecisionByTheme.get(problem.theme) ?? decisions[0]));

  return {
    primary_problem: primary?.diagnosis ??
      'The core problem is fragmented execution pressure across multiple areas, which is diluting progress.',
    primary_theme: primary?.theme ?? null,
    secondary_problems: secondaryProblems,
    ranked_problems: rankedProblems,
  };
}
