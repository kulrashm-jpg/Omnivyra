/**
 * LI-5B Phase 1 — the claims-based external-identity lookup, in shadow.
 *
 * Two things are under test and both matter equally: that the shadow computes
 * the right answer, and that it cannot change the live one. The second is the
 * reason this phase exists — a shadow that can alter a decision is not a shadow.
 */

type Row = Record<string, unknown>;

const persons: Row[] = [];
const claims: Row[] = [];
const queries: Array<{ table: string; filters: Array<[string, unknown]>; ins: Array<[string, unknown[]]> }> = [];
let claimsError: { message?: string } | null = null;
let claimsThrows = false;
let seq = 0;
const logged: Array<{ event: string; payload: Record<string, unknown> }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, filters: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown[]]> };
    queries.push(rec);
    const nots: Array<[string, string, unknown]> = [];
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;

    const source = () => (table === 'identity_claims' ? claims : persons);
    const matches = (r: Row) =>
      rec.filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      rec.ins.every(([k, vs]) => vs.includes(r[k] as never)) &&
      nots.every(([k, , v]) => (v === null ? r[k] != null : r[k] !== v)) &&
      contains.every(([k, v]) => {
        const have = (r[k] ?? {}) as Record<string, unknown>;
        return Object.entries(v as Record<string, unknown>)
          .every(([pk, pv]) => JSON.stringify(have[pk]) === JSON.stringify(pv));
      });

    b.select = () => c();
    b.order = () => c();
    b.limit = () => c();
    b.eq = (k: string, v: unknown) => { rec.filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { rec.filters.push([k, v]); return c(); };
    b.in = (k: string, v: unknown[]) => { rec.ins.push([k, v]); return c(); };
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };
    b.not = (k: string, op: string, v: unknown) => { nots.push([k, op, v]); return c(); };
    b.maybeSingle = async () => ({ data: source().filter(matches)[0] ?? null, error: null });
    b.insert = (row: Row) => {
      const done = async () => {
        const created = { id: `person-${++seq}`, external_keys: {}, ...row };
        persons.push(created);
        return { data: { id: created.id }, error: null };
      };
      return { select: () => ({ single: done }), single: done };
    };
    b.update = () => {
      const u: Record<string, unknown> = {};
      u.eq = () => u;
      u.select = async () => ({ data: [], error: null });
      (u as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: [], error: null });
      return u;
    };
    (b as { then?: unknown }).then = (res: (v: unknown) => void) => {
      if (table === 'identity_claims') {
        if (claimsThrows) throw new Error('claims store exploded');
        if (claimsError) return res({ error: claimsError });
      }
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
  extractExternalIdentityPairs,
  lookupExternalIdentityClaims,
  classifyShadow,
  compareExternalIdentityShadow,
  SHADOW_CATEGORIES,
  EXTERNAL_CLAIM_TYPES,
} from '../../services/prospectIdentity/externalIdentityShadow';
import { resolveUnifiedPerson } from '../../services/identityResolutionService';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const claim = (over: Row = {}): Row => ({
  id: `claim-${claims.length + 1}`, organization_id: ORG_A, person_id: 'person-1',
  claim_type: 'external_id', platform: 'apollo', normalized_value: 'a-123',
  revoked_at: null, ...over,
});

const person = (over: Row = {}): Row => ({
  id: 'person-1', company_id: ORG_A, primary_email: null, primary_phone: null,
  external_keys: {}, status: 'active', ...over,
});

const APOLLO_KEYS = { apollo: { external_id: 'A-123' } };

beforeEach(() => {
  persons.length = 0;
  claims.length = 0;
  queries.length = 0;
  logged.length = 0;
  claimsError = null;
  claimsThrows = false;
  seq = 0;
});

describe('LI-5B — pair extraction reuses the existing contract', () => {
  it('extracts (platform, normalized value) from the code-written shape', () => {
    expect(extractExternalIdentityPairs(APOLLO_KEYS))
      .toEqual([{ platform: 'apollo', normalizedValue: 'a-123' }]);
  });

  it('normalises platform and identifier with the existing rules', () => {
    expect(extractExternalIdentityPairs({ ' Apollo ': { external_id: '  @Jane-Doe  ' } }))
      .toEqual([{ platform: 'apollo', normalizedValue: 'jane-doe' }]);
  });

  it('extracts several providers for one person', () => {
    const pairs = extractExternalIdentityPairs({
      apollo: { external_id: 'A-1' }, linkedin: { external_id: 'L-1' }, crm: { external_id: 'C-1' },
    });
    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => p.platform).sort()).toEqual(['apollo', 'crm', 'linkedin']);
  });

  it('deduplicates identical pairs', () => {
    expect(extractExternalIdentityPairs({ apollo: { external_id: 'A-1' }, Apollo: { external_id: 'a-1' } }))
      .toHaveLength(1);
  });

  it('IGNORES the legacy shapes entirely — Q-1 stays uninfluenced', () => {
    expect(extractExternalIdentityPairs({ linkedin_urns: ['urn:li:person:x'] })).toEqual([]);
    expect(extractExternalIdentityPairs({ external_user_keys: ['k1', 'k2'] })).toEqual([]);
    expect(extractExternalIdentityPairs({ unified_person_id: 'person-1' })).toEqual([]);
    expect(extractExternalIdentityPairs({
      unified_person_id: 'p', external_user_keys: ['k'], linkedin_urns: ['u'],
    })).toEqual([]);
  });

  it('ignores a provider entry with no external_id, and non-object input', () => {
    expect(extractExternalIdentityPairs({ apollo: { profile_url: 'x' } })).toEqual([]);
    expect(extractExternalIdentityPairs({ apollo: 'A-1' })).toEqual([]);
    expect(extractExternalIdentityPairs(null)).toEqual([]);
    expect(extractExternalIdentityPairs([] as never)).toEqual([]);
  });
});

describe('LI-5B — the claims lookup', () => {
  it('finds the person a claim points at', async () => {
    claims.push(claim());
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r).toMatchObject({ ok: true, personIds: ['person-1'], pairsProbed: 1 });
    expect(r.matchedClaimTypes).toEqual(['external_id']);
  });

  it('observes BOTH external claim types, because Q-3 is unresolved', async () => {
    claims.push(claim({ claim_type: 'external_profile' }));
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r.personIds).toEqual(['person-1']);
    const q = queries.find((x) => x.table === 'identity_claims')!;
    expect(new Map(q.ins).get('claim_type')).toEqual([...EXTERNAL_CLAIM_TYPES]);
  });

  it('never promotes an UNRESOLVED claim — person_id IS NOT NULL is required', async () => {
    claims.push(claim({ person_id: null, platform: 'linkedin', normalized_value: 'l-1' }));
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'linkedin', normalizedValue: 'l-1' }]);
    expect(r.personIds).toEqual([]);
  });

  it('ignores a revoked claim', async () => {
    claims.push(claim({ revoked_at: '2026-01-01T00:00:00.000Z' }));
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r.personIds).toEqual([]);
  });

  it('does NOT cross-match platform against another platform\'s value', async () => {
    claims.push(claim({ platform: 'linkedin', normalized_value: 'a-123' }));
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r.personIds).toEqual([]);      // same value, wrong platform
  });

  it('issues ONE query no matter how many providers are supplied', async () => {
    claims.push(claim(), claim({ platform: 'linkedin', normalized_value: 'l-1', person_id: 'person-1' }));
    await lookupExternalIdentityClaims(ORG_A, [
      { platform: 'apollo', normalizedValue: 'a-123' },
      { platform: 'linkedin', normalizedValue: 'l-1' },
      { platform: 'crm', normalizedValue: 'c-1' },
    ]);
    expect(queries.filter((q) => q.table === 'identity_claims')).toHaveLength(1);
  });

  it('does not query at all when there is nothing to probe', async () => {
    const r = await lookupExternalIdentityClaims(ORG_A, []);
    expect(r).toEqual({ ok: true, personIds: [], matchedClaimTypes: [], pairsProbed: 0 });
    expect(queries.filter((q) => q.table === 'identity_claims')).toHaveLength(0);
  });

  it('reports a read failure rather than an empty result', async () => {
    claimsError = { message: 'connection reset' };
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/connection reset/);
  });
});

describe('LI-5B — tenant isolation', () => {
  it('the tenant is the FIRST predicate on the claims query', async () => {
    await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    const q = queries.find((x) => x.table === 'identity_claims')!;
    expect(q.filters[0]).toEqual(['organization_id', ORG_A]);
  });

  it('Tenant A never observes Tenant B\'s claim', async () => {
    claims.push(claim({ organization_id: ORG_B, person_id: 'person-b' }));
    const r = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r.personIds).toEqual([]);
  });

  it('the same provider + external id in two tenants gives two different identities', async () => {
    claims.push(claim({ organization_id: ORG_A, person_id: 'person-a' }));
    claims.push(claim({ organization_id: ORG_B, person_id: 'person-b' }));

    const a = await lookupExternalIdentityClaims(ORG_A, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    const b = await lookupExternalIdentityClaims(ORG_B, [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(a.personIds).toEqual(['person-a']);
    expect(b.personIds).toEqual(['person-b']);
  });

  it('refuses a tenant-less lookup', async () => {
    const r = await lookupExternalIdentityClaims('', [{ platform: 'apollo', normalizedValue: 'a-123' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/organizationId is required/);
  });
});

describe('LI-5B — comparison categories', () => {
  const ok = (personIds: string[]) => ({ ok: true, personIds, matchedClaimTypes: [], pairsProbed: 1 });

  it('covers exactly the seven required categories', () => {
    expect([...SHADOW_CATEGORIES]).toEqual([
      'SAME_PERSON', 'BOTH_UNRESOLVED', 'CURRENT_ONLY', 'SHADOW_ONLY',
      'DISAGREEMENT', 'MULTIPLE_SHADOW_MATCHES', 'ERROR',
    ]);
  });

  it('SAME_PERSON', () => expect(classifyShadow('p1', ok(['p1']))).toBe('SAME_PERSON'));
  it('BOTH_UNRESOLVED', () => expect(classifyShadow(null, ok([]))).toBe('BOTH_UNRESOLVED'));
  it('CURRENT_ONLY', () => expect(classifyShadow('p1', ok([]))).toBe('CURRENT_ONLY'));
  it('SHADOW_ONLY', () => expect(classifyShadow(null, ok(['p2']))).toBe('SHADOW_ONLY'));
  it('DISAGREEMENT', () => expect(classifyShadow('p1', ok(['p2']))).toBe('DISAGREEMENT'));
  it('MULTIPLE_SHADOW_MATCHES', () => expect(classifyShadow('p1', ok(['p1', 'p2']))).toBe('MULTIPLE_SHADOW_MATCHES'));
  it('ERROR', () => expect(classifyShadow('p1', { ok: false, personIds: [], matchedClaimTypes: [], pairsProbed: 1 })).toBe('ERROR'));

  it('multiple matches are reported even when the live person is among them', () => {
    // Collapsing this to SAME_PERSON would hide a real finding.
    expect(classifyShadow('p1', ok(['p1', 'p2']))).toBe('MULTIPLE_SHADOW_MATCHES');
  });

  it('a thrown lookup becomes ERROR, never a false agreement', async () => {
    claimsThrows = true;
    const r = await compareExternalIdentityShadow({
      organizationId: ORG_A, externalKeys: APOLLO_KEYS, currentPersonId: 'p1',
    });
    expect(r.category).toBe('ERROR');
    expect(r.error).toMatch(/claims store exploded/);
  });
});

describe('LI-5B — the shadow cannot change the live decision', () => {
  it('a DISAGREEMENT leaves the live result untouched', async () => {
    persons.push(person({ id: 'live-person', external_keys: APOLLO_KEYS }));
    claims.push(claim({ person_id: 'claims-person' }));

    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO_KEYS });
    expect(r.unifiedPersonId).toBe('live-person');       // external_keys still decides
    expect(r.matchedBy).toBe('external_keys');

    const ev = logged.find((l) => l.event === 'external_identity_shadow')!;
    expect(ev.payload.category).toBe('DISAGREEMENT');
  });

  it('SHADOW_ONLY does not resurrect a person the live path did not find', async () => {
    claims.push(claim({ person_id: 'claims-person' }));
    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO_KEYS });
    expect(r.created).toBe(true);                        // live path created, as before
    expect(r.unifiedPersonId).not.toBe('claims-person');
    expect(logged.find((l) => l.event === 'external_identity_shadow')!.payload.category).toBe('SHADOW_ONLY');
  });

  it('a shadow FAILURE does not break resolution', async () => {
    persons.push(person({ id: 'live-person', external_keys: APOLLO_KEYS }));
    claimsThrows = true;

    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO_KEYS });
    expect(r.unifiedPersonId).toBe('live-person');
    expect(r.matchedBy).toBe('external_keys');
  });

  it('the shadow writes nothing — no claim, no person, no update', async () => {
    claims.push(claim({ person_id: 'claims-person' }));
    persons.push(person({ id: 'live-person', external_keys: APOLLO_KEYS }));
    const before = { persons: persons.length, claims: claims.length };

    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO_KEYS });
    expect(persons).toHaveLength(before.persons);
    expect(claims).toHaveLength(before.claims);
  });

  it('the module imports no write helper', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/externalIdentityShadow.ts'), 'utf8');
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });
});

describe('LI-5B — the existing resolution order is unchanged', () => {
  it('email still wins, and no shadow runs', async () => {
    persons.push(person({ id: 'by-email', primary_email: 'a@x.test' }));
    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO_KEYS });
    expect(r.matchedBy).toBe('email');
    // The external stage never ran, so there is nothing to compare.
    expect(logged.filter((l) => l.event === 'external_identity_shadow')).toHaveLength(0);
  });

  it('phone still wins over external keys, and no shadow runs', async () => {
    persons.push(person({ id: 'by-phone', primary_phone: '+15550100000' }));
    const r = await resolveUnifiedPerson({ companyId: ORG_A, phone: '+15550100000', externalKeys: APOLLO_KEYS });
    expect(r.matchedBy).toBe('phone');
    expect(logged.filter((l) => l.event === 'external_identity_shadow')).toHaveLength(0);
  });

  it('the shadow runs when the external stage actually executes', async () => {
    persons.push(person({ id: 'live-person', external_keys: APOLLO_KEYS }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO_KEYS });
    expect(logged.filter((l) => l.event === 'external_identity_shadow')).toHaveLength(1);
  });

  it('no external keys means no shadow and no extra query', async () => {
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'new@x.test' });
    expect(logged.filter((l) => l.event === 'external_identity_shadow')).toHaveLength(0);
    expect(queries.filter((q) => q.table === 'identity_claims')).toHaveLength(0);
  });

  it('LEGACY-ONLY keys produce no shadow comparison', async () => {
    persons.push(person({ id: 'legacy', external_keys: { linkedin_urns: ['u'] } }));
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: { linkedin_urns: ['u'] } });
    // Nothing extractable → no probe, no comparison, no interpretation.
    expect(logged.filter((l) => l.event === 'external_identity_shadow')).toHaveLength(0);
  });
});

describe('LI-5B — observability carries no PII', () => {
  it('logs identifiers and counts only', async () => {
    persons.push(person({ id: 'live-person', external_keys: APOLLO_KEYS }));
    claims.push(claim({ person_id: 'live-person' }));

    await resolveUnifiedPerson({
      companyId: ORG_A, email: null, phone: null, externalKeys: { apollo: { external_id: 'A-123' } },
    });

    const ev = logged.find((l) => l.event === 'external_identity_shadow')!;
    expect(Object.keys(ev.payload).sort()).toEqual([
      'category', 'companyId', 'currentPersonId', 'hasError', 'matchedClaimTypes', 'pairsProbed', 'shadowMatchCount',
    ]);
    const serialized = JSON.stringify(ev.payload);
    expect(serialized).not.toContain('A-123');
    expect(serialized).not.toContain('a-123');
    expect(serialized).not.toContain('@');
  });

  it('reuses the resolver\'s existing logger rather than a parallel system', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/identityResolutionService.ts'), 'utf8');
    expect(src).toMatch(/logger\.info\('external_identity_shadow'/);
    expect(src).not.toMatch(/console\.(log|info|warn)\(/);
  });
});
