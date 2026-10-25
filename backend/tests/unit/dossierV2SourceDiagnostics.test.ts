/**
 * Source diagnostics and competitor discovery — the checks that fail the build when a source gap is
 * explained beyond its evidence, or a competitor comparison rests on unverified identity or claims.
 */
import { classifyProviderError, classifyStoredReason, errorEvidence, sanitize } from '../../services/intelligence/publicResearch/providerErrors';
import { buildOfferingRegister, deriveMarket, proposeQueries } from '../../services/intelligence/publicResearch/offeringRegister';
import { CAPABILITIES, capabilityState, classifyCandidate, NOT_A_COMPETITOR } from '../../services/intelligence/publicResearch/competitorDiscovery';
import { buildDiagnostics } from '../../services/intelligence/dossierV2/diagnostics';
import { buildLedger } from '../../services/intelligence/dossierV2/ledger';
import { buildDossierRegistry } from '../../services/intelligence/dossierV2/registry';
import { validateReport } from '../../services/intelligence/dossierV2/validate';

const DAY = '<p>Evidence dates: website crawl 25 Oct 2026 · report 25 Oct 2026.</p>';
const payload = (): any => ({
  generated_at: '2026-10-25T10:00:00Z', pillars: [],
  report1: { evidence_acquisition: { crawl: { action: 'reused', pagesAfter: 2, lastCrawledAt: '2026-10-25T07:00:00Z' } }, website_checks: { pagesEvaluated: 2 }, company_identity: { fields: [] } },
  authority_inflow: { score: { state: 'unavailable', value: null }, rationale: { text: 'No backlink/authority API is configured.' } },
});
const rec = (o: Record<string, unknown>) => ({ id: 'E-GEN-01', kind: 'gemini_search', surface: 'Gemini (Google Search grounding)', claim: '', status: 'failed_source', confidence: 'high', sourceUrl: '', observedAt: '2026-10-25T09:00:00Z', method: '', scope: '', query: 'best tools', ...o });
const pack = (o: Record<string, unknown> = {}): any => ({
  subject: { brand: 'Acme', domain: 'acme.test' }, collectedAt: '2026-10-25T09:00:00Z', collector: 't', method: {},
  company: [], search: [], generative: [], competitors: [], independent: [], gaps: [], site: [], benchmark: [], ...o,
});
const rules = (html: string, p: any) => validateReport(buildLedger(payload(), p), buildDossierRegistry(payload(), p), `<html><body>${DAY}${html}</body></html>`, [], p).issues.filter((i) => i.blocking).map((i) => i.rule);

describe('provider errors: a cause only from the provider’s own evidence', () => {
  it('never assigns a cause from an HTTP status alone', () => {
    expect(classifyProviderError({ httpStatus: 429, codes: [], quota: null, message: '' })).toMatchObject({ errorClass: 'request_failed', causeConfirmed: false });
    expect(classifyProviderError({ httpStatus: 401, codes: [], quota: null, message: '' }).causeConfirmed).toBe(false);
    expect(classifyProviderError({ httpStatus: 503, codes: [], quota: null, message: '' })).toMatchObject({ errorClass: 'provider_unavailable', causeConfirmed: false });
  });
  it('classifies from the message and keeps an ambiguous quota unconfirmed', () => {
    expect(classifyStoredReason('Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key')).toMatchObject({ errorClass: 'invalid_credential', causeConfirmed: true });
    expect(classifyStoredReason('HTTP 429: Your account has run out of searches.')).toMatchObject({ errorClass: 'quota_exhausted', causeConfirmed: true });
    expect(classifyStoredReason('HTTP 429: You exceeded your current quota, please check your plan and billing details.')).toMatchObject({ errorClass: 'quota_exhausted', causeConfirmed: false });
    expect(classifyProviderError(errorEvidence(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_requests_per_model_per_day', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } })))
      .toMatchObject({ errorClass: 'quota_exhausted', causeConfirmed: true });
  });
  it('never keeps a credential in recorded evidence', () => {
    expect(sanitize('GET https://serpapi.com/search.json?engine=x&api_key=0000aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb')).not.toMatch(/0000aaaa/);
    expect(sanitize('key AIzaSyA1234567890abcdefghijklmnop and sk-proj-abcdefghijklmnop1234')).not.toMatch(/AIza|sk-proj/);
  });
  it('the validator fails a stored error whose recorded cause its evidence does not support', () => {
    const bad = pack({ generative: [rec({ providerError: { httpStatus: 429, codes: [], quota: null, message: '', errorClass: 'billing_blocked', causeConfirmed: true } })] });
    expect(rules('', bad)).toContain('error-cause');
    const ok = pack({ generative: [rec({ providerError: { httpStatus: 429, codes: [], quota: null, message: 'You exceeded your current quota', errorClass: 'quota_exhausted', causeConfirmed: false } })] });
    expect(rules('', ok)).not.toContain('error-cause');
  });
});

describe('diagnostics: missing is not zero, and not found needs a search that ran', () => {
  it('a missing backlink credential is "not configured", never zero evidence', () => {
    const d = buildDiagnostics(buildLedger(payload(), null), null).find((x) => x.key === 'family:inbound_links')!;
    expect(d.state).toBe('not_configured');
    expect(d.impact).toMatch(/unknown, not zero/);
    expect(d.usable).toBe(false);
  });
  it('fails "not found in search" when the mention search did not run', () => {
    const p = pack({ footprint: { checkedAt: '2026-10-25T09:00:00Z', profiles: [], mentions: [], platforms: [], mentionSearch: null } });
    expect(rules('<p>G2: not found in search.</p>', p)).toContain('not-found-scope');
  });
  it('every price named in a next step cites its provider page, and an unconfirmed cause says so', () => {
    const p = pack({ generative: [rec({ claim: 'Gemini (Google Search grounding): HTTP 429: You exceeded your current quota, please check your plan and billing details.' })] });
    const l = buildLedger(payload(), p);
    const rows = buildDiagnostics(l, p);
    for (const r of rows) if (/\$\d/.test(`${r.next} ${r.unlocks}`)) expect(r.docUrl).toBeTruthy();
    const g = rows.find((x) => x.key === 'gemini')!;
    expect(g.causeConfirmed).toBe(false);
    expect(g.cause).toMatch(/cause unconfirmed/);
  });
  it('fails a summary whose source state contradicts the diagnostic matrix', () => {
    const p = pack({ generative: [rec({ claim: 'Gemini (Google Search grounding): HTTP 429: You exceeded your current quota' })] });
    const html = '<section id="summary-now"><ul><li data-diag="gemini"><b>Gemini</b><span>not configured</span></li></ul></section>';
    expect(rules(html, p)).toContain('summary-diagnostics');
    const good = '<section id="summary-now"><ul><li data-diag="gemini"><b>Gemini</b><span>quota exhausted (cause unconfirmed)</span></li></ul></section>';
    expect(rules(good, p)).not.toContain('summary-diagnostics');
  });
});

describe('competitor discovery: offering first, then identity, then comparison', () => {
  const site = [{ url: 'https://acme.test/features', text: 'Campaign Operations: plan and execute marketing campaigns. Content Operations: create and publish social content. SEO audit reports for AI visibility.' }];
  it('applies the same capability definitions to every company', () => {
    expect(capabilityState(CAPABILITIES.find((d) => d.key === 'campaign_ops')!, site).state).toBe('confirmed');
    expect(capabilityState(CAPABILITIES.find((d) => d.key === 'marketing_analytics')!, site).state).toBe('not_found_in_checked_pages');
    expect(capabilityState(CAPABILITIES[0], []).state).toBe('not_checked');
  });
  const base = { name: 'Rival', domain: 'rival.test', sources: [{ kind: 'search_result' as const, detail: 'Google result', url: null, date: null }], pagesRead: ['https://rival.test/'], identityVerified: true, identityBasis: 'title', signals: { software: true, service: false }, checkedAt: '' };
  const caps = (keys: string[]) => Object.fromEntries(CAPABILITIES.map((d) => [d.key, { state: keys.includes(d.key) ? 'confirmed' : 'not_found_in_checked_pages', excerpt: null, url: null }])) as never;
  it('never compares a candidate without verified identity or a recorded rationale', () => {
    expect(classifyCandidate({ ...base, identityVerified: false, capabilities: caps(['campaign_ops', 'content_ops', 'visibility_reporting']) }, ['campaign_ops', 'content_ops', 'visibility_reporting']).classification).toBe('unverified');
    expect(classifyCandidate({ ...base, domain: 'reddit.com', capabilities: caps([]) }, []).classification).toBe('excluded');
    expect(NOT_A_COMPETITOR.test('g2.com')).toBe(true);
    const p = pack({ candidates: [{ ...base, identityVerified: false, capabilities: caps([]), overlap: [], classification: 'direct', rationale: 'x', confidence: 'low' }] });
    expect(rules('', p)).toContain('competitors');
  });
  it('counts overlap only on capabilities the company’s own website states', () => {
    const r = classifyCandidate({ ...base, capabilities: caps(['campaign_ops', 'content_ops', 'marketing_analytics']) }, ['campaign_ops', 'content_ops']);
    expect(r.overlap).toEqual(['campaign_ops', 'content_ops']);
    const p = pack({ offering: { checkedAt: '', pages: [{ url: site[0].url, purpose: 'features', status: 200, read: true, fetchedAt: '', text: site[0].text }], selfDescription: null, offering: null, capabilities: [], pricing: null, freePlan: null },
      candidates: [{ ...base, capabilities: caps(['marketing_analytics', 'campaign_ops']), overlap: ['marketing_analytics', 'campaign_ops'], classification: 'adjacent', rationale: 'x', confidence: 'low' }] });
    expect(rules('', p)).toContain('provenance');
  });
  it('builds the market from website evidence and labels profile-only facts as assumptions', () => {
    const off: any = { checkedAt: '2026-10-25', pricing: null, freePlan: null, capabilities: [], offering: null, selfDescription: null,
      pages: [{ url: 'https://acme.test/features', purpose: 'features', status: 200, read: true, fetchedAt: '2026-10-25', headings: ['Campaign Operations', 'Fragmented marketing systems limit growth.'], text: 'Campaign Operations Plan and execute campaigns across channels. Fragmented marketing systems limit growth.' },
        { url: 'https://acme.test/solutions', purpose: 'solutions', status: 200, read: true, fetchedAt: '2026-10-25', headings: [], text: 'Built for agencies and growth teams.' }] };
    const reg = buildOfferingRegister(off, { geography: 'India', targetCustomer: 'SMBs' });
    expect(reg.entries.find((e) => e.field === 'product_line')?.status).toBe('official_website_verified');
    expect(reg.entries.find((e) => e.field === 'geography')?.status).toBe('company_declared');
    expect(reg.missing).toContain('geography');
    const m = deriveMarket(reg);
    expect(m.items.find((i) => i.kind === 'geography')?.basis).toBe('assumption');
    expect(m.items.some((i) => i.kind === 'category' && i.basis === 'verified')).toBe(true);
    expect(proposeQueries(reg, m).every((q) => q.status === 'proposed')).toBe(true);
  });
  it('never presents generic category queries as buyer-intent searches', () => {
    const pl = payload();
    pl.report1.search_visibility = { queriesRun: 4, queriesRanked: 0, observations: [{ query: 'SaaS Software alternatives' }] };
    const p = pack();
    const v = validateReport(buildLedger(pl, p), buildDossierRegistry(pl, p), `<html><body>${DAY}<p>Found for 0 of 4 buyer searches.</p></body></html>`, [], p);
    expect(v.issues.filter((i) => i.blocking).map((i) => i.rule)).toContain('unsupported');
  });
});
