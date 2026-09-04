/**
 * LI-5E — measuring the external-identity shadow observation window.
 *
 * The property that matters most here is negative: an observation must be
 * counted ONLY when a genuine resolution actually compared the two stores.
 * If historical claims, migration replay or an empty read could increment the
 * counter, then "the stores agree" would be indistinguishable from "nothing
 * ever happened" — which is the exact confusion LI-5C warned against.
 */

type Row = Record<string, unknown>;

const persons: Row[] = [];
const claims: Row[] = [];
const logged: Array<{ event: string; payload: Record<string, unknown> }> = [];
let claimsError: { message?: string } | null = null;
let seq = 0;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const nots: Array<[string, unknown]> = [];
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;

    const source = () => (table === 'identity_claims' ? claims : persons);
    const matches = (r: Row) =>
      filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      ins.every(([k, vs]) => vs.includes(r[k] as never)) &&
      nots.every(([k, v]) => (v === null ? r[k] != null : r[k] !== v)) &&
      contains.every(([k, v]) => {
        const have = (r[k] ?? {}) as Record<string, unknown>;
        return Object.entries(v as Record<string, unknown>)
          .every(([pk, pv]) => JSON.stringify(have[pk]) === JSON.stringify(pv));
      });

    b.select = () => c(); b.order = () => c(); b.limit = () => c();
    b.eq = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.in = (k: string, v: unknown[]) => { ins.push([k, v]); return c(); };
    b.not = (k: string, _o: string, v: unknown) => { nots.push([k, v]); return c(); };
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };
    b.maybeSingle = async () => ({ data: source().filter(matches)[0] ?? null, error: null });
    b.insert = (row: Row) => {
      if (table === 'identity_claims') { claims.push({ id: `c${claims.length + 1}`, revoked_at: null, ...row }); return Promise.resolve({ error: null }); }
      const done = async () => {
        const created: Row = { id: `person-${++seq}`, external_keys: {}, ...row };
        persons.push(created);
        return { data: { id: created.id }, error: null };
      };
      return { select: () => ({ single: done }), single: done };
    };
    b.update = () => {
      const u: Record<string, unknown> = {};
      u.eq = () => u; u.select = async () => ({ data: [], error: null });
      (u as { then?: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
      return u;
    };
    (b as { then?: unknown }).then = (res: (v: unknown) => void) => {
      if (table === 'identity_claims' && claimsError) return res({ error: claimsError });
      return res({ data: source().filter(matches), error: null });
    };
    return b;
  },
}));

jest.mock('../../services/logger', () => ({
  logger: {
    info: (event: string, payload: Record<string, unknown>) => { logged.push({ event, payload }); },
    warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  },
}));

import {
  recordShadowObservation,
  getShadowObservationCounts,
  SHADOW_OBSERVATION_METRIC,
  SHADOW_CATEGORIES,
} from '../../services/prospectIdentity/externalIdentityShadow';
import { registry } from '../../observability/registry';
import { resolveUnifiedPerson } from '../../services/identityResolutionService';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const APOLLO = { apollo: { external_id: 'A-123' } };

const person = (over: Row = {}): Row => ({
  id: 'p1', company_id: ORG_A, primary_email: null, primary_phone: null,
  external_keys: {}, status: 'active', ...over,
});

const claim = (over: Row = {}): Row => ({
  id: 'c1', organization_id: ORG_A, person_id: 'p1', claim_type: 'external_id',
  platform: 'apollo', normalized_value: 'a-123', revoked_at: null, ...over,
});

beforeEach(() => {
  persons.length = 0; claims.length = 0; logged.length = 0;
  claimsError = null; seq = 0;
  registry.reset();
});

describe('LI-5E — the observation model', () => {
  it('reports every category explicitly, including the zeroes', () => {
    const counts = getShadowObservationCounts();
    expect(Object.keys(counts.byCategory).sort()).toEqual([...SHADOW_CATEGORIES].sort());
    for (const c of SHADOW_CATEGORIES) expect(counts.byCategory[c]).toBe(0);
  });

  it('distinguishes an EMPTY window from an agreeing one', () => {
    expect(getShadowObservationCounts()).toMatchObject({ total: 0, empty: true });
    recordShadowObservation('SAME_PERSON');
    expect(getShadowObservationCounts()).toMatchObject({ total: 1, empty: false });
  });

  it('preserves the LI-5B vocabulary rather than inventing a competing one', () => {
    expect([...SHADOW_CATEGORIES]).toEqual([
      'SAME_PERSON', 'BOTH_UNRESOLVED', 'CURRENT_ONLY', 'SHADOW_ONLY',
      'DISAGREEMENT', 'MULTIPLE_SHADOW_MATCHES', 'ERROR',
    ]);
  });

  it('accumulates per category', () => {
    recordShadowObservation('SAME_PERSON');
    recordShadowObservation('SAME_PERSON');
    recordShadowObservation('DISAGREEMENT');
    const c = getShadowObservationCounts();
    expect(c.byCategory.SAME_PERSON).toBe(2);
    expect(c.byCategory.DISAGREEMENT).toBe(1);
    expect(c.total).toBe(3);
  });

  it('uses the existing platform registry, not a parallel store', () => {
    recordShadowObservation('SAME_PERSON');
    const entry = registry.counterEntries().find((e) => e.name === SHADOW_OBSERVATION_METRIC);
    expect(entry).toBeDefined();
    expect(entry!.value).toBe(1);
  });

  it('carries ONLY the category as a label — bounded to seven series forever', () => {
    for (const c of SHADOW_CATEGORIES) recordShadowObservation(c);
    const entries = registry.counterEntries().filter((e) => e.name === SHADOW_OBSERVATION_METRIC);
    expect(entries).toHaveLength(SHADOW_CATEGORIES.length);
    for (const e of entries) expect(Object.keys(e.labels ?? {})).toEqual(['category']);
  });

  it('never throws, so a counter cannot break the path it observes', () => {
    expect(() => recordShadowObservation('ERROR')).not.toThrow();
    expect(() => recordShadowObservation('nonsense' as never)).not.toThrow();
  });
});

describe('LI-5E — observations require a GENUINE resolution', () => {
  it('counts nothing before any resolution has happened', () => {
    expect(getShadowObservationCounts().total).toBe(0);
  });

  it('existing historical claims alone produce NO observation', async () => {
    // 10 unresolved LinkedIn-style claims sitting in the table, untouched.
    for (let i = 0; i < 10; i += 1) {
      claims.push(claim({ id: `w3-${i}`, person_id: null, platform: 'linkedin', normalized_value: `urn-${i}` }));
    }
    expect(getShadowObservationCounts().total).toBe(0);
  });

  it('a resolution with NO external keys produces no observation', async () => {
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test' });
    expect(getShadowObservationCounts().total).toBe(0);
  });

  it('a resolution settled by EMAIL never reaches the external stage, so counts nothing', async () => {
    persons.push(person({ id: 'by-email', primary_email: 'a@x.test' }));
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO });
    expect(getShadowObservationCounts().total).toBe(0);
  });

  it('LEGACY-shaped external keys produce no observation — nothing comparable', async () => {
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: { linkedin_urns: ['urn:li:person:x'] } });
    expect(getShadowObservationCounts().total).toBe(0);
  });

  it('a genuine external-stage resolution produces EXACTLY ONE observation', async () => {
    persons.push(person({ id: 'live', external_keys: APOLLO }));
    claims.push(claim({ person_id: 'live' }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(getShadowObservationCounts().total).toBe(1);
  });
});

describe('LI-5E — the four required categories, end to end', () => {
  it('SAME_PERSON — both stores name the same person', async () => {
    persons.push(person({ id: 'live', external_keys: APOLLO }));
    claims.push(claim({ person_id: 'live' }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(getShadowObservationCounts().byCategory.SAME_PERSON).toBe(1);
  });

  it('CURRENT_ONLY — external_keys resolves, claims do not', async () => {
    persons.push(person({ id: 'live', external_keys: APOLLO }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(getShadowObservationCounts().byCategory.CURRENT_ONLY).toBe(1);
  });

  it('SHADOW_ONLY — claims resolve, external_keys does not', async () => {
    claims.push(claim({ person_id: 'claims-person' }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(getShadowObservationCounts().byCategory.SHADOW_ONLY).toBe(1);
  });

  it('DISAGREEMENT — the two stores name different people', async () => {
    persons.push(person({ id: 'keys-person', external_keys: APOLLO }));
    claims.push(claim({ person_id: 'claims-person' }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(getShadowObservationCounts().byCategory.DISAGREEMENT).toBe(1);
  });

  it('BOTH_UNRESOLVED and ERROR are preserved, not collapsed', async () => {
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(getShadowObservationCounts().byCategory.BOTH_UNRESOLVED).toBe(1);

    registry.reset();
    claimsError = { message: 'claims unreadable' };
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: { apollo: { external_id: 'B-1' } } });
    expect(getShadowObservationCounts().byCategory.ERROR).toBe(1);
  });
});

describe('LI-5E — the read authority is untouched', () => {
  it('a DISAGREEMENT does not change the resolver answer', async () => {
    persons.push(person({ id: 'keys-person', external_keys: APOLLO }));
    claims.push(claim({ person_id: 'claims-person' }));

    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(r.unifiedPersonId).toBe('keys-person');       // external_keys still decides
    expect(r.matchedBy).toBe('external_keys');
    expect(getShadowObservationCounts().byCategory.DISAGREEMENT).toBe(1);
  });

  it('SHADOW_ONLY does not resurrect a person external_keys did not find', async () => {
    claims.push(claim({ person_id: 'claims-person' }));
    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(r.created).toBe(true);
    expect(r.unifiedPersonId).not.toBe('claims-person');
  });

  it('the LI-5D fail-open behaviour still holds — a shadow error does not fail resolution', async () => {
    persons.push(person({ id: 'live', primary_email: 'a@x.test' }));
    claimsError = { message: 'claims unreadable' };
    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(r.unifiedPersonId).toBeTruthy();
    expect(getShadowObservationCounts().byCategory.ERROR).toBe(1);
  });
});

describe('LI-5E — tenant isolation and privacy', () => {
  it('the counter carries NO tenant label — no cross-tenant series in a shared store', async () => {
    persons.push(person({ id: 'a', company_id: ORG_A, external_keys: APOLLO }));
    persons.push(person({ id: 'b', company_id: ORG_B, external_keys: APOLLO }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    await resolveUnifiedPerson({ companyId: ORG_B, externalKeys: APOLLO });

    const entries = registry.counterEntries().filter((e) => e.name === SHADOW_OBSERVATION_METRIC);
    for (const e of entries) {
      expect(Object.keys(e.labels ?? {})).toEqual(['category']);
      expect(JSON.stringify(e.labels)).not.toContain(ORG_A);
      expect(JSON.stringify(e.labels)).not.toContain(ORG_B);
    }
  });

  it("Tenant A's resolution never observes Tenant B's claim", async () => {
    claims.push(claim({ organization_id: ORG_B, person_id: 'b-person' }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    // A saw nothing of B's, so this is BOTH_UNRESOLVED, not SHADOW_ONLY.
    expect(getShadowObservationCounts().byCategory.SHADOW_ONLY).toBe(0);
    expect(getShadowObservationCounts().byCategory.BOTH_UNRESOLVED).toBe(1);
  });

  it('the per-event log stays tenant-scoped and PII-free', async () => {
    persons.push(person({ id: 'live', external_keys: APOLLO }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });

    const ev = logged.find((l) => l.event === 'external_identity_shadow')!;
    expect(ev.payload.companyId).toBe(ORG_A);
    const s = JSON.stringify(ev.payload);
    expect(s).not.toContain('A-123');
    expect(s).not.toContain('a-123');
    expect(s).not.toContain('@');
  });

  it('no raw identifier, email or phone is ever persisted by the counter', () => {
    for (const c of SHADOW_CATEGORIES) recordShadowObservation(c);
    const s = JSON.stringify(registry.counterEntries().filter((e) => e.name === SHADOW_OBSERVATION_METRIC));
    expect(s).not.toContain('@');
    expect(s).not.toContain('A-123');
    expect(s).not.toMatch(/\+\d{8,}/);
  });

  it('no __global__ observation scope exists', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/externalIdentityShadow.ts'), 'utf8');
    expect(src).not.toMatch(/__global__/);
  });
});

describe('LI-5E — determinism and no new identity source', () => {
  it('repeating the same resolution counts each occurrence, not a deduplicated one', async () => {
    persons.push(person({ id: 'live', external_keys: APOLLO }));
    claims.push(claim({ person_id: 'live' }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    // Two genuine resolutions are two observations — a window measures events,
    // not distinct pairs.
    expect(getShadowObservationCounts().byCategory.SAME_PERSON).toBe(2);
  });

  it('reading the window twice returns the same answer', () => {
    recordShadowObservation('SAME_PERSON');
    expect(getShadowObservationCounts()).toEqual(getShadowObservationCounts());
  });

  it('creates no second resolver and no new identity store', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/externalIdentityShadow.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/resolveUnifiedPerson\s*\(/);
    expect(code).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });
});
