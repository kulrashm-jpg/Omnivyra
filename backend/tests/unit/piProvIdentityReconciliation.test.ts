/**
 * closure-B — identity ordering reconciliation (unit).
 *
 *   - pure alias resolution (tenant-scoped, cycle-safe, terminal);
 *   - the survivor rule (`planIdentityReconciliation`): deterministic and
 *     order-independent; never merges a prospect anchored to another person;
 *   - `reconcileVerifiedSocialIdentity` over an in-memory tenant-keyed world
 *     that emulates the migration's invariants (unique alias, terminal
 *     survivor, no alias of an alias, composite tenant FK) by name;
 *   - the alias store's error mapping;
 *   - the bridge wiring: both orderings converge on ONE prospect, a handle is
 *     never a person before verification, nothing crosses tenants.
 */
import {
  aliasIndexOf,
  terminalSurvivorOf,
  absorbedInto,
  PROSPECT_ALIAS_DB,
  type ProspectAlias,
} from '../../../lib/prospectProvenance/prospectAliases';
import {
  planIdentityReconciliation,
  reconcileVerifiedSocialIdentity,
  reconcileVerifiedPersonIdentities,
  resetIdentityReconciliationReportsForTests,
  IDENTITY_RECONCILIATION_RULE,
  type ProspectAnchor,
  type ReconciliationDeps,
} from '../../services/prospectProvenance/identityReconciliation';
import {
  recordProspectAlias,
  readProspectAliases,
  resetProspectAliasReportsForTests,
  type ProspectAliasQueryPort,
} from '../../services/prospectProvenance/prospectAliasStore';
import { bridgeSourceEvent } from '../../services/prospectProvenance/bridge/bridgeCore';
import type { BridgeSourceEvent } from '../../services/prospectProvenance/bridge/types';
import { makeWorld, ORG_A, ORG_B, type FakeWorld } from './piProvBridge.helpers';

let warn: jest.SpyInstance;
beforeEach(() => {
  resetIdentityReconciliationReportsForTests();
  resetProspectAliasReportsForTests();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

/* ── pure alias resolution ─────────────────────────────────────────────── */

describe('prospect aliases — pure resolution', () => {
  const A = (aliasLeadId: string, survivorLeadId: string, organizationId = ORG_A): ProspectAlias => ({ organizationId, aliasLeadId, survivorLeadId });

  it('resolves an alias to its terminal survivor; a non-alias to itself', () => {
    const ix = aliasIndexOf(ORG_A, [A('p1', 'p2')]);
    expect(terminalSurvivorOf(ix, 'p1')).toBe('p2');
    expect(terminalSurvivorOf(ix, 'p2')).toBe('p2');
    expect(terminalSurvivorOf(ix, 'p3')).toBe('p3');
    expect(absorbedInto(ix, 'p2')).toEqual(['p1']);
  });

  it('never follows another tenant\'s alias row', () => {
    const ix = aliasIndexOf(ORG_A, [A('p1', 'p2', ORG_B)]);
    expect(terminalSurvivorOf(ix, 'p1')).toBe('p1');
    expect(absorbedInto(ix, 'p2')).toEqual([]);
  });

  it('drops self-aliases and contradictory rows, and a cycle resolves to the lead itself', () => {
    expect(aliasIndexOf(ORG_A, [A('p1', 'p1')]).size).toBe(0);
    expect(aliasIndexOf(ORG_A, [A('p1', 'p2'), A('p1', 'p3')]).has('p1')).toBe(false);
    const cyc = aliasIndexOf(ORG_A, [A('p1', 'p2'), A('p2', 'p1')]);
    expect(terminalSurvivorOf(cyc, 'p1')).toBe('p1');
    expect(terminalSurvivorOf(cyc, 'p2')).toBe('p2');
  });

  it('follows a (corrupt) chain to its terminal, bounded', () => {
    const ix = aliasIndexOf(ORG_A, [A('a', 'b'), A('b', 'c')]);
    expect(terminalSurvivorOf(ix, 'a')).toBe('c');
    expect(absorbedInto(ix, 'c')).toEqual(['a', 'b']);
  });
});

/* ── the survivor rule ─────────────────────────────────────────────────── */

describe('planIdentityReconciliation — survivor rule', () => {
  const P = (id: string, personId: string | null, createdAt: string): ProspectAnchor => ({ id, personId, createdAt });
  const X = 'person-x';

  it('community (handle, earlier) + discovery (person, later): survivor is the PERSON-anchored prospect', () => {
    const plan = planIdentityReconciliation({
      personId: X,
      personProspects: [P('disc', X, '2026-10-20T00:00:00Z')],
      handleProspects: [P('comm', null, '2026-10-01T00:00:00Z')],
      aliasIndex: new Map(),
    });
    expect(plan.survivor?.id).toBe('disc');
    expect(plan.absorb.map((p) => p.id)).toEqual(['comm']);
    expect(plan.attachPerson).toBe(false);
  });

  it('is order-independent (inputs reversed ⇒ identical plan)', () => {
    const a = [P('p2', X, '2026-10-02T00:00:00Z'), P('p1', X, '2026-10-01T00:00:00Z')];
    const h = [P('h1', null, '2026-09-01T00:00:00Z')];
    const one = planIdentityReconciliation({ personId: X, personProspects: a, handleProspects: h, aliasIndex: new Map() });
    const two = planIdentityReconciliation({ personId: X, personProspects: [...a].reverse(), handleProspects: h, aliasIndex: new Map() });
    expect(two).toEqual(one);
    expect(one.survivor?.id).toBe('p1'); // both carry X: earliest wins
    expect(one.absorb.map((p) => p.id)).toEqual(['p2', 'h1']);
  });

  it('a handle prospect anchored to ANOTHER person is a conflict — never merged', () => {
    const plan = planIdentityReconciliation({
      personId: X,
      personProspects: [P('disc', X, '2026-10-20T00:00:00Z')],
      handleProspects: [P('other', 'person-y', '2026-10-01T00:00:00Z')],
      aliasIndex: new Map(),
    });
    expect(plan.absorb).toEqual([]);
    expect(plan.conflicts).toEqual(['other']);
  });

  it('a single person-less handle prospect gets the person attached (no alias)', () => {
    const plan = planIdentityReconciliation({ personId: X, personProspects: [], handleProspects: [P('comm', null, '2026-10-01T00:00:00Z')], aliasIndex: new Map() });
    expect(plan).toMatchObject({ survivor: { id: 'comm' }, absorb: [], attachPerson: true });
  });

  it('an already-aliased candidate is resolved, not re-aliased; an existing survivor is never demoted', () => {
    const ix = aliasIndexOf(ORG_A, [{ organizationId: ORG_A, aliasLeadId: 'comm', survivorLeadId: 'disc' }]);
    const plan = planIdentityReconciliation({
      personId: X,
      personProspects: [P('disc', X, '2026-10-20T00:00:00Z'), P('older', X, '2026-01-01T00:00:00Z')],
      handleProspects: [P('comm', null, '2026-10-01T00:00:00Z')],
      aliasIndex: ix,
    });
    expect(plan.alreadyAliased).toEqual(['comm']);
    expect(plan.survivor?.id).toBe('disc'); // has absorbed prospects ⇒ stays the survivor
    expect(plan.absorb.map((p) => p.id)).toEqual(['older']);
  });
});

/* ── reconcileVerifiedSocialIdentity over an invariant-enforcing world ───── */

interface World {
  prospects: Array<{ org: string; id: string; personId: string | null; createdAt: string; handle?: { platform: string; platformUserId: string } }>;
  claims: Array<{ org: string; platform: string; value: string; personId: string; revoked?: boolean }>;
  aliases: Array<ProspectAlias & { reason: string; ruleVersion: string; evidence: Record<string, unknown> }>;
  aliasTable: boolean;
}

function worldDeps(w: World): ReconciliationDeps {
  return {
    verify: async (org, platform, value) => {
      const ids = [...new Set(w.claims.filter((c) => c.org === org && c.platform === platform && c.value === value && !c.revoked).map((c) => c.personId))];
      return ids.length === 1
        ? { status: 'verified', personId: ids[0], reason: 'linked_identity_claim', candidateCount: 1 }
        : { status: 'unverified', personId: null, reason: ids.length > 1 ? 'ambiguous' : 'unresolved', candidateCount: ids.length };
    },
    prospectsForPerson: async (org, personId) => w.prospects.filter((p) => p.org === org && p.personId === personId)
      .map((p) => ({ id: p.id, personId: p.personId, createdAt: p.createdAt })),
    prospectsForHandle: async (org, platform, value) => w.prospects
      .filter((p) => p.org === org && p.handle?.platform === platform && p.handle.platformUserId === value)
      .map((p) => ({ id: p.id, personId: p.personId, createdAt: p.createdAt })),
    readAliases: async (org) => (w.aliasTable
      ? { status: 'ok', aliases: w.aliases.filter((a) => a.organizationId === org), truncated: false }
      : { status: 'table_missing', aliases: [], truncated: false }),
    recordAlias: async (input) => recordProspectAlias(input, { port: aliasPort(w) }),
    attachPerson: async (org, id, personId) => {
      const p = w.prospects.find((x) => x.org === org && x.id === id);
      if (!p || p.personId) return { attached: false, reason: 'not found or anchored' };
      p.personId = personId;
      return { attached: true, reason: 'attached' };
    },
    verifiedHandlesOfPerson: async (org, personId) => w.claims.filter((c) => c.org === org && c.personId === personId && !c.revoked)
      .map((c) => ({ platform: c.platform, platformUserId: c.value })),
  };
}

/** Emulates 20270109000001 by NAME: unique alias, not self, terminal survivor, no alias of an alias, tenant FK. */
function aliasPort(w: World): ProspectAliasQueryPort {
  return {
    async list(org) { return w.aliasTable ? { data: w.aliases.filter((a) => a.organizationId === org).map(toRow), error: null } : { data: null, error: { code: '42P01', message: 'relation does not exist' } }; },
    async findByAlias(org, alias) { return { data: w.aliases.map(toRow).find((r) => r.organization_id === org && r.alias_lead_id === alias) ?? null, error: null }; },
    async insert(row) {
      if (!w.aliasTable) return { data: null, error: { code: '42P01', message: 'relation "prospect_aliases" does not exist' } };
      const org = row.organization_id as string; const a = row.alias_lead_id as string; const s = row.survivor_lead_id as string;
      const lead = (id: string) => w.prospects.find((p) => p.id === id && p.org === org);
      if (!lead(a) || !lead(s)) return { data: null, error: { code: '23503', message: 'violates foreign key constraint "pa_alias_lead_tenant_fk"' } };
      if (a === s) return { data: null, error: { code: '23514', message: `violates check constraint "${PROSPECT_ALIAS_DB.notSelf}"` } };
      if (w.aliases.some((x) => x.organizationId === org && x.aliasLeadId === a)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${PROSPECT_ALIAS_DB.uniqueAlias}"` } };
      if (w.aliases.some((x) => x.organizationId === org && x.aliasLeadId === s)) return { data: null, error: { code: '23514', message: `${PROSPECT_ALIAS_DB.survivorIsTerminal}: the survivor is itself an alias` } };
      if (w.aliases.some((x) => x.organizationId === org && x.survivorLeadId === a)) return { data: null, error: { code: '23514', message: `${PROSPECT_ALIAS_DB.aliasHasNoAliases}: already absorbed others` } };
      w.aliases.push({ organizationId: org, aliasLeadId: a, survivorLeadId: s, reason: row.reason as string, ruleVersion: row.rule_version as string, evidence: row.evidence as Record<string, unknown> });
      return { data: { id: `alias-${w.aliases.length}` }, error: null };
    },
  };
  function toRow(a: ProspectAlias) { return { organization_id: a.organizationId, alias_lead_id: a.aliasLeadId, survivor_lead_id: a.survivorLeadId, reason: a.reason ?? 'verified_identity', created_at: null }; }
}

const HANDLE = { platform: 'reddit', platformUserId: 'ada' };
const newWorld = (): World => ({
  prospects: [
    { org: ORG_A, id: 'comm', personId: null, createdAt: '2026-10-01T00:00:00Z', handle: HANDLE },
    { org: ORG_A, id: 'disc', personId: 'x', createdAt: '2026-10-20T00:00:00Z' },
    // Tenant B: IDENTICAL ids/handle, its own world.
    { org: ORG_B, id: 'comm-b', personId: null, createdAt: '2026-10-01T00:00:00Z', handle: HANDLE },
    { org: ORG_B, id: 'disc-b', personId: 'x-b', createdAt: '2026-10-20T00:00:00Z' },
  ],
  claims: [],
  aliases: [],
  aliasTable: true,
});

describe('reconcileVerifiedSocialIdentity', () => {
  it('an UNVERIFIED handle merges nothing (a handle alone is never identity)', async () => {
    const w = newWorld();
    const r = await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w));
    expect(r).toMatchObject({ status: 'unverified', aliased: [] });
    expect(w.aliases).toEqual([]);
    expect(w.prospects.find((p) => p.id === 'comm')!.personId).toBeNull();
  });

  it('a verified handle aliases the handle prospect onto the person prospect, with audit evidence; replay is a no-op', async () => {
    const w = newWorld();
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x' });
    const r = await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w));
    expect(r).toMatchObject({ status: 'reconciled', survivorId: 'disc', aliased: ['comm'], personAttached: false, personId: 'x' });
    expect(w.aliases).toEqual([expect.objectContaining({
      organizationId: ORG_A, aliasLeadId: 'comm', survivorLeadId: 'disc', reason: 'verified_identity', ruleVersion: IDENTITY_RECONCILIATION_RULE,
      evidence: expect.objectContaining({ platform: 'reddit', verification: 'linked_identity_claim' }),
    })]);
    // Alias rows are append-only: they must never hold erasable personal data.
    expect(w.aliases[0].evidence).not.toHaveProperty('platformUserId');
    expect(w.aliases[0].evidence).not.toHaveProperty('personId');
    expect(JSON.stringify(w.aliases[0].evidence)).not.toContain('ada');
    // The absorbed prospect is NOT given the person (no second anchor).
    expect(w.prospects.find((p) => p.id === 'comm')!.personId).toBeNull();

    const again = await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w));
    expect(again).toMatchObject({ status: 'no_change', aliased: [], alreadyAliased: ['comm'] });
    expect(w.aliases).toHaveLength(1);
  });

  it('never crosses tenants: tenant B with identical ids/handle is untouched', async () => {
    const w = newWorld();
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x' });
    await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w));
    expect(w.aliases.every((a) => a.organizationId === ORG_A)).toBe(true);
    const b = await reconcileVerifiedSocialIdentity(ORG_B, HANDLE, worldDeps(w));
    expect(b.status).toBe('unverified'); // tenant A's claim never verifies tenant B's handle
  });

  it('a revoked or ambiguous claim verifies nothing', async () => {
    const w = newWorld();
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x', revoked: true });
    expect((await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w))).status).toBe('unverified');
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x' }, { org: ORG_A, platform: 'reddit', value: 'ada', personId: 'y' });
    expect((await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w))).status).toBe('unverified');
    expect(w.aliases).toEqual([]);
  });

  it('missing alias table ⇒ unavailable, nothing written, no throw', async () => {
    const w = newWorld(); w.aliasTable = false;
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x' });
    const r = await reconcileVerifiedSocialIdentity(ORG_A, HANDLE, worldDeps(w));
    expect(r.status).toBe('unavailable');
    expect(w.aliases).toEqual([]);
  });

  it('a dependency that throws yields failed, never a throw', async () => {
    const w = newWorld();
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x' });
    const deps = { ...worldDeps(w), prospectsForPerson: async () => { throw new Error('boom'); } };
    await expect(reconcileVerifiedSocialIdentity(ORG_A, HANDLE, deps)).resolves.toMatchObject({ status: 'failed' });
  });

  it('discovery hook: reconciles every verified handle of the person', async () => {
    const w = newWorld();
    w.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'x' });
    const rs = await reconcileVerifiedPersonIdentities(ORG_A, 'x', worldDeps(w));
    expect(rs).toEqual([expect.objectContaining({ status: 'reconciled', survivorId: 'disc', aliased: ['comm'] })]);
    // A person without verified handles: no reconciliation, no write.
    expect(await reconcileVerifiedPersonIdentities(ORG_A, 'nobody', worldDeps(w))).toEqual([]);
  });
});

/* ── alias store: refusal mapping (cycle attempts) ──────────────────────── */

describe('recordProspectAlias — refusals are outcomes, never throws', () => {
  const w = (): World => ({
    prospects: ['a', 'b', 'c'].map((id) => ({ org: ORG_A, id, personId: null, createdAt: '2026-10-01T00:00:00Z' }))
      .concat([{ org: ORG_B, id: 'z', personId: null, createdAt: '2026-10-01T00:00:00Z' }]),
    claims: [], aliases: [], aliasTable: true,
  });
  const input = (aliasLeadId: string, survivorLeadId: string, organizationId = ORG_A) =>
    ({ organizationId, aliasLeadId, survivorLeadId, reason: 'verified_identity' as const, ruleVersion: 'test', evidence: {} });

  it('self-alias, alias of an alias, survivor that is an alias, re-pointing and cross-tenant are all refused', async () => {
    const world = w(); const port = aliasPort(world);
    expect(await recordProspectAlias(input('a', 'a'), { port })).toEqual({ status: 'refused', code: PROSPECT_ALIAS_DB.notSelf });
    expect(await recordProspectAlias(input('a', 'b'), { port })).toEqual({ status: 'inserted' });
    expect(await recordProspectAlias(input('a', 'b'), { port })).toMatchObject({ status: 'duplicate' });
    expect(await recordProspectAlias(input('a', 'c'), { port })).toMatchObject({ status: 'conflict', existingSurvivorLeadId: 'b' });
    // b → a would be a cycle: refused because the survivor a is itself an alias.
    expect(await recordProspectAlias(input('b', 'a'), { port })).toEqual({ status: 'refused', code: PROSPECT_ALIAS_DB.survivorIsTerminal });
    // c → a: survivor is an alias ⇒ refused (must point at terminal b).
    expect(await recordProspectAlias(input('c', 'a'), { port })).toEqual({ status: 'refused', code: PROSPECT_ALIAS_DB.survivorIsTerminal });
    // b → c: b already absorbed a ⇒ refused (no chains).
    expect(await recordProspectAlias(input('b', 'c'), { port })).toEqual({ status: 'refused', code: PROSPECT_ALIAS_DB.aliasHasNoAliases });
    // Cross-tenant survivor: the composite FK refuses.
    expect(await recordProspectAlias(input('c', 'z'), { port })).toEqual({ status: 'refused', code: '23503' });
    expect(world.aliases).toHaveLength(1);
  });

  it('readProspectAliases is tenant-filtered and fail-open on a missing table', async () => {
    const world = w(); const port = aliasPort(world);
    await recordProspectAlias(input('a', 'b'), { port });
    expect((await readProspectAliases(ORG_A, { port })).aliases).toHaveLength(1);
    expect((await readProspectAliases(ORG_B, { port })).aliases).toHaveLength(0);
    world.aliasTable = false;
    expect(await readProspectAliases(ORG_A, { port })).toEqual({ status: 'table_missing', aliases: [], truncated: false });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a foreign row returned by a broken filter is dropped', async () => {
    const port: ProspectAliasQueryPort = {
      list: async () => ({ data: [{ organization_id: ORG_B, alias_lead_id: 'a', survivor_lead_id: 'b' }], error: null }),
      insert: async () => ({ data: null, error: null }),
      findByAlias: async () => ({ data: null, error: null }),
    };
    expect((await readProspectAliases(ORG_A, { port })).aliases).toEqual([]);
  });
});

/* ── bridge wiring: both orderings converge on ONE prospect ─────────────── */

/** Wire the bridge fake world to the reconciliation world (same prospects + claims). */
function wireReconciliation(fw: FakeWorld, aliases: World['aliases']): void {
  const view = (): World => ({
    prospects: fw.prospects.map((p) => {
      const si = (p.metadata?.sourceIdentity ?? null) as { platform: string; platformUserId: string } | null;
      return { org: p.org, id: p.id, personId: p.personId, createdAt: String(p.metadata?.createdAt ?? p.id), handle: si ?? undefined };
    }),
    claims: fw.claims.filter((c) => c.personId).map((c) => ({ org: c.org, platform: c.platform, value: c.value, personId: c.personId as string, revoked: !!c.revokedAt })),
    aliases,
    aliasTable: true,
  });
  fw.deps.reconcileVerifiedIdentity = async (org, platform, platformUserId) => {
    const v = view();
    const deps = worldDeps(v);
    // attachPerson must write through to the bridge world.
    deps.attachPerson = (o, id, personId) => fw.deps.attachPersonToProspect(o, id, personId);
    const r = await reconcileVerifiedSocialIdentity(org, { platform, platformUserId }, deps);
    return { status: r.status, survivorId: r.survivorId };
  };
  fw.deps.resolveSurvivors = async (org, ids) => {
    const ix = aliasIndexOf(org, aliases);
    return new Map(ids.map((id) => [id, terminalSurvivorOf(ix, id)]));
  };
}

function communityEvent(org: string, feedId: string): BridgeSourceEvent {
  return {
    kind: 'community_feed', organizationId: org, sourceCategory: 'community', provider: 'community', sourceRecordKey: feedId,
    prospectSource: 'community', identity: { platform: 'reddit', platformUserId: 'Ada', authorHandle: 'Ada' },
    newProspect: { allowed: true, rule: 'community.discovery.v1', reason: 'discovery_source' },
    platform: 'reddit', sourceUrl: `https://reddit.com/${feedId}`, observedAt: '2026-10-01T08:00:00.000Z', observedAtBasis: 'posted_at',
    ingestionRunId: null, refs: { opportunityFeedItemId: feedId }, evidence: {}, sourceMetadata: {}, rawPayload: { id: feedId },
  };
}

/** What PI discovery leaves behind: a person-anchored prospect keyed by the provider id (no handle). */
function discover(fw: FakeWorld, org: string, personId: string, createdAt: string): string {
  const id = `disc-${org.slice(0, 4)}`;
  fw.prospects.push({ id, org, key: 'apollo:p1', personId, source: 'apollo', metadata: { createdAt } });
  return id;
}

describe('bridge + reconciliation — both orderings end with ONE canonical prospect', () => {
  const run = async (order: 'community_first' | 'discovery_first') => {
    const fw = makeWorld();
    const aliases: World['aliases'] = [];
    wireReconciliation(fw, aliases);
    fw.gateOpen.add(ORG_A);
    let disc = '';
    if (order === 'discovery_first') disc = discover(fw, ORG_A, 'person-x', '2026-10-20T00:00:00Z');
    const first = await bridgeSourceEvent(communityEvent(ORG_A, 'feed-1'), fw.deps);
    expect(first).toMatchObject({ status: 'bridged', identityStatus: 'unverified', personId: null, prospectPath: 'created', reconciliation: 'not_run' });
    // Unverified ⇒ no person on the community prospect, whatever exists elsewhere.
    expect(fw.prospects.find((p) => p.id === first.prospectId)!.personId).toBeNull();
    if (order === 'community_first') disc = discover(fw, ORG_A, 'person-x', '2026-10-20T00:00:00Z');
    expect(fw.prospects.filter((p) => p.org === ORG_A)).toHaveLength(2);

    // Verification: one active, linked claim names person-x.
    fw.claims.push({ org: ORG_A, platform: 'reddit', value: 'ada', personId: 'person-x' });
    // The NEXT post by the same author triggers reconciliation and lands on the survivor.
    const next = await bridgeSourceEvent(communityEvent(ORG_A, 'feed-2'), fw.deps);
    expect(next).toMatchObject({ status: 'bridged', identityStatus: 'verified', reconciliation: 'reconciled', prospectId: disc, prospectPath: 'existing_person', leadCreated: false });
    expect(aliases).toEqual([expect.objectContaining({ organizationId: ORG_A, aliasLeadId: first.prospectId, survivorLeadId: disc })]);

    // A replay of the FIRST post keeps its own (originating) contribution, gets no person, writes nothing new.
    const replay = await bridgeSourceEvent(communityEvent(ORG_A, 'feed-1'), fw.deps);
    expect(replay).toMatchObject({ status: 'bridged', reason: 'already_recorded', prospectId: first.prospectId, aliasOf: disc, personAttached: false, reconciliation: 'no_change' });
    expect(fw.prospects.find((p) => p.id === first.prospectId)!.personId).toBeNull();

    // Contributions are preserved, never moved: feed-1 on the absorbed prospect, feed-2 on the survivor.
    expect(fw.contributions.map((c) => [c.external_ref, c.canonical_lead_id, c.contribution_role]).sort()).toEqual([
      ['community:feed-1', first.prospectId, 'originating'],
      ['community:feed-2', disc, 'contributing'],
    ].sort());
    // One verified person anchors exactly ONE prospect.
    expect(fw.prospects.filter((p) => p.personId === 'person-x').map((p) => p.id)).toEqual([disc]);
    return { fw, aliases };
  };

  it('(a) community → discovery → verification', async () => { await run('community_first'); });
  it('(b) discovery → community → verification', async () => { await run('discovery_first'); });

  it('without reconciliation wiring the bridge behaves exactly as before (older fakes)', async () => {
    const fw = makeWorld();
    fw.gateOpen.add(ORG_A);
    const r = await bridgeSourceEvent(communityEvent(ORG_A, 'feed-1'), fw.deps);
    expect(r).toMatchObject({ status: 'bridged', reconciliation: 'not_run', aliasOf: null });
  });

  it('a second tenant with identical ids/handle is never aliased or merged', async () => {
    const { fw, aliases } = await run('community_first');
    fw.gateOpen.add(ORG_B);
    const b1 = await bridgeSourceEvent(communityEvent(ORG_B, 'feed-1'), fw.deps);
    expect(b1).toMatchObject({ status: 'bridged', identityStatus: 'unverified', prospectPath: 'created' });
    expect(b1.prospectId).not.toBe(fw.prospects.find((p) => p.org === ORG_A && p.key === 'community:feed-1')!.id);
    expect(aliases.every((a) => a.organizationId === ORG_A)).toBe(true);
    expect(aliases).toHaveLength(1);
  });
});
