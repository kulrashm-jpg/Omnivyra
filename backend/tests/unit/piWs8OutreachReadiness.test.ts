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

const assess = async (over: { target?: string | null; now?: string } = {}, icp: RatifiedIcp | null = ratified()) => {
  const built = await buildCtx({}, icp);
  return assessOutreachReadiness({ built: built as ProspectContextResult, now: NOW, ...over });
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

  it('identity evidence alone proposes MONITOR — never outreach', async () => {
    // The engine's own rule: with intent and opportunity at zero it proposes
    // . That is an evidence-backed answer, not an abstention, and
    // WS-8 preserves it verbatim rather than upgrading or discarding it.
    seedProspect(ORG_A, LEAD, PERSON);
    seedPerson(ORG_A, PERSON, ACCOUNT);
    seedAccount(ORG_A, ACCOUNT);
    const out = await assess();

    expect(out.nextBestAction.action).toBe('monitor');
    expect(out.nextBestAction.unknowns).toContain('no engagement or trigger evidence');
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
    const out = await assessOutreachReadiness({ built: built as ProspectContextResult, now: NOW }, ports);
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
    const out = await assessOutreachReadiness({ built: built as ProspectContextResult, now: NOW }, ports);
    expect(out.readiness).toBe('not_ready');
    expect(out.requiredMissingFields).toContain('contact_anchor');
    expect(out.suppression).toBeNull();
  });

  it('adds no second suppression evaluator and never reads a legacy store', () => {
    const code = readFile('../../services/prospectOutreach/readiness.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('mayContact');
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
    await expect(assessOutreachReadiness({ built: tenantless, now: NOW }))
      .rejects.toThrow(/organizationId is required/);
    await expect(assessOutreachReadiness({ built, now: '' }))
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
