import {
  buildCompanyContextBlock,
  buildCompanyContextBlockShort,
  buildIdentityLock,
  type CompanyIdentity,
} from '../../../lib/content/companyContextBlock';

/**
 * Brand Program — Phase 0. brand_voice is extracted into CompanyIdentity.brandVoice
 * but was dropped by the context builders (posts/threads/variants/blueprints).
 * These builders must now EMIT brand voice when present, and be byte-identical
 * when absent (additive, omit-when-empty — no behavior change for tenants
 * without brand_voice).
 */
describe('companyContextBlock — brand voice emission', () => {
  const base: CompanyIdentity = {
    companyName: 'Acme',
    industry: 'B2B SaaS',
    targetAudience: 'RevOps leaders',
    uniqueValue: 'cuts onboarding to 5 minutes',
  };
  const withVoice: CompanyIdentity = { ...base, brandVoice: 'dry, direct, contrarian — no hype' };

  it('emits brand voice in all three builders when brandVoice is present', () => {
    expect(buildCompanyContextBlock(withVoice)).toContain('BRAND VOICE: dry, direct, contrarian');
    expect(buildCompanyContextBlockShort(withVoice)).toContain('VOICE: dry, direct, contrarian');
    expect(buildIdentityLock(withVoice, 'post')).toContain('YOUR BRAND VOICE: dry, direct, contrarian');
  });

  it('omits the voice line and is byte-identical when brandVoice is absent', () => {
    expect(buildCompanyContextBlock(base)).not.toMatch(/BRAND VOICE:/);
    expect(buildCompanyContextBlockShort(base)).not.toMatch(/VOICE:/);
    expect(buildIdentityLock(base, 'post')).not.toMatch(/BRAND VOICE:/);

    // Baseline parity: output with brandVoice undefined equals output with the
    // field stripped entirely (no incidental change).
    const stripped: CompanyIdentity = { ...base };
    delete (stripped as { brandVoice?: string }).brandVoice;
    expect(buildCompanyContextBlock(base)).toBe(buildCompanyContextBlock(stripped));
    expect(buildCompanyContextBlockShort(base)).toBe(buildCompanyContextBlockShort(stripped));
    expect(buildIdentityLock(base, 'post')).toBe(buildIdentityLock(stripped, 'post'));
  });

  it('does not emit voice for empty-string brandVoice (falsy guard)', () => {
    const empty: CompanyIdentity = { ...base, brandVoice: '' };
    expect(buildCompanyContextBlock(empty)).not.toMatch(/BRAND VOICE:/);
    expect(buildIdentityLock(empty, 'post')).not.toMatch(/BRAND VOICE:/);
  });
});
