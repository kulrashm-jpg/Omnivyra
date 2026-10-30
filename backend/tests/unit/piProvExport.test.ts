/**
 * Export provenance columns (Agent 3).
 *
 *   - the six provenance columns are appended (existing column positions unchanged);
 *   - the evidence URL is personal data: it is disclosed only on an explicit
 *     grant, sanitised (http(s), no query/fragment/credentials/`@`), and the
 *     read service grants it only when governance is readable, every present
 *     endpoint is permitted and no all-channel restriction applies to the person;
 *   - the company column never falls back to the TENANT id;
 *   - exports are no longer silently cut at 500 rows.
 */
const governance: Array<Record<string, unknown>> = [];
let governanceFails = false;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order']) chain[m] = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) => resolve(
      table === 'contact_governance_records'
        ? (governanceFails ? { data: null, error: { message: 'down' } } : { data: governance, error: null })
        : { data: [], error: null },
    );
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import {
  toExportRow, toCsv, sanitizeSourceUrl, prospectCompanyName, EXPORT_WITHHELD, DISCLOSE_NOTHING,
  type CanonicalLeadView,
} from '../../../lib/leadIntelligence';
import { exportLeads, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import type { ProvenanceContribution } from '../../../lib/prospectProvenance/contract';
import type { ContributionReadResult } from '../../services/prospectProvenance/contributionReader';

const CO1 = '11111111-1111-1111-1111-111111111111';
const URL_RAW = 'https://www.reddit.com/r/devops/comments/abc/need_help/?utm_source=x&email=jane@acme.com#frag';
const URL_CLEAN = 'https://www.reddit.com/r/devops/comments/abc/need_help/';

const contribution = (over: Partial<ProvenanceContribution> = {}): ProvenanceContribution => ({
  id: 'c-1', role: 'originating', sourceCategory: 'community', externalRef: 'community:feed-1', platform: 'reddit',
  sourceUrl: URL_RAW, sourceRecordId: 'sr-1', observedAt: '2026-10-01T10:00:00+00:00',
  signalRefs: { opportunityFeedItemId: 'feed-1' }, evidence: {}, ...over,
});

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: CO1, source: 'community', sourceLabel: 'Community', unifiedPersonId: 'up1',
  identity: { email: 'jane@acme.com' }, scores: { total: 0.4 }, status: null, campaign: null, content: null,
  referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: '2026-10-01T10:00:00Z',
  sourceRef: { table: 'canonical_leads', id: 'cl-1' },
  attribution: { originalSource: 'community', originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
  sources: [contribution(), contribution({ id: 'c-2', role: 'contributing', sourceCategory: 'pi_enrichment', platform: 'apollo', externalRef: 'apollo:p1', sourceUrl: null, observedAt: '2026-10-04T00:00:00+00:00' })],
  evidence: [], provenanceStatus: 'loaded',
  origin: { category: 'community', platform: 'reddit', observedAt: '2026-10-01T10:00:00+00:00' },
  ...over,
});

const ALL = { email: true, phone: true, action: true, sourceUrl: true } as const;

describe('export — provenance columns', () => {
  it('emits origin category / platform / observed time / sanitised URL / contributors / status', () => {
    const row = toExportRow(view(), undefined, ALL);
    expect(row).toMatchObject({
      origin_category: 'community',
      origin_platform: 'reddit',
      origin_observed_at: '2026-10-01T10:00:00+00:00',
      origin_source_url: URL_CLEAN,
      contributors: 'originating:community/reddit@2026-10-01T10:00:00+00:00; contributing:pi_enrichment/apollo@2026-10-04T00:00:00+00:00',
      provenance_status: 'loaded',
    });
  });

  it('appends the columns: existing positions are unchanged', () => {
    const header = toCsv([toExportRow(view(), undefined, ALL)]).split('\n')[0];
    expect(header).toBe('identity,company,source,campaign,journey,timeline_summary,buying_intent,content_interests,recommended_next_action,ai_summary,status,metadata,'
      + 'origin_category,origin_platform,origin_observed_at,origin_source_url,contributors,provenance_status,linked_sources');
  });

  it('contributors never carry external ids, URLs or evidence payload', () => {
    const row = toExportRow(view(), undefined, ALL);
    expect(row.contributors).not.toContain('apollo:p1');
    expect(row.contributors).not.toContain('http');
    expect(row.contributors).not.toContain('feed-1');
  });

  it('a view outside provenance exports empty provenance cells and not_applicable', () => {
    const row = toExportRow(view({ sources: undefined, origin: undefined, provenanceStatus: undefined }), undefined, ALL);
    expect(row).toMatchObject({ origin_category: '', origin_source_url: '', contributors: '', provenance_status: 'not_applicable' });
  });

  it('unavailable provenance is exported as such, not as "no sources"', () => {
    expect(toExportRow(view({ sources: [], provenanceStatus: 'unavailable', origin: null }), undefined, ALL).provenance_status).toBe('unavailable');
  });
});

describe('export — provenance URL redaction', () => {
  it('DEFAULT (no disclosure) withholds the URL', () => {
    expect(toExportRow(view()).origin_source_url).toBe(EXPORT_WITHHELD);
    expect(toExportRow(view(), undefined, DISCLOSE_NOTHING).origin_source_url).toBe(EXPORT_WITHHELD);
  });

  it('a grant of the endpoints alone does NOT grant the URL (absent ⇒ deny)', () => {
    expect(toExportRow(view(), undefined, { email: true, phone: true, action: true }).origin_source_url).toBe(EXPORT_WITHHELD);
  });

  it.each([
    ['mailto:jane@acme.com', ''],
    ['javascript:alert(1)', ''],
    ['https://user:pw@example.com/p', ''],
    ['https://example.com/u/jane@acme.com', ''],
    ['not a url', ''],
    ['https://linkedin.com/in/jane?trk=abc#x', 'https://linkedin.com/in/jane'],
  ])('sanitises %s', (raw, want) => {
    expect(sanitizeSourceUrl(raw)).toBe(want);
  });

  it('an unusable URL exports as empty, not as withheld', () => {
    const row = toExportRow(view({ sources: [contribution({ sourceUrl: 'mailto:jane@acme.com' })] }), undefined, ALL);
    expect(row.origin_source_url).toBe('');
  });
});

describe('export — company column', () => {
  it('never falls back to the tenant id', () => {
    const row = toExportRow(view(), undefined, ALL);
    expect(row.company).toBe('');
    expect(row.company).not.toBe(CO1);
  });

  it('uses the prospect company from source fields (incl. canonical_leads.lead_metadata)', () => {
    expect(prospectCompanyName(view({ attribution: { ...view().attribution, sourceMetadata: { lead_metadata: { company_name: 'Acme' } } } }))).toBe('Acme');
    expect(prospectCompanyName(view({ attribution: { ...view().attribution, sourceMetadata: { account_name: 'Initech' } } }))).toBe('Initech');
  });

  it('does not derive the company from a (possibly withheld) email domain', () => {
    expect(prospectCompanyName(view({ identity: { email: 'jane@acme.com' } }))).toBe('');
  });
});

/* ── service level: the read service decides the URL grant from governance ── */

const ok = (byLead: Record<string, ProvenanceContribution[]>): ContributionReadResult =>
  ({ status: 'ok', byLead: new Map(Object.entries(byLead)), truncated: false, reads: 1 });

function readers(row: Record<string, unknown> = {}): LeadSourceReaders {
  return {
    durable: async () => [],
    leads: async () => [],
    canonicalLeads: async () => [{ id: 'cl-1', company_id: CO1, source: 'community', created_at: '2026-10-01T10:00:00Z', qualification_score: 40, unified_person_id: 'up1', email: 'jane@acme.com', ...row }],
    contributions: async () => ok({ 'cl-1': [contribution()] }),
  };
}

const record = (over: Record<string, unknown>) => ({
  id: 'g1', organization_id: CO1, person_id: null, target_normalized: null, channel: 'email', governance_type: 'unsubscribe',
  effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, ...over,
});

const urlCell = async (rs: LeadSourceReaders = readers()) => {
  const csv = (await exportLeads({ companyId: CO1 }, 'csv', rs)).body;
  return csv.includes(URL_CLEAN) ? 'url' : csv.includes(EXPORT_WITHHELD) ? 'withheld' : 'none';
};

describe('exportLeads — governed provenance URL', () => {
  beforeEach(() => { governance.length = 0; governanceFails = false; });

  it('permitted person + endpoint → the sanitised URL is exported; raw query never is', async () => {
    const csv = (await exportLeads({ companyId: CO1 }, 'csv', readers())).body;
    expect(csv).toContain(URL_CLEAN);
    expect(csv).not.toContain('utm_source=x');
    expect(csv).toContain('originating:community/reddit@');
  });

  it('a suppressed email withholds the URL', async () => {
    governance.push(record({ target_normalized: 'jane@acme.com' }));
    const csv = (await exportLeads({ companyId: CO1 }, 'csv', readers())).body;
    expect(csv).not.toContain(URL_CLEAN);
  });

  it('a person-anchored ALL-channel restriction withholds the URL even with no endpoint', async () => {
    governance.push(record({ person_id: 'up1', channel: '*', governance_type: 'dnc_permanent' }));
    expect(await urlCell(readers({ email: null }))).toBe('withheld');
  });

  it('a person-anchored restriction on ONE other channel does not withhold it', async () => {
    governance.push(record({ id: 'g-phone', person_id: 'up1', channel: 'phone', governance_type: 'dnc_channel' }));
    expect(await urlCell()).toBe('url');
  });

  it('an unreadable governance store withholds it (fail closed)', async () => {
    governanceFails = true;
    expect(await urlCell()).not.toBe('url');
  });

  it("another tenant's restriction does not affect this tenant", async () => {
    governance.push(record({ organization_id: 'other', person_id: 'up1', channel: '*', governance_type: 'dnc_permanent' }));
    expect(await urlCell()).toBe('url');
  });
});

describe('exportLeads — completeness', () => {
  beforeEach(() => { governance.length = 0; governanceFails = false; });

  it('exports every filtered row (previously clamped to 500 by the page limit)', async () => {
    const rs: LeadSourceReaders = {
      durable: async () => [],
      leads: async () => Array.from({ length: 750 }, (_, i) => ({ id: `l${i}`, company_id: CO1, email: `${i}@b.com`, source: 'form_embed' })),
      canonicalLeads: async () => [],
    };
    const csv = (await exportLeads({ companyId: CO1 }, 'csv', rs)).body;
    expect(csv.split('\n')).toHaveLength(751); // header + 750
  });

  it("a large export issues ONE logical provenance read (chunking is the default reader's job)", async () => {
    const calls: number[] = [];
    const rs: LeadSourceReaders = {
      durable: async () => [],
      leads: async () => [],
      canonicalLeads: async () => Array.from({ length: 250 }, (_, i) => ({ id: `cl-${i}`, company_id: CO1, source: 'community', qualification_score: 10 })),
      contributions: async (_c, ids) => { calls.push(ids.length); return ok({}); },
    };
    await exportLeads({ companyId: CO1 }, 'csv', rs);
    // The injected reader receives the whole id set once; chunking is the
    // default reader's job (see piProvReader). One logical read per export.
    expect(calls).toEqual([250]);
  });
});
