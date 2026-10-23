/**
 * PHASE 4C-4B — the phone / WhatsApp normalization contract, pinned.
 *
 * The 4C-4A audit found that NO test asserted `normalizePhone`'s behaviour, and
 * that seven suites replace it with a weaker mock — `(v) => v.trim()` or
 * `(v) => v` — so none of them would catch a normalization regression. This
 * suite exercises the REAL helpers and the REAL evaluator.
 *
 * ─── WHAT THIS SUITE DOES *NOT* CLAIM ──────────────────────────────────────
 * Three groups below pin behaviour the audit identified as DEFECTIVE (M1, M2,
 * M3). They assert what the code does TODAY so that a future fix is a visible,
 * deliberate change rather than a silent one. Each is labelled. **Production
 * behaviour is unchanged by this phase and these defects remain unfixed.**
 *
 * Runs against a double. Real constraints, RLS and PostgREST stay UNVERIFIED.
 */

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];

const db = {
  tables: {} as Record<string, Row[]>,
  failures: {} as Record<string, { code: string; message: string }>,
  queries: [] as Array<{ table: string; op: string; filters: Filter[]; payload: Row | null }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', filters: [] as Filter[], payload: null as Row | null };
    const rows = (): Row[] => (db.tables[table] ??= []);
    const match = (r: Row): boolean =>
      st.filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val;
        if (kind === 'is') return (r[col] ?? null) === val;
        if (kind === 'in') return Array.isArray(val) && (val as unknown[]).includes(r[col] ?? null);
        return true;
      });

    const exec = async (mode: 'many' | 'maybe'): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      db.queries.push({ table, op: st.op, filters: st.filters, payload: st.payload });
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };

      if (st.op === 'insert' || st.op === 'upsert') {
        const defaults: Row = table === 'contact_governance_records'
          ? { effective_from: new Date(0).toISOString(), effective_until: null, revoked_at: null, person_id: null, target_normalized: null }
          : {};
        const candidate = { ...defaults, ...(st.payload as Row) };
        // `uq_suppression (company_id, channel, target)` — the upsert target.
        if (st.op === 'upsert' && table === 'suppression_entries') {
          const existing = rows().find((r) => r.company_id === candidate.company_id && r.channel === candidate.channel && r.target === candidate.target);
          if (existing) { Object.assign(existing, candidate); return { data: existing, error: null }; }
        }
        const created = { id: `${table}-${db.nextId++}`, ...candidate };
        rows().push(created);
        return { data: created, error: null };
      }
      if (st.op === 'update') {
        const hit = rows().filter(match);
        for (const r of hit) Object.assign(r, st.payload);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const found = rows().filter(match);
      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push(['is', c, v]); return b; },
      in: (c: string, v: unknown) => { st.filters.push(['in', c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      maybeSingle: () => exec('maybe'),
      single: () => exec('maybe'),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => exec('many').then(resolve, reject),
    };
    return b;
  },
}));

import { normalizeEmail, normalizePhone } from '../../services/identityResolutionService';
import { loadGovernanceRecords, normalizeGovernanceTarget } from '../../services/prospectIdentity/contactGovernanceRepository';
import { mayContact } from '../../services/prospectIdentity/contactGovernance';
import { addSuppression, isSuppressed, releaseSuppression } from '../../services/execution/suppressionService';

const ORG = '00000000-0000-4000-8000-00000000000a';
const NOW = '2026-06-01T00:00:00.000Z';

/** The audit's representation matrix: one number, written eight ways. */
const SPACED = '+1 555 010 0000';
const PUNCTUATED = '+1 (555) 010-0000';
const COMPACT = '+15550100000';
const NO_PLUS = '15550100000';
const NATIONAL = '5550100000';

const govRow = (over: Row = {}): Row => ({
  id: 'g1', organization_id: ORG, person_id: null, target_normalized: COMPACT,
  channel: 'phone', governance_type: 'dnc_permanent',
  effective_from: '2026-01-01T00:00:00.000Z', effective_until: null, revoked_at: null,
  ...over,
});

beforeEach(() => {
  db.tables = { contact_governance_records: [], suppression_entries: [], identity_claims: [] };
  db.failures = {};
  db.queries = [];
  db.nextId = 1;
});

// ── 1. The normalizer itself ────────────────────────────────────────────────
describe('4C-4B — normalizePhone, the real helper', () => {
  it('1. strips formatting characters and keeps a leading +', () => {
    expect(normalizePhone(COMPACT)).toBe('+15550100000');
    expect(normalizePhone(SPACED)).toBe('+15550100000');
    expect(normalizePhone(PUNCTUATED)).toBe('+15550100000');
    // Those three are the SAME key: formatting is not identity.
    expect(new Set([normalizePhone(COMPACT), normalizePhone(SPACED), normalizePhone(PUNCTUATED)]).size).toBe(1);
  });

  it('2. the leading + is SIGNIFICANT — with and without it are different keys', () => {
    expect(normalizePhone(NO_PLUS)).toBe('15550100000');
    expect(normalizePhone(COMPACT)).toBe('+15550100000');
    expect(normalizePhone(COMPACT)).not.toBe(normalizePhone(NO_PLUS));
  });

  it('3. national and international forms are NOT inferred to be equivalent', () => {
    expect(normalizePhone(NATIONAL)).toBe('5550100000');
    expect(normalizePhone(NATIONAL)).not.toBe(normalizePhone(COMPACT));
    // No country-code policy exists, so none is applied.
    expect(normalizePhone('0044 20 7946 0000')).toBe('00442079460000');
    expect(normalizePhone('+442079460000')).toBe('+442079460000');
    expect(normalizePhone('0044 20 7946 0000')).not.toBe(normalizePhone('+442079460000'));
  });

  it('4. extension-like suffixes are NOT specially parsed — the digits are absorbed', () => {
    // Pinning current behaviour, not endorsing it: the extension becomes part of
    // the key, so this value can never match the bare number.
    expect(normalizePhone('+15550100000 x123')).toBe('+15550100000123');
    expect(normalizePhone('+15550100000 x123')).not.toBe(normalizePhone(COMPACT));
  });

  it('5. missing values follow the null / unanchorable contract', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    // A value with no digits and no + collapses to nothing, not to itself.
    expect(normalizePhone('abc')).toBeNull();
  });

  it('6. it is NOT the weaker shape the mocking suites substitute', () => {
    // Seven suites replace this helper with `(v) => v.trim()` or `(v) => v`.
    // Those mocks are not faithful, and this is the proof.
    const trimOnly = (v: string) => (v ?? '').trim() || null;
    const identity = (v: string) => v;
    expect(normalizePhone(SPACED)).not.toBe(trimOnly(SPACED));
    expect(normalizePhone(SPACED)).not.toBe(identity(SPACED));
  });
});

// ── 2. The governance-facing wrapper ───────────────────────────────────────
describe('4C-4B — normalizeGovernanceTarget per channel', () => {
  it('7. email casefolds; phone and WhatsApp share the phone normalizer', () => {
    expect(normalizeGovernanceTarget('email', '  Alice@Example.Test ')).toBe('alice@example.test');
    expect(normalizeGovernanceTarget('phone', SPACED)).toBe('+15550100000');
    expect(normalizeGovernanceTarget('whatsapp', SPACED)).toBe('+15550100000');
    // WhatsApp has no normalizer of its own, by design.
    expect(normalizeGovernanceTarget('whatsapp', SPACED)).toBe(normalizeGovernanceTarget('phone', SPACED));
  });

  it('8. an unknown channel casefolds and does NOT strip digits', () => {
    expect(normalizeGovernanceTarget('carrier_pigeon', '  Foo BAR ')).toBe('foo bar');
    expect(normalizeGovernanceTarget('carrier_pigeon', SPACED)).toBe('+1 555 010 0000');
  });

  it('9. missing or blank targets are null on every channel', () => {
    for (const channel of ['email', 'phone', 'whatsapp', 'carrier_pigeon', '*']) {
      expect(normalizeGovernanceTarget(channel, null)).toBeNull();
      expect(normalizeGovernanceTarget(channel, '   ')).toBeNull();
    }
  });

  it('10. email agrees with normalizeEmail, which is why email has no divergence', () => {
    // The legacy store's own `norm()` is trim+lowercase, identical to this —
    // which is exactly why the divergence is phone/WhatsApp-only.
    expect(normalizeGovernanceTarget('email', ' A@B.TEST ')).toBe(normalizeEmail(' A@B.TEST '));
  });
});

// ── 3. M4 — the + makes two subjects out of one number ─────────────────────
describe('4C-4B / M4 — a record for one form does not block the other', () => {
  it('11. a canonical record on +1555… does not block 1555… (and vice versa)', async () => {
    db.tables.contact_governance_records = [govRow({ target_normalized: COMPACT })];

    expect((await isSuppressed(ORG, 'phone', COMPACT)).suppressed).toBe(true);
    expect((await isSuppressed(ORG, 'phone', SPACED)).suppressed).toBe(true);     // same key
    expect((await isSuppressed(ORG, 'phone', PUNCTUATED)).suppressed).toBe(true); // same key
    // Different key — not blocked. Pinning the gap, not endorsing it.
    expect((await isSuppressed(ORG, 'phone', NO_PLUS)).suppressed).toBe(false);
    expect((await isSuppressed(ORG, 'phone', NATIONAL)).suppressed).toBe(false);
  });

  it('12. a WhatsApp restriction blocks the same number given either way', async () => {
    db.tables.contact_governance_records = [govRow({ channel: 'whatsapp', target_normalized: COMPACT })];

    expect((await isSuppressed(ORG, 'whatsapp', SPACED)).suppressed).toBe(true);
    expect((await isSuppressed(ORG, 'whatsapp', PUNCTUATED)).suppressed).toBe(true);
  });
});

// ── 4. M1 / M2 — the raw-versus-normalized comparison, at the real seam ────
describe('4C-4B / M1+M2 — `mayContact` compares EXACTLY, which is why its callers must normalise', () => {
  /**
   * These assertions pin `mayContact`'s pure-comparison contract: it normalises
   * nothing, so a raw target does not match a normalised record even when the
   * loader returned that record. That contract is DELIBERATE and R1 preserved
   * it — the fix was applied to the callers, never to the evaluator.
   *
   * WHAT CHANGED (R1, Phase 4C-4D): Path C (`readiness.ts`) and Path D
   * (`leadIntelligenceReadService`) no longer pass a raw target. They normalise
   * at the comparison boundary with `normalizeGovernanceTarget` and the
   * channel the target belongs to. The positive proof of that lives with each
   * path — `piWs8OutreachReadiness` and `leadIntelligenceReadService` — because
   * it belongs on the real call path, not on this evaluator-level mechanism.
   *
   * So the assertions below are unchanged in meaning: they are now the
   * SPECIFICATION of why the callers must normalise, not a record of a defect.
   */
  it('13. the loader DOES find the record for a raw spelling — it normalises its query', async () => {
    db.tables.contact_governance_records = [govRow({ target_normalized: COMPACT })];

    const loaded = await loadGovernanceRecords({ organizationId: ORG, target: SPACED, channel: 'phone' });

    expect(loaded.ok).toBe(true);
    expect(loaded.records).toHaveLength(1);
  });

  it('14. ...and a RAW `targetNormalized` does not match it — which is why callers normalise', async () => {
    db.tables.contact_governance_records = [govRow({ target_normalized: COMPACT })];
    const loaded = await loadGovernanceRecords({ organizationId: ORG, target: SPACED, channel: 'phone' });

    // What Path C and Path D passed BEFORE R1: the RAW value.
    const raw = mayContact({
      organizationId: ORG, personId: null, targetNormalized: SPACED,
      channel: 'phone', now: NOW, records: loaded.records,
    });
    // What they pass AFTER R1, as Path A and Path B already did.
    const normalised = mayContact({
      organizationId: ORG, personId: null, targetNormalized: normalizeGovernanceTarget('phone', SPACED),
      channel: 'phone', now: NOW, records: loaded.records,
    });

    expect(raw.decision).toBe('allowed');          // the evaluator's exact-comparison contract
    expect(normalised.decision).toBe('blocked');   // what every caller now yields
    expect(normalised.governanceType).toBe('dnc_permanent');
  });

  it('15. the same holds for EMAIL whenever the raw value is not already casefolded', async () => {
    db.tables.contact_governance_records = [govRow({ channel: 'email', target_normalized: 'alice@example.test' })];
    const loaded = await loadGovernanceRecords({ organizationId: ORG, target: 'Alice@Example.Test', channel: 'email' });

    expect(loaded.records).toHaveLength(1);
    expect(mayContact({
      organizationId: ORG, personId: null, targetNormalized: 'Alice@Example.Test',
      channel: 'email', now: NOW, records: loaded.records,
    }).decision).toBe('allowed');                  // not phone-only: casefolding matters too
  });

  it('16. a person-anchored restriction is unaffected — it never compares a target', async () => {
    const PERSON = '00000000-0000-4000-8000-000000000001';
    db.tables.contact_governance_records = [govRow({ person_id: PERSON, target_normalized: null })];
    const loaded = await loadGovernanceRecords({ organizationId: ORG, personId: PERSON, target: SPACED, channel: 'phone' });

    expect(mayContact({
      organizationId: ORG, personId: PERSON, targetNormalized: SPACED,
      channel: 'phone', now: NOW, records: loaded.records,
    }).decision).toBe('blocked');
  });
});

// ── 5. M3 — the release that reports success while the legacy row survives ──
describe('4C-4B / M3+M5 — FIXED BY R2 then R3-A′: a mismatched-spelling release now completes', () => {
  /**
   * These were 4C-4B's fix-detectors, pinning the DEFECT so no fix could land
   * silently. Both fixes have now landed, in two steps:
   *
   *   R2  stopped the FALSE CLAIM — a zero-row legacy update was reported as
   *       `no_match` / `complete: false` instead of as a completed release.
   *   R3-A′ removed the CAUSE — the release now also deactivates on
   *       `norm(target_raw)`, the spelling the canonical record itself recorded,
   *       so the legacy row is actually found.
   *
   * Tests 18 and 19 therefore assert the corrected behaviour, each with the
   * positive assertion that proves it. Test 17 is untouched and still pins the
   * fact that drove all of this: one write really does produce two keys.
   */
  const writeSpaced = () => addSuppression({ companyId: ORG, channel: 'phone', target: SPACED, reason: 'manual' });

  it('17. one write produces TWO different keys, one per store', async () => {
    await writeSpaced();

    expect(db.tables.contact_governance_records[0].target_normalized).toBe(COMPACT);   // normalised
    expect(db.tables.suppression_entries[0].target).toBe('+1 555 010 0000');           // trim+lowercase only
  });

  it('18. releasing with the COMPACT spelling DEACTIVATES the row written as SPACED', async () => {
    await writeSpaced();

    const released = await releaseSuppression(ORG, 'phone', COMPACT);

    expect(released.canonicalRevoked).toBe(1);                   // canonical matched
    // R3-A′: the legacy row is found via `norm(target_raw)`, not via the
    // request's formatting. Pre-R2 this said `complete: true` while the row
    // survived; post-R2 it said `no_match`; now the row is genuinely gone.
    expect(released.legacyOutcome).toBe('deactivated');
    expect(released.legacyDeactivated).toBe(true);
    expect(released.complete).toBe(true);
    expect(released.legacyError).toBeNull();
    expect(db.tables.suppression_entries[0].active).toBe(false); // POSITIVE: actually released
  });

  it('19. so the target is released on BOTH spellings, and the result says so', async () => {
    await writeSpaced();
    const released = await releaseSuppression(ORG, 'phone', COMPACT);

    expect(released.complete).toBe(true);

    // The positive proof: neither spelling is suppressed any more, and no
    // surviving legacy row answers for either.
    expect((await isSuppressed(ORG, 'phone', SPACED)).suppressed).toBe(false);
    expect((await isSuppressed(ORG, 'phone', COMPACT)).suppressed).toBe(false);
  });

  it('20. releasing with the ORIGINAL spelling clears both stores — the defect is spelling-dependent', async () => {
    await writeSpaced();

    const released = await releaseSuppression(ORG, 'phone', SPACED);

    expect(released).toMatchObject({ canonicalRevoked: 1, legacyDeactivated: true, complete: true });
    expect(db.tables.suppression_entries[0].active).toBe(false);
    expect((await isSuppressed(ORG, 'phone', SPACED)).suppressed).toBe(false);
  });

  it('21. EMAIL is immune: both stores derive the same key, so release is consistent', async () => {
    await addSuppression({ companyId: ORG, channel: 'email', target: ' Alice@Example.Test ', reason: 'manual' });

    expect(db.tables.contact_governance_records[0].target_normalized).toBe('alice@example.test');
    expect(db.tables.suppression_entries[0].target).toBe('alice@example.test');

    const released = await releaseSuppression(ORG, 'email', 'ALICE@example.test');
    expect(released.complete).toBe(true);
    expect(db.tables.suppression_entries[0].active).toBe(false);
    expect((await isSuppressed(ORG, 'email', 'alice@example.test')).suppressed).toBe(false);
  });
});
