/**
 * WS-5 (FR-14 · FR-20) — a Prospect's engagement evidence and canonical signals.
 *
 * The default ports run against a stub database rather than being doubled away,
 * because the tenant filters ARE the security property under test — and one of
 * them cannot exist: `engagement_messages` has no tenant column, so its
 * isolation depends entirely on the thread ids it is handed. A suite that
 * mocked `loadMessages` would prove nothing about that.
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
  PROSPECT_ENGAGEMENT_VERSION,
  CANONICAL_SIGNAL_TABLE,
  readProspectEngagementIntelligence,
  defaultProspectEngagementPorts,
  type ProspectEngagementPorts,
} from '../../services/engagement/prospectEngagementIntelligence';

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
const seedContact = (org: string, id: string, personId: string | null) => {
  (db.tables.contacts ??= []).push({ id, organization_id: org, unified_person_id: personId });
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

const read = (over: Partial<Parameters<typeof readProspectEngagementIntelligence>[0]> = {}) =>
  readProspectEngagementIntelligence({ organizationId: ORG_A, prospectId: LEAD, now: NOW, ...over });

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — the canonical signal model, and only it', () => {
  it('reads `lead_signals` and never revives `lead_signals_v1`', () => {
    expect(CANONICAL_SIGNAL_TABLE).toBe('lead_signals');
    // Comments are stripped: the header DOCUMENTS the frozen decision that
    // `lead_signals_v1` stays untouched, and that prose is worth keeping. What
    // must not exist is code that reads or writes it.
    const code = readFile('../../services/engagement/prospectEngagementIntelligence.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('lead_signals_v1');
  });

  it('introduces no storage model — it names only existing canonical tables', () => {
    const src = readFile('../../services/engagement/prospectEngagementIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const named = [...code.matchAll(/ownedDbTable\((?:'([a-z_0-9]+)'|CANONICAL_SIGNAL_TABLE)\)/g)]
      .map((m) => m[1] ?? 'lead_signals');
    expect([...new Set(named)].sort()).toEqual([
      'canonical_leads', 'contacts', 'engagement_messages', 'engagement_threads', 'lead_signals',
    ]);
  });

  it('adds no second signal writer — the module contains no write verb', () => {
    const src = readFile('../../services/engagement/prospectEngagementIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(code).not.toContain(verb);
    }
  });

  it('leaves the declared single writer and its idempotency key untouched', () => {
    const writer = readFile('../../services/canonicalLeadSignalService.ts');
    expect(writer).toContain('No direct writes to `lead_signals` are allowed outside this module');
    // The existing dedupe key. WS-5 introduces no second mechanism.
    expect(writer).toContain("onConflict: 'organization_id,source_type,source_id'");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — timeline (FR-14) is derived from evidence, in order', () => {
  beforeEach(() => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
  });

  it('orders dated evidence chronologically across BOTH sources', async () => {
    seedMessage('m-2', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });
    seedMessage('m-1', 'thread-1', { platform_created_at: '2026-09-01T00:00:00.000Z' });
    seedSignal(ORG_A, 's-1', { detected_at: '2026-09-03T00:00:00.000Z' });

    const out = await read();
    expect(out!.timeline.map((e) => e.id)).toEqual(['m-1', 'm-2', 's-1']);
    expect(out!.timeline.map((e) => e.source)).toEqual([
      'engagement_messages', 'engagement_messages', 'lead_signals',
    ]);
  });

  it('reports the SOURCE time, and says it came from the source', async () => {
    seedMessage('m-1', 'thread-1', {
      platform_created_at: '2026-09-02T00:00:00.000Z', created_at: '2026-09-02T06:00:00.000Z',
    });
    const entry = (await read())!.timeline[0];
    expect(entry.observedAt).toBe('2026-09-02T00:00:00.000Z');   // NOT the ingest time
    expect(entry.observedAtSource).toBe('platform');
    expect(entry.recordedAt).toBe('2026-09-02T06:00:00.000Z');
  });

  it('falls back to ingest time and LABELS it as such, never as a source time', async () => {
    seedMessage('m-1', 'thread-1', {
      platform_created_at: null, created_at: '2026-09-02T06:00:00.000Z',
    });
    const out = await read();
    expect(out!.timeline[0]).toMatchObject({
      observedAt: '2026-09-02T06:00:00.000Z', observedAtSource: 'ingest',
    });
    expect(out!.consistency.entriesDatedByIngestOnly).toBe(1);
  });

  it('an undated event keeps its place in the evidence but NOT in the ordering', async () => {
    seedMessage('m-dated', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });
    seedMessage('m-undated', 'thread-1', { platform_created_at: null, created_at: null });

    const out = await read();
    // Kept — dropping it would lose evidence. Last — placing it in the sequence
    // would invent a chronology the source never gave.
    expect(out!.timeline.map((e) => e.id)).toEqual(['m-dated', 'm-undated']);
    expect(out!.timeline[1]).toMatchObject({ observedAt: null, observedAtSource: 'none' });
    expect(out!.consistency.entriesWithoutObservationTime).toBe(1);
  });

  it('never substitutes the current time for a missing observation', async () => {
    seedMessage('m-1', 'thread-1', { platform_created_at: null, created_at: null });
    const out = await read();
    expect(out!.timeline[0].observedAt).toBeNull();
    expect(JSON.stringify(out!.timeline)).not.toContain(NOW);
  });

  it('first and last activity come from DATED evidence only', async () => {
    seedMessage('m-1', 'thread-1', { platform_created_at: '2026-09-01T00:00:00.000Z' });
    seedMessage('m-2', 'thread-1', { platform_created_at: '2026-09-03T00:00:00.000Z' });
    seedMessage('m-x', 'thread-1', { platform_created_at: null, created_at: null });
    const out = await read();
    expect(out!.engagement.firstActivityAt).toBe('2026-09-01T00:00:00.000Z');
    expect(out!.engagement.lastActivityAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('spans several threads and channels for one Prospect', async () => {
    seedThread(ORG_A, 'thread-2', PERSON, { platform: 'x' });
    seedMessage('m-1', 'thread-1', { platform: 'linkedin', platform_created_at: '2026-09-01T00:00:00.000Z' });
    seedMessage('m-2', 'thread-2', { platform: 'x', platform_created_at: '2026-09-02T00:00:00.000Z' });
    const out = await read();
    expect(out!.engagement.threadCount).toBe(2);
    expect(out!.engagement.channels).toEqual(['linkedin', 'x']);
    expect(out!.timeline.map((e) => e.id)).toEqual(['m-1', 'm-2']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — engagement (FR-20) is evidence, not a score', () => {
  beforeEach(() => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
  });

  it('counts direction, and refuses to assume one the source did not state', async () => {
    seedMessage('m-1', 'thread-1', { direction: 'inbound' });
    seedMessage('m-2', 'thread-1', { direction: 'outbound' });
    seedMessage('m-3', 'thread-1', { direction: null });
    seedMessage('m-4', 'thread-1', { direction: 'sideways' });   // not in the model

    const out = await read();
    expect(out!.engagement).toMatchObject({ inbound: 1, outbound: 1, directionUnknown: 2 });
    expect(out!.consistency.messagesWithoutDirection).toBe(2);
    expect(out!.timeline.find((e) => e.id === 'm-4')!.direction).toBeNull();
  });

  it('passes signal scores through verbatim and combines nothing', async () => {
    seedSignal(ORG_A, 's-1', {
      intent_score: 70, urgency_score: 40, icp_score: 55, confidence_score: 0.8, total_score: 65,
    });
    const s = (await read())!.signals[0];
    expect(s.scores).toEqual({ intent: 70, urgency: 40, icp: 55, confidence: 0.8, total: 65 });
  });

  it('a score nobody recorded is null, never zero', async () => {
    seedSignal(ORG_A, 's-1', {
      intent_score: null, urgency_score: null, icp_score: null,
      confidence_score: null, total_score: null,
    });
    expect((await read())!.signals[0].scores).toEqual({
      intent: null, urgency: null, icp: null, confidence: null, total: null,
    });
  });

  it('emits no composite score, readiness or recommendation — WS-6/WS-8 own those', async () => {
    seedMessage('m-1', 'thread-1');
    const out = await read() as unknown as Record<string, unknown>;
    for (const forbidden of ['score', 'totalScore', 'priority', 'intent', 'readiness', 'recommendation']) {
      expect(out).not.toHaveProperty(forbidden);
    }
  });

  it('the six dimensions stay separate — no generic quality number', async () => {
    seedMessage('m-1', 'thread-1');
    const out = await read() as unknown as Record<string, unknown>;
    for (const d of ['completeness', 'freshness', 'provenance', 'consistency']) {
      expect(typeof out[d]).toBe('object');
    }
    expect(out).not.toHaveProperty('quality');
    expect(out).not.toHaveProperty('qualityScore');
    // Confidence stays per-signal; actionability is WS-8's and is absent.
    expect(out).not.toHaveProperty('actionability');
  });

  it('preserves provenance: which tables, which channels, which producer', async () => {
    seedMessage('m-1', 'thread-1');
    seedSignal(ORG_A, 's-1', { migration_source: 'engagement_pipeline' });
    const out = await read();
    expect(out!.provenance.sources).toEqual(['engagement_messages', 'lead_signals']);
    expect(out!.provenance.signalProducers).toEqual(['engagement_pipeline']);
    expect(out!.signals[0].sourceId).toBe('src-s-1');   // the idempotency key, surfaced
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — absence is absence, never a negative signal', () => {
  it('a Prospect with no engagement reports nothing found, and no signal', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    const out = await read();
    expect(out!.completeness).toEqual({ hasPerson: true, threads: 0, messages: 0, signals: 0 });
    expect(out!.timeline).toEqual([]);
    expect(out!.signals).toEqual([]);
    expect(out!.engagement.lastActivityAt).toBeNull();     // null, not an epoch
  });

  it('a Prospect with no resolved person says so — it does not say "disengaged"', async () => {
    seedProspect(ORG_A, LEAD, null);
    const out = await read();
    expect(out!.personId).toBeNull();
    expect(out!.completeness.hasPerson).toBe(false);
    expect(out!.reason).toMatch(/no resolved person/);
    expect(out!.signals).toEqual([]);
  });

  it('manufactures no signal from silence', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);            // a thread, but nothing in it
    const out = await read();
    expect(out!.signals).toEqual([]);
    expect(out!.timeline).toEqual([]);
    expect(db.writeOps).toEqual([]);
  });

  it('reports age, and asserts staleness only under a caller policy', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedMessage('m-1', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });

    expect((await read())!.freshness).toMatchObject({ ageDays: 2, stale: null });
    expect((await read({ stalenessDays: 30 }))!.freshness.stale).toBe(false);
    expect((await read({ stalenessDays: 1 }))!.freshness.stale).toBe(true);
  });

  it('no dated evidence is STALE under a policy — and completeness says why', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    const out = await read({ stalenessDays: 30 });
    expect(out!.freshness).toMatchObject({ ageDays: null, stale: true });
    // Stale-for-lack-of-evidence is distinguishable from stale-and-old.
    expect(out!.completeness.messages).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — signal linkage, one Account many Prospects, idempotency', () => {
  it('links signals by thread AND by contact, counting a shared one once', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedContact(ORG_A, 'contact-1', PERSON);
    seedSignal(ORG_A, 's-thread', { thread_id: 'thread-1', contact_id: null });
    seedSignal(ORG_A, 's-contact', { thread_id: null, contact_id: 'contact-1' });
    seedSignal(ORG_A, 's-both', { thread_id: 'thread-1', contact_id: 'contact-1' });

    const out = await read();
    expect(out!.signals.map((s) => s.id)).toEqual(['s-both', 's-contact', 's-thread']);
    expect(out!.signals.find((s) => s.id === 's-both')!.linkedBy).toEqual(['thread', 'contact']);
  });

  it('two Prospects for the same person each see that person\'s evidence', async () => {
    seedProspect(ORG_A, 'lead-a', PERSON);
    seedProspect(ORG_A, 'lead-b', PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedMessage('m-1', 'thread-1');

    const a = await read({ prospectId: 'lead-a' });
    const b = await read({ prospectId: 'lead-b' });
    expect(a!.timeline.map((e) => e.id)).toEqual(['m-1']);
    expect(b!.timeline.map((e) => e.id)).toEqual(['m-1']);
    expect(a!.prospectId).not.toBe(b!.prospectId);      // evidence shared, identity not
  });

  it('another person\'s threads and signals never appear', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedThread(ORG_A, 'thread-other', 'person-2');
    seedMessage('m-mine', 'thread-1');
    seedMessage('m-theirs', 'thread-other');
    seedSignal(ORG_A, 's-theirs', { thread_id: 'thread-other' });

    const out = await read();
    expect(out!.timeline.map((e) => e.id)).toEqual(['m-mine']);
    expect(out!.signals).toEqual([]);
  });

  it('repeated reads are idempotent and create nothing', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedMessage('m-1', 'thread-1');
    seedMessage('m-2', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });
    seedSignal(ORG_A, 's-1');

    const first = await read();
    const second = await read();
    expect(second).toEqual(first);
    expect(db.writeOps).toEqual([]);
    expect(db.tables.lead_signals).toHaveLength(1);
  });

  it('ordering is stable when two events share a timestamp', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedMessage('m-b', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });
    seedMessage('m-a', 'thread-1', { platform_created_at: '2026-09-02T00:00:00.000Z' });
    expect((await read())!.timeline.map((e) => e.id)).toEqual(['m-a', 'm-b']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — tenant isolation across every join', () => {
  it('Tenant A cannot read Tenant B\'s Prospect', async () => {
    seedProspect(ORG_B, LEAD, PERSON);
    expect(await read()).toBeNull();
  });

  it('a globally unique person id does NOT authorise another tenant\'s threads', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_B, 'thread-b', PERSON);        // same person id, other tenant
    seedMessage('m-b', 'thread-b');
    const out = await read();
    expect(out!.engagement.threadCount).toBe(0);
    expect(out!.timeline).toEqual([]);
  });

  it('messages are reachable ONLY through tenant-scoped threads', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-a', PERSON);
    seedThread(ORG_B, 'thread-b', PERSON);
    seedMessage('m-mine', 'thread-a');
    seedMessage('m-theirs', 'thread-b');

    const out = await read();
    // `engagement_messages` has NO tenant column; this is the whole guarantee.
    expect(out!.timeline.map((e) => e.id)).toEqual(['m-mine']);
  });

  it('Tenant B\'s signals never reach Tenant A, even on a shared thread id', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedSignal(ORG_A, 's-mine', { thread_id: 'thread-1' });
    seedSignal(ORG_B, 's-theirs', { thread_id: 'thread-1' });
    expect((await read())!.signals.map((s) => s.id)).toEqual(['s-mine']);
  });

  it('Tenant B\'s contacts cannot pull signals into Tenant A', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedContact(ORG_B, 'contact-b', PERSON);
    seedSignal(ORG_A, 's-b', { thread_id: null, contact_id: 'contact-b' });
    expect((await read())!.signals).toEqual([]);
  });

  it('EVERY tenant-capable read carries its tenant column', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    seedContact(ORG_A, 'contact-1', PERSON);
    seedSignal(ORG_A, 's-1');
    await read();

    for (const [table, column] of [
      ['canonical_leads', 'company_id'],
      ['engagement_threads', 'organization_id'],
      ['contacts', 'organization_id'],
      ['lead_signals', 'organization_id'],
    ] as Array<[string, string]>) {
      expect(db.filters).toContainEqual({ table, column, value: ORG_A });
    }
    // The one table that CANNOT be tenant-filtered is filtered by thread only.
    const messageFilters = db.filters.filter((f) => f.table === 'engagement_messages');
    expect(messageFilters.map((f) => f.column)).toEqual(['thread_id']);
  });

  it('refuses tenant-less access and ambient time', async () => {
    await expect(read({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(read({ prospectId: '' })).rejects.toThrow(/prospectId is required/);
    await expect(read({ now: '' })).rejects.toThrow(/now is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-5 — failure semantics', () => {
  it('an unreadable canonical table fails safely, with the table named', async () => {
    db.errors.canonical_leads = { message: 'connection reset' };
    await expect(read()).rejects.toThrow(/canonical_leads read failed: connection reset/);

    db.errors = {};
    seedProspect(ORG_A, LEAD, PERSON);
    db.errors.engagement_threads = { message: 'permission denied' };
    await expect(read()).rejects.toThrow(/engagement_threads read failed: permission denied/);
  });

  it('an unreadable signal table is an error, never an empty signal set', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    seedThread(ORG_A, 'thread-1', PERSON);
    db.errors.lead_signals = { message: 'timeout' };
    await expect(read()).rejects.toThrow(/lead_signals read failed: timeout/);
  });

  it('a port failure returns no partial timeline', async () => {
    seedProspect(ORG_A, LEAD, PERSON);
    const ports: ProspectEngagementPorts = {
      ...defaultProspectEngagementPorts,
      async loadMessages() { throw new Error('downstream unavailable'); },
    };
    await expect(readProspectEngagementIntelligence(
      { organizationId: ORG_A, prospectId: LEAD, now: NOW }, ports,
    )).rejects.toThrow('downstream unavailable');
    expect(db.writeOps).toEqual([]);
  });

  it('an unknown Prospect is null — distinct from one with no evidence', async () => {
    expect(await read({ prospectId: 'nope' })).toBeNull();
    seedProspect(ORG_A, 'known', PERSON);
    const empty = await read({ prospectId: 'known' });
    expect(empty).not.toBeNull();
    expect(empty!.version).toBe(PROSPECT_ENGAGEMENT_VERSION);
    expect(empty!.completeness.messages).toBe(0);
  });
});
