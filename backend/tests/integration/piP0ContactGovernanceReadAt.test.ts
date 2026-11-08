/**
 * P0 CONTACT GOVERNANCE — PART 2. The computed field, against a REAL PostgREST.
 *
 * ─── WHY THIS SUITE EXISTS AT ALL ───────────────────────────────────────────
 * Everything else about part 2 is provable against a double, and is proved
 * there (contactGovernanceReadAggregation.test.ts). Exactly one claim is not:
 * that `public.read_at(public.contact_governance_records)` is SELECTABLE as a
 * PostgREST computed field, through the repository's own `@supabase/supabase-js`
 * client, and that it returns one `transaction_timestamp()` per REQUEST.
 *
 * A mock cannot establish that. A mock of PostgREST returns whatever I decided
 * PostgREST does, so a passing mock would only confirm my own assumption. The
 * decision pack for this change recorded that selectability as INFERRED and
 * UNVERIFIED precisely because no PostgREST was reachable; this suite is what
 * converts it to measured.
 *
 * ─── IT RUNS NOWHERE BUT THE DISPOSABLE CI CONTAINER ────────────────────────
 * Gated on `PI_CG_POSTGREST=1`, which only
 * .github/workflows/pi-contact-governance-postgrest.yml sets, beside a
 * `localhost` PostgREST and a `localhost` PostgreSQL that exist for the life of
 * that job. It is SKIPPED everywhere else, including a developer machine and
 * every other CI job, so it can never reach a database it was not given.
 */

import { createClient } from '@supabase/supabase-js';
import { loadGovernanceRecords, loadTenantGovernanceRecords } from '../../services/prospectIdentity/contactGovernanceRepository';
import { evaluateCanonicalGovernance } from '../../services/prospectIdentity/contactGovernanceEvaluation';

const ENABLED = process.env.PI_CG_POSTGREST === '1';
const d = ENABLED ? describe : describe.skip;

const URL = String(process.env.PI_CG_POSTGREST_URL ?? 'http://localhost:3000');
const SERVICE_JWT = String(process.env.PI_CG_SERVICE_JWT ?? '');
const PROBE_JWT = String(process.env.PI_CG_PROBE_JWT ?? '');
const AUTHENTICATED_JWT = String(process.env.PI_CG_AUTHENTICATED_JWT ?? '');
const ANON_JWT = String(process.env.PI_CG_ANON_JWT ?? '');

/**
 * PostgreSQL's OWN rendering of a `timestamptz` through `to_json`: an ALWAYS
 * EXPLICIT numeric offset, `+00:00` at UTC and NEVER `Z`, with 1–6 fractional
 * digits and trailing zeros trimmed — so a whole second carries no fractional
 * part at all.
 *
 * This pattern is itself a discriminator, and a strong one: `Date#toISOString`
 * can only produce `Z` with exactly three fractional digits. A value matching
 * this cannot have come from a JavaScript clock.
 */
const PG_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}:\d{2}$/;

/** A separate client for SEEDING only. The reads under test use the repository. */
const seeder = () => createClient(URL, SERVICE_JWT, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** One org per concern, so no test can be affected by another's rows. */
const ORG = {
  twoAnchors: '0a000000-0000-4000-8000-000000000001',
  dbClock: '0a000000-0000-4000-8000-000000000002',
  tenantA: '0a000000-0000-4000-8000-000000000003',
  tenantB: '0a000000-0000-4000-8000-000000000004',
  acl: '0a000000-0000-4000-8000-000000000005',
};
const PERSON = '0b000000-0000-4000-8000-000000000001';
const TARGET = 'ada@example.test';

/** A `now` that is DECADES wrong, passed deliberately. See its use below. */
const WRONG_HOST_CLOCK = '1970-01-01T00:00:00.000Z';

const http = (path: string, jwt: string) => fetch(`${URL}${path}`, {
  headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
});

beforeAll(async () => {
  if (!ENABLED) return;
  const db = seeder();

  const companies = await db.from('companies').insert(Object.values(ORG).map((id) => ({ id })));
  if (companies.error) throw new Error(`seed companies: ${companies.error.message}`);

  // `effective_from` is computed BY THE DATABASE in SQL terms where it matters,
  // but PostgREST takes literals — so the two clock cases use offsets wide
  // enough (an hour) that no plausible skew between the two containers' clocks
  // could decide them. The point of those two tests is the SIGN of the
  // comparison, not its precision.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const hourAhead = new Date(Date.now() + 3600_000).toISOString();

  const rows = [
    // Two anchors in one tenant: one person-anchored, one target-anchored, so
    // the anchored loader must make two requests.
    { organization_id: ORG.twoAnchors, person_id: PERSON, channel: 'email', governance_type: 'unsubscribe', source: 'ci', effective_from: hourAgo },
    { organization_id: ORG.twoAnchors, target_normalized: TARGET, channel: 'email', governance_type: 'complaint', source: 'ci', effective_from: hourAgo },

    // The clock cases. One restriction already in force an hour ago, one that
    // does not begin for another hour.
    { organization_id: ORG.dbClock, target_normalized: 'past@example.test', channel: 'email', governance_type: 'unsubscribe', source: 'ci', effective_from: hourAgo },
    { organization_id: ORG.dbClock, target_normalized: 'future@example.test', channel: 'email', governance_type: 'unsubscribe', source: 'ci', effective_from: hourAhead },

    // The SAME target restricted in tenant A and not in tenant B.
    { organization_id: ORG.tenantA, target_normalized: 'shared@example.test', channel: 'email', governance_type: 'unsubscribe', source: 'ci', effective_from: hourAgo },

    // A row for the ACL probe to try to read.
    { organization_id: ORG.acl, target_normalized: 'acl@example.test', channel: 'email', governance_type: 'unsubscribe', source: 'ci', effective_from: hourAgo },
  ];

  const seeded = await db.from('contact_governance_records').insert(rows);
  if (seeded.error) throw new Error(`seed governance: ${seeded.error.message}`);
});

// ════════════════════════════════════════════════════════════════════════════
d('P0-2 §7 — the computed field is real, and it comes from the database', () => {
  it('`read_at` is selectable through the repository client and renders as PostgreSQL does', async () => {
    const res = await seeder()
      .from('contact_governance_records')
      .select('id, read_at')
      .eq('organization_id', ORG.twoAnchors);

    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2);
    for (const row of res.data as Array<{ read_at: string }>) {
      // Not `Z`, and not three-digits-always: this is Postgres's rendering.
      expect(row.read_at).toMatch(PG_INSTANT);
      expect(row.read_at).not.toMatch(/Z$/);
    }
  });

  it('every row of ONE request carries the IDENTICAL instant — it is per transaction', async () => {
    const res = await seeder()
      .from('contact_governance_records')
      .select('id, read_at')
      .eq('organization_id', ORG.twoAnchors);

    const instants = new Set((res.data as Array<{ read_at: string }>).map((r) => r.read_at));
    expect(instants.size).toBe(1);
  });

  it('TWO requests return TWO instants, and the second is not earlier than the first', async () => {
    const db = seeder();
    const one = await db.from('contact_governance_records').select('read_at').eq('organization_id', ORG.twoAnchors).limit(1);
    const two = await db.from('contact_governance_records').select('read_at').eq('organization_id', ORG.twoAnchors).limit(1);

    const a = (one.data as Array<{ read_at: string }>)[0].read_at;
    const b = (two.data as Array<{ read_at: string }>)[0].read_at;
    expect(Date.parse(b)).toBeGreaterThanOrEqual(Date.parse(a));
    // The whole premise of per-read instants: they are genuinely two values,
    // not one snapshot shared by both requests. A tie would mean PostgREST had
    // served both from one transaction, which it does not do — but if it ever
    // did, the per-read design would be unnecessary and this would say so.
    expect(b).not.toBe(a);
  });
});

// ════════════════════════════════════════════════════════════════════════════
d('P0-2 §3/§4 — the anchored loader reports two reads with two instants', () => {
  it('both anchors produce two reads, each with its own rows and its own instant', async () => {
    const loaded = await loadGovernanceRecords({
      organizationId: ORG.twoAnchors, personId: PERSON, target: TARGET, channel: 'email',
    });

    expect(loaded.ok).toBe(true);
    expect(loaded.reads).toHaveLength(2);

    const person = loaded.reads!.find((r) => r.anchor === 'person')!;
    const target = loaded.reads!.find((r) => r.anchor === 'target')!;

    expect(person.records.map((r) => r.governanceType)).toEqual(['unsubscribe']);
    expect(target.records.map((r) => r.governanceType)).toEqual(['complaint']);

    expect(person.readAt).toMatch(PG_INSTANT);
    expect(target.readAt).toMatch(PG_INSTANT);
    // Two requests, two transactions, two instants.
    expect(person.readAt).not.toBe(target.readAt);
  });

  it('the tenant loader reports its one read with one instant', async () => {
    const loaded = await loadTenantGovernanceRecords(ORG.twoAnchors, ['email']);
    expect(loaded.ok).toBe(true);
    expect(loaded.reads).toHaveLength(1);
    expect(loaded.reads![0].anchor).toBe('tenant');
    expect(loaded.reads![0].readAt).toMatch(PG_INSTANT);
  });
});

// ════════════════════════════════════════════════════════════════════════════
d('P0-2 §4 — the verdict uses the DATABASE instant, not the caller’s clock', () => {
  it('a restriction in force an hour ago BLOCKS, although the caller passes 1970', async () => {
    // THE CENTRAL ASSERTION OF PART 2. `now` is deliberately decades wrong. If
    // the caller's clock were still being used, 1970 would precede
    // `effective_from` and this would read as "not yet in force" — which
    // PERMITS contact. It blocks, so the instant came from the database.
    const r = await evaluateCanonicalGovernance({
      organizationId: ORG.dbClock, channel: 'email',
      personId: null, target: 'past@example.test',
      now: WRONG_HOST_CLOCK,
    });

    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('blocked');
    expect(r.ok === true && r.verdict.reason).toBe('blocked_by_unsubscribe');
    // And the evidence names the instant it was judged at.
    expect(r.ok === true && r.reads).toHaveLength(1);
    expect(r.ok === true && r.reads[0].readAt).toMatch(PG_INSTANT);
  });

  it('a restriction that begins in an hour does NOT block, with the same wrong clock', async () => {
    // The negative control for the test above. Were the comparison inert — say,
    // always "in force" — this would block too, and the previous test would
    // prove nothing.
    const r = await evaluateCanonicalGovernance({
      organizationId: ORG.dbClock, channel: 'email',
      personId: null, target: 'future@example.test',
      now: WRONG_HOST_CLOCK,
    });

    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('allowed');
  });

  it('with both anchors restricted, the STRICTER band wins and both reads are reported', async () => {
    const r = await evaluateCanonicalGovernance({
      organizationId: ORG.twoAnchors, channel: 'email',
      personId: PERSON, target: TARGET,
      now: WRONG_HOST_CLOCK,
    });

    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verdict.decision).toBe('blocked');
    // unsubscribe and complaint are both band 4, so either may win — what must
    // hold is that a verdict was reached, both reads were evaluated, and each
    // was judged at its own instant.
    expect(r.ok === true && r.verdict.gate).toBe(4);
    expect(r.ok === true && r.reads).toHaveLength(2);
    const instants = (r.ok === true ? r.reads : []).map((e) => e.readAt);
    for (const i of instants) expect(i).toMatch(PG_INSTANT);
    expect(new Set(instants).size).toBe(2);
    // Every restrictive reason survives, not only the winner's.
    const reasons = (r.ok === true ? r.reads : []).map((e) => e.verdict?.reason).sort();
    expect(reasons).toEqual(['blocked_by_complaint', 'blocked_by_unsubscribe']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
d('P0-2 — tenant isolation, at the QUERY level', () => {
  it('the same target restricted in tenant A is not restricted in tenant B', async () => {
    const a = await evaluateCanonicalGovernance({
      organizationId: ORG.tenantA, channel: 'email', personId: null,
      target: 'shared@example.test', now: WRONG_HOST_CLOCK,
    });
    const b = await evaluateCanonicalGovernance({
      organizationId: ORG.tenantB, channel: 'email', personId: null,
      target: 'shared@example.test', now: WRONG_HOST_CLOCK,
    });

    expect(a.ok === true && a.verdict.decision).toBe('blocked');
    expect(b.ok === true && b.verdict.decision).toBe('allowed');
  });

  it('the isolation is the application predicate, NOT RLS — which is why it is tested here', async () => {
    // `service_role` has BYPASSRLS in production and in the fixture, so the
    // policy on this table cannot be what separates the tenants. Reading
    // WITHOUT the organization predicate must therefore return both tenants'
    // rows. If this ever came back as one tenant's rows, the thing under test
    // would be RLS and the application filter would be untested.
    const res = await seeder()
      .from('contact_governance_records')
      .select('organization_id')
      .in('organization_id', [ORG.tenantA, ORG.tenantB, ORG.twoAnchors]);

    expect(res.error).toBeNull();
    const orgs = new Set((res.data as Array<{ organization_id: string }>).map((r) => r.organization_id));
    expect(orgs.has(ORG.tenantA)).toBe(true);
    expect(orgs.has(ORG.twoAnchors)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
d('P0-2 §7 — only service_role may call the function', () => {
  it('a request with NO token is refused', async () => {
    const res = await http(`/contact_governance_records?select=id,read_at&limit=1`, '');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('`anon` and `authenticated` cannot read the table at all, so cannot reach the field', async () => {
    for (const jwt of [ANON_JWT, AUTHENTICATED_JWT]) {
      const res = await http(`/contact_governance_records?select=id&limit=1`, jwt);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('the probe role CAN read the table but is REFUSED the computed field', async () => {
    // This is the assertion that isolates the EXECUTE grant from the table
    // grant. `pi_cg_probe` has SELECT on the table and no EXECUTE on
    // `public.read_at`, so the two requests below differ in exactly one column.
    const allowed = await http(`/contact_governance_records?select=id&organization_id=eq.${ORG.acl}`, PROBE_JWT);
    expect(allowed.status).toBe(200);

    const refused = await http(`/contact_governance_records?select=id,read_at&organization_id=eq.${ORG.acl}`, PROBE_JWT);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const body = await refused.text();
    // Reported, not asserted on exact wording: PostgREST's message for a
    // missing EXECUTE is a server-version detail, and pinning it would make
    // this test about PostgREST's phrasing rather than about the privilege.
    expect(body.length).toBeGreaterThan(0);
  });

  it('service_role gets the field, which is the other half of the same claim', async () => {
    const res = await http(`/contact_governance_records?select=id,read_at&organization_id=eq.${ORG.acl}`, SERVICE_JWT);
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<{ read_at: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].read_at).toMatch(PG_INSTANT);
  });
});

// ════════════════════════════════════════════════════════════════════════════
d('P0-2 — the suite itself is not vacuous', () => {
  it('the gate is really on, and a real PostgREST really answered', async () => {
    expect(ENABLED).toBe(true);
    expect(SERVICE_JWT.split('.')).toHaveLength(3);
    const root = await http('/', SERVICE_JWT);
    // PostgREST serves its OpenAPI description at the root. Any answer here is
    // a live server; a mock would not be listening on a port at all.
    expect([200, 404]).toContain(root.status);
  });
});
