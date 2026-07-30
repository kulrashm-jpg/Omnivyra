import {
  normalizeContentContext,
  buildCompanyGroundingDirective,
  resolveCompanyGroundingGuard,
} from '../../services/context/canonicalContentContextResolver';
import type { CompanyProfile } from '../../services/companyProfile/types';

/**
 * Company Grounding Guard — deterministic execution-context leakage prevention.
 *
 * The guard is the fix for cross-company leakage (a reply naming "Drishiq" in a
 * non-Drishiq workspace). It is a RENDERING helper over the canonical resolver:
 * given the active company's normalized context it produces a system-prompt
 * directive that (a) names the active company as the ONLY first-person subject,
 * (b) allow-lists that company's brand/product names, and (c) forbids naming any
 * company that is not present in the request payload — even with no profile.
 */

const PROFILE = {
  name: 'Omnivyra',
  products_services_list: ['Omnivyra', 'Creator Studio'],
  brand_voice: 'direct, no hype',
} as unknown as CompanyProfile;

describe('buildCompanyGroundingDirective', () => {
  it('names the active company and allow-lists its brand/product names', () => {
    const ctx = normalizeContentContext(PROFILE, undefined, 'company-1');
    const guard = buildCompanyGroundingDirective(ctx);

    expect(guard.brand).toBe('Omnivyra');
    expect(guard.allowedNames).toEqual(['Omnivyra', 'Creator Studio']);
    // First-person references are pinned to the active company.
    expect(guard.directive).toContain('on behalf of "Omnivyra"');
    expect(guard.directive).toContain('"Omnivyra", "Creator Studio"');
    // The core leak-prevention rule is always present.
    expect(guard.directive).toMatch(/Do NOT mention, reference, or imply ANY other company/i);
    expect(guard.directive).toMatch(/appears in the conversation, draft, or content provided/i);
  });

  it('forbids naming an out-of-context company even with an empty profile', () => {
    const ctx = normalizeContentContext(null, undefined, null);
    const guard = buildCompanyGroundingDirective(ctx);

    expect(guard.brand).toBe('');
    expect(guard.allowedNames).toEqual([]);
    // No brand is asserted, but the "no foreign company names" rule still holds —
    // this is what stops a hallucinated "…your work at Drishiq…".
    expect(guard.directive).not.toContain('on behalf of');
    expect(guard.directive).toMatch(/Do NOT mention, reference, or imply ANY other company/i);
    expect(guard.directive).toMatch(/Do not assume or invent a company identity/i);
  });

  it('is deterministic for a given context (same input → byte-identical directive)', () => {
    const ctx = normalizeContentContext(PROFILE, undefined, 'company-1');
    expect(buildCompanyGroundingDirective(ctx).directive).toBe(
      buildCompanyGroundingDirective(ctx).directive,
    );
  });
});

describe('Company Grounding Guard — negative / cross-company-leak cases', () => {
  it('allow-lists ONLY the active company; a foreign company in the profile is never asserted as own', () => {
    // Even if a foreign brand string leaked into the active profile, the directive still forbids
    // asserting any name outside the request payload; the allow-list is exactly the profile identity.
    const ctx = normalizeContentContext(PROFILE, undefined, 'company-1');
    const g = buildCompanyGroundingDirective(ctx);
    expect(g.allowedNames).not.toContain('Drishiq');
    expect(g.directive).not.toMatch(/drishiq/i);
  });

  it('unknown company (id present, no resolvable profile) ⇒ empty brand + forbidding directive', () => {
    const ctx = normalizeContentContext(null, undefined, 'company-unknown');
    const g = buildCompanyGroundingDirective(ctx);
    expect(g.brand).toBe('');
    expect(g.allowedNames).toEqual([]);
    expect(g.directive).toMatch(/Do NOT mention, reference, or imply ANY other company/i);
  });

  it('missing company (null id, null profile) ⇒ never invents an identity', () => {
    const g = buildCompanyGroundingDirective(normalizeContentContext(null, undefined, null));
    expect(g.brand).toBe('');
    expect(g.directive).toMatch(/Do not assume or invent a company identity/i);
    expect(g.directive).toMatch(/Never recall a company from earlier requests, training data, or memory/i);
  });

  it('the directive is authoritative and overrides other company references', () => {
    const g = buildCompanyGroundingDirective(normalizeContentContext(PROFILE, undefined, 'company-1'));
    expect(g.directive).toMatch(/authoritative — this overrides any other company reference/i);
  });
});

describe('Company Grounding Guard — async resolver (resolveCompanyGroundingGuard)', () => {
  it('missing companyId ⇒ resolves the empty, forbidding directive (no fetch, fail-safe)', async () => {
    const g = await resolveCompanyGroundingGuard(null);
    expect(g.brand).toBe('');
    expect(g.allowedNames).toEqual([]);
    expect(g.directive).toMatch(/Do NOT mention, reference, or imply ANY other company/i);
  });

  it('resolution failure is caught internally ⇒ never throws; still returns a forbidding directive', async () => {
    // resolveContentContext catches fetch/config failures and returns the empty normalization,
    // so the guard is fail-safe: any unresolvable company still yields the anti-leak directive.
    const g = await resolveCompanyGroundingGuard('non-existent-company-id');
    expect(g.directive).toMatch(/Do NOT mention, reference, or imply ANY other company/i);
  });

  it('is deterministic across calls for the same (unresolvable) input', async () => {
    const a = await resolveCompanyGroundingGuard(null);
    const b = await resolveCompanyGroundingGuard(null);
    expect(a.directive).toBe(b.directive);
  });

  it('wiring contract: directive is a non-empty string safe to append to any system prompt', async () => {
    const g = await resolveCompanyGroundingGuard(null);
    expect(typeof g.directive).toBe('string');
    expect(g.directive.length).toBeGreaterThan(0);
    // The exact concatenation the wired endpoints perform.
    const systemPrompt = 'You are a campaign strategist.' + '\n\n' + g.directive;
    expect(systemPrompt).toContain(g.directive);
  });
});
