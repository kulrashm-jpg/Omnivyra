/**
 * WS-6 — the canonical spine reaching the scoring engines.
 *
 * The seams under test are NOT mocked. WS-5 and WS-7 run for real over a stub
 * database, and the assembled context is fed to the real
 * `assembleLeadUnderstanding`, so what is proven is the actual path from
 * canonical rows to a blended, explainable score. Doubling the seams would pass
 * even if WS-6 never called them.
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
    const iss: Array<[string, unknown]> = [];
    const rows = (): Row[] => (db.tables[table] ??= []);
    const run = async () => {
      await Promise.resolve();
      const err = db.errors[table];
      if (err) return { data: null, error: err };
      const matched = rows().filter((r) =>
        eqs.every(([c, v]) => r[c] === v)
        && ins.every(([c, vs]) => vs.includes(r[c] as never))
        && iss.every(([c, v]) => (r[c] ?? null) === v));
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      is: (c: string, v: unknown) => { iss.push([c, v]); return api; },
      order: () => api,
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
  PROSPECT_CONTEXT_VERSION,
  MAPPABLE_BUYING_ROLES,
  buildProspectIntelligenceContext,
  defaultProspectContextPorts,
  type ProspectContextPorts,
} from '../../services/leadUnderstanding/prospectContext';
import { assembleLeadUnderstanding } from '../../services/leadUnderstanding/engines/assembly';
import { runProspectIcpFit } from '../../services/leadUnderstanding/engines/prospectIcpFit';
import { SCORE_DIMENSIONS } from '../../services/leadUnderstanding/types';
import { BUYING_ROLES } from '../../services/prospectIdentity/attributes';
import type { RatifiedIcp } from '../../services/prospectIcp/types';

const readFile = (p: string): string =>
  require('fs').readFileSync(require('path').join(__dirname, p), 'utf8');

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const LEAD = 'lead-1';
const PERSON = 'person-1';
const ACCOUNT = 'account-1';
const ASOF = '2026-09-04T00:00:00.000Z';

/** One ICP, two subjects — the shape D1's evaluator was written for. */
const ratified = (over: Partial<RatifiedIcp> = {}): RatifiedIcp => ({
  organizationId: ORG_A,
  icpId: '11111111-1111-4111-8111-111111111111',
  icpKey: 'default',
  version: 1,
  criteria: [
    { id: 'c1', kind: 'required', subject: 'person', attribute: 'seniority', predicate: { op: 'one_of', values: ['director', 'vp'] } },
    { id: 'c2', kind: 'required', subject: 'account', attribute: 'industry', predicate: { op: 'one_of', values: ['fintech'] } },
  ],
  ratifiedAt: '2026-08-01T00:00:00.000Z',
  ratifiedBy: '22222222-2222-4222-8222-222222222222',
  ...over,
});

const seedProspect = (org: string, id: string, personId: string | null) => {
  (db.tables.canonical_leads ??= []).push({ id, company_id: org, unified_person_id: personId });
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
const seedThread = (org: string, id: string, personId: string | null, over: Row = {}) => {
  (db.tables.engagement_threads ??= []).push({
    id, organization_id: org, unified_person_id: personId, platform: 'linkedin',
    contact_id: null, created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z', ...over,
  });
};
const seedMessage = (id: string, threadId: string, over: Row = {}) => {
  (db.tables.engagement_messages ??= []).push({
    id, thread_id: threadId, platform: 'linkedin', direction: 'inbound',
    message_type: 'comment', platform_created_at: '2026-09-02T00:00:00.000Z',
    created_at: '2026-09-02T06:00:00.000Z', ...over,
  });
};
const seedSignal = (org: string, id: string, over: Row = {}) => {
  (db.tables.lead_signals ??= []).push({
    id, organization_id: org, source_type: 'engagement', source_id: `src-${id}`,
    thread_id: 'thread-1', contact_id: null, platform: 'linkedin',
    intent_score: 70, urgency_score: 40, icp_score: 55, confidence_score: 0.8,
    total_score: 65, detected_at: '2026-09-03T00:00:00.000Z',
    migration_source: 'engagement_pipeline', ...over,
  });
};

/** Ports whose ONLY double is the ICP read — everything else is the real seam. */
const portsWithIcp = (icp: RatifiedIcp | null): ProspectContextPorts => ({
  ...defaultProspectContextPorts,
  async loadRatifiedIcp(org) { return org === ORG_A ? icp : null; },
});

const build = (
  over: Partial<Parameters<typeof buildProspectIntelligenceContext>[0]> = {},
  icp: RatifiedIcp | null = null,
) => buildProspectIntelligenceContext(
  { organizationId: ORG_A, prospectId: LEAD, asOf: ASOF, ...over }, portsWithIcp(icp),
);

/** A fully populated tenant: prospect → person → account, engagement, signals. */
const seedFull = () => {
  seedProspect(ORG_A, LEAD, PERSON);
  seedPerson(ORG_A, PERSON, ACCOUNT);
  seedAccount(ORG_A, ACCOUNT);
  seedThread(ORG_A, 'thread-1', PERSON);
  seedMessage('m-1', 'thread-1', { platform_created_at: '2026-09-01T00:00:00.000Z' });
  seedMessage('m-2', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });
  seedSignal(ORG_A, 's-1');
};

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — evidence reaches the engines', () => {
  it('WS-5 engagement becomes behavioural evidence the engines can read', async () => {
    seedFull();
    const built = await build();
    expect(built!.version).toBe(PROSPECT_CONTEXT_VERSION);
    // Two messages + one signal, all dated.
    expect(built!.context.behaviour).toHaveLength(3);
    expect(built!.context.behaviouralHistory).toHaveLength(3);
    expect(built!.context.behaviour!.map((b) => b.source).sort())
      .toEqual(['engagement_messages', 'engagement_messages', 'lead_signals']);
  });

  it('WS-7 account intelligence supplies identity and account facts', async () => {
    seedFull();
    const built = await build();
    expect(built!.context.identity).toMatchObject({
      title: 'VP Engineering', department: 'Engineering', seniority: 'vp', organization: 'Acme Ltd',
    });
    expect(built!.context.account!.attributes).toMatchObject({ industry: 'fintech' });
    expect(built!.sources.account).toBe(true);
  });

  it('the ratified ICP arrives already resolved — engines perform no I/O', async () => {
    seedFull();
    const built = await build({}, ratified());
    expect(built!.context.ratifiedIcp!.icpId).toBe('11111111-1111-4111-8111-111111111111');
    expect(built!.sources.ratifiedIcp).toBe(true);
    // The engine contract: it reads ctx, never a database. Comments are
    // stripped — the header DOCUMENTS that `getRatifiedIcp` is the caller's
    // job, and that prose is the contract, not a violation of it.
    const code = readFile('../../services/leadUnderstanding/engines/prospectIcpFit.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('ownedDbTable');
    expect(code).not.toContain('getRatifiedIcp');
  });

  it('buying roles reach the relationship engine, mapped only where both vocabularies agree', async () => {
    seedFull();
    seedPerson(ORG_A, 'person-2', ACCOUNT, { buying_role: 'economic_buyer' });
    seedPerson(ORG_A, 'person-3', ACCOUNT, { buying_role: null });

    const built = await build();
    const byPerson = Object.fromEntries(built!.context.relationships!.map((r) => [r.personId, r.role]));
    expect(byPerson[PERSON]).toBe('decision_maker');
    // `economic_buyer` has no RelationshipRole counterpart. Contributed WITHOUT
    // a role rather than mapped to a role that resembles it.
    expect(byPerson['person-2']).toBeUndefined();
    expect(byPerson['person-3']).toBeUndefined();
    expect(built!.gaps.find((g) => g.kind === 'buying_role_outside_relationship_vocabulary'))
      .toMatchObject({ count: 1 });
  });

  it('the mappable role set is the INTERSECTION of both vocabularies, not a hand list', () => {
    for (const r of MAPPABLE_BUYING_ROLES) expect(BUYING_ROLES as readonly string[]).toContain(r);
    expect(MAPPABLE_BUYING_ROLES).not.toContain('economic_buyer');
    expect(MAPPABLE_BUYING_ROLES).not.toContain('unknown');
  });

  it('writes nothing — building a context is a read', async () => {
    seedFull();
    await build({}, ratified());
    expect(db.writeOps).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — evidence that cannot be mapped is reported, never coerced', () => {
  it('lead_signals do NOT become buying signals — there is no vocabulary bridge', async () => {
    seedFull();
    const built = await build();
    // `RawSignal.type` is a closed buying-signal vocabulary; `source_type` is
    // only engagement/listening. Choosing one would invent an observation.
    expect(built!.context.signals).toBeUndefined();
    expect(built!.gaps.find((g) => g.kind === 'signals_have_no_buying_signal_type'))
      .toMatchObject({ count: 1 });
    // The evidence still arrives, honestly labelled.
    expect(built!.context.behaviour!.some((b) => b.source === 'lead_signals')).toBe(true);
  });

  it('undated evidence is EXCLUDED and counted, never back-dated to asOf', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, null);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedMessage('m-dated', 'thread-1', { platform_created_at: '2026-09-01T00:00:00.000Z' });
    seedMessage('m-undated', 'thread-1', { platform_created_at: null, created_at: null });

    const built = await build();
    expect(built!.context.behaviour).toHaveLength(1);
    expect(built!.context.behaviour![0].observedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(JSON.stringify(built!.context.behaviour)).not.toContain(ASOF);
    expect(built!.gaps.find((g) => g.kind === 'evidence_without_observation_time'))
      .toMatchObject({ count: 1 });
  });

  it('no buying STAGE is inferred from a message', async () => {
    seedFull();
    const built = await build();
    for (const e of built!.context.behaviouralHistory!) expect(e.stage).toBeUndefined();
  });

  it('account geography never becomes the person\'s geography', async () => {
    seedFull();
    seedAccount(ORG_A, 'account-2', { region: 'APAC', country_code: 'IN' });
    const built = await build();
    expect(built!.context.identity!.geography).toBeUndefined();
  });

  it('only facts the account HOLDS are offered; a missing one is omitted, not falsified', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT);
    seedAccount(ORG_A, ACCOUNT, { industry: 'fintech', employee_count: null, founded_year: null });
    const attrs = (await build())!.context.account!.attributes;
    expect(attrs).toMatchObject({ industry: 'fintech' });
    expect(attrs).not.toHaveProperty('employee_count');
    expect(attrs).not.toHaveProperty('founded_year');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — scoring reuses the existing formula, unchanged', () => {
  it('the frozen dimension set is untouched', () => {
    expect(SCORE_DIMENSIONS).toEqual(['intent', 'icp', 'urgency', 'opportunity', 'priority']);
  });

  it('the context builder defines no weight, threshold or formula', () => {
    const code = readFile('../../services/leadUnderstanding/prospectContext.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['weight', 'threshold', 'combineScores', 'combineDimension', 'SCORE_DIMENSIONS']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('a real context produces a blended, explainable score through the real assembly', async () => {
    seedFull();
    const built = await build({}, ratified());
    const { understanding, engines } = assembleLeadUnderstanding(built!.context);

    expect(engines).toHaveLength(12);
    // Evidence reached the engines: intent is computable rather than abstaining.
    expect(understanding.score.dimensions.intent.abstained).toBe(false);
    expect(understanding.score.dimensions.intent.value).not.toBeNull();
    expect(understanding.score.dimensions.icp.abstained).toBe(false);
    expect(understanding.builtAt).toBe(ASOF);
  });

  it('component scores, contributors and evidence are all traceable (FR-13)', async () => {
    seedFull();
    const built = await build({}, ratified());
    const { understanding } = assembleLeadUnderstanding(built!.context);

    for (const d of SCORE_DIMENSIONS) {
      expect(understanding.score.dimensions[d]).toHaveProperty('value');
      expect(understanding.score.dimensions[d]).toHaveProperty('confidence');
      expect(understanding.score.dimensions[d]).toHaveProperty('contributors');
    }
    expect(understanding.score.dimensions.icp.contributors).toContain('prospect_icp');
    expect(understanding.reasoning.length).toBeGreaterThan(0);
    // The missing inputs travel with the answer rather than being inferred later.
    expect(Array.isArray(built!.gaps)).toBe(true);
  });

  it('the context version and the reference time are both identifiable', async () => {
    seedFull();
    const built = await build({}, ratified());
    expect(built!.version).toBe(PROSPECT_CONTEXT_VERSION);
    expect(built!.context.asOf).toBe(ASOF);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 (FR-16) — company fit, as D1 designed it: two evaluations, one ICP', () => {
  it('the ACCOUNT subject is evaluated when account facts exist', async () => {
    seedFull();
    const built = await build({}, ratified());
    const out = runProspectIcpFit(built!.context);
    expect(out.abstained).toBe(false);
    // One contribution per subject, both on the `icp` dimension.
    expect(out.contributions).toHaveLength(2);
    expect(new Set(out.contributions.map((c) => c.dimension))).toEqual(new Set(['icp']));
    expect(out.reasoning.map((r) => r.claim).sort())
      .toEqual(['ratified_icp_fit', 'ratified_icp_fit:account']);
  });

  it('person fit and account fit stay distinguishable in the evidence trail', async () => {
    seedFull();
    const out = runProspectIcpFit((await build({}, ratified()))!.context);
    const labels = out.evidence.map((e) => e.label).sort();
    expect(labels).toEqual(['ratified_icp_fit', 'ratified_icp_fit:account']);
  });

  it('no account ⇒ the account subject is NOT evaluated, and person fit still is', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, null);                 // no account
    const built = await build({}, ratified());
    expect(built!.context.account).toBeUndefined();

    const out = runProspectIcpFit(built!.context);
    expect(out.abstained).toBe(false);
    expect(out.contributions).toHaveLength(1);       // person only, never a zero for the account
    expect(built!.gaps.find((g) => g.kind === 'no_account')).toBeTruthy();
  });

  it('no ratified ICP ⇒ NO contribution at all, not a zero (contract 18)', async () => {
    seedFull();
    const built = await build({}, null);
    const out = runProspectIcpFit(built!.context);
    expect(out.abstained).toBe(true);
    expect(out.contributions).toEqual([]);
    expect(built!.gaps.find((g) => g.kind === 'no_ratified_icp')).toBeTruthy();

    const { understanding } = assembleLeadUnderstanding(built!.context);
    expect(understanding.score.dimensions.icp.value).not.toBe(0);
  });

  it('WS-6 ratifies nothing and mutates no ICP', () => {
    const code = readFile('../../services/leadUnderstanding/prospectContext.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', 'ratifyIcpVersion', 'createIcpVersion']) {
      expect(code).not.toContain(verb);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — absence is never a score', () => {
  it('no engagement produces no observations, and the dimension ABSTAINS', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT);
    seedAccount(ORG_A, ACCOUNT);

    const built = await build();
    expect(built!.context.behaviour).toEqual([]);
    const { understanding } = assembleLeadUnderstanding(built!.context);
    // Abstention, not zero. A prospect nobody contacted is unmeasured, not cold.
    expect(understanding.score.dimensions.intent.abstained).toBe(true);
    expect(understanding.score.dimensions.intent.value).toBeNull();
  });

  it('adds no inactivity penalty anywhere', () => {
    const code = readFile('../../services/leadUnderstanding/prospectContext.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['penalty', 'inactiv', 'decay', 'dormant', 'cold']) {
      expect(code.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('a prospect with no person reports the gap and fabricates nothing', async () => {
    seedProspect(ORG_A, LEAD, null);
    const built = await build();
    expect(built!.gaps.find((g) => g.kind === 'no_person')).toBeTruthy();
    expect(built!.context.behaviour).toEqual([]);
    expect(built!.context.relationships).toEqual([]);
    expect(built!.context.account).toBeUndefined();
    expect(built!.sources).toEqual({ engagement: false, account: false, ratifiedIcp: false });
  });

  it('an incomplete account still contributes what it has', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT, { job_title: null, seniority: null });
    seedAccount(ORG_A, ACCOUNT, { name: null, industry: null });
    const built = await build();
    expect(built!.context.identity!.title).toBeUndefined();
    expect(built!.context.account!.attributes).toEqual({});
    expect(built!.sources.account).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — determinism', () => {
  it('identical inputs and reference time produce an identical context', async () => {
    seedFull();
    const a = await build({}, ratified());
    const b = await build({}, ratified());
    expect(b).toEqual(a);
  });

  it('identical contexts produce an identical Understanding', async () => {
    seedFull();
    const built = await build({}, ratified());
    const first = assembleLeadUnderstanding(built!.context);
    const second = assembleLeadUnderstanding(built!.context);
    expect(second.understanding.score).toEqual(first.understanding.score);
    expect(second.understanding.builtAt).toBe(first.understanding.builtAt);
  });

  it('the builder calls no clock and draws no random value', () => {
    const code = readFile('../../services/leadUnderstanding/prospectContext.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['Date.now', 'new Date(', 'Math.random']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('a different reference time changes only what depends on it', async () => {
    seedFull();
    const early = await build({ asOf: '2026-09-04T00:00:00.000Z' }, ratified());
    const late = await build({ asOf: '2026-12-01T00:00:00.000Z' }, ratified());
    expect(late!.context.asOf).not.toBe(early!.context.asOf);
    // Observation times are the SOURCE's and do not move with the clock.
    expect(late!.context.behaviour).toEqual(early!.context.behaviour);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — tenant isolation across the whole read path', () => {
  it('Tenant A cannot score Tenant B\'s Prospect', async () => {
    seedProspect(ORG_B, LEAD, PERSON);
    expect(await build()).toBeNull();
  });

  it('Tenant B\'s account is not reachable through a shared person id', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT);
    seedAccount(ORG_B, ACCOUNT);                     // account exists only in B
    const built = await build();
    expect(built!.context.account).toBeUndefined();
    expect(built!.gaps.find((g) => g.kind === 'no_account')).toBeTruthy();
  });

  it('Tenant B\'s engagement and signals never reach Tenant A\'s context', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, null);
    seedThread(ORG_B, 'thread-b', PERSON);           // same person id, other tenant
    seedMessage('m-b', 'thread-b');
    seedSignal(ORG_B, 's-b', { thread_id: 'thread-b' });
    const built = await build();
    expect(built!.context.behaviour).toEqual([]);
  });

  it('Tenant B\'s ICP is never used for Tenant A', async () => {
    seedFull();
    // The port answers only for ORG_A; a B-scoped read must yield nothing.
    const built = await buildProspectIntelligenceContext(
      { organizationId: ORG_A, prospectId: LEAD, asOf: ASOF },
      { ...defaultProspectContextPorts, async loadRatifiedIcp(org) { return org === ORG_B ? ratified() : null; } },
    );
    expect(built!.context.ratifiedIcp).toBeNull();
    expect(built!.gaps.find((g) => g.kind === 'no_ratified_icp')).toBeTruthy();
  });

  it('every read carries its tenant column', async () => {
    seedFull();
    await build({}, ratified());
    for (const [table, column] of [
      ['canonical_leads', 'company_id'],
      ['unified_persons', 'company_id'],
      ['prospect_accounts', 'organization_id'],
      ['engagement_threads', 'organization_id'],
      ['lead_signals', 'organization_id'],
    ] as Array<[string, string]>) {
      expect(db.filters).toContainEqual({ table, column, value: ORG_A });
    }
  });

  it('refuses tenant-less access and ambient time', async () => {
    await expect(build({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(build({ prospectId: '' })).rejects.toThrow(/prospectId is required/);
    await expect(build({ asOf: '' })).rejects.toThrow(/asOf is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-6 — the runtime stays dark, and failures stay visible', () => {
  it('nothing here enables the Lead Understanding runtime', () => {
    expect(process.env.LEAD_UNDERSTANDING_ENABLED).not.toBe('true');
    const code = readFile('../../services/leadUnderstanding/prospectContext.ts');
    expect(code).not.toContain('LEAD_UNDERSTANDING_ENABLED');
    expect(code).not.toContain('isLeadUnderstandingEnabled');
  });

  it('an unreadable canonical table fails safely, with the table named', async () => {
    db.errors.canonical_leads = { message: 'connection reset' };
    await expect(build()).rejects.toThrow(/canonical_leads read failed: connection reset/);
  });

  it('a seam failure yields no partial context', async () => {
    seedFull();
    const ports: ProspectContextPorts = {
      ...defaultProspectContextPorts,
      async loadAccount() { throw new Error('downstream unavailable'); },
    };
    await expect(buildProspectIntelligenceContext(
      { organizationId: ORG_A, prospectId: LEAD, asOf: ASOF }, ports,
    )).rejects.toThrow('downstream unavailable');
    expect(db.writeOps).toEqual([]);
  });
});
