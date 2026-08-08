/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 4 — production producer + persistence seam.
 *
 * Four properties are asserted in separate groups so a mutation to one cannot be reported by another:
 *
 *   PERSISTENCE MAPPING — the semantic identity extracted for the idempotency decision, and the merge
 *   PRODUCER OUTPUT     — write-path inputs → evidence → record, including what it refuses to invent
 *   PARITY PROPAGATION  — the measured comparison parity reaching the record and the result
 *   PROJECTION INTEGRITY— the record's projection is the assembled one, unmodified
 */

import {
  produceCanonicalContact,
  collectContactEvidence,
  writeInputsFromContactRow,
  runContactShadowPersist,
  decideContactPersistence,
  applyCanonicalContactOnly,
  extractSemanticContactIdentity,
  assembleContactUnderstanding,
  projectContact,
  compareToRaw,
  CONTACT_PRODUCER,
  type ContactWriteInputs,
  type ContactRowLike,
  type ContactShadowPersistDeps,
} from '../../services/contactIntelligence';

const ASOF = '2026-08-08T00:00:00.000Z';
const SEEN = '2026-08-01T00:00:00.000Z';

const row = (over: Partial<ContactRowLike> = {}): ContactRowLike => ({
  id: 'ct-1', organization_id: 'co-1',
  platform: 'x', platform_user_id: '12345', contact_key: 'x:12345',
  display_name: 'Alice', profile_url: 'https://x.com/alice',
  unified_person_id: 'up-1', updated_at: SEEN, ...over,
});

const inputs = (over: Partial<ContactWriteInputs> = {}): ContactWriteInputs => ({
  ...writeInputsFromContactRow(row(), ASOF), ...over,
});

const savedEnv = { ...process.env };
const enable = () => { process.env.CONTACT_UNDERSTANDING_ENABLED = 'true'; };
afterEach(() => { process.env = { ...savedEnv }; });

// ── PRODUCER OUTPUT ────────────────────────────────────────────────────────────────────────────────
describe('Contact producer — output', () => {
  it('maps a contacts row onto write-path inputs, tenant included', () => {
    const w = writeInputsFromContactRow(row(), ASOF);
    expect(w.companyId).toBe('co-1');
    expect(w.contactId).toBe('ct-1');
    expect(w.platform).toBe('x');
    expect(w.platformUserId).toBe('12345');
    expect(w.contactKey).toBe('x:12345');
    expect(w.unifiedPersonId).toBe('up-1');
    expect(w.observedAt).toBe(SEEN);
  });

  it('refuses to invent an observation time — no updated_at ⇒ no dated identity evidence', () => {
    const e = collectContactEvidence(inputs({ observedAt: null }));
    // Stamping asOf here would make a row of unknown age score maximally fresh.
    expect(e.identity).toBeUndefined();
    expect(e.profile).toBeUndefined();
  });

  it('abstains channels, interactions and affiliation — a contacts row grounds none of them', () => {
    const e = collectContactEvidence(inputs());
    expect(e.channels).toBeUndefined();
    expect(e.interactions).toBeUndefined();
    const { understanding } = assembleContactUnderstanding(e);
    expect(understanding.facets.channels.value).toBeNull();
    expect(understanding.facets.engagement.value).toBeNull();
    expect(understanding.facets.affiliation.value).toBeNull();
  });

  it('carries already-fetched observations through when the caller supplies them', () => {
    const e = collectContactEvidence(inputs({
      channels: [{ channel: 'dm', observedAt: SEEN }],
      interactions: [{ threadRef: 't1', observedAt: SEEN }],
      sourceRefs: ['thread:t1'],
    }));
    expect(e.channels).toHaveLength(1);
    expect(e.interactions).toHaveLength(1);
    expect(e.sourceRefs).toEqual(['thread:t1']);
  });

  it('produces a persistable record stamped with its producer and evidence source', () => {
    const { record } = produceCanonicalContact(inputs());
    expect(record.company_id).toBe('co-1');
    expect(record.contact_id).toBe('ct-1');
    expect(record.identity_source).toBe('evidence');
    expect(record.producer).toBe(CONTACT_PRODUCER);
    expect(record.built_at).toBe(ASOF);
  });

  it('is deterministic and performs no I/O', () => {
    expect(JSON.stringify(produceCanonicalContact(inputs()))).toBe(JSON.stringify(produceCanonicalContact(inputs())));
  });

  it('yields the legacy field shape an adopter can compare against its row', () => {
    const { legacy } = produceCanonicalContact(inputs());
    expect(legacy).toMatchObject({
      company_id: 'co-1', contact_id: 'ct-1', platform: 'x',
      platform_user_id: '12345', contact_key: 'x:12345',
      display_name: 'Alice', unified_person_id: 'up-1',
    });
  });
});

// ── PARITY PROPAGATION ─────────────────────────────────────────────────────────────────────────────
describe('Contact producer — parity propagation', () => {
  it('the record carries the MEASURED parity, never null', () => {
    const { record, comparison } = produceCanonicalContact(inputs());
    expect(record.parity).not.toBeNull();
    expect(record.parity).toBe(comparison.parity);
  });

  it('the carried parity equals an independent compareToRaw over the same evidence', () => {
    const w = inputs();
    const { record } = produceCanonicalContact(w);
    const evidence = collectContactEvidence(w);
    const independent = compareToRaw(assembleContactUnderstanding(evidence).understanding, evidence);
    expect(record.parity).toBe(independent.parity);
  });

  it('a fully-grounded row round-trips at parity 1.0', () => {
    expect(produceCanonicalContact(inputs()).record.parity).toBe(1);
  });

  it('parity reaches the persist result', async () => {
    enable();
    const written: Array<Record<string, unknown>> = [];
    const deps: ContactShadowPersistDeps = { readShadow: async () => null, writeShadow: async (_c, _k, container) => { written.push(container); } };
    const res = await runContactShadowPersist(inputs(), deps);
    expect(res.parity).toBe(1);
    expect((written[0].canonical_contact as { parity: number }).parity).toBe(1);
  });
});

// ── PROJECTION INTEGRITY ───────────────────────────────────────────────────────────────────────────
describe('Contact producer — projection integrity', () => {
  it('the record projection equals projecting the record understanding at asOf', () => {
    const { record } = produceCanonicalContact(inputs());
    expect(JSON.stringify(record.projection)).toBe(JSON.stringify(projectContact(record.understanding, ASOF)));
  });

  it('the producer does not re-derive — it equals the assembled seam', () => {
    const w = inputs();
    const { understanding, projection } = produceCanonicalContact(w);
    const a = assembleContactUnderstanding(collectContactEvidence(w));
    expect(JSON.stringify(understanding)).toBe(JSON.stringify(a.understanding));
    expect(JSON.stringify(projection)).toBe(JSON.stringify(a.projection));
  });

  it('the projection keeps the tenant-scoped key and the person reference', () => {
    const { projection } = produceCanonicalContact(inputs());
    expect(projection.key).toEqual({ companyId: 'co-1', contactId: 'ct-1' });
    expect(projection.unifiedPersonId).toBe('up-1');
  });
});

// ── PERSISTENCE MAPPING ────────────────────────────────────────────────────────────────────────────
describe('Contact persistence — semantic identity mapping', () => {
  it('extracts the identity fields that gate a write', () => {
    const { record } = produceCanonicalContact(inputs());
    expect(extractSemanticContactIdentity(record)).toEqual({
      platform: 'x', platformUserId: '12345', contactKey: 'x:12345',
      displayName: 'alice', profileUrl: 'https://x.com/alice',
      unifiedPersonId: 'up-1', channels: null,
    });
  });

  it('EXCLUDES metadata — built_at, parity, version and producer never gate a write', () => {
    const a = produceCanonicalContact(inputs()).record;
    const b = { ...a, built_at: '2030-01-01T00:00:00.000Z', parity: 0.1, version: 99, producer: 'other@9' };
    expect(decideContactPersistence(a, b)).toEqual({ persist: false, reason: 'IDENTICAL' });
  });

  it('merges only canonical_contact and preserves every sibling key', () => {
    const { record } = produceCanonicalContact(inputs());
    const merged = applyCanonicalContactOnly({ other: 1, canonical_contact: 'stale' }, record);
    expect(merged.other).toBe(1);
    expect(merged.canonical_contact).toBe(record);
  });
});

describe('Contact persistence — evolution policy', () => {
  const withRow = (over: Partial<ContactRowLike>) => produceCanonicalContact(writeInputsFromContactRow(row(over), ASOF)).record;

  it('INITIAL when nothing was stored before', () => {
    expect(decideContactPersistence(null, withRow({}))).toEqual({ persist: true, reason: 'INITIAL' });
  });

  it('IDENTICAL when the meaningful identity is unchanged', () => {
    expect(decideContactPersistence(withRow({}), withRow({}))).toEqual({ persist: false, reason: 'IDENTICAL' });
  });

  it('IMPROVED when an abstained field becomes grounded', () => {
    const before = withRow({ unified_person_id: null });
    expect(decideContactPersistence(before, withRow({}))).toEqual({ persist: true, reason: 'IMPROVED' });
  });

  it('CHANGED when a grounded field takes a different value', () => {
    expect(decideContactPersistence(withRow({}), withRow({ display_name: 'Alicia' })))
      .toEqual({ persist: true, reason: 'CHANGED' });
  });

  it('DEGRADATION_PROTECTED when a grounded field abstains — identity is never erased', () => {
    expect(decideContactPersistence(withRow({}), withRow({ unified_person_id: null })))
      .toEqual({ persist: false, reason: 'DEGRADATION_PROTECTED' });
  });

  it('a degradation blocks the write even when another field improved', () => {
    const before = withRow({ display_name: null });                    // displayName abstained
    const after = withRow({ display_name: 'Alice', unified_person_id: null }); // gained one, lost another
    expect(decideContactPersistence(before, after)).toEqual({ persist: false, reason: 'DEGRADATION_PROTECTED' });
  });
});

describe('Contact persistence — orchestrator', () => {
  const spyDeps = () => {
    const calls = { read: 0, write: 0, containers: [] as Array<Record<string, unknown>> };
    const deps: ContactShadowPersistDeps = {
      readShadow: async () => { calls.read += 1; return null; },
      writeShadow: async (_c, _k, container) => { calls.write += 1; calls.containers.push(container); },
    };
    return { deps, calls };
  };

  it('is flag-dark: OFF ⇒ no production, no read, no write', async () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    const { deps, calls } = spyDeps();
    const res = await runContactShadowPersist(inputs(), deps);
    expect(res).toEqual({ companyId: 'co-1', contactId: 'ct-1', executed: false, wrote: false, reason: 'DISABLED', parity: null, version: null, builtAt: null });
    expect(calls.read).toBe(0);
    expect(calls.write).toBe(0);
  });

  it('writes on first production', async () => {
    enable();
    const { deps, calls } = spyDeps();
    const res = await runContactShadowPersist(inputs(), deps);
    expect(res).toMatchObject({ executed: true, wrote: true, reason: 'INITIAL' });
    expect(calls.write).toBe(1);
  });

  it('does NOT write when the identity is unchanged', async () => {
    enable();
    const { record } = produceCanonicalContact(inputs());
    const calls = { write: 0 };
    const deps: ContactShadowPersistDeps = {
      readShadow: async () => ({ canonical_contact: record }),
      writeShadow: async () => { calls.write += 1; },
    };
    const res = await runContactShadowPersist(inputs(), deps);
    expect(res).toMatchObject({ wrote: false, reason: 'IDENTICAL' });
    expect(calls.write).toBe(0);
  });

  it('binds to no store — the module exposes no client or table', async () => {
    const mod = await import('../../services/contactIntelligence/production/contactShadowPersistence');
    const bound = Object.keys(mod).filter((k) => /supabase|client|table|sql|db/i.test(k));
    expect(bound).toEqual([]);
  });
});
