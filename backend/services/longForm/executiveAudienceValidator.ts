export interface ExecutiveAudienceValidationResult {
  score: number;
  passed: boolean;
  primaryAudience: string;
  businessImplicationSignals: string[];
  issues: string[];
}

const AUDIENCE_TERMS = [
  'founder',
  'ceo',
  'cmo',
  'vp',
  'director',
  'department head',
  'strategic buyer',
  'executive',
  'leader',
  'leadership',
];

const BUSINESS_IMPLICATION_TERMS = [
  'revenue',
  'margin',
  'pipeline',
  'budget',
  'risk',
  'cost',
  'retention',
  'conversion',
  'sales cycle',
  'operating model',
  'resource allocation',
  'decision',
  'priority',
  'measurement',
  'governance',
  'growth',
  'market',
  'positioning',
  'execution',
  'productivity',
  'adoption',
  'velocity',
  'operational',
  'operating',
];

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function validateExecutiveAudience(input: {
  contentHtml: string;
  primaryAudience: string;
}): ExecutiveAudienceValidationResult {
  const text = stripHtml(input.contentHtml).toLowerCase();
  const matchedAudienceTerms = AUDIENCE_TERMS.filter((term) => text.includes(term));
  const businessImplicationSignals = BUSINESS_IMPLICATION_TERMS.filter((term) => text.includes(term));
  const implicationDensity = Math.min(60, businessImplicationSignals.length * 5);
  const audienceScore = matchedAudienceTerms.length > 0 ? 20 : 0;
  const actionScore = /should|must|prioritize|stop|avoid|measure|decide|sequence|invest|allocate|choose/.test(text) ? 15 : 0;
  const tradeoffScore = /tradeoff|risk|cost|avoid|instead|failure mode|constraint|what to stop|what to sequence/.test(text) ? 10 : 0;
  const score = Math.min(100, implicationDensity + audienceScore + actionScore + tradeoffScore);
  const issues: string[] = [];
  if (matchedAudienceTerms.length === 0) issues.push('No clear executive audience language.');
  if (businessImplicationSignals.length < 6) issues.push('Insufficient business implications.');
  if (actionScore === 0) issues.push('Does not tell leaders what to do differently.');

  return {
    score,
    passed: score >= 75,
    primaryAudience: input.primaryAudience,
    businessImplicationSignals,
    issues,
  };
}
