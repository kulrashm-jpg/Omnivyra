import { buildGenerationReview, stageGlyph } from '../../../lib/creator-templates';

const diag = (over: any = {}) => ({
  generation: { assetType: 'infographic', platform: 'linkedin', durationMs: 8200, ...over.generation },
  template: { id: 'sys-infographic-statistics', name: 'Statistics', version: 1, assetFamily: 'infographic', ...over.template },
  contentValidation: { warnings: [], missingRequiredTerms: [], ...over.contentValidation },
  rendering: { width: 1080, height: 1350, layoutProfile: 'stats', brandingProfile: 'balanced', ...over.rendering },
  visualValidation: { passed: true, checks: {}, failures: [], ...over.visualValidation },
  scores: { overallReadiness: { value: 88, reason: 'ok' }, brandCompliance: { value: 90 }, ...over.scores },
});
const okResult = (over: any = {}) => ({
  success: true,
  primary_platform: 'linkedin',
  persisted_asset_id: 'asset-1',
  output: {
    asset_type: 'infographic',
    asset_instruction: { template_id: 'sys-infographic-statistics', blueprint: { a: 1 }, structure: { sections: 3 } },
    asset_payload: { media_bundle: { url: 'https://cdn/x.png', files: ['https://cdn/x.png'], metadata: { creator_diagnostic_report: diag(over.diag), applied_variant: over.applied_variant } } },
  },
  ...over.top,
});

describe('CREATOR-010 generation review (deterministic, read-only)', () => {
  it('success: all stages done, one completed asset, summary + quality', () => {
    const m = buildGenerationReview({ result: okResult() });
    expect(m.overall).toBe('success');
    expect(m.stages.length).toBe(9);
    expect(m.stages.every((s) => s.status === 'done')).toBe(true);
    expect(m.assets.length).toBe(1);
    expect(m.assets[0].status).toBe('completed');
    expect(m.assets[0].previewUrl).toBe('https://cdn/x.png');
    expect(m.assets[0].template).toBe('Statistics');
    expect(m.assets[0].layout).toBe('stats');
    expect(m.summary.timeTakenMs).toBe(8200);
    expect(m.summary.successful).toBe(1);
    expect(m.summary.failed).toBe(0);
    expect(m.summary.templateUsed).toBe('Statistics');
    expect(m.quality.renderingCompleted).toBe(true);
    expect(m.quality.templateValidationPassed).toBe(true);
  });

  it('in-progress: stages active/pending, asset shows rendering', () => {
    const m = buildGenerationReview({ result: { output: { asset_instruction: { template_id: 't' } } }, inProgress: true, progressStatus: 'active' });
    expect(m.overall).toBe('in_progress');
    expect(m.assets[0].status).toBe('rendering');
    expect(m.stages.some((s) => s.status === 'active' || s.status === 'pending')).toBe(true);
  });

  it('failure: humanised reason, retryable, never leaks the raw error', () => {
    const raw = 'Error: render_job_timeout_60000ms at Object.<anonymous> (/srv/worker.js:42)';
    const m = buildGenerationReview({ result: { success: false, output: {} }, error: raw });
    expect(m.overall).toBe('failed');
    expect(m.failures.length).toBeGreaterThan(0);
    const f = m.failures[0];
    expect(f.stage).toBe('Rendering');
    expect(f.retryable).toBe(true);
    expect(f.reason).toMatch(/timed out/i);
    // no stack trace / internals leaked
    expect(JSON.stringify(m)).not.toMatch(/worker\.js|Object\.<anonymous>|render_job_timeout/);
    expect(m.stages.find((s) => s.key === 'asset_rendered')!.status).toBe('failed');
  });

  it('maps validation/publishing/renderer failures to friendly stages', () => {
    expect(buildGenerationReview({ result: {}, error: 'forbidden claim rejected by rule' }).failures[0].stage).toBe('Validation');
    expect(buildGenerationReview({ result: {}, error: 'publishing unavailable' }).failures[0].stage).toBe('Publishing');
    expect(buildGenerationReview({ result: {}, error: 'renderer unavailable dead_letter' }).failures[0].stage).toBe('Rendering');
  });

  it('multi-asset campaign: per-asset status + partial detection', () => {
    const r = okResult();
    (r as any).generated_assets = [
      { rank: 0, variant_family: 'mvp', ok: true, persisted_asset_id: 'a0', asset_type: 'image' },
      { rank: 1, variant_family: 'risk', ok: false, error: 'render timeout', asset_type: 'carousel' },
    ];
    const m = buildGenerationReview({ result: r });
    expect(m.overall).toBe('partial');
    expect(m.assets.length).toBe(2);
    expect(m.assets[0].status).toBe('completed');
    expect(m.assets[1].status).toBe('failed');
    expect(m.assets[1].failure?.stage).toBe('Rendering');
    expect(m.summary.successful).toBe(1);
    expect(m.summary.failed).toBe(1);
    expect(m.summary.variantUsed).toBe('mvp');
  });

  it('warnings flow from existing validation into summary + quality', () => {
    const m = buildGenerationReview({ result: okResult({ diag: { contentValidation: { warnings: ['Tone softened'], missingRequiredTerms: ['ROI'] }, visualValidation: { passed: true, failures: [{ message: 'tight margin' }] } } }) });
    expect(m.summary.warnings).toBeGreaterThanOrEqual(3);
    expect(m.quality.warnings.join(' ')).toMatch(/ROI|Tone|margin/);
    expect(m.quality.templateValidationPassed).toBe(false); // missing required term
  });

  it('stage glyphs + determinism', () => {
    expect(stageGlyph('done')).toBe('✓');
    expect(stageGlyph('failed')).toBe('✕');
    const a = buildGenerationReview({ result: okResult() });
    const b = buildGenerationReview({ result: okResult() });
    expect(a).toEqual(b);
  });
});
