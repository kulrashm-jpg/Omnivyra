import type { PersistedDecisionObject } from './decisionObjectService';

type BusinessImpactInput = {
  issueType?: string | null;
  actionType?: string | null;
  title?: string | null;
  impactTraffic?: number | null;
  impactConversion?: number | null;
  impactRevenue?: number | null;
};

function topTwoImpacts(params: BusinessImpactInput): Array<'traffic' | 'conversion' | 'revenue'> {
  const ranked = [
    { key: 'traffic' as const, value: Number(params.impactTraffic ?? 0) },
    { key: 'conversion' as const, value: Number(params.impactConversion ?? 0) },
    { key: 'revenue' as const, value: Number(params.impactRevenue ?? 0) },
  ]
    .sort((left, right) => right.value - left.value)
    .filter((entry) => entry.value > 0);

  return ranked.slice(0, 2).map((entry) => entry.key);
}

function impactPhrase(impact: 'traffic' | 'conversion' | 'revenue'): string {
  switch (impact) {
    case 'traffic':
      return 'qualified traffic';
    case 'conversion':
      return 'conversion from high-intent visitors';
    case 'revenue':
      return 'pipeline and revenue capture';
    default:
      return 'commercial performance';
  }
}

function likelyVerb(issueType: string, actionType: string, title: string): string {
  const haystack = `${issueType} ${actionType} ${title}`.toLowerCase();

  if (/(cta|conversion|dropoff|lead|journey|funnel|pricing|contact|demo|signup)/.test(haystack)) {
    return 'reduces';
  }

  if (/(trust|credib|testimonial|proof|authority|backlink|reputation)/.test(haystack)) {
    return 'weakens';
  }

  if (/(content|topic|keyword|seo|search|ranking|geo|local|aeo)/.test(haystack)) {
    return 'limits';
  }

  return 'suppresses';
}

function joinImpactPhrases(impacts: Array<'traffic' | 'conversion' | 'revenue'>): string {
  if (impacts.length === 0) return 'commercial performance';
  if (impacts.length === 1) return impactPhrase(impacts[0]);
  return `${impactPhrase(impacts[0])} and ${impactPhrase(impacts[1])}`;
}

export function buildBusinessImpact(params: BusinessImpactInput): string {
  const issueType = String(params.issueType ?? '').trim();
  const actionType = String(params.actionType ?? '').trim();
  const title = String(params.title ?? '').trim();
  const impacts = topTwoImpacts(params);
  const verb = likelyVerb(issueType, actionType, title);
  const impactLabel = joinImpactPhrases(impacts);

  if (/(cta|conversion|dropoff|lead|journey|funnel|pricing|contact|demo|signup)/i.test(`${issueType} ${actionType} ${title}`)) {
    return `This gap likely ${verb} ${impactLabel} by adding friction when buyers are closest to taking action.`;
  }

  if (/(trust|credib|testimonial|proof|authority|backlink|reputation|brand)/i.test(`${issueType} ${title}`)) {
    return `This gap likely ${verb} ${impactLabel} because buyers and search systems see less proof and credibility than they need.`;
  }

  if (/(content|topic|keyword|seo|search|ranking|geo|local|aeo|intent)/i.test(`${issueType} ${title}`)) {
    return `This gap likely ${verb} ${impactLabel} by making the business harder to discover and harder to match to buyer intent.`;
  }

  return `This gap likely ${verb} ${impactLabel} if it remains unresolved.`;
}

export function buildDecisionBusinessImpact(decision: PersistedDecisionObject): string {
  return buildBusinessImpact({
    issueType: decision.issue_type,
    actionType: decision.action_type,
    title: decision.title,
    impactTraffic: decision.impact_traffic,
    impactConversion: decision.impact_conversion,
    impactRevenue: decision.impact_revenue,
  });
}
