import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import { synthesizePrimaryNarrative } from '../../services/primaryNarrativeService';

function makeDecision(params: {
  id: string;
  issueType: PersistedDecisionObject['issue_type'];
  title: string;
  description: string;
  recommendation: string;
  impactTraffic?: number;
  impactConversion?: number;
  impactRevenue?: number;
  confidenceScore?: number;
  actionType?: PersistedDecisionObject['action_type'];
}): PersistedDecisionObject {
  const now = new Date('2026-03-31T00:00:00.000Z').toISOString();

  return {
    id: params.id,
    company_id: 'company-1',
    report_tier: 'snapshot',
    source_service: 'testService',
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: params.description,
    evidence: { seed: true },
    impact_traffic: params.impactTraffic ?? 50,
    impact_conversion: params.impactConversion ?? 35,
    impact_revenue: params.impactRevenue ?? 25,
    priority_score: 65,
    effort_score: 25,
    execution_score: 60,
    confidence_score: params.confidenceScore ?? 0.8,
    recommendation: params.recommendation,
    action_type: params.actionType ?? 'improve_content',
    action_payload: {},
    status: 'open',
    last_changed_by: 'system',
    created_at: now,
    updated_at: now,
    resolved_at: null,
    ignored_at: null,
  };
}

describe('primaryNarrativeService', () => {
  it('ranks the dominant theme by impact and frequency and returns supporting issues', () => {
    const narrative = synthesizePrimaryNarrative([
      makeDecision({
        id: 'content-1',
        issueType: 'content_gap',
        title: 'High-intent buying pages are missing',
        description: 'The site is under-covered on comparison and solution pages.',
        recommendation: 'Publish comparison and solution pages.',
        impactTraffic: 72,
      }),
      makeDecision({
        id: 'content-2',
        issueType: 'weak_content_depth',
        title: 'Core service pages are too thin',
        description: 'Pages do not answer enough buyer questions to compete.',
        recommendation: 'Expand service-page depth.',
        impactTraffic: 68,
      }),
      makeDecision({
        id: 'trust-1',
        issueType: 'credibility_gap',
        title: 'Proof is too light on money pages',
        description: 'Testimonials and case studies are not visible enough.',
        recommendation: 'Add stronger proof to conversion pages.',
        impactConversion: 63,
        actionType: 'adjust_strategy',
      }),
      makeDecision({
        id: 'conversion-1',
        issueType: 'cta_clarity_gap',
        title: 'Calls to action are too weak',
        description: 'Buyers do not get a strong next step from key pages.',
        recommendation: 'Clarify the CTA hierarchy.',
        impactConversion: 58,
        actionType: 'fix_conversion',
      }),
    ]);

    expect(narrative.primary_theme).toBe('content');
    expect(narrative.primary_problem).toContain('The core problem is weak content coverage');
    expect(narrative.secondary_problems.length).toBeGreaterThanOrEqual(2);
    expect(narrative.ranked_problems[0]?.frequency).toBe(2);
  });
});
