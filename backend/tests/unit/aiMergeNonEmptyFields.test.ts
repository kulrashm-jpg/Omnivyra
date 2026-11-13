/**
 * Scalar '' audit (2026-11-13, e9 ruling (a)): AI chat results merged into the
 * company-profile form must never blank a stored value, and must not inject keys the
 * endpoint doesn't own. One rule (the D3 helper, generalized): incoming non-empty wins,
 * empty keeps current; only each endpoint's known output fields are accepted.
 */
import {
  mergeNonEmptyFields,
  TARGET_CUSTOMER_FIELDS,
  MARKETING_INTELLIGENCE_FIELDS,
} from '../../../utils/mergeCampaignPurposeIntent';

describe('mergeNonEmptyFields', () => {
  it('an AI blank never overwrites a stored value (generate-marketing-intelligence shape)', () => {
    const stored = { marketing_channels: 'LinkedIn, Email', key_messages: 'Save 10h a week' };
    const ai = { marketing_channels: '', content_strategy: 'Weekly blog + 2 posts', key_messages: '   ' };
    expect(mergeNonEmptyFields(stored, ai, MARKETING_INTELLIGENCE_FIELDS)).toEqual({
      marketing_channels: 'LinkedIn, Email',
      content_strategy: 'Weekly blog + 2 posts',
      key_messages: 'Save 10h a week',
    });
  });

  it('a non-empty AI value wins', () => {
    expect(mergeNonEmptyFields({ pricing_model: 'Per seat' }, { pricing_model: 'Usage-based' }, TARGET_CUSTOMER_FIELDS))
      .toEqual({ pricing_model: 'Usage-based' });
  });

  it('an unexpected key is dropped', () => {
    const out = mergeNonEmptyFields({}, { pricing_model: 'Per seat', name: 'Hijacked Co', website_url: 'x' }, TARGET_CUSTOMER_FIELDS);
    expect(out).toEqual({ pricing_model: 'Per seat' });
    expect(out).not.toHaveProperty('name');
    expect(out).not.toHaveProperty('website_url');
  });

  it('a blank for a never-filled field stays absent (null stays null, never becomes "")', () => {
    const out = mergeNonEmptyFields({ sales_cycle: null }, { sales_cycle: '', avg_deal_size: '' }, TARGET_CUSTOMER_FIELDS);
    expect(out).toEqual({ sales_cycle: null });
    expect(out).not.toHaveProperty('avg_deal_size');
  });

  it('fields the AI did not return are untouched', () => {
    expect(mergeNonEmptyFields({ growth_priorities: 'EU expansion' }, { campaign_focus: 'Q1 launch' }, MARKETING_INTELLIGENCE_FIELDS))
      .toEqual({ campaign_focus: 'Q1 launch' });
  });

  it('field lists match the endpoints that produce them', () => {
    const src = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8') as string;
    for (const f of TARGET_CUSTOMER_FIELDS) expect(src('pages/api/company-profile/define-target-customer.ts')).toContain(`'${f}'`);
    for (const f of MARKETING_INTELLIGENCE_FIELDS) {
      expect(src('pages/api/company-profile/generate-marketing-intelligence.ts')).toContain(`'${f}'`);
      expect(src('pages/api/company-profile/define-marketing-intelligence.ts')).toContain(`'${f}'`);
    }
  });
});

describe('useCompanyProfileState merge sites (one per AI endpoint)', () => {
  const hook = require('fs').readFileSync(require('path').join(process.cwd(), 'hooks/useCompanyProfileState.tsx'), 'utf8') as string;

  it('no AI result is spread raw into the profile anymore', () => {
    expect(hook).not.toMatch(/\.\.\.data\.structuredFields/);
    expect(hook).not.toMatch(/\.\.\.structuredFields\b/);
  });

  it('target customer merges through TARGET_CUSTOMER_FIELDS', () => {
    expect(hook).toMatch(/mergeNonEmptyFields\(activeProfile, data\.structuredFields, TARGET_CUSTOMER_FIELDS\)/);
  });

  it('define + generate marketing intelligence merge through MARKETING_INTELLIGENCE_FIELDS', () => {
    expect(hook).toMatch(/mergeNonEmptyFields\(activeProfile, data\.structuredFields, MARKETING_INTELLIGENCE_FIELDS\)/);
    expect(hook).toMatch(/mergeNonEmptyFields\(activeProfile, structuredFields, MARKETING_INTELLIGENCE_FIELDS\)/);
  });

  it('problem & transformation: an AI [] never replaces a stored list (both sites, both lists)', () => {
    for (const f of ['pain_symptoms', 'authority_domains']) {
      const ok = hook.match(new RegExp(String.raw`${f}: Array\.isArray\(sf\.${f}\) && sf\.${f}\.length > 0 \? sf\.${f}`, 'g')) ?? [];
      expect(ok).toHaveLength(2);
      expect(hook).not.toMatch(new RegExp(String.raw`${f}: Array\.isArray\(sf\.${f}\) \? sf\.${f}`));
    }
  });
});
