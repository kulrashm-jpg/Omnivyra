/**
 * PHASE ACTIVITY-AI-ISOLATION — per-card AI suggestions in ACTIVITY_DETAIL_MODE
 * must derive ONLY from the variant + platform, never from campaign-level
 * strategic memory. The card passes `memoryProfile = undefined` in activity mode
 * and the real profile in campaign mode; this verifies the resulting behavior.
 */
import { computeVariantIntelligence } from '../../../lib/intelligence/executionIntelligence';
import { rankSuggestionsByMemory } from '../../../lib/intelligence/strategicMemory';
import type { StrategicMemoryProfile } from '../../../lib/intelligence/strategicMemory';
import {
  isActivityDetailMode,
  ACTIVITY_DETAIL_MODE,
  CAMPAIGN_WORKSPACE,
} from '../../../lib/shared/activityWorkspaceMode';

// A variant whose long single-line content (>120 chars, first line >100) yields
// IMPROVE_HOOK, and the absence of discoverability_meta yields ADD_DISCOVERABILITY.
const VARIANT = {
  platform: 'linkedin',
  content_type: 'post',
  generated_content:
    'This is a single very long opening line that exceeds one hundred characters so the hook suggestion is triggered for sure here.',
};

// Campaign-scoped strategic memory: ranks ADD_DISCOVERABILITY above IMPROVE_HOOK.
const CAMPAIGN_MEMORY: StrategicMemoryProfile = {
  campaign_id: 'camp-1',
  action_acceptance_rate: {
    ADD_DISCOVERABILITY: 0.9,
    IMPROVE_HOOK: 0.1,
    IMPROVE_CTA: 0.5,
  } as StrategicMemoryProfile['action_acceptance_rate'],
  platform_confidence_average: { linkedin: 0.8 },
  total_events: 42,
};

describe('mode → memory-profile gating (mirrors WorkspacePlatformCard)', () => {
  const memoryForMode = (mode: typeof ACTIVITY_DETAIL_MODE | typeof CAMPAIGN_WORKSPACE) =>
    isActivityDetailMode(mode) ? undefined : CAMPAIGN_MEMORY;

  it('A. activity mode strips strategicMemoryProfile (→ undefined)', () => {
    expect(memoryForMode(ACTIVITY_DETAIL_MODE)).toBeUndefined();
  });

  it('B. campaign mode preserves strategicMemoryProfile', () => {
    expect(memoryForMode(CAMPAIGN_WORKSPACE)).toBe(CAMPAIGN_MEMORY);
  });
});

describe('computeVariantIntelligence — activity (no memory) vs campaign (memory)', () => {
  const activity = computeVariantIntelligence(VARIANT, 'linkedin', undefined);
  const campaign = computeVariantIntelligence(VARIANT, 'linkedin', CAMPAIGN_MEMORY);

  it('C. activity suggestions still render (campaign-memory stripped)', () => {
    expect(activity.strategist_suggestions.length).toBeGreaterThan(0);
    expect(typeof activity.confidence_score).toBe('number');
  });

  it('D. activity suggestions derive from variant/platform inputs (variant change → different result)', () => {
    const other = computeVariantIntelligence({ ...VARIANT, generated_content: '' }, 'linkedin', undefined);
    // Different variant content → different computed intelligence (variant-driven, not campaign-driven).
    expect(other).not.toEqual(activity);
  });

  it('E. campaign memory materially changes displayed suggestions; activity mode strips that dependency', () => {
    const activityActions = activity.strategist_suggestions.map((s) => s.action);
    const campaignActions = campaign.strategist_suggestions.map((s) => s.action);
    // Both modes render suggestions...
    expect(activityActions.length).toBeGreaterThan(0);
    expect(campaignActions.length).toBeGreaterThan(0);
    // ...but campaign-memory ranking changes WHICH/ORDER surface — proving the
    // campaign dependency, which ACTIVITY_DETAIL_MODE (undefined memory) removes.
    expect(campaignActions).not.toEqual(activityActions);
    // campaign mode surfaces the high-acceptance action; activity mode does not.
    expect(campaignActions).toContain('ADD_DISCOVERABILITY');
    expect(activityActions).not.toContain('ADD_DISCOVERABILITY');
  });
});

describe('rankSuggestionsByMemory — isolation mechanism (null-safe)', () => {
  const suggestions = [
    { action: 'IMPROVE_HOOK' as const },
    { action: 'ADD_DISCOVERABILITY' as const },
  ];

  it('undefined/null profile → suggestions returned UNRANKED (activity mode)', () => {
    expect(rankSuggestionsByMemory(suggestions, undefined).map((s) => s.action)).toEqual([
      'IMPROVE_HOOK',
      'ADD_DISCOVERABILITY',
    ]);
    expect(rankSuggestionsByMemory(suggestions, null).map((s) => s.action)).toEqual([
      'IMPROVE_HOOK',
      'ADD_DISCOVERABILITY',
    ]);
  });

  it('profile present → reorders by acceptance rate (campaign mode)', () => {
    expect(rankSuggestionsByMemory(suggestions, CAMPAIGN_MEMORY).map((s) => s.action)).toEqual([
      'ADD_DISCOVERABILITY',
      'IMPROVE_HOOK',
    ]);
  });
});
