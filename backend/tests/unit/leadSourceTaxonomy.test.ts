import { resolveCanonicalSource, isCanonicalLeadSource, CANONICAL_LEAD_SOURCES, CANONICAL_LEAD_SOURCE_LABELS } from '../../../lib/leadIntelligence';

describe('Canonical lead-source taxonomy', () => {
  it('has all 14 canonical sources with labels', () => {
    expect(CANONICAL_LEAD_SOURCES).toHaveLength(14);
    for (const src of CANONICAL_LEAD_SOURCES) expect(CANONICAL_LEAD_SOURCE_LABELS[src]).toBeTruthy();
    expect(CANONICAL_LEAD_SOURCE_LABELS.marketpulse).toBe('MarketPulse');
  });

  it('resolves each category from representative signals', () => {
    expect(resolveCanonicalSource({ rawSource: 'form_embed' })).toBe('website');
    expect(resolveCanonicalSource({ rawSource: 'blog' })).toBe('blog');
    expect(resolveCanonicalSource({ platform: 'linkedin' })).toBe('social');
    expect(resolveCanonicalSource({ signalSourceType: 'engagement', platform: 'linkedin' })).toBe('engagement');
    expect(resolveCanonicalSource({ signalSourceType: 'listening', platform: 'reddit' })).toBe('community');
    expect(resolveCanonicalSource({ opportunityType: 'buying_intent' })).toBe('community');
    expect(resolveCanonicalSource({ marketPulseCategory: 'hiring' })).toBe('marketpulse');
    expect(resolveCanonicalSource({ rawSource: 'hubspot', unifiedSourceCategory: 'crm' })).toBe('crm');
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'import' })).toBe('import');
    expect(resolveCanonicalSource({ rawSource: 'manual' })).toBe('manual');
    expect(resolveCanonicalSource({ rawSource: 'referral' })).toBe('referral');
    expect(resolveCanonicalSource({ rawSource: 'partner' })).toBe('partner');
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'api' })).toBe('api');
    expect(resolveCanonicalSource({ unifiedSourceOrigin: 'webhook' })).toBe('webhook');
  });

  it('precedence: community/engagement beat platform/raw', () => {
    expect(resolveCanonicalSource({ signalSourceType: 'engagement', rawSource: 'website' })).toBe('engagement');
    expect(resolveCanonicalSource({ opportunityType: 'migration_signal', marketPulseCategory: 'x' })).toBe('community');
  });

  it('explicit canonical override wins', () => {
    expect(resolveCanonicalSource({ canonicalSource: 'partner', platform: 'linkedin' })).toBe('partner');
  });

  it('unknown signals fall back to other', () => {
    expect(resolveCanonicalSource({ rawSource: 'totally_unknown' })).toBe('other');
    expect(resolveCanonicalSource({ unifiedSourceCategory: 'email' })).toBe('other');
    expect(resolveCanonicalSource({})).toBe('other');
  });

  it('isCanonicalLeadSource guards', () => {
    expect(isCanonicalLeadSource('webhook')).toBe(true);
    expect(isCanonicalLeadSource('nope')).toBe(false);
  });
});
