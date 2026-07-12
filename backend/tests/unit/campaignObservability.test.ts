/**
 * CAMPAIGN-OPS-001 — campaign observability metric builders (pure).
 */
import {
  buildQualityMetrics,
  buildOptimizationMetrics,
  buildCampaignRunMetrics,
  buildGenerationDurationMetric,
  emitMetrics,
  type MetricSample,
} from '../../services/campaign/campaignObservability';
import { assessCampaignQuality } from '../../../lib/shared/campaign/campaignQuality';
import { optimizeCampaign } from '../../../lib/shared/campaign/campaignOptimizer';

const find = (samples: MetricSample[], name: string) => samples.filter((s) => s.name === name);

describe('quality metrics', () => {
  const assessment = assessCampaignQuality([
    { content_type: 'post', platform: 'linkedin', week: 1, theme: 'A', funnel_stage: 'awareness', cta: 'x', audience: 'y', master_idea_id: 'm1', idea_fingerprint: 'i1', topic_title: 'T1' },
    { content_type: 'article', platform: 'facebook', week: 2, theme: 'B', funnel_stage: 'consideration', cta: 'z', audience: 'y', master_idea_id: 'm2', idea_fingerprint: 'i2', topic_title: 'T2' },
  ]);

  it('emits score, grade, and one sample per dimension', () => {
    const s = buildQualityMetrics(assessment, { mode: 'weekly', campaign_type: 'text' });
    expect(find(s, 'campaign.quality.score')[0].value).toBe(assessment.overall);
    expect(find(s, 'campaign.quality.grade')[0].labels?.grade).toBe(assessment.grade);
    expect(find(s, 'campaign.quality.dimension')).toHaveLength(assessment.dimensions.length);
    // low-cardinality labels only — no campaign_id/company_id
    for (const m of s) expect(Object.keys(m.labels ?? {})).not.toContain('campaign_id');
  });
});

describe('optimization metrics', () => {
  const monotonous = Array.from({ length: 8 }, (_, i) => ({
    content_type: ['post', 'article', 'carousel'][i % 3], platform: 'linkedin', week: (i % 4) + 1,
    theme: 'Onboarding', funnel_stage: 'awareness', cta: 'Book a demo', audience: 'RevOps',
    master_idea_id: `m${i}`, idea_fingerprint: 'same', topic_title: `T${i}`,
  }));

  it('emits before/after/delta/passes + change counts', () => {
    const r = optimizeCampaign(monotonous);
    const s = buildOptimizationMetrics(r, { mode: 'weekly' });
    expect(find(s, 'campaign.optimization.before_score')[0].value).toBe(r.before.overall);
    expect(find(s, 'campaign.optimization.after_score')[0].value).toBe(r.after.overall);
    expect(find(s, 'campaign.optimization.delta')[0].value).toBe(r.delta);
    expect(find(s, 'campaign.optimization.passes')[0].value).toBe(r.passes_run);
    expect(find(s, 'campaign.optimization.changes')[0].value).toBe(r.changes.length);
    // per-pass breakdown present when there were changes
    if (r.changes.length > 0) expect(find(s, 'campaign.optimization.change').length).toBeGreaterThan(0);
  });
});

describe('run + generation metrics', () => {
  it('run metrics: duration histogram + a success OR failure counter', () => {
    const ok = buildCampaignRunMetrics({ durationMs: 1234, success: true }, { campaign_type: 'creator' });
    expect(find(ok, 'campaign.run.duration_ms')[0].value).toBe(1234);
    expect(find(ok, 'campaign.run.success')).toHaveLength(1);
    expect(find(ok, 'campaign.run.failure')).toHaveLength(0);
    const fail = buildCampaignRunMetrics({ durationMs: -5, success: false });
    expect(find(fail, 'campaign.run.duration_ms')[0].value).toBe(0); // clamped
    expect(find(fail, 'campaign.run.failure')).toHaveLength(1);
    // CAMPAIGN-OPS-001A: a failed run emits failure only, never success.
    expect(find(fail, 'campaign.run.success')).toHaveLength(0);
    expect(find(ok, 'campaign.run.failure')).toHaveLength(0);
  });

  it('generation duration metric is labelled by content type + platform', () => {
    const m = buildGenerationDurationMetric(456, { content_type: 'article', platform: 'linkedin' });
    expect(m.name).toBe('campaign.generation.duration_ms');
    expect(m.value).toBe(456);
    expect(m.labels).toMatchObject({ content_type: 'article', platform: 'linkedin' });
  });

  it('emitMetrics never throws', () => {
    expect(() => emitMetrics(buildCampaignRunMetrics({ durationMs: 1, success: true }))).not.toThrow();
    expect(() => emitMetrics([])).not.toThrow();
  });
});
