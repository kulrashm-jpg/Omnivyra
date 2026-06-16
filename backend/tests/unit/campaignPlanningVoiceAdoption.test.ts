import { enrichWeeklyWritingContext } from '../../services/campaignAiOrchestrator/structuredPlanTransforms';

/**
 * Phase 2B — campaign/planning voice adoption. The planning tone
 * (weeklyContextCapsule.toneGuidance + topic narrativeStyle) now honors a
 * BrandRuntime-resolved `brandVoiceOverride` (authoritative when a brand_identity
 * row exists, undefined otherwise → legacy chain unchanged).
 */
const run = (prefilled: Record<string, unknown>, brandVoiceOverride?: string) =>
  JSON.stringify(enrichWeeklyWritingContext({
    structured: { weeks: [{ week: 1, theme: 'Theme' }] },
    recommendationContext: null,
    prefilledPlanning: prefilled,
    brandVoiceOverride,
  }));

describe('campaign planning — Phase 2B voice adoption', () => {
  it('brandVoiceOverride is authoritative (beats communication_style + brand_voice)', () => {
    const j = run({ communication_style: 'formal', brand_voice: 'LEGACY_VOICE' }, 'RUNTIME_VOICE');
    expect(j).toContain('RUNTIME_VOICE');
    expect(j).not.toContain('LEGACY_VOICE');
  });

  it('no-row parity: without override the legacy brand_voice is used', () => {
    const j = run({ brand_voice: 'LEGACY_VOICE' });
    expect(j).toContain('LEGACY_VOICE');
    expect(j).not.toContain('RUNTIME_VOICE');
  });

  it('no-row parity: undefined override is byte-identical to omitting it', () => {
    const withUndef = run({ brand_voice: 'LEGACY_VOICE' }, undefined);
    const without = JSON.stringify(enrichWeeklyWritingContext({
      structured: { weeks: [{ week: 1, theme: 'Theme' }] },
      recommendationContext: null,
      prefilledPlanning: { brand_voice: 'LEGACY_VOICE' },
    }));
    expect(withUndef).toBe(without);
  });

  it('default tone preserved when nothing is set', () => {
    expect(run({})).toContain('clear, practical, outcome-driven');
  });
});
