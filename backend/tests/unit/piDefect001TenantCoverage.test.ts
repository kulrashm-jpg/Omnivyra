/**
 * PI-DEFECT-001 — the enrichment subsystem was unreachable behind an omitted
 * argument.
 *
 * THE DEFECT
 * `executeProspectEnrichment` built its plan with `ingestionEnrichmentCoverage()`
 * — no statuses. That helper documents that `statuses` is optional and ABSENT
 * MEANS NONE, which is a deliberate safety property: a caller that has not
 * resolved a tenant's provider credentials must not be able to publish a global
 * capability as a tenant one. The boundary HAD resolved them; it resolved them
 * twenty lines further down, for `executePlannedField`, and never handed them to
 * the planner. Coverage was therefore
 * `{ marketPulse: [], external: {}, verifiedExternal: [] }`, every field's action
 * became `no_available_source`, and the `action !== 'enrich'` guard returned
 * `not_planned` before the executor could be reached. Twenty-seven files of
 * adapters, leases, spend ceiling and retry consumer could not be entered by a
 * tenant holding a working credential.
 *
 * WHAT IS PROVEN HERE
 * Not by reading the source — by running the REAL planner and the REAL coverage
 * derivation over a stub database, exactly as `piWs10ProspectApi.test.ts` does.
 * Only two things are doubled: the credential store (so a synthetic key can
 * stand for a tenant subscription) and `executePlannedField` (so nothing reaches
 * a provider). If the argument is removed again, the first test fails with
 * `not_planned`.
 *
 * The negative tests are the load-bearing ones. A tenant WITHOUT a credential
 * must still be refused, and must be refused by the planner rather than by the
 * executor — the safety default is preserved, not weakened, and supplying
 * statuses at this one call site changes nothing for a tenant that has none.
 *
 * SECRETS: all synthetic. No credential is created, no provider is contacted.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

type Row = Record<string, unknown>;

/** The stub spine, mirroring the mock-db style WS-10's tests already use. */
const db = {
  tables: {} as Record<string, Row[]>,
  writeOps: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const rows = (): Row[] => (db.tables[table] ??= []);
    const run = async () => {
      await Promise.resolve();
      const matched = rows().filter((r) =>
        eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c] as never)));
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); return api; },
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

/**
 * The tenant credential store, doubled.
 *
 * The real store encrypts at rest, so a fixture row cannot be decrypted without
 * standing up the cipher. What matters to this defect is only the ANSWER the
 * port gives — "this tenant has a key for this provider" — so that answer is
 * supplied directly and the recorded calls double as proof that it is asked for
 * exactly once per execution.
 */
const credentialReads: Array<{ companyId: string; providerKey: string }> = [];
let tenantSubscribed = true;
jest.mock('../../services/integrationCredentialService', () => ({
  ...jest.requireActual('../../services/integrationCredentialService'),
  getProviderCredentials: async (companyId: string, providerKey: string) => {
    credentialReads.push({ companyId, providerKey });
    // Synthetic. Never a real key, and never read from the environment.
    return tenantSubscribed ? { api_key: 'synthetic-not-a-credential' } : {};
  },
}));

/** The canonical executor, doubled: this suite must reach it, never past it. */
const executeField = jest.fn(async () => ({ executed: true, outcome: 'enriched' }));
jest.mock('../../services/enrichment/execution', () => ({
  executePlannedField: (...args: unknown[]) => executeField(...(args as [])),
}));

import {
  executeProspectEnrichment,
  getProspectDetail,
} from '../../apiHandlers/prospects/prospectIntelligenceRead';
import { ACQUISITION_SOURCES, type SourceStatus } from '../../services/enrichment/providers/sources';
import { getProvider } from '../../services/enrichment/providers';

/**
 * Derived, never named.
 *
 * Which providers a credentialled tenant can reach is a property of the A3
 * registry plus the adapters that exist, and both move. Writing a provider name
 * into an assertion would turn this into a test of today's catalogue; deriving
 * it keeps it a test of the WIRING, which is the thing that broke.
 */
const EXECUTABLE = ACQUISITION_SOURCES
  .filter((s) => s.credentialEnvVar && getProvider(s.id))
  .map((s) => s.id);

/** Of those, the ones that declare account.employee_count — the field under test. */
const COVERING = ACQUISITION_SOURCES
  .filter((s) => EXECUTABLE.includes(s.id)
    && s.capabilities.entities.includes('account')
    && s.capabilities.attributes.includes('employee_count'))
  .map((s) => s.id);

/** An account column NO executable provider declares — the honest refusal case. */
const UNCOVERED_ATTRIBUTE = 'annual_revenue';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const LEAD = 'lead-1';
const PERSON = 'person-1';
const ACCOUNT = 'account-1';
const NOW = '2026-09-04T00:00:00.000Z';

/** A prospect whose employer has no employee_count — a genuine, missing gap. */
const seedProspect = () => {
  (db.tables.canonical_leads ??= []).push({
    id: LEAD, company_id: ORG, unified_person_id: PERSON, source: 'crm',
    external_lead_key: 'EXT-1', created_at: '2026-09-01T00:00:00.000Z', qualification_score: 0,
  });
  (db.tables.unified_persons ??= []).push({
    id: PERSON, company_id: ORG, account_id: ACCOUNT, job_title: 'VP Engineering',
    department: 'Engineering', seniority: 'vp', authority: null, influence: null,
    buying_role: 'decision_maker',
  });
  (db.tables.prospect_accounts ??= []).push({
    id: ACCOUNT, organization_id: ORG, name: 'Acme Ltd', domain_normalized: 'acme.test',
    status: 'active', merged_into_id: null, confidence: 0.8,
    first_seen_at: '2026-08-01T00:00:00.000Z', last_verified_at: null,
    attributes_source: 'crm', attributes_updated_at: '2026-09-02T00:00:00.000Z',
    industry: 'fintech',
    // employee_count deliberately absent — the field under test.
  });
};

/** Enough engagement that the READ surface returns a detail at all. */
const seedEngagement = () => {
  (db.tables.engagement_threads ??= []).push({
    id: 'thread-1', organization_id: ORG, unified_person_id: PERSON, platform: 'linkedin',
    contact_id: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z',
  });
  for (let i = 1; i <= 6; i += 1) {
    (db.tables.engagement_messages ??= []).push({
      id: `m-${i}`, thread_id: 'thread-1', platform: 'linkedin', direction: 'inbound',
      message_type: 'comment',
      platform_created_at: `2026-09-0${i > 3 ? 3 : i}T0${i}:00:00.000Z`,
      created_at: `2026-09-0${i > 3 ? 3 : i}T0${i}:00:00.000Z`,
    });
  }
};

const run = (over: Record<string, unknown> = {}) => executeProspectEnrichment({
  organizationId: ORG, prospectId: LEAD,
  attribute: 'employee_count', subject: 'account',
  now: NOW,
  ...over,
} as Parameters<typeof executeProspectEnrichment>[0]);

/** What the boundary handed the canonical executor. */
const sentInput = () => (executeField.mock.calls[0] as unknown as Array<Record<string, unknown>>)[0];

beforeEach(() => {
  db.tables = {};
  db.writeOps = [];
  credentialReads.length = 0;
  tenantSubscribed = true;
  jest.clearAllMocks();
  executeField.mockImplementation(async () => ({ executed: true, outcome: 'enriched' } as never));
  seedProspect();
});

// ════════════════════════════════════════════════════════════════════════════
describe('PI-DEFECT-001 — the execute path plans against the tenant\'s real sources', () => {
  it('a connected tenant gets action=enrich and REACHES execution', async () => {
    // The defect in one assertion: before the fix this returned
    // { status: 'not_planned', reason: 'no_available_source: ...' }.
    const out = await run();
    expect(out.status).toBe('executed');
    expect(executeField).toHaveBeenCalledTimes(1);
  });

  it('the field the executor received was planned as enrich, on a connected source', async () => {
    await run();
    const field = sentInput().field as Record<string, unknown>;
    expect(field.attribute).toBe('employee_count');
    expect(field.subject).toBe('account');
    expect(field.action).toBe('enrich');
    expect(COVERING).toContain(field.source);
    expect(field.sourceStatus).toBe('connected');
    // Tenant-funded: the vendor invoices the tenant, so no price is invented.
    expect(field.cost).toEqual({ kind: 'unknown' });
  });

  it('the plan itself offers the field for enrichment, not merely the executor', async () => {
    await run();
    const plan = sentInput().plan as { toEnrich: Array<{ attribute: string; source: string | null }> };
    const offered = plan.toEnrich.find((f) => f.attribute === 'employee_count');
    expect(offered).toBeDefined();
    expect(COVERING).toContain(offered!.source);
  });

  it('resolves the tenant\'s statuses ONCE and feeds both the planner and the executor', async () => {
    await run();
    // Exactly one read per descriptor that has both an env var and a registered
    // adapter — never two rounds. A second resolution would mean the plan and
    // the call it authorises were built from separate lookups that can disagree.
    expect(EXECUTABLE.length).toBeGreaterThan(0);
    expect(credentialReads).toHaveLength(EXECUTABLE.length);
    expect(credentialReads.map((r) => r.providerKey).sort()).toEqual([...EXECUTABLE].sort());
    for (const read of credentialReads) expect(read.companyId).toBe(ORG);

    const statuses = sentInput().statuses as readonly SourceStatus[];
    for (const id of COVERING) {
      expect(statuses.find((s) => s.id === id)!.connectionState).toBe('connected');
    }
  });

  it('still sends the mandatory safety configuration — nothing was traded for reachability', async () => {
    await run();
    expect(sentInput().requireAttemptRecord).toBe(true);
  });

  it('covers only what a provider actually declares — an uncovered attribute is still refused', async () => {
    // Coverage is the registry's answer, not a blanket "this tenant is connected".
    for (const s of ACQUISITION_SOURCES) {
      expect(s.capabilities.attributes).not.toContain(UNCOVERED_ATTRIBUTE);
    }
    const out = await run({ attribute: UNCOVERED_ATTRIBUTE });
    expect(out).toMatchObject({ status: 'not_planned' });
    expect(out.status === 'not_planned' && out.reason).toMatch(/^no_available_source:/);
    expect(executeField).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('PI-DEFECT-001 — the "absent means none" safety property is preserved', () => {
  it('a tenant with NO provider credential is still refused, by the planner', async () => {
    tenantSubscribed = false;
    const out = await run();
    expect(out).toMatchObject({ status: 'not_planned' });
    expect(out.status === 'not_planned' && out.reason).toMatch(/^no_available_source:/);
    // Refused BEFORE the executor, so no adapter, cost or egress is approached.
    expect(executeField).not.toHaveBeenCalled();
  });

  it('a global environment key cannot substitute for the tenant\'s own', async () => {
    tenantSubscribed = false;
    // Every executable provider's platform env var set at once, so the proof is
    // not limited to whichever one the catalogue happens to list first.
    const envVars = ACQUISITION_SOURCES
      .filter((s) => EXECUTABLE.includes(s.id))
      .map((s) => s.credentialEnvVar as string);
    const before = envVars.map((v) => [v, process.env[v]] as const);
    for (const v of envVars) process.env[v] = 'synthetic-global-key-not-a-tenant-credential';
    try {
      const out = await run();
      expect(out).toMatchObject({ status: 'not_planned' });
      expect(executeField).not.toHaveBeenCalled();
    } finally {
      for (const [v, prior] of before) {
        if (prior === undefined) delete process.env[v];
        else process.env[v] = prior;
      }
    }
  });

  it('a blank tenant is refused before any credential store read', async () => {
    await expect(run({ organizationId: '' })).rejects.toThrow(/organizationId is required/);
    expect(credentialReads).toEqual([]);      // no lookup widened by an empty tenant
    expect(executeField).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('PI-DEFECT-001 — the READ surface shows the same plan the write path would run', () => {
  it('the displayed plan names the connected source, instead of reporting none', async () => {
    seedEngagement();
    const detail = await getProspectDetail({ organizationId: ORG, prospectId: LEAD, now: NOW });
    const plan = detail!.enrichment.data as { fields: Array<Record<string, unknown>> };
    const field = plan.fields.find((f) => f.attribute === 'employee_count' && f.subject === 'account')!;
    expect(field.action).toBe('enrich');
    expect(COVERING).toContain(field.source);
  });

  it('and reports none again when the tenant has no credential', async () => {
    tenantSubscribed = false;
    seedEngagement();
    const detail = await getProspectDetail({ organizationId: ORG, prospectId: LEAD, now: NOW });
    const plan = detail!.enrichment.data as { fields: Array<Record<string, unknown>> };
    const field = plan.fields.find((f) => f.attribute === 'employee_count' && f.subject === 'account')!;
    expect(field.action).toBe('no_available_source');
  });

  it('the read surface still writes nothing to obtain it', async () => {
    seedEngagement();
    await getProspectDetail({ organizationId: ORG, prospectId: LEAD, now: NOW });
    expect(db.writeOps).toEqual([]);
    expect(executeField).not.toHaveBeenCalled();
  });
});
