import { buildCreatorBlueprintPromptSpecification } from '../../services/creator/creatorPromptSpecification';

const baseCreatorContext = {
  content_theme: 'engaging',
  campaign_description: 'Creator campaign execution',
  brand_visual_tone: 'professional',
  visual_style: 'modern professional',
  target_platforms: ['linkedin'],
  supporting_asset_type: 'carousel',
  slide_count: 5,
  narrative_arc: 'problem -> insight -> action',
} as unknown as Parameters<typeof buildCreatorBlueprintPromptSpecification>[0]['creatorContext'];

function spec(overrides: Partial<Parameters<typeof buildCreatorBlueprintPromptSpecification>[0]> = {}) {
  return buildCreatorBlueprintPromptSpecification({
    assetType: 'carousel',
    blueprintType: 'carousel' as any,
    creatorContext: baseCreatorContext,
    promptInput: { topic: 'How routing works', asset_type: 'carousel' },
    templateAlignmentInstruction: 'ALIGN-RULE',
    ...overrides,
  });
}

describe('Canonical Prompt Specification — engine consumes spec, not internal prompt', () => {
  it('produces a two-message spec with the canonical operation + LLM params', () => {
    const s = spec();
    expect(s.operation).toBe('creator_execution_blueprint_carousel');
    expect(s.temperature).toBe(0);
    expect(s.response_format).toEqual({ type: 'json_object' });
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[1].role).toBe('user');
    expect(s.messages[0].content).toBe(s.system);
    expect(s.messages[1].content).toBe(s.user);
    expect(s.system.length).toBeGreaterThan(0);
  });

  it('user prompt carries the structured input, analytics default, and template alignment', () => {
    const s = spec();
    expect(s.user).toContain('Generate a creator asset blueprint.');
    expect(s.user).toContain('"topic": "How routing works"');
    expect(s.user).toContain('No analytics/search intelligence is available');
    expect(s.user).toContain('Template alignment rule:');
    expect(s.user).toContain('ALIGN-RULE');
    expect(s.user.trim().endsWith('Return JSON only.')).toBe(true);
  });

  it('image blueprint adds the single-image output rule and reuses the system factory', () => {
    const s = spec({ assetType: 'image', blueprintType: 'image', promptInput: { asset_type: 'image' } });
    expect(s.operation).toBe('creator_execution_blueprint_image');
    expect(s.user).toContain('Single-image output rule');
    expect(s.system.length).toBeGreaterThan(0); // image reuses video_script factory
  });

  it('non-image blueprint omits the single-image rule', () => {
    expect(spec().user).not.toContain('Single-image output rule');
  });

  it('analytics block + retry hints are threaded when provided', () => {
    const s = spec({
      analyticsPromptBlock: 'USE-TRENDS',
      analyticsLowConfidenceNote: 'low-conf',
      completionRetryHint: 'RETRY-COMPLETION',
      qualityRetryHint: 'RETRY-QUALITY',
    });
    expect(s.user).toContain('USE-TRENDS');
    expect(s.user).toContain('Confidence note: low-conf');
    expect(s.user).toContain('RETRY-COMPLETION');
    expect(s.user).toContain('RETRY-QUALITY');
  });
});
