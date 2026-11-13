/**
 * D3 (2026-11-13): "Define target customer" returned 5 of the 8 campaign_purpose_intent
 * keys and the client REPLACED the stored object, erasing reader_emotion_target,
 * narrative_flow_seed and recommended_cta_style. The client now merges: incoming
 * non-empty values win, incoming empty values keep what is stored.
 */
import { mergeCampaignPurposeIntent } from '../../../utils/mergeCampaignPurposeIntent';

const STORED = {
  primary_objective: 'Build authority with CFOs',
  campaign_intent: 'Lead generation',
  monetization_intent: 'Demo bookings',
  dominant_problem_domains: ['cash flow', 'forecasting'],
  brand_positioning_angle: 'The pragmatic finance partner',
  reader_emotion_target: 'Relief',
  narrative_flow_seed: 'Problem → proof → plan',
  recommended_cta_style: 'Soft invite',
};

// Exactly the 5-key shape define-target-customer.ts returns (nulls for undetermined keys).
const TARGET_CUSTOMER_RESULT = {
  primary_objective: 'Win mid-market CFOs',
  campaign_intent: null,
  monetization_intent: 'Annual contracts',
  dominant_problem_domains: [],
  brand_positioning_angle: null,
};

describe('mergeCampaignPurposeIntent (D3)', () => {
  it('keeps the 3 keys the target-customer chat never returns', () => {
    const merged = mergeCampaignPurposeIntent<Record<string, unknown>>(STORED, TARGET_CUSTOMER_RESULT)!;
    expect(merged.reader_emotion_target).toBe('Relief');
    expect(merged.narrative_flow_seed).toBe('Problem → proof → plan');
    expect(merged.recommended_cta_style).toBe('Soft invite');
  });

  it('lets non-empty incoming values win', () => {
    const merged = mergeCampaignPurposeIntent<Record<string, unknown>>(STORED, TARGET_CUSTOMER_RESULT)!;
    expect(merged.primary_objective).toBe('Win mid-market CFOs');
    expect(merged.monetization_intent).toBe('Annual contracts');
  });

  it('never lets an empty incoming value (null, blank, empty array) erase a stored one', () => {
    const merged = mergeCampaignPurposeIntent<Record<string, unknown>>(STORED, {
      ...TARGET_CUSTOMER_RESULT,
      monetization_intent: '   ',
    })!;
    expect(merged.campaign_intent).toBe('Lead generation');
    expect(merged.brand_positioning_angle).toBe('The pragmatic finance partner');
    expect(merged.dominant_problem_domains).toEqual(['cash flow', 'forecasting']);
    expect(merged.monetization_intent).toBe('Demo bookings');
  });

  it('keeps every stored key: no non-empty value is ever dropped', () => {
    const merged = mergeCampaignPurposeIntent<Record<string, unknown>>(STORED, TARGET_CUSTOMER_RESULT)!;
    for (const [key, value] of Object.entries(STORED)) {
      expect(merged[key]).toBeDefined();
      expect(merged[key]).not.toBeNull();
      if (!(key in TARGET_CUSTOMER_RESULT) || TARGET_CUSTOMER_RESULT[key as keyof typeof TARGET_CUSTOMER_RESULT] == null) {
        expect(merged[key]).toEqual(value);
      }
    }
  });

  it('handles a first-time profile (nothing stored) and a missing result', () => {
    expect(mergeCampaignPurposeIntent(null, TARGET_CUSTOMER_RESULT)).toEqual(TARGET_CUSTOMER_RESULT);
    expect(mergeCampaignPurposeIntent(STORED, null)).toEqual(STORED);
    expect(mergeCampaignPurposeIntent(null, null)).toBeNull();
  });

  it('does not mutate the stored object', () => {
    const stored = { ...STORED };
    mergeCampaignPurposeIntent(stored, TARGET_CUSTOMER_RESULT);
    expect(stored).toEqual(STORED);
  });
});

describe('useCompanyProfileState uses the merge at both chat result sites', () => {
  // Source guard: the regression was a direct assignment of the chat result.
  const src = require('fs').readFileSync(
    require('path').join(process.cwd(), 'hooks/useCompanyProfileState.tsx'),
    'utf8',
  ) as string;

  it('never assigns a chat result to campaign_purpose_intent directly', () => {
    expect(src).not.toMatch(/campaign_purpose_intent:\s*data\.campaign_purpose_intent/);
  });

  it('merges at both the target-customer and campaign-purpose sites', () => {
    const calls = src.match(/mergeCampaignPurposeIntent\(activeProfile\.campaign_purpose_intent, data\.campaign_purpose_intent\)/g) ?? [];
    expect(calls).toHaveLength(2);
  });
});
