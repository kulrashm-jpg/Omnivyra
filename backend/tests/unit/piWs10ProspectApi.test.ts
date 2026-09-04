/**
 * WS-10 — the Prospect Intelligence API surface.
 *
 * The composer is exercised against a stub database with the REAL seams behind
 * it: WS-2, WS-5, WS-6, WS-7, WS-8 and the outcome corpus all run. Doubling
 * them would prove only that the API can shape an object; what matters is that
 * it consumes the canonical services and preserves every state they report.
 *
 * The two route shells are tested separately with the guard doubled, because
 * what they own is authorization ordering and status mapping — nothing else.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string } | undefined>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  writeOps: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const rows = (): Row[] => (db.tables[table] ??= []);
    const run = async () => {
      await Promise.resolve();
      const err = db.errors[table];
      if (err) return { data: null, error: err };
      const matched = rows().filter((r) =>
        eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c] as never)));
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      is: () => api,
      order: () => api,
      range: () => api,
      limit: () => api,
      maybeSingle: () => run().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      api[op] = () => { db.writeOps.push(`${table}.${op}`); return api; };
    }
    return api;
  },
}));

import {
  PROSPECT_API_VERSION,
  UNIMPLEMENTED_DIMENSIONS,
  MAX_PAGE_SIZE,
  listProspects,
  getProspectDetail,
  type DimensionView,
} from '../../apiHandlers/prospects/prospectIntelligenceRead';
import { SCORE_DIMENSIONS } from '../../services/leadUnderstanding/types';

const readFile = (p: string): string =>
  require('fs').readFileSync(require('path').join(__dirname, p), 'utf8');

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const LEAD = 'lead-1';
const PERSON = 'person-1';
const ACCOUNT = 'account-1';
const NOW = '2026-09-04T00:00:00.000Z';

const seedProspect = (org: string, id: string, personId: string | null, over: Row = {}) => {
  (db.tables.canonical_leads ??= []).push({
    id, company_id: org, unified_person_id: personId, source: 'crm',
    external_lead_key: `EXT-${id}`, created_at: '2026-09-01T00:00:00.000Z',
    qualification_score: 0, ...over,
  });
};
const seedPerson = (org: string, id: string, accountId: string | null, over: Row = {}) => {
  (db.tables.unified_persons ??= []).push({
    id, company_id: org, account_id: accountId, job_title: 'VP Engineering',
    department: 'Engineering', seniority: 'vp', authority: null, influence: null,
    buying_role: 'decision_maker', ...over,
  });
};
const seedAccount = (org: string, id: string, over: Row = {}) => {
  (db.tables.prospect_accounts ??= []).push({
    id, organization_id: org, name: 'Acme Ltd', domain_normalized: 'acme.test',
    status: 'active', merged_into_id: null, confidence: 0.8,
    first_seen_at: '2026-08-01T00:00:00.000Z', last_verified_at: null,
    attributes_source: 'crm', attributes_updated_at: '2026-09-02T00:00:00.000Z',
    industry: 'fintech', ...over,
  });
};
const seedThread = (org: string, id: string, personId: string | null) => {
  (db.tables.engagement_threads ??= []).push({
    id, organization_id: org, unified_person_id: personId, platform: 'linkedin',
    contact_id: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z',
  });
};
const seedMessage = (id: string, threadId: string, at: string, over: Row = {}) => {
  (db.tables.engagement_messages ??= []).push({
    id, thread_id: threadId, platform: 'linkedin', direction: 'inbound',
    message_type: 'comment', platform_created_at: at, created_at: at, ...over,
  });
};

const detail = (over: Partial<Parameters<typeof getProspectDetail>[0]> = {}) =>
  getProspectDetail({ organizationId: ORG_A, prospectId: LEAD, now: NOW, ...over });

/** A prospect with enough evidence that the engines do not all abstain. */
const seedEngaged = (org = ORG_A) => {
  seedProspect(org, LEAD, PERSON);
  seedPerson(org, PERSON, ACCOUNT);
  seedAccount(org, ACCOUNT);
  seedThread(org, 'thread-1', PERSON);
  for (let i = 1; i <= 6; i += 1) {
    seedMessage(`m-${i}`, 'thread-1', `2026-09-0${i > 3 ? 3 : i}T0${i}:00:00.000Z`);
  }
};

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-10 — the API consumes services and decides nothing', () => {
  it('holds no scoring, suppression or action primitive of its own', () => {
    const code = readFile('../../apiHandlers/prospects/prospectIntelligenceRead.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The real guarantee is that no DECISION FUNCTION is called here. The words
    // "weight" and "threshold" do appear — inside the reason string explaining
    // that no weight is defined for the unimplemented dimensions — and asserting
    // on English rather than on calls would forbid the documentation instead of
    // the behaviour.
    for (const forbidden of [
      'combineScores(', 'combineDimension(', 'mayContact(',
      'personalized_outreach', 'nurture_sequence', 'buildLeadActionPlan',
      'evaluateIcpFit(', 'runRecommendation(',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('consumes the canonical seams by name', () => {
    const code = readFile('../../apiHandlers/prospects/prospectIntelligenceRead.ts');
    for (const seam of [
      'readProspectEngagementIntelligence', 'aggregateAccountIntelligence',
      'buildProspectIntelligenceContext', 'assessOutreachReadiness',
      'readProspectOutcomeCorpus', 'planProspectEnrichment',
    ]) {
      expect(code).toContain(seam);
    }
  });

  it('writes nothing — the read surface is a read', async () => {
    seedEngaged();
    await detail();
    await listProspects({ organizationId: ORG_A });
    expect(db.writeOps).toEqual([]);
  });

  it('never persists an enrichment result from a GET', async () => {
    const src = readFile('../../apiHandlers/prospects/prospectIntelligenceRead.ts');
    expect(src).toContain('does not persist enrichment results');
    // Comments stripped: the persist port DOCUMENTS that `applyEnrichmentResult`
    // is the sanctioned write path elsewhere. What must not exist is a call.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('applyEnrichmentResult(');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-10 — prospect list', () => {
  it('returns the tenant\'s prospects, newest first, bounded', async () => {
    seedProspect(ORG_A, 'lead-a', PERSON);
    seedProspect(ORG_A, 'lead-b', null);
    const result = await listProspects({ organizationId: ORG_A });
    expect(result.version).toBe(PROSPECT_API_VERSION);
    expect(result.rows).toHaveLength(2);
    expect(result.page.limit).toBe(25);
  });

  it('clamps the page size so one request cannot exhaust the platform', async () => {
    seedProspect(ORG_A, 'lead-a', PERSON);
    expect((await listProspects({ organizationId: ORG_A, limit: 10_000 })).page.limit).toBe(MAX_PAGE_SIZE);
    expect((await listProspects({ organizationId: ORG_A, limit: -5 })).page.limit).toBe(1);
    expect((await listProspects({ organizationId: ORG_A, offset: -9 })).page.offset).toBe(0);
  });

  it('a default qualification_score of 0 is reported as UNSCORED, not as a bad prospect', async () => {
    seedProspect(ORG_A, 'lead-a', PERSON, { qualification_score: 0 });
    const row = (await listProspects({ organizationId: ORG_A })).rows[0];
    expect(row.qualificationScore).toBe(0);
    expect(row.scored).toBe(false);
  });

  it('Tenant A never sees Tenant B\'s prospects', async () => {
    seedProspect(ORG_B, 'lead-b', PERSON);
    expect((await listProspects({ organizationId: ORG_A })).rows).toEqual([]);
    expect(db.filters).toContainEqual({ table: 'canonical_leads', column: 'company_id', value: ORG_A });
  });

  it('an unreadable repository throws rather than returning an empty list', async () => {
    db.errors.canonical_leads = { message: 'connection reset' };
    await expect(listProspects({ organizationId: ORG_A }))
      .rejects.toThrow(/canonical_leads read failed/);
  });

  it('refuses a tenant-less list', async () => {
    await expect(listProspects({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-10 — prospect detail exposes every delivered seam', () => {
  it('composes identity, account, engagement, scoring, NBA, readiness and outcomes', async () => {
    seedEngaged();
    const d = (await detail())!;
    expect(d.prospectId).toBe(LEAD);
    expect(d.personId).toBe(PERSON);
    expect(d.accountId).toBe(ACCOUNT);
    for (const s of ['engagement', 'account', 'enrichment', 'scoring', 'recommendation', 'readiness', 'outcomes'] as const) {
      expect(d[s]).toHaveProperty('state');
      expect(d[s]).toHaveProperty('reason');
    }
  });

  it('exposes account association, roster and observed buying role', async () => {
    seedEngaged();
    const acct = (await detail())!.account;
    expect(acct.state).toBe('available');
    const data = acct.data as { contacts: Array<{ personId: string; attributes: Record<string, string | null> }> };
    expect(data.contacts[0].attributes.buying_role).toBe('decision_maker');
  });

  it('exposes engagement, timeline and provenance of each entry', async () => {
    seedEngaged();
    const eng = (await detail())!.engagement;
    expect(eng.state).toBe('available');
    const data = eng.data as { timeline: Array<{ observedAtSource: string }> };
    expect(data.timeline.length).toBeGreaterThan(0);
    expect(data.timeline[0].observedAtSource).toBe('platform');
  });

  it('exposes the enrichment plan through the WS-2 seam', async () => {
    seedEngaged();
    const enr = (await detail())!.enrichment;
    expect(enr.state).toBe('available');
    const plan = enr.data as { counts: Record<string, number>; fields: Array<{ action: string }> };
    // The frozen field states survive to the API surface.
    for (const state of ['known', 'missing', 'stale', 'conflicting']) {
      expect(plan.counts).toHaveProperty(state);
    }
    // With no available enrichment source, gaps are honest, not invented.
    expect(plan.fields.some((f) => f.action === 'no_available_source')).toBe(true);
  });

  it('exposes readiness with its suppression verdict and constraints', async () => {
    seedEngaged();
    const r = (await detail())!.readiness;
    expect(r.state).toBe('available');
    const data = r.data as { readiness: string; suppression: unknown; requiredMissingFields: string[] };
    expect(['ready', 'deferred', 'blocked', 'not_ready']).toContain(data.readiness);
    expect(data).toHaveProperty('requiredMissingFields');
  });

  it('exposes the outcome corpus, marking unobservable types', async () => {
    seedEngaged();
    const o = (await detail())!.outcomes;
    const data = o.data as { counts: Array<{ type: string; observable: boolean }> };
    expect(data.counts.find((c) => c.type === 'opened')!.observable).toBe(false);
    expect(data.counts.find((c) => c.type === 'replied')!.observable).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-10 — semantic states are preserved, never collapsed', () => {
  it('the four unimplemented dimensions report NOT_IMPLEMENTED, never zero', async () => {
    seedEngaged();
    const dims = ((await detail())!.scoring.data as unknown as { dimensions: DimensionView[] }).dimensions;

    for (const name of UNIMPLEMENTED_DIMENSIONS) {
      const d = dims.find((x) => x.dimension === name)!;
      expect(d.state).toBe('not_implemented');
      expect(d.value).toBeNull();            // NOT 0
      expect(d.reason).toMatch(/open product decision/);
    }
    expect(UNIMPLEMENTED_DIMENSIONS).toEqual([
      'problem_fit', 'account_potential', 'buying_role', 'relationship_strength',
    ]);
  });

  it('does not add the unimplemented dimensions to the frozen scoring model', () => {
    for (const d of UNIMPLEMENTED_DIMENSIONS) {
      expect(SCORE_DIMENSIONS as readonly string[]).not.toContain(d);
    }
    expect(SCORE_DIMENSIONS).toEqual(['intent', 'icp', 'urgency', 'opportunity', 'priority']);
  });

  it('an ABSTAINED dimension is not_evaluated with a null value, never zero', async () => {
    // Identity only: no engagement, so intent has no contribution.
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT);
    seedAccount(ORG_A, ACCOUNT);
    const dims = ((await detail())!.scoring.data as unknown as { dimensions: DimensionView[] }).dimensions;
    const intent = dims.find((d) => d.dimension === 'intent')!;
    expect(intent.state).toBe('not_evaluated');
    expect(intent.value).toBeNull();
  });

  it('an abstaining recommendation is not_evaluated, not an empty success', async () => {
    seedProspect(ORG_A, LEAD, null);         // no person ⇒ no evidence at all
    const d = (await detail())!;
    expect(d.recommendation.state).toBe('not_evaluated');
    expect(d.recommendation.reason).toMatch(/abstained/);
  });

  it('EMPTY and FAILED are different answers', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, null);         // no account
    const empty = (await detail())!;
    expect(empty.account.state).toBe('empty');
    expect(empty.account.reason).toMatch(/not attached to an account/);

    db.errors.outreach_tasks = { message: 'timeout' };
    const failed = (await detail())!;
    expect(failed.outcomes.state).toBe('failed');
    expect(failed.outcomes.reason).toMatch(/could not be read/);
  });

  it('one failing seam does not collapse the others', async () => {
    seedEngaged();
    db.errors.outreach_tasks = { message: 'timeout' };
    const d = (await detail())!;
    expect(d.outcomes.state).toBe('failed');
    expect(d.engagement.state).toBe('available');   // still answered
    expect(d.scoring.state).toBe('available');
  });

  it('a readable prospect with nothing known is a DETAIL, not a 404', async () => {
    seedProspect(ORG_A, LEAD, null);
    const d = await detail();
    expect(d).not.toBeNull();
    expect(d!.engagement.state).toBe('empty');
  });

  it('a prospect in another tenant is null — the route turns that into 404', async () => {
    seedEngaged(ORG_B);
    expect(await detail()).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-10 — no provider is claimed operational', () => {
  it('the enrichment plan offers no external source, because none is available', async () => {
    seedEngaged();
    const plan = (await detail())!.enrichment.data as { toEnrich: Array<{ source: string | null }> };
    for (const f of plan.toEnrich) expect(f.source).not.toMatch(/apollo|zoominfo|rapidapi|sales_navigator/i);
  });

  it('the composer names no provider of its own', () => {
    const code = readFile('../../apiHandlers/prospects/prospectIntelligenceRead.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const p of ['apollo', 'zoominfo', 'rapidapi', 'linkedin_sales_navigator']) {
      expect(code.toLowerCase()).not.toContain(p);
    }
  });

  it('integration state is read from the same table the data-sources route reads', () => {
    const code = readFile('../../apiHandlers/prospects/prospectIntelligenceRead.ts');
    expect(code).toContain("ownedDbTable('company_integrations')");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-10 — tenant isolation across the whole composition', () => {
  it('every read carries its tenant column', async () => {
    seedEngaged();
    await detail();
    for (const [table, column] of [
      ['canonical_leads', 'company_id'],
      ['unified_persons', 'company_id'],
      ['prospect_accounts', 'organization_id'],
      ['engagement_threads', 'organization_id'],
      ['company_integrations', 'company_id'],
      ['outreach_tasks', 'company_id'],
    ] as Array<[string, string]>) {
      expect(db.filters).toContainEqual({ table, column, value: ORG_A });
    }
  });

  it('a cross-tenant person id pulls in no account, engagement or outcome', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_B, PERSON, ACCOUNT);           // same person id, other tenant
    seedAccount(ORG_B, ACCOUNT);
    seedThread(ORG_B, 'thread-b', PERSON);
    const d = (await detail())!;
    expect(d.accountId).toBeNull();
    expect(d.engagement.state).toBe('empty');
  });

  it('refuses tenant-less and ambient-time detail reads', async () => {
    await expect(detail({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(detail({ prospectId: '' })).rejects.toThrow(/prospectId is required/);
    await expect(detail({ now: '' })).rejects.toThrow(/now is required/);
  });
});
