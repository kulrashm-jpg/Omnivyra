/**
 * Unit tests for Opportunity Detection Engine
 */

import {
  detectOpportunities,
  type OpportunityDetectionInput,
} from '../../services/opportunityDetectionService';

describe('opportunityDetectionService', () => {
  it('returns report with report_id, generated_at, company_id, opportunities', async () => {
    const input: OpportunityDetectionInput = {
      company_id: 'c-1',
      trend_signals: [],
      engagement_health_report: null,
      strategic_insight_report: null,
      inbox_signals: [],
    };
    const report = await detectOpportunities(input);
    expect(report).toMatchObject({
      company_id: 'c-1',
      opportunities: expect.any(Array),
    });
    expect(report.report_id).toBeDefined();
    expect(report.generated_at).toBeDefined();
  });

  it('generates market_opportunity when trend strength > threshold and topic not covered', async () => {
    const input: OpportunityDetectionInput = {
      company_id: 'c-1',
      trend_signals: [
        {
          snapshot: {
            emerging_trends: [{ topic: 'AI automation', strength: 0.8 }],
          },
        },
      ],
      engagement_health_report: null,
      strategic_insight_report: { insights: [] },
      inbox_signals: [],
    };
    const report = await detectOpportunities(input);
    const opp = report.opportunities.find(
      (o) => o.opportunity_type === 'market_opportunity' && o.description.toLowerCase().includes('ai automation')
    );
    expect(opp).toBeDefined();
    expect(opp?.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(opp?.opportunity_score).toBeLessThanOrEqual(100);
    expect(opp?.confidence).toBeGreaterThanOrEqual(0);
    expect(opp?.confidence).toBeLessThanOrEqual(1);
  });

  it('converts strategic insight market_trend to opportunity', async () => {
    const input: OpportunityDetectionInput = {
      company_id: 'c-1',
      trend_signals: [],
      engagement_health_report: null,
      strategic_insight_report: {
        insights: [
          {
            title: 'Emerging trend not reflected',
            summary: 'Trend X is not reflected.',
            insight_category: 'market_trend',
            confidence: 0.8,
            recommended_action: 'Add trend X',
            supporting_signals: ['trend.emerging'],
          },
        ],
      },
      inbox_signals: [],
    };
    const report = await detectOpportunities(input);
    const opp = report.opportunities.find((o) => o.opportunity_type === 'market_opportunity');
    expect(opp).toBeDefined();
  });

  it('sorts by opportunity_score DESC then confidence DESC', async () => {
    const input: OpportunityDetectionInput = {
      company_id: 'c-1',
      trend_signals: [
        { snapshot: { emerging_trends: [{ topic: 'A', strength: 0.9 }] } },
        { snapshot: { emerging_trends: [{ topic: 'B', strength: 0.6 }] } },
      ],
      engagement_health_report: null,
      strategic_insight_report: null,
      inbox_signals: [],
    };
    const report = await detectOpportunities(input);
    for (let i = 1; i < report.opportunities.length; i++) {
      const prev = report.opportunities[i - 1];
      const curr = report.opportunities[i];
      const scoreOk = (prev.opportunity_score ?? 0) >= (curr.opportunity_score ?? 0);
      const confOk =
        prev.opportunity_score === curr.opportunity_score
          ? prev.confidence >= curr.confidence
          : true;
      expect(scoreOk && confOk).toBe(true);
    }
  });

  it('includes diagnostic fields: evaluation_duration_ms, signals_analyzed, opportunity_count_total', async () => {
    const input: OpportunityDetectionInput = {
      company_id: 'c-1',
      trend_signals: [{ snapshot: {} }],
      engagement_health_report: null,
      strategic_insight_report: { insights: [{ insight_category: 'other' }] },
      inbox_signals: [{}, {}],
    };
    const report = await detectOpportunities(input);
    expect(typeof report.evaluation_duration_ms).toBe('number');
    expect(report.evaluation_duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof report.signals_analyzed).toBe('number');
    expect(report.signals_analyzed).toBe(1 + 2 + 1);
    expect(report.opportunity_count_total).toBe(report.opportunities.length);
  });

  it('uses allowed opportunity_type values only', async () => {
    const allowed = new Set([
      'content_opportunity',
      'campaign_opportunity',
      'audience_opportunity',
      'market_opportunity',
      'engagement_opportunity',
    ]);
    const input: OpportunityDetectionInput = {
      company_id: 'c-1',
      trend_signals: [{ snapshot: { emerging_trends: [{ topic: 'X', strength: 0.8 }] } }],
      engagement_health_report: { engagement_rate: 0.1 },
      strategic_insight_report: null,
      inbox_signals: [
        { latest_message: 'topic alpha beta', customer_question: true },
        { latest_message: 'topic alpha beta', customer_question: true },
      ],
    };
    const report = await detectOpportunities(input);
    for (const o of report.opportunities) {
      expect(allowed.has(o.opportunity_type)).toBe(true);
    }
  });
});
