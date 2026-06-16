import { resolveBrandVoice } from '../../services/brand/resolveBrandVoice';
import { buildIdentityLock, type CompanyIdentity } from '../../../lib/content/companyContextBlock';
import type { BrandRuntime } from '../../services/brand/brandRuntime';

const baseMeta: BrandRuntime['meta'] = {
  version: 0, status: 'published', completeness: 0, source: 'defaults',
  identityHash: '', updatedAt: null, publishedAt: null, resolvedAt: '', warnings: [],
};
const rt = (source: BrandRuntime['meta']['source'], tone?: string): BrandRuntime => ({
  companyId: 'co1', name: 'Acme',
  logo: {},
  colors: { primary: '#2563eb', accent: '#2563eb', background: '#0f172a', surface: '#fff', text: '#111827', mutedText: '#334155', palette: [] },
  typography: { headingFont: 'a', bodyFont: 'b', headingWeight: 900, bodyWeight: 600, pdfFont: 'Helvetica' },
  voice: tone != null ? { tone } : {},
  vocabulary: { prohibitedPhrases: [], requiredTerms: [] },
  compliance: { regulated: false, disclaimers: [], prohibitedClaims: [] },
  designLanguage: {},
  meta: { ...baseMeta, source },
});

describe('resolveBrandVoice — Phase 2A voice adoption', () => {
  it('uses BrandRuntime voice when a brand_identity row exists', async () => {
    expect(await resolveBrandVoice('co1', 'legacy', { resolve: async () => rt('brand_identity', 'dry, contrarian') }))
      .toBe('dry, contrarian');
  });

  it('falls back to legacy when source is company_profiles (no row)', async () => {
    expect(await resolveBrandVoice('co1', 'legacy', { resolve: async () => rt('company_profiles', 'profile tone') }))
      .toBe('legacy');
  });

  it('falls back to legacy when source is defaults (no row)', async () => {
    expect(await resolveBrandVoice('co1', 'legacy', { resolve: async () => rt('defaults') })).toBe('legacy');
  });

  it('falls back to legacy on resolver failure (generation never fails on brand)', async () => {
    expect(await resolveBrandVoice('co1', 'legacy', { resolve: async () => { throw new Error('db down'); } })).toBe('legacy');
  });

  it('returns legacy when companyId is missing', async () => {
    expect(await resolveBrandVoice(null, 'legacy')).toBe('legacy');
  });

  it('row exists but no tone → legacy', async () => {
    expect(await resolveBrandVoice('co1', 'legacy', { resolve: async () => rt('brand_identity') })).toBe('legacy');
  });

  it('PROMPT PARITY: a no-row tenant emits an identical identity-lock voice line', async () => {
    const legacy: CompanyIdentity = { companyName: 'Acme', brandVoice: 'professional, plain' };
    const resolvedVoice = await resolveBrandVoice('co1', legacy.brandVoice, { resolve: async () => rt('company_profiles', 'ignored') });
    const adopted: CompanyIdentity = { ...legacy, brandVoice: resolvedVoice };
    expect(buildIdentityLock(adopted, 'post')).toBe(buildIdentityLock(legacy, 'post'));
  });
});
