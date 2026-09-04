/**
 * WS-9 — the outreach outcome corpus, read from the canonical Prospect.
 *
 * The default ports run against a stub database rather than being doubled
 * away, because the attribution path IS what is under test: a suite that
 * mocked `loadTasks` would pass even if the real query joined on `lead_id`,
 * which the A3 migration records as an identifier of unproven meaning.
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
  OUTCOME_CORPUS_VERSION,
  BUSINESS_OUTCOME_TYPES,
  PI_OUTCOME_VOCABULARY,
  readProspectOutcomeCorpus,
  defaultProspectOutcomePorts,
  type ProspectOutcomePorts,
} from '../../services/prospectOutcomes/corpus';
import {
  UNOBSERVABLE_BUSINESS_OUTCOMES,
  DERIVED_BUSINESS_OUTCOMES,
} from '../../services/leadOutreachExecution/types';
import { FEEDBACK_SIGNALS } from '../../services/leadOutreachExecution/feedbackIngestion';

const readFile = (p: string): string =>
  require('fs').readFileSync(require('path').join(__dirname, p), 'utf8');

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const LEAD = 'lead-1';
const PERSON = 'person-1';
const NOW = '2026-09-04T00:00:00.000Z';

const seedProspect = (org: string, id: string, personId: string | null) => {
  (db.tables.canonical_leads ??= []).push({ id, company_id: org, unified_person_id: personId });
};
const seedTask = (org: string, id: string, personId: string | null, over: Row = {}) => {
  (db.tables.outreach_tasks ??= []).push({
    id, company_id: org, person_id: personId, lead_id: 'weak-lead-key',
    channel: 'email', delivery_status: 'delivered', ...over,
  });
};
const seedOutcome = (org: string, id: string, taskId: string, over: Row = {}) => {
  (db.tables.outreach_outcomes ??= []).push({
    id, company_id: org, task_id: taskId, outcome_type: 'replied', derived: false,
    occurred_at: '2026-09-02T00:00:00.000Z', created_at: '2026-09-02T06:00:00.000Z',
    source: 'provider_webhook', provider: 'sendgrid', provider_event_id: `evt-${id}`, ...over,
  });
};

const read = (over: Partial<Parameters<typeof readProspectOutcomeCorpus>[0]> = {}) =>
  readProspectOutcomeCorpus({ organizationId: ORG_A, prospectId: LEAD, now: NOW, ...over });

const seedAttributed = (org = ORG_A) => {
  seedProspect(org, LEAD, PERSON);
  seedTask(org, 'task-1', PERSON);
};

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — the established vocabulary, mapped rather than replaced', () => {
  it('uses the repository\'s BusinessOutcomeType, not an invented set', () => {
    // Every type the corpus reports is one the database CHECK permits.
    expect([...BUSINESS_OUTCOME_TYPES].sort()).toEqual([
      'clicked', 'converted', 'meeting_booked', 'no_response',
      'opened', 'rejected', 'replied', 'unsubscribed',
    ]);
  });

  it('documents the PI vocabulary mapping, and admits where there is no counterpart', () => {
    expect(PI_OUTCOME_VOCABULARY.reply.repositoryType).toBe('replied');
    expect(PI_OUTCOME_VOCABULARY.unsubscribe.repositoryType).toBe('unsubscribed');
    expect(PI_OUTCOME_VOCABULARY.conversion.repositoryType).toBe('converted');
    expect(PI_OUTCOME_VOCABULARY.meeting.repositoryType).toBe('meeting_booked');

    // No counterpart exists for these, and none is invented.
    for (const missing of ['positive', 'negative', 'proposal', 'failure']) {
      expect(PI_OUTCOME_VOCABULARY[missing].repositoryType).toBeNull();
      expect(PI_OUTCOME_VOCABULARY[missing].axis).toBe('none');
    }
    // The delivery axis stays separate from the business axis.
    for (const delivery of ['attempted', 'delivered', 'bounced']) {
      expect(PI_OUTCOME_VOCABULARY[delivery].axis).toBe('delivery');
    }
  });

  it('every mapped repository type is a real feedback signal or outcome type', () => {
    for (const entry of Object.values(PI_OUTCOME_VOCABULARY)) {
      if (!entry.repositoryType) continue;
      expect(BUSINESS_OUTCOME_TYPES).toContain(entry.repositoryType);
      expect(FEEDBACK_SIGNALS as readonly string[]).toContain(entry.repositoryType);
    }
  });

  it('a stored value outside the vocabulary is reported, never coerced', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1', { outcome_type: 'ghosted' });
    const corpus = await read();
    expect(corpus!.outcomes[0].type).toBeNull();
    expect(corpus!.consistency.unrecognisedTypes).toEqual(['ghosted']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — every canonical outcome type is carried', () => {
  it.each([...BUSINESS_OUTCOME_TYPES])('carries %s verbatim', async (type) => {
    seedAttributed();
    seedOutcome(ORG_A, `o-${type}`, 'task-1', {
      outcome_type: type,
      derived: DERIVED_BUSINESS_OUTCOMES.includes(type),
    });
    const corpus = await read();
    expect(corpus!.outcomes[0].type).toBe(type);
    expect(corpus!.counts.find((c) => c.type === type)!.count).toBe(1);
  });

  it('an UNSUBSCRIBE is preserved as outcome evidence, and writes no suppression', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1', { outcome_type: 'unsubscribed' });
    const corpus = await read();
    expect(corpus!.counts.find((c) => c.type === 'unsubscribed')!.count).toBe(1);
    // WS-9 records the evidence. Translating it into a governance record is a
    // rule nobody has defined, and inventing one here would be a second
    // suppression authority.
    expect(db.writeOps).toEqual([]);
    expect(db.tables.contact_governance_records).toBeUndefined();
  });

  it('a zero for an UNOBSERVABLE type is never read as a negative', async () => {
    seedAttributed();
    const corpus = await read();
    for (const type of UNOBSERVABLE_BUSINESS_OUTCOMES) {
      const c = corpus!.counts.find((x) => x.type === type)!;
      expect(c.count).toBe(0);
      expect(c.observable).toBe(false);      // "we cannot see this", not "it did not happen"
    }
    expect(corpus!.counts.find((c) => c.type === 'replied')!.observable).toBe(true);
    expect(corpus!.consistency.unobservableTypes).toEqual([...UNOBSERVABLE_BUSINESS_OUTCOMES]);
  });

  it('distinguishes a WITNESSED outcome from one asserted by a rule', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1', { outcome_type: 'replied', derived: false });
    seedOutcome(ORG_A, 'o-2', 'task-1', { outcome_type: 'no_response', derived: true });
    const corpus = await read();
    expect(corpus!.consistency).toMatchObject({ observed: 1, derived: 1 });
    expect(corpus!.counts.find((c) => c.type === 'no_response')!.derivedByRule).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — attribution is person-anchored, never lead_id', () => {
  it('attributes outcomes through outreach_tasks.person_id', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1');
    const corpus = await read();
    expect(corpus!.personId).toBe(PERSON);
    expect(corpus!.outcomes.map((o) => o.id)).toEqual(['o-1']);
  });

  it('never reads lead_id — the A3 migration records it as unproven', () => {
    const code = readFile('../../services/prospectOutcomes/corpus.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('lead_id');
    expect(code).toContain("eq('person_id', personId)");
  });

  it('ONE person\'s outcome is not spread across their colleagues', async () => {
    seedProspect(ORG_A, 'lead-a', PERSON);
    seedProspect(ORG_A, 'lead-b', 'person-2');       // same account, other person
    seedTask(ORG_A, 'task-1', PERSON);
    seedOutcome(ORG_A, 'o-1', 'task-1');

    const a = await read({ prospectId: 'lead-a' });
    const b = await read({ prospectId: 'lead-b' });
    expect(a!.outcomes.map((o) => o.id)).toEqual(['o-1']);
    expect(b!.outcomes).toEqual([]);                 // never inherited
    expect(b!.completeness.tasks).toBe(0);
  });

  it('two Prospects for the SAME person each see that person\'s outcomes', async () => {
    seedProspect(ORG_A, 'lead-a', PERSON);
    seedProspect(ORG_A, 'lead-b', PERSON);
    seedTask(ORG_A, 'task-1', PERSON);
    seedOutcome(ORG_A, 'o-1', 'task-1');

    const a = await read({ prospectId: 'lead-a' });
    const b = await read({ prospectId: 'lead-b' });
    expect(a!.outcomes.map((o) => o.id)).toEqual(['o-1']);
    expect(b!.outcomes.map((o) => o.id)).toEqual(['o-1']);
  });

  it('a Prospect with no resolved person attributes nothing, and says so', async () => {
    seedProspect(ORG_A, LEAD, null);
    seedTask(ORG_A, 'task-1', PERSON);
    seedOutcome(ORG_A, 'o-1', 'task-1');
    const corpus = await read();
    expect(corpus!.personId).toBeNull();
    expect(corpus!.completeness.hasPerson).toBe(false);
    expect(corpus!.outcomes).toEqual([]);
    expect(corpus!.reason).toMatch(/no resolved person/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — provenance and timestamps', () => {
  it('preserves source, provider and the provider event id', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1', {
      source: 'provider_webhook', provider: 'sendgrid', provider_event_id: 'evt-9',
    });
    const corpus = await read();
    expect(corpus!.outcomes[0]).toMatchObject({
      source: 'provider_webhook', provider: 'sendgrid', providerEventId: 'evt-9', channel: 'email',
    });
    expect(corpus!.provenance).toMatchObject({
      sources: ['provider_webhook'], providers: ['sendgrid'], taskIds: ['task-1'],
    });
  });

  it('reports the OCCURRENCE time, kept apart from our ingest time', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1', {
      occurred_at: '2026-09-02T00:00:00.000Z', created_at: '2026-09-02T06:00:00.000Z',
    });
    const corpus = await read();
    expect(corpus!.outcomes[0].occurredAt).toBe('2026-09-02T00:00:00.000Z');
    expect(corpus!.outcomes[0].recordedAt).toBe('2026-09-02T06:00:00.000Z');
  });

  it('an undated outcome stays undated and is NOT back-dated to now', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-dated', 'task-1', { occurred_at: '2026-09-01T00:00:00.000Z' });
    seedOutcome(ORG_A, 'o-undated', 'task-1', { occurred_at: null });

    const corpus = await read();
    expect(corpus!.outcomes.map((o) => o.id)).toEqual(['o-dated', 'o-undated']);
    expect(corpus!.outcomes[1].occurredAt).toBeNull();
    expect(corpus!.consistency.outcomesWithoutObservationTime).toBe(1);
    expect(JSON.stringify(corpus!.outcomes)).not.toContain(NOW);
  });

  it('orders chronologically by source time, stably on a tie', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-b', 'task-1', { occurred_at: '2026-09-02T00:00:00.000Z' });
    seedOutcome(ORG_A, 'o-a', 'task-1', { occurred_at: '2026-09-02T00:00:00.000Z' });
    seedOutcome(ORG_A, 'o-early', 'task-1', { occurred_at: '2026-09-01T00:00:00.000Z' });
    const corpus = await read();
    expect(corpus!.outcomes.map((o) => o.id)).toEqual(['o-early', 'o-a', 'o-b']);
  });

  it('reports age, and asserts staleness only under a caller policy', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1', { occurred_at: '2026-09-02T00:00:00.000Z' });
    expect((await read())!.freshness).toMatchObject({ ageDays: 2, stale: null });
    expect((await read({ stalenessDays: 30 }))!.freshness.stale).toBe(false);
    expect((await read({ stalenessDays: 1 }))!.freshness.stale).toBe(true);
  });

  it('no outcomes is STALE under a policy — and completeness says why', async () => {
    seedAttributed();
    const corpus = await read({ stalenessDays: 30 });
    expect(corpus!.freshness).toMatchObject({ ageDays: null, stale: true });
    expect(corpus!.completeness.outcomes).toBe(0);   // absence, not failure
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — idempotency reuses the existing keys', () => {
  it('repeated reads are identical and create nothing', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1');
    seedOutcome(ORG_A, 'o-2', 'task-1', { outcome_type: 'converted', occurred_at: '2026-09-03T00:00:00.000Z' });

    const first = await read();
    const second = await read();
    expect(second).toEqual(first);
    expect(db.writeOps).toEqual([]);
    expect(db.tables.outreach_outcomes).toHaveLength(2);
  });

  it('the SAME source event ingested twice remains one outcome', async () => {
    seedAttributed();
    // The database's own key — (company_id, task_id, outcome_type, occurred_at)
    // — is what collapses a re-emitted event. WS-9 adds no second mechanism, so
    // a re-ingest yields the same single row and the corpus is unchanged.
    seedOutcome(ORG_A, 'o-1', 'task-1', { provider_event_id: 'evt-dup' });
    const before = await read();
    const after = await read();
    expect(after!.outcomes).toHaveLength(1);
    expect(after).toEqual(before);
  });

  it('introduces no second ledger and no second ingestion path', () => {
    const code = readFile('../../services/prospectOutcomes/corpus.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', 'ingestFeedback']) {
      expect(code).not.toContain(verb);
    }
    const tables = [...code.matchAll(/ownedDbTable\('([a-z_0-9]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual([
      'canonical_leads', 'outreach_outcomes', 'outreach_tasks',
    ]);
  });

  it('leaves the existing ingestion contract and its two keys intact', () => {
    const migration = readFile('../../../supabase/migrations/20260915000000_ws3_feedback_ingestion.sql');
    expect(migration).toContain('uq_outreach_outcomes_provider_event');
    const first = readFile('../../../supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql');
    expect(first).toContain('outreach_outcomes_idempotent UNIQUE (company_id, task_id, outcome_type, occurred_at)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — no policy mutation, no execution, no learning', () => {
  it('mutates no ICP, score, NBA, readiness or governance record', () => {
    const code = readFile('../../services/prospectOutcomes/corpus.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'ratifyIcpVersion', 'createIcpVersion', 'combineScores', 'runRecommendation',
      'assessOutreachReadiness', 'contact_governance_records', 'mayContact',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('implements no learning of any kind', () => {
    const code = readFile('../../services/prospectOutcomes/corpus.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['train', 'learnFrom', 'updateWeights', 'propose', 'retrain']) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('implements no outreach execution', () => {
    const code = readFile('../../services/prospectOutcomes/corpus.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'sendMessage', 'dispatch', 'schedule', 'enqueue', 'campaign', 'sequence', 'retry',
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // The execution tables are never ACCESSED. `outreach_attempts` appears in
    // the documented vocabulary map as prose explaining where an attempt lives,
    // which is the mapping §6 requires — not a read of it.
    for (const table of ['outreach_attempts', 'outreach_approvals', 'outreach_decisions']) {
      expect(code).not.toContain(`ownedDbTable('${table}')`);
    }
  });

  it('the corpus is a read — it writes nothing at all', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1');
    await read();
    expect(db.writeOps).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — tenant isolation', () => {
  it('Tenant A cannot read Tenant B\'s Prospect', async () => {
    seedProspect(ORG_B, LEAD, PERSON);
    expect(await read()).toBeNull();
  });

  it('a globally unique person id does NOT authorise another tenant\'s tasks', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedTask(ORG_B, 'task-b', PERSON);              // same person id, other tenant
    seedOutcome(ORG_B, 'o-b', 'task-b');
    const corpus = await read();
    expect(corpus!.completeness.tasks).toBe(0);
    expect(corpus!.outcomes).toEqual([]);
  });

  it('Tenant B\'s outcomes never cross on a shared task id', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-mine', 'task-1');
    seedOutcome(ORG_B, 'o-theirs', 'task-1');       // same task id, other tenant
    const corpus = await read();
    expect(corpus!.outcomes.map((o) => o.id)).toEqual(['o-mine']);
  });

  it('EVERY read carries its tenant column', async () => {
    seedAttributed();
    seedOutcome(ORG_A, 'o-1', 'task-1');
    await read();
    for (const [table, column] of [
      ['canonical_leads', 'company_id'],
      ['outreach_tasks', 'company_id'],
      ['outreach_outcomes', 'company_id'],
    ] as Array<[string, string]>) {
      expect(db.filters).toContainEqual({ table, column, value: ORG_A });
    }
  });

  it('refuses tenant-less access and ambient time', async () => {
    await expect(read({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(read({ prospectId: '' })).rejects.toThrow(/prospectId is required/);
    await expect(read({ now: '' })).rejects.toThrow(/now is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-9 — failure semantics', () => {
  it('an unreadable canonical table fails safely, with the table named', async () => {
    db.errors.canonical_leads = { message: 'connection reset' };
    await expect(read()).rejects.toThrow(/canonical_leads read failed: connection reset/);

    db.errors = {};
    seedAttributed();
    db.errors.outreach_outcomes = { message: 'permission denied' };
    await expect(read()).rejects.toThrow(/outreach_outcomes read failed: permission denied/);
  });

  it('an unreadable corpus is an error, never an empty corpus', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    db.errors.outreach_tasks = { message: 'timeout' };
    await expect(read()).rejects.toThrow(/outreach_tasks read failed: timeout/);
  });

  it('a port failure returns no partial corpus', async () => {
    seedAttributed();
    const ports: ProspectOutcomePorts = {
      ...defaultProspectOutcomePorts,
      async loadOutcomes() { throw new Error('downstream unavailable'); },
    };
    await expect(readProspectOutcomeCorpus(
      { organizationId: ORG_A, prospectId: LEAD, now: NOW }, ports,
    )).rejects.toThrow('downstream unavailable');
    expect(db.writeOps).toEqual([]);
  });

  it('an unknown Prospect is null — distinct from one with no outcomes', async () => {
    expect(await read({ prospectId: 'nope' })).toBeNull();
    seedProspect(ORG_A, 'known', PERSON);
    const empty = await read({ prospectId: 'known' });
    expect(empty).not.toBeNull();
    expect(empty!.version).toBe(OUTCOME_CORPUS_VERSION);
    expect(empty!.completeness.outcomes).toBe(0);
  });
});
