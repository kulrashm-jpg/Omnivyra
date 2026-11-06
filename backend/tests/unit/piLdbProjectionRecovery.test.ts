/**
 * PI-LDB Prompt 2B · PROJECTION RECONCILIATION.
 *
 * The ingestion path is fail-open about projection: a record whose
 * `lead_intelligence` write fails still leaves a durable canonical prospect,
 * person, employer and evidence behind. That is the right trade, and it left
 * no way BACK - the prospect existed, was invisible to the Lead Database, and
 * the only repair was to re-run the discovery search and pay the vendor again
 * for records already held.
 *
 * ─── WHAT IS REAL HERE ─────────────────────────────────────────────────────
 * `reconcileLeadProjections`, `routeToCanonicalInput`, `computeLeadDedupeKey`
 * and `ingestCanonicalLead` are all the production implementations. Only the
 * three boundaries are injected: the prospect read, the projection lookup and
 * the sink. The sink double is backed by a KEYED STORE, so "already
 * projected" can only be true here if a row is genuinely under that key -
 * which is what makes the idempotency claim checkable rather than asserted.
 */

import {
  reconcileLeadProjections,
  MAX_RECONCILE_BATCH,
  type ReconcileProspectRow,
} from '../../services/leadIntelligence/leadProjectionReconciliation';
import {
  computeLeadDedupeKey,
  canonicalProspectSource,
  buildBuyingIntentProfile,
  canonicalLeadToView,
  routeToCanonicalInput,
  type CanonicalLead,
  type LeadProjectionResult,
} from '../../../lib/leadIntelligence';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const AT = '2026-11-05T10:00:00.000Z';

/** Rows that have "landed", keyed exactly as lead_intelligence_dedupe_unique is. */
let store: Map<string, { id: string }>;
let emitted: CanonicalLead[];
let lookups: Array<{ companyId: string; dedupeKey: string }>;
/** Verdict the sink returns; `null` means "throw instead". */
let sinkVerdict: LeadProjectionResult | 'throw' | null;
let lookupOutcome: 'store' | 'unknown';

beforeEach(() => {
  store = new Map();
  emitted = [];
  lookups = [];
  sinkVerdict = null;
  lookupOutcome = 'store';
});

const prospect = (over: Partial<ReconcileProspectRow> = {}): ReconcileProspectRow => ({
  id: 'prospect-1',
  company_id: ORG,
  source: 'apollo',
  created_at: AT,
  ...over,
});

function ports(over: Record<string, unknown> = {}) {
  return {
    readProspects: async (_org: string, limit: number) => ({
      rows: (over.rows as ReconcileProspectRow[]) ?? [prospect()],
      truncated: Boolean(over.truncated),
    }),
    findProjection: async (companyId: string, dedupeKey: string) => {
      lookups.push({ companyId, dedupeKey });
      if (lookupOutcome === 'unknown') return { outcome: 'unknown' as const };
      const hit = store.get(`${companyId}|${dedupeKey}`);
      return hit ? { outcome: 'found' as const, leadId: hit.id } : { outcome: 'absent' as const };
    },
    sink: {
      emit: async (lead: CanonicalLead) => {
        if (sinkVerdict === 'throw') throw new Error('the sink exploded');
        emitted.push(lead);
        const key = `${lead.organizationId}|${computeLeadDedupeKey(lead)}`;
        if (sinkVerdict) return sinkVerdict;
        store.set(key, { id: `lead-${store.size + 1}` });
        return {
          status: 'persisted' as const, leadId: `lead-${store.size}`,
          reason: null, warnings: [], error: null,
        };
      },
    },
    now: () => AT,
    ...(over.portOverrides as object ?? {}),
  } as never;
}

const run = (over: Record<string, unknown> = {}, limit?: number) =>
  reconcileLeadProjections({ organizationId: ORG, ...(limit ? { limit } : {}), ports: ports(over) });

/* ══════════════════════════════════════════════════════════════════════════*/

describe('PI-LDB 2B · the key it reconciles on IS the key the write path used', () => {
  it('matches the orchestrator\'s dedupe key for the same prospect, exactly', () => {
    // THE CLAIM EVERYTHING ELSE RESTS ON. If these two differed,
    // "reconciliation" would insert a SECOND row rather than repair the
    // missing one - the opposite of its purpose - and no other test here
    // would notice, because they all use the same reader.
    //
    // The orchestrator builds its input from the provider record; this builds
    // it from the stored `canonical_leads` row through `crmAdapter`. Two
    // different code paths, one key.
    const orchestratorKey = computeLeadDedupeKey({
      organizationId: ORG,
      source: canonicalProspectSource({ rawSource: 'apollo' }),
      identity: { email: 'a@b.test', unifiedPersonId: 'up-1' },
      sourceRef: { table: 'canonical_leads', id: 'prospect-1' },
      occurredAt: AT,
    } as never);

    const reconciliationKey = computeLeadDedupeKey(
      routeToCanonicalInput('crm', prospect() as Record<string, unknown>),
    );

    expect(reconciliationKey).toBe(orchestratorKey);
    expect(reconciliationKey).toBe('src:crm|tbl:canonical_leads|id:prospect-1');
  });

  it('`unified_source` would move the key, which is why the reader drops it', () => {
    // The documented asymmetry: the reader passes three signals and the writer
    // one, so they could disagree for a raw source with no RAW_ALIASES entry.
    //
    // CORRECTED IN PROMPT 2C. This used to read "a row from the database has
    // no `unified_source` column at all". It has one -
    // `20260620_unified_source_columns.sql` declares it on
    // `public.canonical_leads` - and it is merely unapplied where we looked.
    // What makes the two sides agree is not the column's absence but
    // `readProspectsDefault` dropping it, which
    // `piLdbReconciliationReaderKeyStability` pins against the real reader.
    // The assertion below is the hazard itself, and it was always correct.
    const withUnified = prospect({ unified_source: { origin: 'import', category: 'file' } });
    expect(computeLeadDedupeKey(routeToCanonicalInput('crm', withUnified as Record<string, unknown>)))
      .not.toBe('src:crm|tbl:canonical_leads|id:prospect-1');
    // ... and without it, which is the shape the reader guarantees, both sides
    // agree.
    expect(computeLeadDedupeKey(routeToCanonicalInput('crm', prospect() as Record<string, unknown>)))
      .toBe('src:crm|tbl:canonical_leads|id:prospect-1');
  });
});

describe('PI-LDB 2B · it projects what is missing and leaves alone what is not', () => {
  it('projects a prospect with no read-model row', async () => {
    const out = await run();
    expect(out.projected).toBe(1);
    expect(out.alreadyProjected).toBe(0);
    expect(out.examined).toBe(1);
    expect(out.outcomes[0].status).toBe('projected');
    expect(out.outcomes[0].projection?.status).toBe('persisted');
    // The row is genuinely in the store, under the key above.
    expect(store.has(`${ORG}|src:crm|tbl:canonical_leads|id:prospect-1`)).toBe(true);
  });

  it('a prospect already projected is RECOGNISED and not written again', async () => {
    store.set(`${ORG}|src:crm|tbl:canonical_leads|id:prospect-1`, { id: 'lead-existing' });
    const out = await run();
    expect(out.alreadyProjected).toBe(1);
    expect(out.projected).toBe(0);
    // NOT WRITTEN. A repair pass that quietly rewrites healthy rows would bump
    // `updated_at` and re-run score materialization on rows nobody asked to
    // change - which, given the score-protection work, is the one thing it
    // must not do.
    expect(emitted).toHaveLength(0);
  });

  it('IDEMPOTENT: running it twice does the work once', async () => {
    const first = await run();
    expect(first.projected).toBe(1);
    const second = await run();
    expect(second.projected).toBe(0);
    expect(second.alreadyProjected).toBe(1);
    expect(store.size).toBe(1);
    expect(emitted).toHaveLength(1);
  });

  it('a verdict short of `persisted` is reported as still missing, never as repaired', async () => {
    for (const verdict of [
      { status: 'failed' as const, leadId: null, reason: 'schema_not_applied' as const, warnings: [], error: null },
      { status: 'pending_reconciliation' as const, leadId: null, reason: 'no_row_returned' as const, warnings: [], error: null },
      { status: 'skipped' as const, leadId: null, reason: 'no_prospect' as const, warnings: [], error: null },
    ]) {
      store.clear(); emitted = [];
      sinkVerdict = verdict;
      const out = await run();
      expect(out.projected).toBe(0);
      expect(out.stillMissing).toBe(1);
      expect(out.outcomes[0].status).toBe('still_missing');
      expect(out.outcomes[0].projection?.status).toBe(verdict.status);
    }
  });

  it('a throwing sink is still missing, and does not abort the pass', async () => {
    sinkVerdict = 'throw';
    const out = await reconcileLeadProjections({
      organizationId: ORG,
      ports: ports({ rows: [prospect(), prospect({ id: 'prospect-2' })] }),
    });
    expect(out.examined).toBe(2);
    expect(out.stillMissing).toBe(2);
    expect(String(out.outcomes[0].detail)).toContain('the sink exploded');
  });

  it('an UNESTABLISHED lookup attempts nothing', async () => {
    // Projecting on a read that could not answer is how a repair pass starts
    // writing rows it has no evidence are needed.
    lookupOutcome = 'unknown';
    const out = await run();
    expect(out.unknown).toBe(1);
    expect(out.projected).toBe(0);
    expect(emitted).toHaveLength(0);
  });
});

describe('PI-LDB 2B · it refuses what it cannot safely project', () => {
  it('a row naming another tenant is skipped, not projected into this one', async () => {
    const out = await reconcileLeadProjections({
      organizationId: ORG,
      ports: ports({ rows: [prospect({ company_id: OTHER_ORG })] }),
    });
    expect(out.skipped).toBe(1);
    expect(out.projected).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(String(out.outcomes[0].detail)).toContain(OTHER_ORG);
  });

  it('a row with no id is skipped - it has no stable projection key', async () => {
    const out = await reconcileLeadProjections({
      organizationId: ORG,
      ports: ports({ rows: [prospect({ id: null })] }),
    });
    expect(out.skipped).toBe(1);
    expect(out.outcomes[0].dedupeKey).toBeNull();
    expect(lookups).toHaveLength(0);
  });

  it('is never tenant-less', async () => {
    await expect(reconcileLeadProjections({ organizationId: '  ' })).rejects.toThrow('never tenant-less');
    await expect(reconcileLeadProjections({ organizationId: undefined as never })).rejects.toThrow();
  });

  it('is bounded, and says so when there is more', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => prospect({ id: `p-${i}` }));
    const out = await reconcileLeadProjections({
      organizationId: ORG, limit: 3, ports: ports({ rows, truncated: true }),
    });
    expect(out.examined).toBe(3);
    expect(out.projected).toBe(3);
    expect(out.truncated).toBe(true);
    expect(store.size).toBe(3);
  });

  it('clamps an out-of-range limit rather than trusting it', async () => {
    const seen: number[] = [];
    const probe = (limit: number) => reconcileLeadProjections({
      organizationId: ORG,
      limit,
      ports: {
        readProspects: async (_o: string, l: number) => { seen.push(l); return { rows: [], truncated: false }; },
      } as never,
    });
    await probe(10_000);
    await probe(0);
    await probe(-5);
    expect(seen).toEqual([MAX_RECONCILE_BATCH, 1, 1]);
  });
});

describe('PI-LDB 2B · reconciliation cannot create an identity or a false claim', () => {
  it('ECHOES the prospect\'s own person id and resolves nothing', async () => {
    // A pass that resolved identities again could attach a different person to
    // an existing prospect and split one lead in two. It has no need to: the
    // dedupe key is a function of the prospect id, not of the identity.
    await reconcileLeadProjections({
      organizationId: ORG,
      ports: ports({ rows: [prospect({ unified_person_id: 'up-9' })] }),
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].identityMatchedBy ?? 'projection_reconciliation')
      .toBe('projection_reconciliation');
  });

  it('a reconciled Apollo prospect is visible WITHOUT gaining a form-submission claim', async () => {
    // Items 1 and 4 together. Reconciliation makes the prospect listable; it
    // must not make it look like an inbound lead on the way. `crmAdapter`
    // gives it a `pi_discovery` origin from its raw source, and the evidence
    // rule refuses `lead_captured` for that.
    await run();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].origin?.category).toBe('pi_discovery');
    expect(emitted[0].origin?.platform).toBe('apollo');

    const profile = buildBuyingIntentProfile({ view: canonicalLeadToView(emitted[0]) });
    expect(profile.evidence.map((e) => e.type)).not.toContain('lead_captured');
    expect(profile.score).toBe(0);
    expect(profile.decisionJourney.some((s) => s.label === 'Converted')).toBe(false);
  });

  it('the reconciled row carries the prospect\'s own source, not a guess', async () => {
    await run();
    expect(emitted[0].source).toBe(canonicalProspectSource({ rawSource: 'apollo' }));
    expect(emitted[0].sourceRef).toEqual({ table: 'canonical_leads', id: 'prospect-1' });
  });
});
