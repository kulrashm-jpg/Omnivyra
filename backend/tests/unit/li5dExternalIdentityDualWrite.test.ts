/**
 * LI-5D — external identity dual-write.
 *
 * Two properties matter equally: that the canonical claim is written correctly,
 * and that failing to write it cannot break an identity resolution. The second
 * is what makes this phase shippable before any agreement evidence exists — an
 * additive write that can fail a resolution is not additive.
 */

type Row = Record<string, unknown>;

const persons: Row[] = [];
const claims: Row[] = [];
const claimInserts: Row[] = [];
const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
const logged: Array<{ event: string; payload: Record<string, unknown> }> = [];

/** Injected outcome for the next claim insert; consumed one at a time. */
let claimErrors: Array<{ code?: string; message?: string } | null> = [];
let claimThrows = false;
let seq = 0;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, filters: [] as Array<[string, unknown]> };
    queries.push(rec);
    const ins: Array<[string, unknown[]]> = [];
    const nots: Array<[string, unknown]> = [];
    const contains: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const c = () => b;

    const source = () => (table === 'identity_claims' ? claims : persons);
    const matches = (r: Row) =>
      rec.filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      ins.every(([k, vs]) => vs.includes(r[k] as never)) &&
      nots.every(([k, v]) => (v === null ? r[k] != null : r[k] !== v)) &&
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
    b.in = (k: string, v: unknown[]) => { ins.push([k, v]); return c(); };
    b.not = (k: string, _op: string, v: unknown) => { nots.push([k, v]); return c(); };
    b.contains = (k: string, v: unknown) => { contains.push([k, v]); return c(); };
    b.maybeSingle = async () => ({ data: source().filter(matches)[0] ?? null, error: null });

    b.insert = (row: Row) => {
      if (table === 'identity_claims') {
        if (claimThrows) throw new Error('claims driver exploded');
        claimInserts.push(row);
        const injected = claimErrors.shift();
        if (injected) return Promise.resolve({ error: injected });
        // Emulate uq_identity_claims_tenant_identity (active rows only).
        const clash = claims.some((r) => r.revoked_at == null
          && r.organization_id === row.organization_id && r.claim_type === row.claim_type
          && r.platform === row.platform && r.normalized_value === row.normalized_value);
        if (clash) return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
        claims.push({ id: `claim-${claims.length + 1}`, revoked_at: null, ...row });
        return Promise.resolve({ error: null });
      }
      const done = async () => {
        const created: Row = { id: `person-${++seq}`, external_keys: {}, ...row };
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
    (b as { then?: unknown }).then = (res: (v: unknown) => void) => res({ data: source().filter(matches), error: null });
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
  buildExternalIdentityClaims,
  writeExternalIdentityClaims,
  classifyClaimFailure,
  DUAL_WRITE_SOURCE,
  DUAL_WRITE_CLAIM_TYPE,
} from '../../services/prospectIdentity/externalIdentityDualWrite';
import { resolveUnifiedPerson } from '../../services/identityResolutionService';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const P1 = 'person-1';
const APOLLO = { apollo: { external_id: 'A-123' } };

beforeEach(() => {
  persons.length = 0; claims.length = 0; claimInserts.length = 0;
  queries.length = 0; logged.length = 0; claimErrors = []; claimThrows = false; seq = 0;
});

describe('LI-5D — claim construction', () => {
  it('builds one external_id claim per provider, linked to the resolved person', () => {
    const { claims: built } = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1, externalKeys: APOLLO,
    });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({
      organizationId: ORG_A, personId: P1, claimType: 'external_id',
      platform: 'apollo', normalizedValue: 'a-123', source: DUAL_WRITE_SOURCE,
    });
  });

  it('uses external_id only — no provider-specific claim type is invented', () => {
    expect(DUAL_WRITE_CLAIM_TYPE).toBe('external_id');
    const { claims: built } = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1,
      externalKeys: { apollo: { external_id: 'A-1' }, linkedin: { external_id: 'L-1' }, crm: { external_id: 'C-1' } },
    });
    expect(built.map((c) => c.claimType)).toEqual(['external_id', 'external_id', 'external_id']);
  });

  it('records live provenance, NOT the W3 backfill source', () => {
    const { claims: built } = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1, externalKeys: APOLLO,
    });
    expect(built[0].source).toBe('identity_dual_write');
    expect(built[0].source).not.toBe('w3_backfill');
  });

  it('stores a summary evidence object, never the provider payload', () => {
    const { claims: built } = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1, externalKeys: APOLLO,
    });
    expect(Object.keys(built[0].evidence!).sort()).toEqual(['derivation', 'dualWriteVersion', 'platform']);
  });

  it('reuses the existing normalization for platform and identifier', () => {
    const { claims: built } = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1, externalKeys: { ' Apollo ': { external_id: '  @Jane-Doe ' } },
    });
    expect(built[0]).toMatchObject({ platform: 'apollo', normalizedValue: 'jane-doe' });
    expect(built[0].rawValue).toBe('  @Jane-Doe ');
  });

  it('never builds an unresolved claim — no person, no claim', () => {
    expect(buildExternalIdentityClaims({ organizationId: ORG_A, personId: '', externalKeys: APOLLO }).claims).toEqual([]);
  });

  it('counts a value no rule can normalise instead of dropping it silently', () => {
    const r = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1, externalKeys: { apollo: { external_id: '   ' } },
    });
    expect(r.claims).toEqual([]);
    expect(r.normalizationFailures).toBe(1);
  });

  it('IGNORES the legacy shapes — Q-1 stays uninfluenced', () => {
    for (const legacy of [
      { linkedin_urns: ['urn:li:person:x'] },
      { external_user_keys: ['k1'] },
      { unified_person_id: 'person-1' },
    ]) {
      expect(buildExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: legacy }).claims).toEqual([]);
    }
  });

  it('deduplicates identical pairs', () => {
    const { claims: built } = buildExternalIdentityClaims({
      organizationId: ORG_A, personId: P1,
      externalKeys: { apollo: { external_id: 'A-1' }, Apollo: { external_id: 'a-1' } },
    });
    expect(built).toHaveLength(1);
  });
});

describe('LI-5D — persistence and error classification', () => {
  it('CREATED on a fresh claim', async () => {
    const r = await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    expect(r).toMatchObject({ attempted: 1, created: 1, alreadyExists: 0, failed: 0 });
    expect(r.outcomes).toEqual(['created']);
  });

  it('ALREADY_EXISTS on a duplicate — the benign 23505', async () => {
    await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    const r = await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    expect(r).toMatchObject({ created: 0, alreadyExists: 1, failed: 0 });
    expect(claims).toHaveLength(1);
  });

  it('TENANT_FK_FAILURE on 23503', async () => {
    claimErrors = [{ code: '23503', message: 'violates foreign key constraint' }];
    const r = await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    expect(r.outcomes).toEqual(['tenant_fk_failure']);
    expect(r.failed).toBe(1);
  });

  it('INVALID_CLAIM on 23514 and 23502', async () => {
    expect(classifyClaimFailure('23514')).toBe('invalid_claim');
    expect(classifyClaimFailure('23502')).toBe('invalid_claim');
  });

  it('DATABASE_FAILURE on anything unrecognised', async () => {
    claimErrors = [{ code: '08006', message: 'connection failure' }];
    const r = await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    expect(r.outcomes).toEqual(['database_failure']);
    expect(r.failureCodes).toEqual(['08006']);
  });

  it('NORMALIZATION_FAILURE is reported, never counted as success', async () => {
    const r = await writeExternalIdentityClaims({
      organizationId: ORG_A, personId: P1, externalKeys: { apollo: { external_id: '  ' } },
    });
    expect(r.outcomes).toEqual(['normalization_failure']);
    expect(r.created).toBe(0);
    expect(r.failed).toBe(1);
  });

  it('a thrown driver becomes DATABASE_FAILURE rather than propagating', async () => {
    claimThrows = true;
    const r = await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    expect(r.outcomes).toEqual(['database_failure']);
  });

  it('never uses ON CONFLICT — the partial index would answer 42P10', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['externalIdentityDualWrite.ts', 'canonicalisation.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../../services/prospectIdentity/', f), 'utf8');
      // Strip comments first: both modules DOCUMENT that ON CONFLICT would raise
      // 42P10, and a raw scan reads that warning as a violation of itself.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/onConflict|\.upsert\(/);
    }
  });

  it('reuses the W3 writer rather than creating a second one', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/externalIdentityDualWrite.ts'), 'utf8');
    expect(src).toMatch(/import \{ persistClaims/);
    expect(src).not.toMatch(/ownedDbTable/);       // it owns no query of its own
  });
});

describe('LI-5D — multiple identities and providers', () => {
  it('one person may hold several provider claims', async () => {
    const r = await writeExternalIdentityClaims({
      organizationId: ORG_A, personId: P1,
      externalKeys: { apollo: { external_id: 'A-1' }, linkedin: { external_id: 'L-1' }, crm: { external_id: 'C-1' } },
    });
    expect(r.created).toBe(3);
    expect(claims.filter((c) => c.person_id === P1)).toHaveLength(3);
  });

  it('the same identifier on two platforms is two distinct claims', async () => {
    const r = await writeExternalIdentityClaims({
      organizationId: ORG_A, personId: P1,
      externalKeys: { apollo: { external_id: 'SHARED' }, linkedin: { external_id: 'SHARED' } },
    });
    expect(r.created).toBe(2);
  });

  it('the same platform + identifier in two tenants is two claims', async () => {
    await writeExternalIdentityClaims({ organizationId: ORG_A, personId: P1, externalKeys: APOLLO });
    const r = await writeExternalIdentityClaims({ organizationId: ORG_B, personId: 'person-b', externalKeys: APOLLO });
    expect(r.created).toBe(1);
    expect(claims).toHaveLength(2);
    expect(claims.map((c) => c.organization_id).sort()).toEqual([ORG_A, ORG_B].sort());
  });
});

describe('LI-5D — the dual-write cannot break a resolution', () => {
  it('resolution still succeeds when the claim write fails', async () => {
    persons.push({ id: 'live', company_id: ORG_A, primary_email: 'a@x.test', external_keys: {} });
    claimErrors = [{ code: '08006', message: 'connection failure' }];

    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO });
    expect(r.unifiedPersonId).toBe('live');
    expect(r.matchedBy).toBe('email');
  });

  it('resolution still succeeds when the claim driver throws', async () => {
    persons.push({ id: 'live', company_id: ORG_A, primary_email: 'a@x.test', external_keys: {} });
    claimThrows = true;
    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO });
    expect(r.unifiedPersonId).toBe('live');
  });

  it('a newly created person also gets its claim', async () => {
    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'new@x.test', externalKeys: APOLLO });
    expect(r.created).toBe(true);
    expect(claims).toHaveLength(1);
    expect(claims[0].person_id).toBe(r.unifiedPersonId);
  });

  it('a matched person also gets its claim', async () => {
    persons.push({ id: 'live', company_id: ORG_A, primary_email: 'a@x.test', external_keys: {} });
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO });
    expect(claims).toHaveLength(1);
    expect(claims[0].person_id).toBe('live');
  });

  it('no external keys means no claim and no write attempt', async () => {
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'new@x.test' });
    expect(claimInserts).toHaveLength(0);
    expect(logged.filter((l) => l.event === 'external_identity_dual_write')).toHaveLength(0);
  });

  it('legacy-only external keys produce no claim', async () => {
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'new@x.test', externalKeys: { linkedin_urns: ['u'] } });
    expect(claimInserts).toHaveLength(0);
  });
});

describe('LI-5D — the read path is unchanged', () => {
  it('external_keys still decides — a claim does not resolve anyone', async () => {
    // A claim points at one person; external_keys at another. The live answer
    // must still come from external_keys.
    claims.push({
      id: 'c1', organization_id: ORG_A, person_id: 'claims-person', claim_type: 'external_id',
      platform: 'apollo', normalized_value: 'a-123', revoked_at: null,
    });
    persons.push({ id: 'keys-person', company_id: ORG_A, external_keys: APOLLO });

    const r = await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(r.unifiedPersonId).toBe('keys-person');
    expect(r.matchedBy).toBe('external_keys');
  });

  it('the shadow comparison still runs alongside', async () => {
    persons.push({ id: 'keys-person', company_id: ORG_A, external_keys: APOLLO });
    await resolveUnifiedPerson({ companyId: ORG_A, externalKeys: APOLLO });
    expect(logged.filter((l) => l.event === 'external_identity_shadow')).toHaveLength(1);
  });

  it('external_keys is still written on create, unchanged', async () => {
    const r = await resolveUnifiedPerson({ companyId: ORG_A, email: 'new@x.test', externalKeys: APOLLO });
    const created = persons.find((p) => p.id === r.unifiedPersonId)!;
    expect(created.external_keys).toEqual(APOLLO);
  });
});

describe('LI-5D — observability carries no PII', () => {
  it('logs counts, outcomes and SQLSTATEs only', async () => {
    persons.push({ id: 'live', company_id: ORG_A, primary_email: 'a@x.test', external_keys: {} });
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO });

    const ev = logged.find((l) => l.event === 'external_identity_dual_write')!;
    expect(Object.keys(ev.payload).sort()).toEqual([
      'alreadyExists', 'attempted', 'companyId', 'created', 'failed', 'failureCodes', 'outcomes', 'unifiedPersonId',
    ]);
    const s = JSON.stringify(ev.payload);
    expect(s).not.toContain('A-123');
    expect(s).not.toContain('a-123');
    expect(s).not.toContain('@');
  });

  it('a failure is visible rather than silent', async () => {
    persons.push({ id: 'live', company_id: ORG_A, primary_email: 'a@x.test', external_keys: {} });
    claimErrors = [{ code: '23503', message: 'fk' }];
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'a@x.test', externalKeys: APOLLO });

    const ev = logged.find((l) => l.event === 'external_identity_dual_write')!;
    expect(ev.payload.outcomes).toEqual(['tenant_fk_failure']);
    expect(ev.payload.failureCodes).toEqual(['23503']);
  });

  it('reuses the existing logger, not a parallel system', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/identityResolutionService.ts'), 'utf8');
    expect(src).toMatch(/logger\.info\('external_identity_dual_write'/);
    expect(src).not.toMatch(/console\.(log|info|warn)\(/);
  });
});

describe('LI-5D — W3 backfill behaviour is preserved', () => {
  it('a claim without an explicit source still records w3_backfill', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/prospectIdentity/canonicalisation.ts'), 'utf8');
    expect(src).toMatch(/source: d\.source \?\? CANONICALISATION_SOURCE/);
    expect(src).toMatch(/evidence: d\.evidence \?\?/);
  });

  it('the unresolved W3 LinkedIn claims are never touched', async () => {
    claims.push({
      id: 'w3-1', organization_id: ORG_A, person_id: null, claim_type: 'external_id',
      platform: 'linkedin', normalized_value: 'urn-1', revoked_at: null, source: 'w3_backfill',
    });
    await resolveUnifiedPerson({ companyId: ORG_A, email: 'new@x.test', externalKeys: APOLLO });

    const w3 = claims.find((c) => c.id === 'w3-1')!;
    expect(w3.person_id).toBeNull();          // still unresolved
    expect(w3.source).toBe('w3_backfill');    // still W3's
  });
});
