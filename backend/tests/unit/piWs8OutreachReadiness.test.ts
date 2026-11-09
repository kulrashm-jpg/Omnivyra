/**
 * WS-8 (FR-24 · FR-25) — next best action, and permission to act on it.
 *
 * Nothing downstream of WS-6 is mocked. The real spine is seeded, the real
 * `buildProspectIntelligenceContext` runs, the real assembly produces the
 * recommendation and the real `mayContact` decides eligibility — so what is
 * proven is the whole path, not a set of doubles agreeing with each other.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string } | undefined>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  writeOps: [] as string[],
};

/**
 * P0 — the database's own read instant, as PostgREST would serve it.
 *
 * `read_at` is the computed field `public.read_at(public.contact_governance_records)`,
 * which returns `transaction_timestamp()`. PostgREST runs one transaction per
 * request, so every row of one response carries the IDENTICAL value, and that is
 * what the stand-in below reproduces. The shape is PostgreSQL's, not JS's: `T`
 * separated, microsecond precision, and an EXPLICIT `+00:00` offset — Postgres
 * never renders a `timestamptz` as `Z`.
 *
 * It is deliberately 1.25 s AFTER `NOW`, the caller's instant. Two different
 * values is the whole point: a test can then seed a restriction that starts
 * BETWEEN them and prove which clock decided. Since Part 3A nothing compares
 * the two, so the gap can be any size — these tests use a small one only to
 * show that even a small one is decisive.
 */
const DB_READ_AT = '2026-09-04T00:00:01.250000+00:00';

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
      // The governance table is read through the computed field in production,
      // so the double serves it. Omitting it is INDETERMINATE, not permissive —
      // `contactGovernanceAggregation` fails closed on rows with no instant —
      // which is why every seeded row carries one here.
      return {
        data: table === 'contact_governance_records'
          ? matched.map((r) => ({ read_at: DB_READ_AT, ...r }))
          : matched,
        error: null,
      };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      is: (c: string, v: unknown) => { iss.push([c, v]); return api; },
      or: () => api,
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
  OUTREACH_READINESS_VERSION,
  HISTORICAL_GOVERNANCE_REASON,
  assessOutreachReadiness,
  toNextBestAction,
  resolveGovernanceChannel,
  defaultOutreachReadinessPorts,
  type OutreachReadinessPorts,
} from '../../services/prospectOutreach/readiness';
import {
  buildProspectIntelligenceContext,
  defaultProspectContextPorts,
  type ProspectContextResult,
} from '../../services/leadUnderstanding/prospectContext';
import { assembleLeadUnderstanding } from '../../services/leadUnderstanding/engines/assembly';
import { KNOWN_CHANNELS } from '../../services/prospectIdentity/contactGovernance';
import type { RatifiedIcp } from '../../services/prospectIcp/types';

const readFile = (p: string): string =>
  require('fs').readFileSync(require('path').join(__dirname, p), 'utf8');

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const LEAD = 'lead-1';
const PERSON = 'person-1';
const ACCOUNT = 'account-1';
const NOW = '2026-09-04T00:00:00.000Z';

const ratified = (): RatifiedIcp => ({
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
const seedThread = (org: string, id: string, personId: string | null) => {
  (db.tables.engagement_threads ??= []).push({
    id, organization_id: org, unified_person_id: personId, platform: 'linkedin',
    contact_id: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z',
  });
};
const seedMessage = (id: string, threadId: string, at: string) => {
  (db.tables.engagement_messages ??= []).push({
    id, thread_id: threadId, platform: 'linkedin', direction: 'inbound',
    message_type: 'comment', platform_created_at: at, created_at: at,
  });
};
const seedGovernance = (org: string, id: string, over: Row = {}) => {
  (db.tables.contact_governance_records ??= []).push({
    id, organization_id: org, person_id: PERSON, target_normalized: null,
    channel: 'email', governance_type: 'dnc_permanent', source: 'manual',
    effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, ...over,
  });
};

const portsWithIcp = (icp: RatifiedIcp | null) => ({
  ...defaultProspectContextPorts,
  async loadRatifiedIcp(org: string) { return org === ORG_A ? icp : null; },
});

const buildCtx = (
  over: Partial<Parameters<typeof buildProspectIntelligenceContext>[0]> = {},
  icp: RatifiedIcp | null = ratified(),
) => buildProspectIntelligenceContext(
  { organizationId: ORG_A, prospectId: LEAD, asOf: NOW, ...over }, portsWithIcp(icp),
);

/** A prospect with enough evidence that the engine does NOT abstain. */
const seedEngaged = (org = ORG_A) => {
  seedProspect(org, LEAD, PERSON);
  seedPerson(org, PERSON, ACCOUNT);
  seedAccount(org, ACCOUNT);
  seedThread(org, 'thread-1', PERSON);
  for (let i = 1; i <= 6; i += 1) {
    seedMessage(`m-${i}`, 'thread-1', `2026-09-0${i > 3 ? 3 : i}T0${i}:00:00.000Z`);
  }
};

const assess = async (
  // `historicalAsOf` is REQUIRED on the input, so the default is stated here
  // once and overridden per test rather than being implicit anywhere.
  over: { target?: string | null; now?: string; historicalAsOf?: boolean } = {},
  icp: RatifiedIcp | null = ratified(),
) => {
  const built = await buildCtx({}, icp);
  return assessOutreachReadiness({
    built: built as ProspectContextResult, now: NOW, historicalAsOf: false, ...over,
  });
};

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — the canonical recommendation engine, reused', () => {
  it('the NBA is reshaped from the assembly facet, not recomputed', async () => {
    seedEngaged();
    const built = await buildCtx();
    const { understanding } = assembleLeadUnderstanding(built!.context);
    const nba = toNextBestAction(built!, understanding);

    expect(nba.abstained).toBe(false);
    expect(nba.action).toBe(understanding.facets.recommendations!.value!.nextAction);
    expect(nba.channel).toBe(understanding.facets.recommendations!.value!.nextChannel);
    expect(nba.timing).toBe(understanding.facets.recommendations!.value!.nextTiming);
    expect(nba.confidence).toBe(understanding.facets.recommendations!.confidence);
  });

  it('adds no second producer — no action vocabulary, no threshold, no channel rule', () => {
    const code = readFile('../../services/prospectOutreach/readiness.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'personalized_outreach', 'nurture_sequence', 'monitor',
      'buildLeadActionPlan', 'threshold', 'weight',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('leaves the retained legacy read-side producer untouched (C-7)', () => {
    // `leadActions.buildLeadActionPlan` stays live for the existing UI. WS-8
    // neither deletes it nor makes it a second canonical producer.
    expect(require('fs').existsSync(
      require('path').join(__dirname, '../../../lib/leadIntelligence/leadActions.ts'),
    )).toBe(true);
  });

  it('writes nothing — deciding is a read', async () => {
    seedEngaged();
    await assess();
    expect(db.writeOps).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — abstention is preserved, and nothing is invented', () => {
  it('NO evidence at all ⇒ the engine abstains and NOTHING is proposed', async () => {
    // A prospect with no resolved person: no identity, no engagement, no
    // account. Every primary abstains, so the recommendation engine has
    // nothing to reason over.
    seedProspect(ORG_A, LEAD, null);
    const out = await assess({}, null);

    expect(out.nextBestAction.abstained).toBe(true);
    expect(out.nextBestAction.action).toBeNull();
    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toEqual(['recommended_action']);
  });

  it('identity evidence alone proposes NOTHING — every driver abstains', async () => {
    // Identity and account facts are evidence, but none of them scores intent,
    // opportunity or urgency. The engine used to read those three abstentions as
    // zeros and propose a real action off them; it now abstains, because a
    // prospect nobody has engaged with is unmeasured, not cold. WS-8 preserves
    // that verbatim rather than upgrading it.
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT);
    seedAccount(ORG_A, ACCOUNT);
    const out = await assess();

    expect(out.nextBestAction.abstained).toBe(true);
    expect(out.nextBestAction.action).toBeNull();
    expect(out.nextBestAction.timing).toBeNull();
    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toContain('recommended_action');
  });

  it('objective and expiry stay NULL — neither exists in the repository', async () => {
    seedEngaged();
    const out = await assess();
    expect(out.objective).toBeNull();
    expect(out.nextBestAction.objective).toBeNull();
    expect(out.nextBestAction.expiry).toBeNull();
  });

  it('timing is the engine\'s relative window, never a fabricated timestamp', async () => {
    seedEngaged();
    const out = await assess();
    expect(out.recommendedTiming).toMatch(/^(within_24h|this_week|this_month)$/);
    expect(Date.parse(out.recommendedTiming!)).toBeNaN();
    expect(JSON.stringify(out)).not.toContain('2026-09-04T00:00:00.000Z');
  });

  it('the decision path calls no clock and draws no random value', () => {
    const code = readFile('../../services/prospectOutreach/readiness.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['Date.now', 'new Date(', 'Math.random']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('invents no scoring dimension and no buying-signal vocabulary', () => {
    const code = readFile('../../services/prospectOutreach/readiness.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'problem_fit', 'account_potential', 'relationship_strength',
      'hiring', 'funding', 'exec_change', 'economic_buyer',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — the channel is read, never chosen', () => {
  it('resolves only EXACT governance channels, dropping the rest', () => {
    expect(resolveGovernanceChannel('email')).toEqual({ channel: 'email', ungovernableSteps: [] });
    // The engine's composite is ordered: email happens first.
    expect(resolveGovernanceChannel('email_then_call'))
      .toEqual({ channel: 'email', ungovernableSteps: ['call'] });
    // `call` is NOT turned into `phone`. Resemblance is not a mapping.
    expect(resolveGovernanceChannel('call')).toEqual({ channel: null, ungovernableSteps: ['call'] });
    expect(resolveGovernanceChannel(null)).toEqual({ channel: null, ungovernableSteps: [] });
  });

  it('every resolved channel is a member of the canonical vocabulary', () => {
    for (const c of ['email', 'email_then_call', 'phone', 'whatsapp']) {
      const { channel } = resolveGovernanceChannel(c);
      if (channel) expect(KNOWN_CHANNELS as readonly string[]).toContain(channel);
    }
  });

  it('an ungovernable channel FAILS CLOSED rather than assuming permission', async () => {
    seedEngaged();
    const built = await buildCtx();
    const ports: OutreachReadinessPorts = {
      ...defaultOutreachReadinessPorts,
      assemble(b) {
        const u = defaultOutreachReadinessPorts.assemble(b);
        // Force a channel the governance store cannot evaluate.
        return {
          ...u,
          facets: { ...u.facets, recommendations: { ...u.facets.recommendations!, value: { ...u.facets.recommendations!.value!, nextChannel: 'carrier_pigeon' } } },
        } as typeof u;
      },
    };
    const out = await assessOutreachReadiness(
      { built: built as ProspectContextResult, now: NOW, historicalAsOf: false }, ports);
    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toContain('governable_channel');
    expect(out.suppression).toBeNull();
    expect(out.recommendedChannel).toBe('carrier_pigeon');   // reported, not altered
  });

  it('the ungovernable step is recorded as a constraint', async () => {
    seedEngaged();
    const out = await assess();
    if (out.recommendedChannel === 'email_then_call') {
      expect(out.constraints).toContain('ungovernable_channel_step:call');
      expect(out.governanceChannel).toBe('email');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — suppression is authoritative and overrides', () => {
  it('an unsuppressed prospect with a proposed action is READY', async () => {
    seedEngaged();
    const out = await assess();
    expect(out.nextBestAction.abstained).toBe(false);
    expect(out.readiness).toBe('ready');
    expect(out.suppression!.decision).toBe('allowed');
    expect(out.requiredMissingFields).toEqual([]);
  });

  it('a suppressed prospect is BLOCKED even with a positive recommendation', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', { governance_type: 'dnc_permanent' });
    const out = await assess();

    // The recommendation is still sound and still returned in full...
    expect(out.nextBestAction.abstained).toBe(false);
    expect(out.nextBestAction.action).toBeTruthy();
    // ...and we are not permitted to act on it.
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.governanceType).toBe('dnc_permanent');
    expect(out.reason).toMatch(/canonical suppression/);
  });

  it('a deferment is DEFERRED — backpressure, not a standing prohibition', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', {
      governance_type: 'deferred', effective_until: '2027-01-01T00:00:00.000Z',
    });
    const out = await assess();
    expect(out.readiness).toBe('deferred');
    expect(out.suppression!.deferredUntil).toBe('2027-01-01T00:00:00.000Z');
  });

  it('a REVOKED suppression does not block — the evaluator owns that rule', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', { revoked_at: '2026-08-01T00:00:00.000Z' });
    const out = await assess();
    expect(out.readiness).toBe('ready');
  });

  // ── R1 (Phase 4C-4D) — the comparison boundary is normalised ─────────────
  //
  // 4C-4A/M1: `loadGovernance` normalises its own query, so a record stored
  // under a normalised endpoint IS returned for an equivalent differently
  // formatted target. The RAW value then reached `mayContact`, which compares
  // exactly, so the restriction was fetched and then never applied. These drive
  // the REAL Path C call path, with the real normaliser and the real evaluator.
  it('R1: a differently CASED email target is blocked by a target-anchored restriction', async () => {
    seedEngaged();
    // Target-anchored and stored normalised, exactly as the canonical writer writes it.
    seedGovernance(ORG_A, 'g-1', {
      person_id: null, target_normalized: 'cto@example.test', channel: 'email',
      governance_type: 'unsubscribe',
    });

    const out = await assess({ target: 'CTO@Example.Test' });

    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.governanceType).toBe('unsubscribe');
    expect(out.suppression!.matchedBy).toBe('target');
  });

  it('R1: the already-normalised control case is blocked too — no miss was swapped for another', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', {
      person_id: null, target_normalized: 'cto@example.test', channel: 'email',
      governance_type: 'unsubscribe',
    });

    const out = await assess({ target: 'cto@example.test' });
    expect(out.readiness).toBe('blocked');
  });

  it('R1: a genuinely DIFFERENT endpoint is still allowed', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', {
      person_id: null, target_normalized: 'cto@example.test', channel: 'email',
    });

    const out = await assess({ target: 'someone.else@example.test' });
    expect(out.readiness).toBe('ready');
    expect(out.suppression!.decision).toBe('allowed');
  });

  it('R1: a PERSON-anchored restriction still blocks, whatever the target spelling', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', { governance_type: 'dnc_permanent' });  // person-anchored by default

    const out = await assess({ target: 'CTO@Example.Test' });
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.matchedBy).toBe('person');
  });

  it('R1: a PHONE target is normalised with the phone rule, not the email rule', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1', {
      person_id: null, target_normalized: '+15550100000', channel: 'phone',
      governance_type: 'dnc_channel',
    });
    const built = await buildCtx();
    // Force the recommendation onto the phone channel, the way the existing
    // ungovernable-channel test forces `carrier_pigeon`.
    const ports: OutreachReadinessPorts = {
      ...defaultOutreachReadinessPorts,
      assemble(b) {
        const u = defaultOutreachReadinessPorts.assemble(b);
        return {
          ...u,
          facets: { ...u.facets, recommendations: { ...u.facets.recommendations!, value: { ...u.facets.recommendations!.value!, nextChannel: 'phone' } } },
        } as typeof u;
      },
    };

    const out = await assessOutreachReadiness(
      { built: built as ProspectContextResult, now: NOW, historicalAsOf: false, target: '+1 (555) 010-0000' },
      ports,
    );

    expect(out.governanceChannel).toBe('phone');
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.governanceType).toBe('dnc_channel');
    expect(out.suppression!.matchedBy).toBe('target');
  });

  it('R1: a target that cannot be normalised, with no person, is UNANCHORABLE rather than allowed', async () => {
    // `'   '` survives `input.target ?? null` but normalises to null, so no
    // record could ever match it. Before R1 the guard read the RAW value, so
    // this reached the evaluator with no anchor at all and read as ALLOWED —
    // the one conclusion the guard exists to prevent.
    seedProspect(ORG_A, LEAD, null);                     // no person anchor
    const built = await buildCtx();
    const ports: OutreachReadinessPorts = {
      ...defaultOutreachReadinessPorts,
      assemble(b) {
        const u = defaultOutreachReadinessPorts.assemble(b);
        return {
          ...u,
          facets: {
            ...u.facets,
            recommendations: {
              value: { nextAction: 'monitor', nextMessage: 'x', nextChannel: 'email', nextTiming: 'this_month' },
              confidence: 0.5, evidence: [], abstained: false,
            } as never,
          },
        } as typeof u;
      },
    };

    const out = await assessOutreachReadiness(
      { built: built as ProspectContextResult, now: NOW, historicalAsOf: false, target: '   ' },
      ports,
    );

    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toContain('contact_anchor');
    expect(out.suppression).toBeNull();
  });

  it('unreadable suppression FAILS CLOSED', async () => {
    seedEngaged();
    db.errors.contact_governance_records = { message: 'connection reset' };
    const out = await assess();
    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toContain('readable_suppression_state');
    expect(out.reason).toMatch(/failing closed/);
    expect(out.suppression).toBeNull();
  });

  it('an unanchored evaluation is never concluded ALLOWED', async () => {
    // No person and no target: no governance record could match, and "no match"
    // must not be read as permission.
    seedProspect(ORG_A, LEAD, null);
    const built = await buildCtx();
    const ports: OutreachReadinessPorts = {
      ...defaultOutreachReadinessPorts,
      assemble(b) {
        const u = defaultOutreachReadinessPorts.assemble(b);
        return {
          ...u,
          facets: {
            ...u.facets,
            recommendations: {
              value: { nextAction: 'monitor', nextMessage: 'x', nextChannel: 'email', nextTiming: 'this_month' },
              confidence: 0.5, evidence: [], abstained: false,
            } as never,
          },
        } as typeof u;
      },
    };
    const out = await assessOutreachReadiness(
      { built: built as ProspectContextResult, now: NOW, historicalAsOf: false }, ports);
    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toContain('contact_anchor');
    expect(out.suppression).toBeNull();
  });

  it('adds no second suppression evaluator and never reads a legacy store', () => {
    const code = readFile('../../services/prospectOutreach/readiness.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // P0 — the canonical authority is still the only one consulted, and it is
    // now reached THROUGH `evaluateGovernanceReads`, the one seam that pairs each
    // read's rows with the `read_at` they arrived with. A direct `mayContact`
    // call from here would need a decision instant, and the only instant this
    // module holds is the caller's `input.now` — which is exactly the P0 this
    // change removes. So the ABSENCE of that call is the property worth pinning,
    // alongside the absence of any clock of its own.
    expect(code).toContain('evaluateGovernanceReads');
    expect(code).not.toContain('mayContact(');
    expect(code).not.toContain('new Date(');
    expect(code).not.toContain('now: input.now');
    for (const legacy of ['suppression_entries', 'outreach_suppressions', 'ownedDbTable']) {
      expect(code).not.toContain(legacy);
    }
  });

  it('suppression is evaluated on the resolved governance channel', async () => {
    seedEngaged();
    await assess();
    const governanceFilters = db.filters.filter((f) => f.table === 'contact_governance_records');
    expect(governanceFilters).toContainEqual({
      table: 'contact_governance_records', column: 'organization_id', value: ORG_A,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — recommendation and eligibility stay distinct', () => {
  it('a blocked prospect still carries its full, explainable recommendation', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1');
    const out = await assess();
    expect(out.readiness).toBe('blocked');
    expect(out.messageContext.action).toBeTruthy();
    expect(out.nextBestAction.evidenceIds.length).toBeGreaterThan(0);
    expect(out.nextBestAction.assumptions.length).toBeGreaterThan(0);
  });

  it('a high priority never converts an ineligible prospect into an eligible one', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1');
    const out = await assess();
    expect(out.readiness).toBe('blocked');
    // Priority is reported verbatim; it changes nothing about permission.
    expect(out.nextBestAction.priority).toHaveProperty('value');
    expect(out.nextBestAction.priority).toHaveProperty('abstained');
  });

  it('required missing fields name only what BLOCKS the action, not every empty column', async () => {
    seedEngaged();
    const out = await assess();
    expect(out.requiredMissingFields).toEqual([]);
    // The account has many unset firmographics; none of them is listed.
    expect(JSON.stringify(out.requiredMissingFields)).not.toContain('founded_year');
  });

  it('WS-6 context gaps are CONSTRAINTS, not blockers', async () => {
    seedEngaged();
    // A canonical signal exists but carries no buying-signal type — WS-6's
    // recorded gap. It explains a weaker recommendation; it does not block one.
    (db.tables.lead_signals ??= []).push({
      id: 's-1', organization_id: ORG_A, source_type: 'engagement', source_id: 'src-1',
      thread_id: 'thread-1', contact_id: null, platform: 'linkedin',
      intent_score: 70, urgency_score: 40, icp_score: 55, confidence_score: 0.8,
      total_score: 65, detected_at: '2026-09-03T00:00:00.000Z',
      migration_source: 'engagement_pipeline',
    });
    const out = await assess();
    expect(out.constraints).toContain('context:signals_have_no_buying_signal_type');
    expect(out.readiness).toBe('ready');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — explainability', () => {
  it('the recommendation is traceable to evidence, assumptions and unknowns', async () => {
    seedEngaged();
    const out = await assess();
    expect(out.nextBestAction.reason).toMatch(/next_best_action/);
    expect(out.nextBestAction.evidenceIds.length).toBeGreaterThan(0);
    expect(Array.isArray(out.nextBestAction.unknowns)).toBe(true);
    expect(out.version).toBe(OUTREACH_READINESS_VERSION);
  });

  it('message context carries what to cite — and PI composes no message', async () => {
    seedEngaged();
    const out = await assess();
    expect(out.messageContext).toHaveProperty('action');
    expect(out.messageContext).toHaveProperty('evidenceIds');
    expect(out.messageContext).not.toHaveProperty('body');
    expect(out.messageContext).not.toHaveProperty('subject');
  });

  it('implements no outreach execution of any kind', () => {
    const code = readFile('../../services/prospectOutreach/readiness.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'sendMessage', 'dispatch', 'schedule', 'enqueue', 'campaign',
      'sequence', 'retry', 'outreach_tasks', 'outreach_attempts',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — determinism', () => {
  it('identical evidence and reference time produce an identical decision', async () => {
    seedEngaged();
    const a = await assess();
    const b = await assess();
    expect(b).toEqual(a);
  });

  it('suppression state changes the decision, and only the decision', async () => {
    seedEngaged();
    const before = await assess();
    seedGovernance(ORG_A, 'g-1');
    const after = await assess();
    expect(before.readiness).toBe('ready');
    expect(after.readiness).toBe('blocked');
    // The recommendation itself is unchanged — eligibility is a separate answer.
    expect(after.nextBestAction.action).toBe(before.nextBestAction.action);
    expect(after.nextBestAction.channel).toBe(before.nextBestAction.channel);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — tenant isolation across the whole decision path', () => {
  it('Tenant A cannot decide for Tenant B\'s Prospect', async () => {
    seedEngaged(ORG_B);
    expect(await buildCtx()).toBeNull();
  });

  it('Tenant B\'s suppression never applies to Tenant A', async () => {
    seedEngaged();
    seedGovernance(ORG_B, 'g-b');                    // same person id, other tenant
    const out = await assess();
    expect(out.readiness).toBe('ready');
    expect(out.suppression!.decision).toBe('allowed');
  });

  it('Tenant A\'s suppression is not weakened by Tenant B\'s absence of one', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-a');
    seedGovernance(ORG_B, 'g-b', { governance_type: 'deferred' });
    const out = await assess();
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.recordId).toBe('g-a');
  });

  it('every governance read carries the tenant column', async () => {
    seedEngaged();
    await assess();
    expect(db.filters).toContainEqual({
      table: 'contact_governance_records', column: 'organization_id', value: ORG_A,
    });
  });

  it('refuses tenant-less access and ambient time', async () => {
    seedEngaged();
    const built = (await buildCtx())!;
    const tenantless = { ...built, context: { ...built.context, key: { ...built.context.key, companyId: '  ' } } };
    await expect(assessOutreachReadiness({ built: tenantless, now: NOW, historicalAsOf: false }))
      .rejects.toThrow(/organizationId is required/);
    await expect(assessOutreachReadiness({ built, now: '', historicalAsOf: false }))
      .rejects.toThrow(/now is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-8 — the runtime stays dark', () => {
  it('nothing here enables the Lead Understanding runtime', () => {
    expect(process.env.LEAD_UNDERSTANDING_ENABLED).not.toBe('true');
    const code = readFile('../../services/prospectOutreach/readiness.ts');
    expect(code).not.toContain('LEAD_UNDERSTANDING_ENABLED');
    expect(code).not.toContain('isLeadUnderstandingEnabled');
  });

  it('does not touch the platform-flip readiness assessor', () => {
    // `engines/authoritativeReadiness.ts` assesses whether the PLATFORM is
    // ready for an authoritative flip. It is a different question from whether
    // a prospect is ready for outreach, and it is left alone.
    const code = readFile('../../services/prospectOutreach/readiness.ts');
    expect(code).not.toContain('assessAuthoritativeReadiness');
    expect(code).not.toContain('authoritativeReadiness');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// P0 — the suppression clock is the database's, and a replay cannot borrow it
//
// `input.now` reaches this service from `/api/prospects/[id]`, which derives it
// from an optional `asOf` query parameter validated for parseability and bounded
// in neither direction. An authenticated tenant member could therefore choose
// the instant a suppression check was judged at, and an `asOf` before a
// restriction's `effective_from` made that restriction read as "not yet started".
//
// Two separable properties are pinned below:
//   1. WHICH CLOCK DECIDES — proved with a restriction that starts BETWEEN the
//      caller's instant (`NOW`) and the database's (`DB_READ_AT`, 1.25 s later,
//      inside the live tolerance). At `NOW` it has not started; at `DB_READ_AT`
//      it is in force. The verdict names the clock.
//   2. A REPLAY IS REFUSED, NOT ANSWERED — an instant outside the tolerance
//      cannot be reconstructed from this store, so governance is reported as
//      irreproducible with no verdict attached.
// ════════════════════════════════════════════════════════════════════════════
describe('P0 — suppression is judged at the database read instant', () => {
  /** In force at DB_READ_AT (00:00:01.250) and NOT at the caller's NOW (00:00:00.000). */
  const STARTS_BETWEEN = '2026-09-04T00:00:00.500000+00:00';

  it('a restriction that starts between the caller instant and the database instant BLOCKS', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-between', { effective_from: STARTS_BETWEEN });
    const out = await assess();

    // Judged at `input.now` this record has not started and the prospect is
    // READY. Judged at `read_at` it is in force. This asserts the latter, so
    // reinstating `now: input.now` here fails exactly this test.
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.recordId).toBe('g-between');
    expect(out.requiredMissingFields).toEqual([]);
  });

  it('a restriction that starts AFTER the database instant does not block — the database clock is read, not merely something later', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-later', { effective_from: '2026-09-04T00:00:05.000000+00:00' });
    const out = await assess();
    expect(out.readiness).toBe('ready');
    expect(out.suppression!.decision).toBe('allowed');
  });

  it('a 1970 caller instant cannot override a current restriction — it is BLOCKED', async () => {
    // Since Part 3A the caller's instant is not compared to anything, so a
    // nonsensical one is simply irrelevant: the restriction is judged at the
    // database instant and blocks. Stronger than the earlier refusal, because a
    // real verdict with a real record id is produced.
    seedEngaged();
    seedGovernance(ORG_A, 'g-1');
    const out = await assess({ now: '1970-01-01T00:00:00.000Z' });
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.recordId).toBe('g-1');
  });

  it('a FUTURE caller instant cannot override a current restriction either', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-1');
    const out = await assess({ now: '2030-01-01T00:00:00.000Z' });
    expect(out.readiness).toBe('blocked');
    expect(out.suppression!.recordId).toBe('g-1');
  });

  it('clock skew far beyond two minutes does NOT reclassify a live request', async () => {
    // The specific regression Part 3A removes. A host clock ten minutes out
    // would have tripped the old 120 s tolerance and refused a live request.
    seedEngaged();
    const skewed = await assess({ now: '2026-09-04T00:10:00.000Z' });
    expect(skewed.readiness).toBe('ready');
    expect(skewed.suppression!.decision).toBe('allowed');
    expect(skewed.requiredMissingFields).toEqual([]);

    seedGovernance(ORG_A, 'g-skew');
    const blocked = await assess({ now: '2026-09-04T00:10:00.000Z' });
    expect(blocked.readiness).toBe('blocked');
    expect(blocked.suppression!.recordId).toBe('g-skew');
  });

  it('an unrelated producer is unaffected: another person\u2019s restriction does not block this one', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-other-person', { person_id: 'person-99', target_normalized: null });
    const out = await assess();
    expect(out.readiness).toBe('ready');
    expect(out.suppression!.decision).toBe('allowed');
  });

  it('rows with NO read instant cannot yield clearance', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-no-instant', { read_at: undefined });
    const out = await assess();
    expect(out.readiness).toBe('not_ready');
    expect(out.suppression).toBeNull();
    expect(out.requiredMissingFields).toContain('readable_suppression_state');
    expect(out.reason).toMatch(/indeterminate/);
  });

  it('a producer that reports NO reads at all cannot yield clearance', async () => {
    // `GovernanceLoadResult.reads` is optional so that hand-built port doubles
    // keep compiling. A producer that did not say what it read has not said it
    // read nothing, and the one thing that must not follow is permission.
    seedEngaged();
    const built = await buildCtx();
    const ports: OutreachReadinessPorts = {
      ...defaultOutreachReadinessPorts,
      async loadGovernance() { return { ok: true, records: [] }; },
    };
    const out = await assessOutreachReadiness(
      { built: built as ProspectContextResult, now: NOW, historicalAsOf: false }, ports);
    expect(out.readiness).toBe('not_ready');
    expect(out.suppression).toBeNull();
    expect(out.requiredMissingFields).toContain('readable_suppression_state');
  });
});

describe('P0/3A — an explicit historical request is refused, unconditionally', () => {
  const HISTORICAL = '2026-07-01T00:00:00.000Z';
  /** 30 s before the database instant — deliberately NEAR, to prove nearness is irrelevant. */
  const NEARLY_NOW = '2026-09-04T00:00:31.250000+00:00';
  const historical = (now: string = HISTORICAL) => assess({ now, historicalAsOf: true });

  it('1. asOf with a NON-EMPTY governance result is refused, naming the limitation exactly', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-hist');
    const out = await historical();
    expect(out.readiness).toBe('not_ready');
    expect(out.reason).toBe(HISTORICAL_GOVERNANCE_REASON);
    expect(out.requiredMissingFields).toContain('reproducible_suppression_state');
    expect(out.suppression).toBeNull();
    expect(out.constraints).toContain(`historical_as_of:${HISTORICAL}`);
  });

  it('2. asOf with an EMPTY successful governance result is refused too', async () => {
    // THE PART 3A CORRECTION. This case used to be answered, on the argument
    // that with no record the verdict is the same at every instant. It is not
    // sound evidence about the past: an empty result is exactly the shape a
    // since-revoked or since-deleted restriction leaves behind.
    seedEngaged();                                   // no governance rows at all
    const out = await historical();
    expect(out.readiness).toBe('not_ready');
    expect(out.reason).toBe(HISTORICAL_GOVERNANCE_REASON);
    expect(out.suppression).toBeNull();
  });

  it('3. asOf with a since-REVOKED record is refused, with no claim of reconstruction', async () => {
    // The loader filters `revoked_at IS NULL`, so this row never comes back —
    // the read is empty although a restriction demonstrably existed. Precisely
    // the state that must not be reported as "nothing applied".
    seedEngaged();
    seedGovernance(ORG_A, 'g-revoked', { revoked_at: '2026-08-01T00:00:00+00:00' });
    const out = await historical();
    expect(out.readiness).toBe('not_ready');
    expect(out.reason).toBe(HISTORICAL_GOVERNANCE_REASON);
    expect(out.suppression).toBeNull();
    // No verdict is asserted about the past, in either direction.
    expect(JSON.stringify(out)).not.toContain('allowed');
  });

  it('4. asOf with an UNAVAILABLE governance store yields no contact clearance', async () => {
    seedEngaged();
    db.errors.contact_governance_records = { message: 'connection reset' };
    const out = await historical();
    expect(out.readiness).not.toBe('ready');
    expect(out.readiness).toBe('not_ready');
    expect(out.suppression).toBeNull();
    // The HISTORICAL reason, not the unreadable-store one: the refusal precedes
    // the read, so an outage cannot change which answer a replay gets. Asserting
    // the specific reason is what makes a mutation that defers the refusal until
    // after a successful read detectable at all.
    expect(out.reason).toBe(HISTORICAL_GOVERNANCE_REASON);
    expect(out.requiredMissingFields).toContain('reproducible_suppression_state');
    expect(out.requiredMissingFields).not.toContain('readable_suppression_state');
  });

  it('5. asOf only 30 SECONDS from the database instant is still refused', async () => {
    // Under the removed tolerance this was classed as live and answered. The
    // signal is the parameter, not the distance.
    seedEngaged();
    seedGovernance(ORG_A, 'g-hist');
    const out = await historical(NEARLY_NOW);
    expect(out.readiness).toBe('not_ready');
    expect(out.reason).toBe(HISTORICAL_GOVERNANCE_REASON);
    expect(out.suppression).toBeNull();
  });

  it('6. asOf YEARS from the database instant is refused the same way, with the same reason', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-hist');
    const far = await historical('2019-01-01T00:00:00.000Z');
    const near = await historical(NEARLY_NOW);
    expect(far.readiness).toBe('not_ready');
    expect(far.reason).toBe(near.reason);
    expect(far.requiredMissingFields).toEqual(near.requiredMissingFields);
  });

  it('7. historical SCORING is still answered at the requested instant', async () => {
    seedEngaged();
    seedGovernance(ORG_A, 'g-hist');
    const out = await historical();

    // Only PERMISSION is withheld. The recommendation, its confidence, its
    // evidence and the whole NBA are returned exactly as for a live request.
    expect(out.nextBestAction.abstained).toBe(false);
    expect(out.nextBestAction.action).toBeTruthy();
    expect(out.recommendedChannel).toBeTruthy();
    expect(out.recommendedTiming).toBeTruthy();
    expect(out.confidence).not.toBeNull();
    expect(out.messageContext.evidenceIds).toBeDefined();
    expect(out.nextBestAction.priority).toHaveProperty('value');
  });

  it('the refusal does not read the store at all, so nothing it returns can influence it', async () => {
    // The strongest form of "unconditional": the query is never issued, so the
    // four cases above cannot diverge however the store behaves.
    seedEngaged();
    seedGovernance(ORG_A, 'g-hist');
    db.filters = [];
    await historical();
    expect(db.filters.filter((f) => f.table === 'contact_governance_records')).toEqual([]);
  });

  it('THE FLAG is what differs: the same instant without it is answered normally', async () => {
    // The control. Same `now`, same records, flag off — and a verdict appears.
    // So the refusal is caused by the explicit signal and by nothing else.
    seedEngaged();
    seedGovernance(ORG_A, 'g-hist');
    const refused = await assess({ now: HISTORICAL, historicalAsOf: true });
    const answered = await assess({ now: HISTORICAL, historicalAsOf: false });

    expect(refused.readiness).toBe('not_ready');
    expect(refused.suppression).toBeNull();
    expect(answered.readiness).toBe('blocked');
    expect(answered.suppression!.recordId).toBe('g-hist');
  });
});
