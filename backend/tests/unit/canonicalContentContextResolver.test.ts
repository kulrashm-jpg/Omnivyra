import {
  normalizeContentContext,
  buildAdaptationContextBlock,
  buildContextBlock,
  extractIdentityNames,
  extractCompanyIdentity,
  mapCreatorCompanyContext,
  type NormalizedContentContext,
} from '../../services/context/canonicalContentContextResolver';
import type { CompanyProfile } from '../../services/companyProfile/types';

/**
 * Wave 1 item 6 — ONE canonical content-context resolver.
 *
 * These tests assert (a) the stable normalized superset shape, (b) a
 * representative profile maps to the expected brand / audience / tone /
 * identityNames / business context, and (c) OUTPUT PARITY: the adaptation block
 * reproduces the exact string the route-local assembler emitted, and the
 * per-request objective is carried only when supplied (never from the profile).
 */

const PROFILE = {
  name: 'Omnivyra',
  industry: 'B2B SaaS',
  website_url: 'https://omnivyra.com',
  products_services: 'AI content platform',
  // Case-insensitive dedup: 'omnivyra' collides with the company name.
  products_services_list: ['Omnivyra', 'Creator Studio', 'omnivyra'],
  target_audience: 'B2B marketers',
  geography: 'North America',
  brand_voice: 'direct, no hype',
  unique_value: 'ships campaigns in minutes',
  brand_positioning: 'the operating system for content',
  key_messages: 'speed, quality, control',
  // Creator-overlay mapping fields (read via Record cast in the resolver):
  description: 'AI content platform',
  target_audience_list: ['B2B marketers', 'founders'],
  industry_list: ['B2B SaaS'],
  // growth_priorities is a freeform string in production (extractStrategyProfile
  // splits it). The creator mapping reads it via list(), which returns undefined
  // for a bare string — the verbatim #3 behavior preserved here.
  growth_priorities: 'expand mid-market',
  messaging_pillars: ['speed', 'quality'],
  biggest_advantage: 'end-to-end',
  icp: { age_group: '25-40', use_case: 'content ops', user_intent: 'scale output' },
} as unknown as CompanyProfile;

// The exact block the route-local buildCompanyContextBlock produced for PROFILE.
// Kept as a literal so any drift in the consolidated resolver fails the test.
const EXPECTED_ADAPTATION_BLOCK = [
  '- Company: Omnivyra',
  '- Industry: B2B SaaS',
  '- Website: https://omnivyra.com',
  '- Products / services: AI content platform',
  '- Target audience: B2B marketers',
  '- Geography: North America',
  '- Brand voice: direct, no hype',
  '- Unique value: ships campaigns in minutes',
  '- Brand positioning: the operating system for content',
  '- Key messages: speed, quality, control',
  '- Allowed product / brand names (use ONLY these, copy verbatim): "Omnivyra", "Creator Studio"',
].join('\n');

describe('canonicalContentContextResolver — normalized shape', () => {
  it('exposes the stable superset keys', () => {
    const ctx = normalizeContentContext(PROFILE, undefined, 'company-123');
    expect(Object.keys(ctx).sort()).toEqual(
      [
        'adaptation',
        'audience',
        'brand',
        'businessContext',
        'companyId',
        'contextBlock',
        'creatorCompany',
        'identity',
        'identityNames',
        'objective',
        'profile',
        'tone',
      ].sort(),
    );
  });

  it('maps a representative profile to the expected primitives', () => {
    const ctx: NormalizedContentContext = normalizeContentContext(PROFILE, undefined, 'company-123');
    expect(ctx.companyId).toBe('company-123');
    expect(ctx.brand).toBe('Omnivyra');
    expect(ctx.audience).toBe('B2B marketers');
    expect(ctx.tone).toBe('direct, no hype');
    expect(ctx.businessContext).toBe('AI content platform');
    // Allow-list: company name + structured products, case-insensitive dedup.
    expect(ctx.identityNames).toEqual(['Omnivyra', 'Creator Studio']);
  });

  it('carries a per-request objective ONLY when supplied (never from the profile)', () => {
    expect(normalizeContentContext(PROFILE).objective).toBeNull();
    expect(normalizeContentContext(PROFILE, { objective: '   ' }).objective).toBeNull();
    expect(normalizeContentContext(PROFILE, { objective: 'Drive signups' }).objective).toBe('Drive signups');
  });

  it('degrades safely on a null profile', () => {
    const ctx = normalizeContentContext(null);
    expect(ctx.brand).toBe('');
    expect(ctx.audience).toBe('');
    expect(ctx.tone).toBe('');
    expect(ctx.businessContext).toBe('');
    expect(ctx.identityNames).toEqual([]);
    expect(ctx.creatorCompany).toEqual({});
    expect(ctx.adaptation).toBeNull();
    expect(ctx.contextBlock).toBe('');
    expect(ctx.objective).toBeNull();
  });
});

describe('canonicalContentContextResolver — output parity', () => {
  it('reproduces the adaptation block + allow-list exactly (#2 parity)', () => {
    const adaptation = buildAdaptationContextBlock(PROFILE);
    expect(adaptation).not.toBeNull();
    expect(adaptation!.block).toBe(EXPECTED_ADAPTATION_BLOCK);
    expect(adaptation!.allowedNames).toEqual(['Omnivyra', 'Creator Studio']);
    // The normalized context embeds the same adaptation artifact.
    expect(normalizeContentContext(PROFILE).adaptation).toEqual(adaptation);
  });

  it('returns null for an empty profile (adaptation contract preserved)', () => {
    expect(buildAdaptationContextBlock({} as unknown as CompanyProfile)).toBeNull();
    expect(buildAdaptationContextBlock(null)).toBeNull();
  });

  it('extractIdentityNames is the single allow-list source', () => {
    expect(extractIdentityNames(PROFILE)).toEqual(['Omnivyra', 'Creator Studio']);
    expect(extractIdentityNames(null)).toEqual([]);
  });

  it('renders the generation context block from the extracted identity (#1 parity)', () => {
    const identity = extractCompanyIdentity(PROFILE);
    const block = buildContextBlock(identity);
    expect(block).toContain('COMPANY: Omnivyra');
    expect(block).toContain('INDUSTRY: B2B SaaS');
    expect(block).toContain('TARGET AUDIENCE: B2B marketers');
    expect(block).toContain('BRAND VOICE: direct, no hype — write every sentence in this voice.');
    // Normalized context embeds the identical block.
    expect(normalizeContentContext(PROFILE).contextBlock).toBe(block);
  });

  it('maps the Creator overlay company context (#3 parity)', () => {
    const co = mapCreatorCompanyContext(PROFILE);
    expect(co).toEqual({
      description: 'AI content platform',
      products: ['Omnivyra', 'Creator Studio', 'omnivyra'],
      audience: ['B2B marketers', 'founders'],
      positioning: 'the operating system for content',
      differentiators: 'end-to-end',
      industries: ['B2B SaaS'],
      categories: undefined,
      businessObjectives: undefined,
      messagingPillars: ['speed', 'quality'],
      icp: '25-40 · content ops · scale output',
    });
    // No per-request objective ever folds into the company-scoped mapping.
    expect((co as Record<string, unknown>).objective).toBeUndefined();
  });
});
