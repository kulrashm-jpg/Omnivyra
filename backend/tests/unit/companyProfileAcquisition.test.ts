/**
 * CPG-002 — evidence acquisition & orchestration behaviour tests.
 *
 * NO NETWORK CALL IS MADE. Every source receives a FIXTURE fetcher, so the whole
 * acquisition path is exercised deterministically and offline. Fixture HTML is
 * hand-written test data and is never presented as retrieved evidence.
 *
 * Raina-12 values appear only as read-only input shapes (§13). The frozen
 * dataset is not imported and not modified.
 */

import { createFirstPartySource, extractFirstPartyClaims } from '../../services/companyProfile/grounding/acquisition/firstPartySource';
import { createUserSuppliedSource, ingestUserSuppliedUrls } from '../../services/companyProfile/grounding/acquisition/userSuppliedSource';
import { orchestrateGrounding } from '../../services/companyProfile/grounding/acquisition/orchestrator';
import { CAPABILITY_MATRIX, coverageSummary } from '../../services/companyProfile/grounding/acquisition/capabilityMatrix';
import { claimId, normalizeValue, retrieved, unavailable, type AcquisitionContext, type EvidenceFetcher, type EvidenceSource } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals, EvidenceClaim, UserClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const COMPANY = 'company-001';
const DOMAIN = 'secureitsimply.com';

const KNOWN: EntitySignals = {
  companyName: 'Secure IT Simply', domain: DOMAIN,
  linkedinUrl: 'https://linkedin.com/company/secure-it-simply',
  location: 'India', leadership: ['Jitesh Midha'], registryId: null,
};

const html = (title: string, description: string) =>
  `<html><head><title>${title}</title><meta property="og:site_name" content="${title}"/>` +
  `<meta name="description" content="${description}"/></head><body></body></html>`;

/** FIXTURE fetcher — hand-written test data, never a real retrieval. */
function fixtureFetcher(pages: Record<string, { status?: number; body?: string; throws?: string }>): EvidenceFetcher {
  return async (url) => {
    const p = pages[url];
    if (!p) return { ok: false, status: 404, url, text: '' };
    if (p.throws) throw new Error(p.throws);
    const status = p.status ?? 200;
    return { ok: status >= 200 && status < 300, status, url, text: p.body ?? '' };
  };
}

const ctxWith = (fetcher: EvidenceFetcher, urls?: string[]): AcquisitionContext => ({
  companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, fetcher, userSuppliedUrls: urls,
});

const uc = (field: string, value: string): UserClaim => ({
  field, value, normalizedValue: normalizeValue(value), assertedAt: '2026-08-01T00:00:00.000Z', assertedBy: 'user-1',
});

describe('CPG-002 (1) first-party website evidence', () => {
  it('extracts only what the document states, with a real source URL', async () => {
    const src = createFirstPartySource(['/']);
    const res = await src.acquire(ctxWith(fixtureFetcher({
      [`https://${DOMAIN}/`]: { body: html('Secure IT Simply', 'Managed cybersecurity for growing businesses') },
    })));
    expect(res.state).toBe('retrieved');
    if (res.state !== 'retrieved') return;
    expect(res.claims.every((c) => c.sourceUrl?.startsWith(`https://${DOMAIN}`))).toBe(true);
    expect(res.claims.map((c) => c.field).sort()).toEqual(['company_description', 'name']);
    expect(res.claims.every((c) => c.sourceAccessedAt === ASOF)).toBe(true);
  });

  it('does NOT invent industry, ICP, brand voice or positioning from a homepage', () => {
    const claims = extractFirstPartyClaims(
      html('Secure IT Simply', 'Enterprise-grade security for ambitious teams'),
      `https://${DOMAIN}/`, ctxWith(fixtureFetcher({})),
    );
    const fields = claims.map((c) => c.field);
    for (const invented of ['industry', 'ideal_customer_profile', 'brand_voice', 'brand_positioning', 'unique_value', 'competitive_advantages']) {
      expect(fields).not.toContain(invented);
    }
  });

  it('maps a meta description to company_description, never to unique_value', () => {
    const claims = extractFirstPartyClaims(html('X', 'We make security simple'), `https://${DOMAIN}/`, ctxWith(fixtureFetcher({})));
    expect(claims.find((c) => c.field === 'company_description')).toBeDefined();
    expect(claims.find((c) => c.field === 'unique_value')).toBeUndefined();
  });

  it('is unavailable with a reason when no domain is known', async () => {
    const res = await createFirstPartySource().acquire({ ...ctxWith(fixtureFetcher({})), companyDomain: null });
    expect(res.state).toBe('unavailable');
    if (res.state === 'unavailable') expect(res.reason).toBe('no_coverage');
  });
});

describe('CPG-002 (2,8) user-supplied URLs', () => {
  it('retrieves a supplied URL and attaches the actual URL', async () => {
    const out = await ingestUserSuppliedUrls(ctxWith(
      fixtureFetcher({ 'https://inc42.com/company/mrmed': { body: html('MrMed', 'Specialty medicine marketplace') } }),
      ['https://inc42.com/company/mrmed'],
    ));
    expect(out[0].state).toBe('retrieved');
    expect(out[0].claims[0].sourceUrl).toBe('https://inc42.com/company/mrmed');
    expect(out[0].claims[0].verificationMethod).toBe('user_input');
  });

  it('records UNAVAILABLE(reason) for an unreachable URL instead of guessing', async () => {
    const out = await ingestUserSuppliedUrls(ctxWith(
      fixtureFetcher({ 'https://inc42.com/gone': { status: 404 } }), ['https://inc42.com/gone'],
    ));
    expect(out[0].state).toBe('unavailable');
    expect(out[0].reason).toMatch(/retrieval_failed/);
    expect(out[0].claims).toHaveLength(0);
  });

  it('rejects a malformed URL', async () => {
    const out = await ingestUserSuppliedUrls(ctxWith(fixtureFetcher({}), ['not a url']));
    expect(out[0].reason).toMatch(/invalid_url/);
  });

  it('§8 — accepts a LinkedIn URL as a reference but never fetches its content', async () => {
    const fetcher = jest.fn(fixtureFetcher({}));
    const out = await ingestUserSuppliedUrls(ctxWith(fetcher, ['https://linkedin.com/company/secure-it-simply']));
    expect(out[0].state).toBe('unavailable');
    expect(out[0].reason).toMatch(/not_permitted/);
    expect(fetcher).not.toHaveBeenCalled(); // no scraping around the restriction
  });
});

describe('CPG-002 (3,4,5) corroboration, conflict, staleness through the resolver', () => {
  const base = {
    companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN,
    fieldsOfInterest: [] as string[], asOf: ASOF, fetcher: fixtureFetcher({}),
  };

  const staticSource = (id: string, claims: EvidenceClaim[]): EvidenceSource => ({
    id, label: id, isAvailable: () => true, async acquire() { return retrieved(claims, 1); },
  });

  const claim = (over: Partial<EvidenceClaim> & { field: string; value: string; sourceUrl: string }): EvidenceClaim => ({
    claimId: claimId('t', over.sourceUrl, over.field, over.value),
    normalizedValue: normalizeValue(over.value), sourceType: 'editorial', sourceName: 'src',
    sourcePublishedAt: '2026-08-01T00:00:00.000Z', sourceAccessedAt: '2026-09-01T00:00:00.000Z',
    excerpt: null, verificationMethod: 'crawl',
    entitySignals: { companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: null, location: 'India', leadership: [], registryId: null },
    ...over,
  } as EvidenceClaim);

  it('(3) multiple independent sources agreeing raise corroboration', async () => {
    const r = await orchestrateGrounding({
      ...base, userClaims: [uc('industry', 'Cybersecurity')],
      sources: [
        staticSource('a', [claim({ field: 'industry', value: 'Cybersecurity', sourceUrl: 'https://inc42.com/a' })]),
        staticSource('b', [claim({ field: 'industry', value: 'Cybersecurity', sourceUrl: 'https://linkedin.com/company/x', sourceType: 'business_intelligence' })]),
      ],
    });
    const f = r.fields.find((x) => x.field === 'industry')!;
    expect(f.status).toBe('PUBLICLY_VERIFIED');
    expect(f.confidence.components.corroboration).toBeGreaterThan(0);
  });

  it('(4) §5 worked example — website+LinkedIn say B, old article says A, user says A', async () => {
    const r = await orchestrateGrounding({
      ...base, userClaims: [uc('ceo', 'Person A')],
      sources: [
        staticSource('site', [claim({ field: 'ceo', value: 'Person B', sourceUrl: `https://${DOMAIN}/team`, sourceType: 'company_website' })]),
        staticSource('li', [claim({ field: 'ceo', value: 'Person B', sourceUrl: 'https://linkedin.com/company/x', sourceType: 'business_intelligence' })]),
        staticSource('old', [claim({ field: 'ceo', value: 'Person A', sourceUrl: 'https://inc42.com/old', sourcePublishedAt: '2022-01-01T00:00:00.000Z' })]),
      ],
    });
    const f = r.fields.find((x) => x.field === 'ceo')!;
    expect(f.status).toBe('CONFLICTING');
    expect(f.effectiveValue).toBe('Person A');          // user claim preserved
    expect(f.effectiveValueSource).toBe('user');        // never silently replaced
    expect(f.isMaterialConflict).toBe(true);
    expect(r.confirmationRequests.some((q) => q.field === 'ceo')).toBe(true);
    // nothing deleted: both Person B sources retained
    expect(f.conflictingEvidence.filter((e) => e.value === 'Person B')).toHaveLength(2);
  });

  it('(5) a stale source is marked stale, not treated as authoritative', async () => {
    const r = await orchestrateGrounding({
      ...base, userClaims: [],
      sources: [staticSource('old', [claim({ field: 'industry', value: 'Cybersecurity', sourceUrl: 'https://inc42.com/x', sourcePublishedAt: '2022-01-01T00:00:00.000Z' })])],
    });
    const f = r.fields.find((x) => x.field === 'industry')!;
    expect(f.freshness).toBe('stale');
    expect(f.confidence.band).not.toBe('VERIFIED_CANDIDATE');
  });

  it('(6) entity-mismatched evidence is retained but never becomes effective', async () => {
    const r = await orchestrateGrounding({
      ...base, userClaims: [],
      sources: [staticSource('x', [claim({
        field: 'industry', value: 'Petroleum', sourceUrl: 'https://inc42.com/other',
        entitySignals: { companyName: 'Spetrol', domain: 'spetrol.example', linkedinUrl: null, location: 'UAE', leadership: [], registryId: null },
      })])],
    });
    const f = r.fields.find((x) => x.field === 'industry')!;
    expect(f.effectiveValue).toBeNull();
    expect(f.evidence.map((e) => e.value)).toContain('Petroleum'); // retained for audit
  });

  it('(11) different financial measures do not fabricate a conflict', async () => {
    const r = await orchestrateGrounding({
      ...base, userClaims: [uc('revenue', '₹10 Cr+ revenue')],
      sources: [staticSource('a', [claim({ field: 'revenue', value: '₹20 Cr FY27 target', sourceUrl: 'https://yourstory.com/x' })])],
    });
    const f = r.fields.find((x) => x.field === 'revenue')!;
    expect(f.isMaterialConflict).toBe(false);
    expect(f.status).not.toBe('CONFLICTING');
    expect(f.conflictingEvidence.map((e) => e.value)).toContain('₹20 Cr FY27 target'); // retained
  });

  it('(9,10,14) the user claim is never silently overwritten by any source', async () => {
    const r = await orchestrateGrounding({
      ...base, userClaims: [uc('headquarters', 'Chennai')],
      sources: [staticSource('site', [claim({ field: 'headquarters', value: 'Bengaluru', sourceUrl: `https://${DOMAIN}/about`, sourceType: 'company_website' })])],
    });
    const f = r.fields.find((x) => x.field === 'headquarters')!;
    expect(f.effectiveValue).toBe('Chennai');
    expect(f.status).toBe('CONFLICTING');
    expect(r.confirmationRequests).toHaveLength(1); // (15) confirmation triggered
  });
});

describe('CPG-002 (7,17) provider failure isolation', () => {
  const good: EvidenceSource = {
    id: 'good', label: 'good', isAvailable: () => true,
    async acquire(ctx) {
      return retrieved([{
        claimId: 'g1', field: 'industry', value: 'Cybersecurity', normalizedValue: 'cybersecurity',
        sourceType: 'company_website', sourceName: DOMAIN, sourceUrl: `https://${DOMAIN}/about`,
        sourcePublishedAt: null, sourceAccessedAt: ctx.asOf, excerpt: null, verificationMethod: 'crawl',
        entitySignals: { companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
      }], 1);
    },
  };
  const thrower: EvidenceSource = { id: 'boom', label: 'boom', isAvailable: () => true, async acquire() { throw new Error('vendor exploded'); } };
  const uncredentialed: EvidenceSource = { id: 'dark', label: 'dark', isAvailable: () => false, async acquire() { return unavailable('no_credential', 'no key'); } };

  const run = () => orchestrateGrounding({
    companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [],
    fieldsOfInterest: [], sources: [thrower, uncredentialed, good], fetcher: fixtureFetcher({}), asOf: ASOF,
  });

  it('a throwing source is recorded, not fatal', async () => {
    const r = await run();
    const boom = r.sourceOutcomes.find((o) => o.sourceId === 'boom')!;
    expect(boom.state).toBe('errored');
    expect(boom.detail).toMatch(/vendor exploded/);
    expect(r.fields.find((f) => f.field === 'industry')?.effectiveValue).toBe('Cybersecurity');
  });

  it('an uncredentialed source reports no_credential and makes no claim', async () => {
    const r = await run();
    const dark = r.sourceOutcomes.find((o) => o.sourceId === 'dark')!;
    expect(dark.state).toBe('unavailable');
    expect(dark.reason).toBe('no_credential');
    expect(dark.claimCount).toBe(0);
  });

  it('(18) orchestration is deterministic', async () => {
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });
});

describe('CPG-002 (12,13) provenance and traceability survive orchestration', () => {
  it('every emitted claim carries a URL and an access date end-to-end', async () => {
    const r = await orchestrateGrounding({
      companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [],
      fieldsOfInterest: [], sources: [createFirstPartySource(['/', '/about'])],
      fetcher: fixtureFetcher({
        [`https://${DOMAIN}/`]: { body: html('Secure IT Simply', 'Managed cybersecurity') },
        [`https://${DOMAIN}/about`]: { body: html('Secure IT Simply', 'Managed cybersecurity') },
      }),
      asOf: ASOF,
    });
    const withEvidence = r.fields.filter((f) => f.evidence.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const f of withEvidence) {
      for (const e of f.evidence) {
        expect(e.sourceUrl).toBeTruthy();
        expect(e.sourceAccessedAt).toBe(ASOF);
      }
    }
  });

  it('the same value on two pages is one claim, not fake corroboration', async () => {
    const res = await createFirstPartySource(['/', '/about']).acquire(ctxWith(fixtureFetcher({
      [`https://${DOMAIN}/`]: { body: html('Secure IT Simply', 'Same text') },
      [`https://${DOMAIN}/about`]: { body: html('Secure IT Simply', 'Same text') },
    })));
    expect(res.state).toBe('retrieved');
    if (res.state !== 'retrieved') return;
    expect(res.documentsFetched).toBe(2);
    expect(res.claims.filter((c) => c.field === 'name')).toHaveLength(1);
  });
});

describe('CPG-002 (15) no false completeness', () => {
  it('reports UNVERIFIED for fields no source could support', async () => {
    const r = await orchestrateGrounding({
      companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [],
      fieldsOfInterest: ['industry', 'brand_voice', 'ideal_customer_profile', 'competitive_advantages'],
      synthesizedFields: ['competitive_advantages'],
      sources: [createFirstPartySource(['/'])],
      fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: { body: html('Secure IT Simply', 'Managed cybersecurity') } }),
      asOf: ASOF,
    });
    expect(r.fields.find((f) => f.field === 'brand_voice')!.status).toBe('UNVERIFIED');
    expect(r.fields.find((f) => f.field === 'ideal_customer_profile')!.status).toBe('UNVERIFIED');
    expect(r.fields.find((f) => f.field === 'competitive_advantages')!.status).toBe('SYNTHESIZED');
    expect(r.coverage.unverified).toBeGreaterThan(0);
    // CPG-010: the statement now names what is ACTUALLY unavailable (web search is not).
    // CPG-011: the statement names the provider framework and what is inaccessible — not SEC as the only route.
    // CPG-012: the inaccessible / credential-gated list grew; MCA is still named in it.
    expect(r.coverage.acquisitionLimitation).toMatch(/represented but inaccessible or credential-gated: MCA/);
    expect(r.coverage.acquisitionLimitation).toMatch(/never by name/);
  });
});

describe('CPG-002 capability matrix honesty', () => {
  it('no source is marked production-enabled for grounding', () => {
    expect(CAPABILITY_MATRIX.every((r) => r.productionEnabledForGrounding === false)).toBe(true);
    expect(coverageSummary().productionEnabledForGrounding).toEqual([]);
  });

  it('only genuinely callable sources are callable', () => {
    // CPG-003 re-audit added wikidata here: a real keyless HTTP adapter that is
    // default-ON and already used in production. It was miscategorised in CPG-002.
    // CPG-010: general_web_search (built by CPG-006; the row was stale) and
    // sec_edgar (keyless, live-proven) are callable.
    // CPG-011: fr_sirene and gleif — providers of the country-neutral registry framework, keyless and live-proven.
    // CPG-012: br_receita (live through a mirror — LIVE-BUT-LIMITED). The other CPG-012 providers are not callable.
    expect(coverageSummary().callableNow.sort()).toEqual(['br_receita', 'first_party_website', 'fr_sirene', 'general_web_search', 'gleif', 'sec_edgar', 'user_supplied_url', 'wikidata']);
  });

  it('records the absent capabilities explicitly', () => {
    const absent = coverageSummary().absent;
    // CPG-010: mca_registry joins (live 403); general_web_search leaves.
    expect(absent).toEqual(expect.arrayContaining(['linkedin', 'corporate_registry', 'mca_registry']));
    expect(absent).not.toContain('general_web_search');
  });

  it('corrects the CPG-001 overstatement about SerpAPI', () => {
    const serp = CAPABILITY_MATRIX.find((r) => r.id === 'serpapi_news')!;
    expect(serp.implemented).toBe(true);
    expect(serp.callableForGrounding).toBe(false);
    expect(serp.note).toMatch(/CORRECTION TO CPG-001/);
  });

  it('marks vendor adapters implemented but uncredentialed, never callable', () => {
    for (const id of ['clearbit', 'apollo', 'crunchbase', 'hunter', 'builtwith', 'peopledatalabs']) {
      const row = CAPABILITY_MATRIX.find((r) => r.id === id)!;
      expect(row.implemented).toBe(true);
      expect(row.callableForGrounding).toBe(false);
      expect(row.state).toBe('implemented_no_credential');
    }
  });
});

// ── (16) tenant isolation of orchestration output ───────────────────────────
import { filterReadable, applyUserDecisionGuarded, TenantIsolationError } from '../../services/companyProfile/grounding/groundingAccess';

describe('CPG-002 (16) tenant isolation of orchestrated output', () => {
  const orchestrate = (companyId: string) => orchestrateGrounding({
    companyId, knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [uc('industry', 'Cybersecurity')],
    fieldsOfInterest: [], sources: [], fetcher: fixtureFetcher({}), asOf: ASOF,
  });

  it('every produced field is stamped with the requesting company', async () => {
    const r = await orchestrate(COMPANY);
    expect(r.fields.every((f) => f.companyId === COMPANY)).toBe(true);
  });

  it('output for another tenant is filtered out of a batch read', async () => {
    const mine = (await orchestrate(COMPANY)).fields;
    const theirs = (await orchestrate('other-company')).fields;
    const visible = filterReadable({ userId: 'u1', memberships: [{ companyId: COMPANY, role: 'viewer' }] }, [...mine, ...theirs]);
    expect(visible.every((f) => f.companyId === COMPANY)).toBe(true);
    expect(visible).toHaveLength(mine.length);
  });

  it('a confirmation on another tenant\'s orchestrated field is refused', async () => {
    const theirs = (await orchestrate('other-company')).fields[0];
    expect(() => applyUserDecisionGuarded(
      { userId: 'u1', memberships: [{ companyId: COMPANY, role: 'admin' }] },
      theirs, { kind: 'confirm_own' }, ASOF,
    )).toThrow(TenantIsolationError);
  });
});

// ── CPG-004 regression: a page <title> is NOT a company-name claim ──────────
describe('CPG-004 regression — page titles must never become name claims', () => {
  const titleOnly = (title: string) =>
    `<html><head><title>${title}</title><meta name="description" content="d"/></head><body></body></html>`;

  it('emits NO name claim when the page has only a <title> (real-world defect)', () => {
    // Live evidence produced: "Cloudflare: Build for the agent era",
    // "Basecamp — Where we came from", "Infosys - Consulting | IT Services".
    const claims = extractFirstPartyClaims(titleOnly('Cloudflare: Build for the agent era'), `https://${DOMAIN}/`, ctxWith(fixtureFetcher({})));
    expect(claims.find((c) => c.field === 'name')).toBeUndefined();
    expect(claims.find((c) => c.field === 'company_description')).toBeDefined();
  });

  it('emits a name claim only from og:site_name', () => {
    const withSiteName = `<html><head><title>Marketing headline goes here</title>` +
      `<meta property="og:site_name" content="Cloudflare"/><meta name="description" content="d"/></head><body></body></html>`;
    const claims = extractFirstPartyClaims(withSiteName, `https://${DOMAIN}/`, ctxWith(fixtureFetcher({})));
    expect(claims.find((c) => c.field === 'name')?.value).toBe('Cloudflare');
  });

  it('two pages with different titles no longer manufacture a name conflict', async () => {
    const res = await createFirstPartySource(['/', '/about']).acquire(ctxWith(fixtureFetcher({
      [`https://${DOMAIN}/`]: { body: titleOnly('Homepage headline') },
      [`https://${DOMAIN}/about`]: { body: titleOnly('About page headline') },
    })));
    if (res.state !== 'retrieved') throw new Error('expected retrieved');
    expect(res.claims.filter((c) => c.field === 'name')).toHaveLength(0);
  });
});
