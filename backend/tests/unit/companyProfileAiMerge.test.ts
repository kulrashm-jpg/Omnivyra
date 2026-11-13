/**
 * e1 2026-11-13 - D3 + the generate-marketing-intelligence fallback. AI results are SPREAD into the profile by the
 * client, so the server must return: whitelisted keys only, a blank AI value -> the stored value, no value either way
 * -> the key OMITTED (never '' - it overwrites and reads as a deliberate clear), and the FULL campaign_purpose_intent.
 */
const mockRunCompletion = jest.fn();
jest.mock('../../services/aiGateway', () => ({ runCompletion: (...a: unknown[]) => mockRunCompletion(...a) }));
const mockProfile: { current: any } = { current: null };
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: async () => mockProfile.current }));
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: async () => ({ userId: 'u-1' }) }));
const mockDraft: { current: Record<string, unknown> } = { current: {} };
jest.mock('../../services/companyProfileService', () => ({
  getProfile: async () => mockProfile.current,
  MARKETING_INTELLIGENCE_FIELD_NAMES: ['marketing_channels'],
  generateMarketingIntelligenceDraft: async () => mockDraft.current,
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({ insert: async () => ({ error: null }) }) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

/* eslint-disable @typescript-eslint/no-var-requires */
export {};
const { mergeAiScalarFields, mergeCampaignPurposeIntent } = require('../../services/companyProfile/aiProfileMerge');
const defineTargetCustomer = require('../../../pages/api/company-profile/define-target-customer').default;
const generateMi = require('../../../pages/api/company-profile/generate-marketing-intelligence').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function mkRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => undefined;
  return res;
}

const STORED_CPI = {
  primary_objective: 'Grow pipeline', campaign_intent: 'Awareness', monetization_intent: 'Subscriptions',
  dominant_problem_domains: ['churn'], brand_positioning_angle: 'Trusted',
  reader_emotion_target: 'confident', narrative_flow_seed: { pattern: 'problem-solution', steps: ['hook', 'proof'] },
  recommended_cta_style: 'Soft',
};

describe('mergeAiScalarFields', () => {
  it('non-empty AI wins; blank AI keeps stored; neither -> key omitted (never ""); unknown keys dropped', () => {
    const out = mergeAiScalarFields(['a', 'b', 'c'], { a: ' new ', b: '   ', c: '', evil: 'x' }, { a: 'old', b: 'kept' });
    expect(out).toEqual({ a: 'new', b: 'kept' });
    expect(out).not.toHaveProperty('c');
    expect(out).not.toHaveProperty('evil');
  });
});

describe('mergeCampaignPurposeIntent', () => {
  it('keeps ALL 8 stored keys, overlays only the AI\'s non-empty values', () => {
    const out = mergeCampaignPurposeIntent(STORED_CPI, { primary_objective: 'Win enterprise', campaign_intent: '', dominant_problem_domains: [] });
    expect(out).toEqual({ ...STORED_CPI, primary_objective: 'Win enterprise' });
  });
  it('a non-empty AI domain list wins (strings only, trimmed)', () => {
    expect(mergeCampaignPurposeIntent(STORED_CPI, { dominant_problem_domains: [' cost ', 3, ''] })!.dominant_problem_domains).toEqual(['cost']);
  });
  it('nothing stored and nothing from the AI -> null', () => {
    expect(mergeCampaignPurposeIntent(null, { primary_objective: '  ' })).toBeNull();
  });
});

describe('POST /api/company-profile/define-target-customer (done)', () => {
  it('returns the FULL campaign_purpose_intent and whitelisted, never-blank structuredFields', async () => {
    mockProfile.current = { target_customer_segment: 'SMB SaaS', pricing_model: 'Per seat', campaign_purpose_intent: STORED_CPI };
    mockRunCompletion.mockResolvedValue({ output: JSON.stringify({
      done: true,
      structuredFields: { target_customer_segment: '', ideal_customer_profile: 'Ops leads', sales_cycle: '', invented_key: 'x' },
      campaign_purpose_intent: { primary_objective: 'Win enterprise', campaign_intent: '', monetization_intent: '', dominant_problem_domains: [], brand_positioning_angle: '' },
    }) });
    const res = mkRes();
    await defineTargetCustomer({ method: 'POST', query: { companyId: 'c-1' }, headers: {}, body: { conversation: [] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.structuredFields).toEqual({ target_customer_segment: 'SMB SaaS', ideal_customer_profile: 'Ops leads', pricing_model: 'Per seat' });
    expect(Object.values(res.body.structuredFields)).not.toContain('');
    expect(res.body.campaign_purpose_intent).toEqual({ ...STORED_CPI, primary_objective: 'Win enterprise' });
    for (const k of ['reader_emotion_target', 'narrative_flow_seed', 'recommended_cta_style']) {
      expect(res.body.campaign_purpose_intent[k]).toEqual((STORED_CPI as any)[k]);
    }
  });
});

describe('POST /api/company-profile/generate-marketing-intelligence', () => {
  it('an empty draft field keeps the stored value; empty in both -> omitted (never "")', async () => {
    mockProfile.current = { marketing_channels: 'LinkedIn, email', content_strategy: 'Thought leadership' };
    mockDraft.current = { marketing_channels: '', content_strategy: 'Case studies', campaign_focus: '  ' };
    const res = mkRes();
    await generateMi({ method: 'POST', query: { companyId: 'c-1' }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.structuredFields).toEqual({ marketing_channels: 'LinkedIn, email', content_strategy: 'Case studies' });
    expect(Object.values(res.body.structuredFields)).not.toContain('');
  });
});
