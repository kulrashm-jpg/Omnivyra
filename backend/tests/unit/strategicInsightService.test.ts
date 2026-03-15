/**
 * Unit tests for Strategic Insight Engine
 */

import {
  generateStrategicInsights,
  type StrategicInsightInput,
} from '../../services/strategicInsightService';

describe('strategicInsightService', () => {
  it('returns report with report_id, generated_at, campaign_id, company_id, insights', async () => {
    const input: StrategicInsightInput = {
      company_id: 'c-1',
      campaign_id: 'camp-1',
      campaign_health_report: null,
      engagement_health_report: { engagement_rate: 0.1 },
      trend_signals: [],
      inbox_signals: [],
    };
    const report = await generateStrategicInsights(input);
    expect(report).toMatchObject({
      campaign_id: 'camp-1',
      company_id: 'c-1',
      insights: expect.any(Array),
    });
    expect(report.report_id).toBeDefined();
    expect(report.generated_at).toBeDefined();
    expect(typeof report.report_id).toBe('string');
    expect(typeof report.generated_at).toBe('string');
  });

  it('generates CTA/metadata insight when has_metadata_issues and low reply rate', async () => {
    const input: StrategicInsightInput = {
      company_id: 'c-1',
      campaign_id: 'camp-1',
      campaign_health_report: {
        health_flags: { has_metadata_issues: true },
        health_score: 55,
      },
      engagement_health_report: { engagement_rate: 0.02 },
      trend_signals: [],
      inbox_signals: [],
    };
    const report = await generateStrategicInsights(input);
    const ctaInsight = report.insights.find(
      (i) => i.insight_type === 'engagement_risk' && i.title.includes('CTA')
    );
    expect(ctaInsight).toBeDefined();
    expect(ctaInsight?.confidence).toBeGreaterThanOrEqual(0);
    expect(ctaInsight?.confidence).toBeLessThanOrEqual(1);
    expect(ctaInsight?.recommended_action).toBeDefined();
  });

  it('generates market_opportunity when trend topic not in narrative', async () => {
    const input: StrategicInsightInput = {
      company_id: 'c-1',
      campaign_id: 'camp-1',
      campaign_health_report: { health_summary: 'fitness wellness', top_issue_categories: [] },
      engagement_health_report: { engagement_rate: 0.1 },
      trend_signals: [
        { snapshot: { emerging_trends: [{ topic: 'AI automation' }] } },
      ],
      inbox_signals: [],
    };
    const report = await generateStrategicInsights(input);
    const opp = report.insights.find(
      (i) => i.insight_type === 'market_opportunity' && i.summary.toLowerCase().includes('ai automation')
    );
    expect(opp).toBeDefined();
    expect(opp?.confidence).toBeGreaterThanOrEqual(0);
    expect(opp?.confidence).toBeLessThanOrEqual(1);
  });

  it('sorts insights by impact_score DESC then confidence DESC', async () => {
    const input: StrategicInsightInput = {
      company_id: 'c-1',
      campaign_id: 'camp-1',
      campaign_health_report: {
        health_flags: { has_metadata_issues: true },
        health_score: 35,
      },
      engagement_health_report: { engagement_rate: 0.01 },
      trend_signals: [
        { snapshot: { emerging_trends: [{ topic: 'Web3' }] } },
      ],
      inbox_signals: [{ thread_id: 't1' }],
    };
    const report = await generateStrategicInsights(input);
    for (let i = 1; i < report.insights.length; i++) {
      const prev = report.insights[i - 1];
      const curr = report.insights[i];
      const impactOk = (prev.impact_score ?? 0) >= (curr.impact_score ?? 0);
      const confOk =
        prev.impact_score === curr.impact_score
          ? prev.confidence >= curr.confidence
          : true;
      expect(impactOk && confOk).toBe(true);
    }
  });

  it('includes impact_score (0–100) and insight_category on each insight', async () => {
    const input: StrategicInsightInput = {
      company_id: 'c-1',
      campaign_id: 'camp-1',
      campaign_health_report: {
        health_flags: { has_metadata_issues: true },
        health_score: 40,
      },
      engagement_health_report: { engagement_rate: 0.01 },
      trend_signals: [{ snapshot: { emerging_trends: [{ topic: 'X' }] } }],
      inbox_signals: [{ thread_id: 't1' }],
    };
    const report = await generateStrategicInsights(input);
    const allowedCategories = new Set([
      'campaign_structure',
      'audience_behavior',
      'market_trend',
      'engagement_performance',
      'content_strategy',
    ]);
    for (const i of report.insights) {
      expect(typeof i.impact_score).toBe('number');
      expect(i.impact_score).toBeGreaterThanOrEqual(0);
      expect(i.impact_score).toBeLessThanOrEqual(100);
      expect(allowedCategories.has(i.insight_category)).toBe(true);
    }
  });

  it('uses allowed insight_type values only', async () => {
    const allowed = new Set([
      'campaign_direction',
      'content_strategy',
      'audience_shift',
      'market_opportunity',
      'engagement_risk',
    ]);
    const input: StrategicInsightInput = {
      company_id: 'c-1',
      campaign_id: 'camp-1',
      campaign_health_report: {
        health_flags: { has_metadata_issues: true },
        health_score: 40,
      },
      engagement_health_report: { engagement_rate: 0.01 },
      trend_signals: [{ snapshot: { emerging_trends: [{ topic: 'X' }] } }],
      inbox_signals: [{ thread_id: 't1' }],
    };
    const report = await generateStrategicInsights(input);
    for (const i of report.insights) {
      expect(allowed.has(i.insight_type)).toBe(true);
    }
  });
});
