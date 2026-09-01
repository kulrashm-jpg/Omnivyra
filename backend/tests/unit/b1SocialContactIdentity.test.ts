/**
 * B1 — social contact identity edge.
 *
 * Two properties matter equally: that the canonical edge is drawn ONLY when the
 * evidence is unambiguous, and that failing to draw it can never break social
 * signal ingestion. The second is what makes this shippable on a live path — an
 * additive identity write that can drop a signal is not additive.
 *
 * The negative assertions carry most of the weight here. That no
 * `unified_persons` row is created, that no name is ever used as a key, and that
 * `external_profile` is never written are the invariants that make an unresolved
 * social handle safe to record.
 */

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  identity_claims: [],
  unified_persons: [],
  contacts: [],
  person_duplicate_candidates: [],
};

/** Every filter every query applied, so "never keys on a name" is provable. */
const queries: Array<{ table: string; op: 'select' | 'update' | 'insert'; filters: Array<[string, unknown]> }> = [];
const claimInserts: Row[] = [];
const duplicateInserts: Row[] = [];
const personInserts: Row[] = [];

/** Injected outcomes, consumed one at a time. */
let claimErrors: Array<{ code?: string; message?: string } | null> = [];
let duplicateErrors: Array<{ code?: string; message?: string } | null> = [];
let contactUpdateErrors: Array<{ code?: string; message?: string } | null> = [];
let driverThrows = false;

const logged: Array<{ event: string; payload: Row }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (driverThrows) throw new Error('db driver exploded');

    const filters: Array<[string, unknown]> = [];
    const nots: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    let mode: 'select' | 'update' | 'insert' = 'select';

    const rows = (): Row[] => (tables[table] ??= []);
    const matches = (r: Row) =>
      filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) &&
      nots.every(([k, v]) => (v === null ? r[k] != null : r[k] !== v));

    const settle = () => {
      queries.push({ table, op: mode, filters: [...filters, ...nots] });
      if (mode === 'update') {
        const err = contactUpdateErrors.shift();
        if (err) return { data: null, error: err };
        const hit = rows().filter(matches);
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows().filter(matches), error: null };
    };

    const b: Record<string, unknown> = {};
    const c = () => b;

    b.select = () => c();
    b.limit = () => c();
    b.order = () => c();
    b.eq = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.is = (k: string, v: unknown) => { filters.push([k, v]); return c(); };
    b.not = (k: string, _op: string, v: unknown) => { nots.push([k, v]); return c(); };
    b.update = (p: Row) => { mode = 'update'; patch = p; return c(); };

    b.insert = (row: Row) => {
      mode = 'insert';
      queries.push({ table, op: 'insert', filters: [] });

      if (table === 'identity_claims') {
        claimInserts.push(row);
        const injected = claimErrors.shift();
        if (injected) return Promise.resolve({ error: injected });
        // Emulate uq_identity_claims_tenant_identity — active rows only,
        // NULLS NOT DISTINCT, and person_id is NOT part of the key.
        const clash = rows().some((r) => r.revoked_at == null
          && r.organization_id === row.organization_id && r.claim_type === row.claim_type
          && r.platform === row.platform && r.normalized_value === row.normalized_value);
        if (clash) return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
        rows().push({ id: `claim-${rows().length + 1}`, revoked_at: null, ...row });
        return Promise.resolve({ error: null });
      }

      if (table === 'person_duplicate_candidates') {
        duplicateInserts.push(row);
        const injected = duplicateErrors.shift();
        const done = async () => (injected
          ? { data: null, error: injected }
          : (() => {
            rows().push({ id: `dup-${rows().length + 1}`, ...row });
            return { data: { id: `dup-${rows().length}` }, error: null };
          })());
        return { select: () => ({ single: done }), single: done };
      }

      if (table === 'unified_persons') personInserts.push(row);
      const done = async () => ({ data: { id: 'person-created' }, error: null });
      return { select: () => ({ single: done }), single: done };
    };

    (b as { then?: unknown }).then = (res: (v: unknown) => void) => res(settle());
    return b;
  },
}));

jest.mock('../../services/logger', () => ({
  logger: {
    debug: (event: string, payload: Row) => { logged.push({ event, payload }); },
    info: (event: string, payload: Row) => { logged.push({ event, payload }); },
    warn: (event: string, payload: Row) => { logged.push({ event, payload }); },
    error: (event: string, payload: Row) => { logged.push({ event, payload }); },
  },
}));

import {
  resolveSocialContactIdentity,
  buildSocialContactClaim,
  classifySocialClaimFailure,
  SOCIAL_CONTACT_SOURCE,
  SOCIAL_CONTACT_CLAIM_TYPE,
} from '../../services/prospectIdentity/socialContactResolution';
import { CANONICALISATION_SOURCE } from '../../services/prospectIdentity/canonicalisation';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

/** A contact exactly as canonicalLeadSignalService creates one: no identity. */
function seedContact(org: string, id: string, platformUserId: string, name: string | null = null): void {
  tables.contacts.push({
    id,
    organization_id: org,
    platform: 'linkedin',
    platform_user_id: platformUserId,
    contact_key: `linkedin:${platformUserId}`,
    display_name: name,
    profile_url: null,
    unified_person_id: null,
  });
}

function seedPerson(org: string, id: string, extra: Row = {}): void {
  tables.unified_persons.push({
    id, company_id: org, status: 'active',
    primary_email: null, primary_phone: null, external_keys: {}, ...extra,
  });
}

/** A LINKED claim — the only kind the shadow resolver will resolve on. */
function seedLinkedClaim(org: string, personId: string, value: string, platform = 'linkedin'): void {
  tables.identity_claims.push({
    id: `seed-${tables.identity_claims.length + 1}`,
    organization_id: org, person_id: personId, claim_type: 'external_id',
    platform, normalized_value: value, revoked_at: null, source: 'seed',
  });
}

const contact = (id: string): Row | undefined => tables.contacts.find((r) => r.id === id);

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = [];
  queries.length = 0;
  claimInserts.length = 0;
  duplicateInserts.length = 0;
  personInserts.length = 0;
  logged.length = 0;
  claimErrors = [];
  duplicateErrors = [];
  contactUpdateErrors = [];
  driverThrows = false;
});

describe('B1 — a single deterministic match links, and nothing else does', () => {
  it('links the contact when exactly one person holds the platform identity', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'LinkedIn', platformUserId: 'ABC123',
    });

    expect(res.outcome).toBe('linked');
    expect(res.personId).toBe('p1');
    expect(contact('c1')?.unified_person_id).toBe('p1');
    expect(res.claim).toBe('created');
    expect(claimInserts[0].person_id).toBe('p1');
  });

  it('normalises before matching — the raw handle is kept as raw_value', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'ABC123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'LinkedIn', platformUserId: '  @ABC123 ',
    });

    expect(claimInserts[0].normalized_value).toBe('abc123');
    expect(claimInserts[0].raw_value).toBe('@ABC123');
    expect(claimInserts[0].platform).toBe('linkedin');
  });

  it('an unlinked claim (person_id NULL) resolves nothing — the 10 W3 rows stay inert', async () => {
    tables.identity_claims.push({
      id: 'w3-1', organization_id: ORG_A, person_id: null, claim_type: 'external_id',
      platform: 'linkedin', normalized_value: 'abc123', revoked_at: null, source: CANONICALISATION_SOURCE,
    });
    seedContact(ORG_A, 'c1', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('unresolved');
    expect(contact('c1')?.unified_person_id).toBeNull();
    // The pre-existing W3 row is untouched: same row, same source, same person_id.
    const w3 = tables.identity_claims.find((r) => r.id === 'w3-1');
    expect(w3?.person_id).toBeNull();
    expect(w3?.source).toBe(CANONICALISATION_SOURCE);
  });

  it('a revoked claim never resurrects a link', async () => {
    seedPerson(ORG_A, 'p1');
    tables.identity_claims.push({
      id: 'r1', organization_id: ORG_A, person_id: 'p1', claim_type: 'external_id',
      platform: 'linkedin', normalized_value: 'abc123', revoked_at: '2026-01-01T00:00:00Z', source: 'seed',
    });
    seedContact(ORG_A, 'c1', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('unresolved');
    expect(contact('c1')?.unified_person_id).toBeNull();
  });
});

describe('B1 — no match means no person is invented', () => {
  it('records an unresolved verdict, links nothing, and creates NO unified_persons row', async () => {
    seedContact(ORG_A, 'c1', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('unresolved');
    expect(res.personId).toBeNull();
    expect(contact('c1')?.unified_person_id).toBeNull();
    expect(personInserts).toHaveLength(0);
    expect(tables.unified_persons).toHaveLength(0);
    expect(queries.some((q) => q.table === 'unified_persons' && q.op === 'insert')).toBe(false);
  });

  it('still writes exactly ONE claim, with person_id NULL', async () => {
    seedContact(ORG_A, 'c1', 'abc123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(claimInserts).toHaveLength(1);
    expect(claimInserts[0].person_id).toBeNull();
    expect(claimInserts[0].claim_type).toBe('external_id');
  });

  it('the unresolved verdict is durably persisted as claim evidence', async () => {
    seedContact(ORG_A, 'c1', 'abc123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    const evidence = claimInserts[0].evidence as Row;
    expect(evidence.resolutionOutcome).toBe('unresolved');
    expect(evidence.linked).toBe(false);
    expect(evidence.candidatePersonCount).toBe(0);
    expect(String(evidence.resolutionReason)).toContain('no candidate matched');
    expect(evidence.derivation).toBe('social_contact_platform_identity');
    // The stored evidence survives in the claims table, not just in the return value.
    expect((tables.identity_claims[0].evidence as Row).resolutionOutcome).toBe('unresolved');
  });

  it('the linked verdict is persisted too', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    const evidence = claimInserts[0].evidence as Row;
    expect(evidence.resolutionOutcome).toBe('matched_claim');
    expect(evidence.linked).toBe(true);
    expect(evidence.candidatePersonCount).toBe(1);
  });
});

describe('B1 — ambiguity parks, it never picks a winner', () => {
  it('two people holding one identity: no link, a duplicate candidate parked on external_key', async () => {
    seedPerson(ORG_A, 'p1');
    seedPerson(ORG_A, 'p2');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedLinkedClaim(ORG_A, 'p2', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('ambiguous');
    expect(res.personId).toBeNull();
    expect(contact('c1')?.unified_person_id).toBeNull();
    expect(res.duplicatesParked).toBe(1);
    expect(duplicateInserts).toHaveLength(1);
    expect(duplicateInserts[0].matched_on).toBe('external_key');
    expect(duplicateInserts[0].classification).toBe('probable');
    expect(duplicateInserts[0].organization_id).toBe(ORG_A);
    expect(duplicateInserts[0].status).toBe('open');
    expect(duplicateInserts[0].person_id).not.toBe(duplicateInserts[0].candidate_person_id);
  });

  it('the ambiguous claim is written with person_id NULL', async () => {
    seedPerson(ORG_A, 'p1');
    seedPerson(ORG_A, 'p2');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedLinkedClaim(ORG_A, 'p2', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(claimInserts).toHaveLength(1);
    expect(claimInserts[0].person_id).toBeNull();
    expect((claimInserts[0].evidence as Row).resolutionOutcome).toBe('ambiguous');
    expect((claimInserts[0].evidence as Row).candidatePersonCount).toBe(2);
  });

  it('three people park two pairs, and a failure to park never throws', async () => {
    seedPerson(ORG_A, 'p1'); seedPerson(ORG_A, 'p2'); seedPerson(ORG_A, 'p3');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedLinkedClaim(ORG_A, 'p2', 'abc123');
    seedLinkedClaim(ORG_A, 'p3', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');
    duplicateErrors = [null, { code: '23505', message: 'already open' }];

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('ambiguous');
    expect(duplicateInserts).toHaveLength(2);
    expect(res.duplicatesParked).toBe(1);   // the 23505 is benign, not a park
    expect(contact('c1')?.unified_person_id).toBeNull();
  });
});

describe('B1 — the duplicate claim is benign', () => {
  it('a repeat claim answers 23505 and is reported as already_exists, not a failure', async () => {
    seedContact(ORG_A, 'c1', 'abc123');

    const first = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });
    const second = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(first.claim).toBe('created');
    expect(second.claim).toBe('already_exists');
    expect(second.outcome).toBe('unresolved');
    expect(second.failureCodes).toEqual([]);
    expect(tables.identity_claims).toHaveLength(1);   // converges, never duplicates
  });

  it('the writer never asks for ON CONFLICT — the partial index answers 42P10', async () => {
    seedContact(ORG_A, 'c1', 'abc123');
    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });
    // persistClaims exposes only `.insert(row)`; an upsert would have needed a
    // second argument, and there is none.
    expect(claimInserts).toHaveLength(1);
    expect(queries.filter((q) => q.table === 'identity_claims' && q.op === 'insert')).toHaveLength(1);
  });
});

describe('B1 — tenant isolation', () => {
  it('a person in another tenant is never matched', async () => {
    seedPerson(ORG_B, 'pb');
    seedLinkedClaim(ORG_B, 'pb', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('unresolved');
    expect(res.personId).toBeNull();
    expect(contact('c1')?.unified_person_id).toBeNull();
  });

  it('every query is tenant-filtered', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    const reads = queries.filter((q) => q.op !== 'insert');
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) {
      const tenant = q.filters.find(([k]) => k === 'organization_id' || k === 'company_id');
      expect(tenant?.[1]).toBe(ORG_A);
    }
    expect(claimInserts[0].organization_id).toBe(ORG_A);
  });

  it('the contact update is keyed on the tenant as well as the id', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');

    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    const update = queries.find((q) => q.table === 'contacts' && q.op === 'update');
    expect(update).toBeDefined();
    expect(update!.filters).toEqual(expect.arrayContaining([
      ['organization_id', ORG_A], ['id', 'c1'], ['unified_person_id', null],
    ]));
  });

  it('a contact in another tenant is not linked even when the id is supplied', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_B, 'c-other', 'abc123');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c-other', platform: 'linkedin', platformUserId: 'abc123',
    });

    // The person matched in ORG_A, but the ORG_A-filtered update touches no row.
    expect(res.outcome).toBe('already_linked');
    expect(contact('c-other')?.unified_person_id).toBeNull();
  });
});

describe('B1 — the claim it writes, and the claims it refuses to write', () => {
  it('provenance is live ingestion, never w3_backfill', async () => {
    seedContact(ORG_A, 'c1', 'abc123');
    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(claimInserts[0].source).toBe(SOCIAL_CONTACT_SOURCE);
    expect(claimInserts[0].source).toBe('social_contact_ingestion');
    expect(claimInserts[0].source).not.toBe(CANONICALISATION_SOURCE);
    expect(claimInserts[0].source).not.toBe('w3_backfill');
  });

  it('claim_type is external_id and external_profile is never emitted', async () => {
    seedContact(ORG_A, 'c1', 'https://linkedin.com/in/jane');
    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin',
      platformUserId: 'https://linkedin.com/in/jane',
    });

    expect(SOCIAL_CONTACT_CLAIM_TYPE).toBe('external_id');
    expect(claimInserts.every((r) => r.claim_type === 'external_id')).toBe(true);
    expect(claimInserts.some((r) => r.claim_type === 'external_profile')).toBe(false);
  });

  it('the claim names the contact as its source, so it is traceable', async () => {
    seedContact(ORG_A, 'c1', 'abc123');
    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });
    expect(claimInserts[0].source_reference).toBe('contacts:c1');
  });

  it('an identity that does not normalize writes nothing at all', async () => {
    seedContact(ORG_A, 'c1', '');
    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: '   ',
    });

    expect(res.outcome).toBe('unusable');
    expect(claimInserts).toHaveLength(0);
    expect(contact('c1')?.unified_person_id).toBeNull();
  });

  it('a missing platform writes nothing — the platform rule would reject it', async () => {
    seedContact(ORG_A, 'c1', 'abc123');
    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: '  ', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('unusable');
    expect(claimInserts).toHaveLength(0);
  });
});

describe('B1 — a name is never an identity key', () => {
  it('a person with the same display name is not matched', async () => {
    seedPerson(ORG_A, 'p1', { full_name: 'Jane Doe' });
    seedContact(ORG_A, 'c1', 'abc123', 'Jane Doe');

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('unresolved');
    expect(contact('c1')?.unified_person_id).toBeNull();
  });

  it('no query ever filters on a name, title or company-name column', async () => {
    seedPerson(ORG_A, 'p1', { full_name: 'Jane Doe' });
    seedContact(ORG_A, 'c1', 'abc123', 'Jane Doe');
    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    const banned = /name|title|seniority|account_name/i;
    for (const q of queries) {
      for (const [k] of q.filters) expect(k).not.toMatch(banned);
    }
  });

  it('the display name is never carried into the claim', async () => {
    seedContact(ORG_A, 'c1', 'abc123', 'Jane Doe');
    await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });
    expect(JSON.stringify(claimInserts[0])).not.toContain('Jane Doe');
  });
});

describe('B1 — an existing decision is never re-made', () => {
  it('a contact that already carries a person is left completely alone', async () => {
    seedPerson(ORG_A, 'p1');
    seedPerson(ORG_A, 'p2');
    seedLinkedClaim(ORG_A, 'p2', 'abc123');
    tables.contacts.push({
      id: 'c1', organization_id: ORG_A, platform: 'linkedin',
      platform_user_id: 'abc123', unified_person_id: 'p1',
    });

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin',
      platformUserId: 'abc123', existingPersonId: 'p1',
    });

    expect(res.outcome).toBe('already_linked');
    expect(res.personId).toBe('p1');
    expect(contact('c1')?.unified_person_id).toBe('p1');
    expect(claimInserts).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });

  it('a concurrent linker wins rather than being overwritten', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    tables.contacts.push({
      id: 'c1', organization_id: ORG_A, platform: 'linkedin',
      platform_user_id: 'abc123', unified_person_id: 'p-other',
    });

    // No existingPersonId was observed at read time, but the row is linked now.
    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('already_linked');
    expect(contact('c1')?.unified_person_id).toBe('p-other');
  });
});

describe('B1 — failure posture: classified, and never fatal to ingestion', () => {
  it('a tenant-FK rejection on the claim refuses the link and is classified, not called transient', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');
    claimErrors = [{ code: '23503', message: 'violates foreign key constraint' }];

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.claim).toBe('tenant_fk_failure');
    expect(res.outcome).toBe('failed');
    expect(res.failureCodes).toEqual(['23503']);
    expect(contact('c1')?.unified_person_id).toBeNull();
    expect(queries.some((q) => q.table === 'contacts' && q.op === 'update')).toBe(false);
  });

  it('classification maps SQLSTATEs to a closed vocabulary', () => {
    expect(classifySocialClaimFailure('23503')).toBe('tenant_fk_failure');
    expect(classifySocialClaimFailure('23514')).toBe('invalid_claim');
    expect(classifySocialClaimFailure('23502')).toBe('invalid_claim');
    expect(classifySocialClaimFailure('08006')).toBe('database_failure');
    expect(classifySocialClaimFailure(null)).toBe('database_failure');
  });

  it('a rejected contact update is reported, not thrown', async () => {
    seedPerson(ORG_A, 'p1');
    seedLinkedClaim(ORG_A, 'p1', 'abc123');
    seedContact(ORG_A, 'c1', 'abc123');
    contactUpdateErrors = [{ code: '23503', message: 'contacts_person_tenant_fk' }];

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('failed');
    expect(res.failureCodes).toContain('23503');
    expect(contact('c1')?.unified_person_id).toBeNull();
  });

  it('a driver-level explosion returns failed instead of throwing', async () => {
    seedContact(ORG_A, 'c1', 'abc123');
    driverThrows = true;

    const res = await resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    });

    expect(res.outcome).toBe('failed');
    expect(res.personId).toBeNull();
  });

  it('missing inputs are skipped, never thrown', async () => {
    await expect(resolveSocialContactIdentity({
      organizationId: '', contactId: 'c1', platform: 'linkedin', platformUserId: 'abc123',
    })).resolves.toMatchObject({ outcome: 'skipped' });

    await expect(resolveSocialContactIdentity({
      organizationId: ORG_A, contactId: '', platform: 'linkedin', platformUserId: 'abc123',
    })).resolves.toMatchObject({ outcome: 'skipped' });
  });
});

describe('B1 — the claim builder is pure', () => {
  const base = {
    organizationId: ORG_A, contactId: 'c1', platform: 'linkedin',
    normalizedValue: 'abc123', rawValue: 'ABC123',
  };

  it('carries the verdict without touching the database', () => {
    const claim = buildSocialContactClaim({
      ...base, personId: null,
      resolution: { outcome: 'unresolved', reason: 'nobody', candidatePersonIds: [] },
    });

    expect(claim.claimType).toBe('external_id');
    expect(claim.personId).toBeNull();
    expect(claim.source).toBe(SOCIAL_CONTACT_SOURCE);
    expect(claim.sourceTable).toBe('contacts');
    expect(claim.sourceColumn).toBe('platform_user_id');
    expect(queries).toHaveLength(0);
  });

  it('is deterministic', () => {
    const args = {
      ...base, personId: 'p1',
      resolution: { outcome: 'matched_claim' as const, reason: 'one', candidatePersonIds: ['p1'] },
    };
    expect(buildSocialContactClaim(args)).toEqual(buildSocialContactClaim(args));
  });
});
