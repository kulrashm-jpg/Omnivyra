/**
 * PI WS-3G — ONE ENGAGEMENT MESSAGE, VERIFIED AS A PROSPECT UTTERANCE.
 *
 * `offeringIntelligence/problemFit.ts` audited `engagement_messages` and refused
 * it as a source of a prospect-stated problem. That verdict is a claim about the
 * RELATION, and it is correct: nothing about the table guarantees that a given
 * row is an utterance by a given prospect. This suite is about the other
 * question — whether ONE ROW can be established — and about the only shape in
 * which an established row is allowed to reach the gate: a server-set
 * attestation that names the verifier, the relation and the exact record.
 *
 * ─── WHAT IS MODELLED RATHER THAN VERIFIED ────────────────────────────────
 * There is no PostgreSQL, no Docker and no database in this environment, so the
 * reads below run against a double. Three things are therefore MODELLED and are
 * flagged as such here rather than being claimed as proven:
 *
 *   1. `idx_contacts_org_platform_user` being UNIQUE — the double returns one
 *      row for the triple because the index says only one can exist.
 *   2. The two schema states of `engagement_messages.organization_id`:
 *      `20261221000000` is AUTHORED and its applied state is unverified, so the
 *      double is driven in both states, and a missing column raises 42703 the
 *      way PostgREST does.
 *   3. `platform_created_at` being nullable with no default, which is what makes
 *      an absent source instant a real case rather than a hypothetical one.
 *
 * ─── WHAT IS DELIBERATELY NOT RE-LITIGATED ────────────────────────────────
 * The admission contract's six requirements, the inadmissible derivations and
 * the origin-spelling normalisation are driven from the published contract in
 * `piWs2cProblemFitBuySide.test.ts` and `piWs3aProblemFitSourceReverify.test.ts`.
 * The capture seam's refusals, its storage invariants and its replay behaviour
 * are driven in `piWs3dProblemObservationCapture.test.ts`. This suite asserts
 * the VERIFICATION and the WIRING, and never a second copy of either.
 *
 * The gate is wrapped in a pass-through spy, not replaced: that is how the
 * candidate it RECEIVED can be asserted exactly — which is where the "a caller
 * cannot influence a derived value" property actually lives — without changing
 * what the gate decides.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  selects: [] as Array<{ table: string; cols: string; filters: Array<[string, unknown]> }>,
  /** Any non-select operation at all, so "this path writes nothing" is checkable. */
  mutations: [] as Array<{ table: string; op: string }>,
  readErrors: {} as Record<string, { code?: string; message?: string }>,
  throwOn: null as string | null,
  /**
   * Columns the deployed schema does NOT have, by table. A select or a predicate
   * naming one raises 42703, exactly as PostgREST does — which is how the
   * UNAPPLIED state of `20261221000000` is represented.
   */
  missingColumns: {} as Record<string, string[]>,
  /** When true the double ignores predicates, so the ROW-LEVEL re-assertions are
   *  what is tested rather than the double's own filtering. */
  ignoreFilters: false,
};

const rowsOf = (table: string): Row[] => {
  if (!db.tables[table]) db.tables[table] = [];
  return db.tables[table];
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = {
      op: 'select',
      cols: '',
      filters: [] as Array<[string, unknown]>,
      payload: null as Row | null,
    };

    const exec = async (mode: 'many' | 'single') => {
      await Promise.resolve();
      if (st.op !== 'select') {
        db.mutations.push({ table, op: st.op });
        return { data: null, error: { code: '42501', message: 'this path must not write' } };
      }

      db.selects.push({ table, cols: st.cols, filters: st.filters });
      if (db.throwOn === table) throw new Error('transport exploded');

      const absent = db.missingColumns[table] ?? [];
      const named = [
        ...st.cols.split(',').map((c) => c.trim()),
        ...st.filters.map(([c]) => c),
      ];
      const missing = absent.find((c) => named.includes(c));
      if (missing) {
        return {
          data: null,
          error: { code: '42703', message: `column ${table}.${missing} does not exist` },
        };
      }

      const err = db.readErrors[table];
      if (err) return { data: null, error: err };

      const found = db.ignoreFilters
        ? rowsOf(table).slice()
        : rowsOf(table).filter((r) => st.filters.every(([c, v]) => r[c] === v));

      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (c: string) => { st.cols = c; return b; },
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      upsert: (p: Row) => { st.op = 'upsert'; st.payload = p; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      order: () => b,
      limit: () => exec('many'),
      single: () => exec('single'),
      maybeSingle: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => { throw new Error('the verification path must not reach the table API directly'); },
  },
}));

const logs: Array<{ level: string; event: string; ctx: Record<string, unknown> }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    warn: (event: string, ctx: Record<string, unknown>) => { logs.push({ level: 'warn', event, ctx }); },
    error: (event: string, ctx: Record<string, unknown>) => { logs.push({ level: 'error', event, ctx }); },
    info: () => {}, debug: () => {},
  },
}));

/**
 * The gate, wrapped and NOT replaced. Every candidate it receives is recorded;
 * what it decides is whatever the real implementation decides. A replaced gate
 * would make every wiring assertion below vacuous.
 */
const gateCalls: Array<Record<string, unknown>> = [];
jest.mock('../../services/offeringIntelligence/problemFit', () => {
  const actual = jest.requireActual('../../services/offeringIntelligence/problemFit');
  return {
    ...actual,
    admitProspectProblem: (candidate: Record<string, unknown>) => {
      gateCalls.push(candidate);
      return actual.admitProspectProblem(candidate);
    },
  };
});

import fs from 'fs';
import path from 'path';
import {
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
} from '../../services/engagementIdentity/attestedIdentityContract';
import {
  PROSPECT_MESSAGE_RELATION,
  PROSPECT_MESSAGE_VERIFICATION_PERFORMS_NO_WRITE,
  PROSPECT_MESSAGE_VERIFICATION_VERSION,
  defaultProspectMessagePorts,
  verifyProspectMessage,
  type ProspectMessageVerification,
} from '../../services/prospectProblems/verifyProspectMessage';
import {
  PROBLEM_OBSERVATION_INGESTION_PERFORMS_NO_WRITE,
  VERIFIED_MESSAGE_ORIGIN_STORE,
  defaultVerifiedMessageCapturePorts,
  recordProspectProblemFromMessage,
  recordProspectProblemObservation,
  type VerifiedMessageCapturePorts,
} from '../../services/prospectProblems/problemObservationIngestion';
import {
  PROSPECT_MESSAGE_VERIFIER,
  type ProblemObservationInput,
  type RecordProblemObservationResult,
} from '../../services/prospectProblems/types';
import { admitProspectProblem } from '../../services/offeringIntelligence/problemFit';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const LEAD_A = 'lead-a';
const PERSON_A = 'person-a';
const PERSON_C = 'person-c';
const ACCOUNT_A = 'account-a';
const THREAD_A = 'thread-a';
const THREAD_C = 'thread-c';
const MSG_A = 'msg-a';
const AUTHOR_A = 'author-a';
const AUTHOR_C = 'author-c';

/** The SOURCE's instant, as the platform reported it — offset form on purpose,
 *  so the derivation is visible rather than a pass-through of the stored text. */
const PLATFORM_CREATED_AT = '2026-09-14T08:15:00+00:00';
const OBSERVED_AT = '2026-09-14T08:15:00.000Z';
/** OUR clocks. Present on every row below, and read by nothing. */
const OUR_CLOCK = '2026-10-28T11:30:00.000Z';

/** Deliberately messy: a sender prefix and runs of whitespace, so the derived
 *  statement proves BOTH the canonical cleaner and the gate's normalisation ran. */
const RAW_CONTENT = '  Alex:  our three   dashboards disagree\n  and nobody can say which one to '
  + 'take to the board  ';
const DERIVED_STATEMENT = 'our three dashboards disagree and nobody can say which one to take to the board';

const seedSpine = (over: { org?: string; personId?: string } = {}) => {
  const org = over.org ?? ORG_A;
  const personId = over.personId ?? PERSON_A;
  rowsOf('canonical_leads').push({ id: LEAD_A, company_id: org, unified_person_id: personId });
  rowsOf('unified_persons').push({ id: personId, company_id: org, account_id: ACCOUNT_A });
  rowsOf('prospect_accounts').push({ id: ACCOUNT_A, organization_id: org });
};

const seedThread = (over: Row = {}) => {
  rowsOf('engagement_threads').push({
    id: THREAD_A,
    organization_id: ORG_A,
    unified_person_id: PERSON_A,
    created_at: OUR_CLOCK,
    ...over,
  });
};

/** A message as the relation holds one, in the APPLIED schema state. */
const seedMessage = (over: Row = {}) => {
  rowsOf('engagement_messages').push({
    id: MSG_A,
    organization_id: ORG_A,
    thread_id: THREAD_A,
    author_id: AUTHOR_A,
    platform: 'linkedin',
    platform_message_id: 'urn:li:comment:(123,456)',
    message_type: 'comment',
    content: RAW_CONTENT,
    raw_payload: {},
    direction: 'inbound',
    platform_created_at: PLATFORM_CREATED_AT,
    // OUR clocks, on every row, so "no clock was substituted" is a real claim.
    created_at: OUR_CLOCK,
    normalized_time: OUR_CLOCK,
    scraped_at: OUR_CLOCK,
    ...over,
  });
};

const seedAuthor = (over: Row = {}) => {
  rowsOf('engagement_authors').push({
    id: AUTHOR_A, platform: 'linkedin', platform_user_id: 'li-alex', ...over,
  });
};

const seedContact = (over: Row = {}) => {
  rowsOf('contacts').push({
    id: 'contact-a',
    organization_id: ORG_A,
    platform: 'linkedin',
    platform_user_id: 'li-alex',
    unified_person_id: PERSON_A,
    ...over,
  });
};

/** The whole happy world: prospect, thread, message, author, resolved contact. */
const seedVerifiableMessage = (over: { message?: Row; thread?: Row; contact?: Row; author?: Row } = {}) => {
  seedSpine();
  seedThread(over.thread);
  seedMessage(over.message);
  seedAuthor(over.author);
  seedContact(over.contact);
};

const verify = (over: Record<string, unknown> = {}): Promise<ProspectMessageVerification> =>
  verifyProspectMessage({
    organizationId: ORG_A,
    messageId: MSG_A,
    subjectType: 'person',
    subjectId: PERSON_A,
    personId: PERSON_A,
    ...over,
  } as never);

const selectsOn = (table: string) => db.selects.filter((s) => s.table === table);

/**
 * Does the companion change in `problemFit.ts` (`admissibleWhen` plus
 * `sourceVerification` on the candidate) exist yet?
 *
 * It is owned by another workstream and lands separately. Asked as a QUESTION of
 * the real gate rather than assumed either way, so this suite is honest in both
 * states: before it lands the seam's end state is `inadmissible_evidence` by the
 * audit, after it lands the same wiring stores a row. Everything that can be
 * asserted in BOTH states is asserted unconditionally below.
 */
const gateAdmitsVerifiedMessages = (): boolean => admitProspectProblem({
  subjectType: 'person',
  subjectId: PERSON_A,
  organizationId: ORG_A,
  statement: DERIVED_STATEMENT,
  origin: { store: PROSPECT_MESSAGE_RELATION, recordId: MSG_A },
  observedAt: OBSERVED_AT,
  confidence: null,
  derivedFrom: 'prospect_statement',
  sourceVerification: {
    verifier: PROSPECT_MESSAGE_VERIFIER,
    relation: PROSPECT_MESSAGE_RELATION,
    recordId: MSG_A,
  },
} as never).admissible;

beforeEach(() => {
  db.tables = {};
  db.selects = [];
  db.mutations = [];
  db.readErrors = {};
  db.throwOn = null;
  db.missingColumns = {};
  db.ignoreFilters = false;
  logs.length = 0;
  gateCalls.length = 0;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · THE VERIFICATION DERIVES, AND THE ATTESTATION NAMES THE ROW
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · a genuine prospect message verifies, and every value is DERIVED', () => {
  it('verifies, and derives the statement, the instant, the origin and the attestation', async () => {
    seedVerifiableMessage();

    const out = await verify();

    expect(out.verified).toBe(true);
    expect(out.refusal).toBeNull();
    // The words, cleaned by the canonical sender-prefix stripper and normalised
    // exactly as the gate normalises — never summarised, never truncated.
    expect(out.statement).toBe(DERIVED_STATEMENT);
    // The SOURCE's instant, parsed rather than echoed.
    expect(out.observedAt).toBe(OBSERVED_AT);
    expect(out.observedAt).not.toBe(OUR_CLOCK);
    expect(out.origin).toEqual({ store: 'engagement_messages', recordId: MSG_A });
    expect(out.sourceVerification).toEqual({
      verifier: PROSPECT_MESSAGE_VERIFIER,
      relation: 'engagement_messages',
      recordId: MSG_A,
    });
    // The gate requires these two to be the same value; an attestation for one
    // row beside a citation of another would certify a verification that never
    // happened for the row being stored.
    expect(out.sourceVerification!.recordId).toBe(out.origin!.recordId);
    expect(out.sourceVerification!.relation).toBe(out.origin!.store);
    // The verifier identity is the contract's, not a local string.
    expect(PROSPECT_MESSAGE_VERIFIER).toBe('prospectProblems/verifyProspectMessage');
  });

  it('reads only, on every path, and never reaches the table API directly', async () => {
    seedVerifiableMessage();
    await verify();
    await verify({ messageId: 'no-such-message' });
    expect(db.mutations).toEqual([]);
    expect(PROSPECT_MESSAGE_VERIFICATION_PERFORMS_NO_WRITE).toBe(true);
    expect(PROSPECT_MESSAGE_VERIFICATION_VERSION).toBe('pi-prospect-message-verify.1');
  });

  it('the module itself carries no mutating call at all', () => {
    const src = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/prospectProblems/verifyProspectMessage.ts',
    ), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['insert', 'update', 'upsert', 'delete']) {
      expect({ verb, hit: new RegExp(`\\.\\s*${verb}\\s*\\(`).test(code) }).toEqual({ verb, hit: false });
    }
    // Guard the guard: a path that read nothing would pass the scan above.
    expect(code).toContain('ownedDbTable');
  });

  it('asserts the tenant on every relation that HAS one, and reads the untenanted one by id alone', async () => {
    seedVerifiableMessage();
    await verify();

    for (const table of ['engagement_messages', 'engagement_threads', 'contacts']) {
      const reads = selectsOn(table);
      expect(reads.length).toBeGreaterThan(0);
      for (const r of reads) {
        expect(r.filters.filter(([c, v]) => c === 'organization_id' && v === ORG_A).length)
          .toBeGreaterThanOrEqual(1);
      }
    }
    // `contacts` leads with the tenant, and names the whole UNIQUE triple.
    const contactRead = selectsOn('contacts')[0];
    expect(contactRead.filters[0]).toEqual(['organization_id', ORG_A]);
    expect(contactRead.filters).toEqual([
      ['organization_id', ORG_A], ['platform', 'linkedin'], ['platform_user_id', 'li-alex'],
    ]);
    // `engagement_authors` has NO tenant column, so it is read ONLY by an id
    // that came out of the tenant-established message — never by identity.
    expect(selectsOn('engagement_authors').map((r) => r.filters)).toEqual([[['id', AUTHOR_A]]]);
    // And nothing selects a column this capability has no business reading.
    for (const r of db.selects) expect(r.cols).not.toBe('*');
  });

  it('records `direction` as context and does not depend on it: a NULL direction still verifies', async () => {
    seedVerifiableMessage({ message: { direction: null } });

    const out = await verify();

    expect(out.verified).toBe(true);
    expect(out.directionAsStored).toBeNull();
    expect(out.statement).toBe(DERIVED_STATEMENT);
  });

  it('never truncates or summarises: a long statement arrives whole', async () => {
    const long = `${'the exports time out whenever finance runs the month-end batch. '.repeat(12)}done`;
    seedVerifiableMessage({ message: { content: long } });

    const out = await verify();

    expect(out.verified).toBe(true);
    expect(out.statement).toBe(long.replace(/\s+/g, ' ').trim());
    expect(out.statement!.length).toBeGreaterThan(600);
    expect(out.statement).not.toMatch(/\.\.\.$|…$/);
  });

  it('cannot be influenced by caller input: the derived values come from the ROW', async () => {
    seedVerifiableMessage();

    // Everything a caller might wish it could supply, supplied. The parameter
    // list has no home for any of it, and the derivation ignores all of it.
    const out = await verify({
      statement: 'a sentence nobody said',
      observedAt: '1999-01-01T00:00:00.000Z',
      origin: { store: 'crm_call_notes', recordId: 'forged' },
      sourceVerification: { verifier: 'forged', relation: 'forged', recordId: 'forged' },
      content: 'also not this',
      platform_created_at: '1999-01-01T00:00:00.000Z',
    });

    expect(out.statement).toBe(DERIVED_STATEMENT);
    expect(out.observedAt).toBe(OBSERVED_AT);
    expect(out.origin).toEqual({ store: 'engagement_messages', recordId: MSG_A });
    expect(out.sourceVerification).toEqual({
      verifier: PROSPECT_MESSAGE_VERIFIER, relation: 'engagement_messages', recordId: MSG_A,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · TENANCY IS THE THREAD, IN BOTH SCHEMA STATES
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · thread-first tenancy, and a tenant predicate that never fails open', () => {
  it('attempts the tenant predicate on the message when the column exists', async () => {
    seedVerifiableMessage();
    await verify();

    const reads = selectsOn('engagement_messages');
    expect(reads).toHaveLength(1);
    expect(reads[0].cols).toContain('organization_id');
    expect(reads[0].filters).toEqual([['id', MSG_A], ['organization_id', ORG_A]]);
  });

  it('relaxes ONLY the predicate when the tenant column is absent — the thread is still the tenancy', async () => {
    // `20261221000000` UNAPPLIED. The column raises 42703, which is an illegible
    // relation rather than a verdict about the evidence.
    db.missingColumns.engagement_messages = ['organization_id'];
    seedVerifiableMessage({ message: { organization_id: undefined } });

    const out = await verify();

    expect(out.verified).toBe(true);
    const reads = selectsOn('engagement_messages');
    expect(reads).toHaveLength(2);
    // Attempt 1 asked for the tenant. Attempt 2 did not ask for a column that
    // does not exist, and asked for nothing else either.
    expect(reads[0].filters).toEqual([['id', MSG_A], ['organization_id', ORG_A]]);
    expect(reads[1].filters).toEqual([['id', MSG_A]]);
    expect(reads[1].cols).not.toContain('organization_id');
    // The relaxation is recorded rather than silent.
    expect(logs.map((l) => l.event)).toContain('prospect_message_tenant_column_illegible');
    // And the thread read that IS the tenancy still carried it.
    expect(selectsOn('engagement_threads')[0].filters)
      .toEqual([['id', THREAD_A], ['organization_id', ORG_A]]);
  });

  it('a thread in another tenant is NOT FOUND, and the distinction survives only in the log', async () => {
    seedSpine();
    seedThread({ organization_id: ORG_B });
    seedMessage({ organization_id: ORG_B });
    seedAuthor();
    seedContact();

    const out = await verify();

    expect(out.verified).toBe(false);
    expect(out.refusal).toBe('source_message_not_found');
    // A transport must not be able to tell absent from another tenant's.
    expect(out.detail).toBe('no such message is readable for this tenant');
    expect(out.detail).not.toContain(ORG_B);
    expect(out.detail).not.toMatch(/tenant'?s|another tenant/);
    // ...and the distinction is kept where it is useful and harmless.
    expect(out.internalDetail).toMatch(/another tenant/);
    expect(logs.map((l) => l.event)).toContain('prospect_message_not_found');
  });

  it('drops a foreign-tenant thread row even when the query does not filter', async () => {
    // The predicate is what makes the read correct; the re-assertion is what
    // keeps it correct if the read is ever edited wrongly.
    seedSpine();
    seedThread({ organization_id: ORG_B });
    seedMessage();
    seedAuthor();
    seedContact();
    db.ignoreFilters = true;

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_message_not_found' });
    expect(out.internalDetail).toMatch(/another tenant/);
  });

  it('refuses a message that does not belong to the thread that was read under this tenant', async () => {
    seedSpine();
    seedThread();
    // The message points at a DIFFERENT thread; only an unfiltered read could
    // ever pair them, and the explicit comparison is what refuses the pairing.
    seedMessage({ thread_id: THREAD_C });
    seedAuthor();
    seedContact();
    db.ignoreFilters = true;

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_message_not_found' });
    expect(out.internalDetail).toMatch(/does not belong to the thread/);
  });

  it('refuses a message row whose own tenant column disagrees with the verified tenant', async () => {
    seedSpine();
    seedThread();
    seedMessage({ organization_id: ORG_B });
    seedAuthor();
    seedContact();
    db.ignoreFilters = true;

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_message_not_found' });
    expect(out.internalDetail).toMatch(/different tenant/);
  });

  it('an absent message is not found, and a message with no thread cannot be tenanted', async () => {
    seedSpine();
    seedThread();
    seedAuthor();
    seedContact();

    expect(await verify({ messageId: 'no-such-message' }))
      .toMatchObject({ verified: false, refusal: 'source_message_not_found' });

    seedMessage({ thread_id: null });
    expect(await verify()).toMatchObject({ verified: false, refusal: 'source_message_not_found' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · AUTHORSHIP IS ESTABLISHED, NEVER INFERRED FROM `direction`
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · positively prospect-authored', () => {
  it('refuses a message with no author at all', async () => {
    seedVerifiableMessage({ message: { author_id: null } });

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    expect(out.detail).toMatch(/names no author/);
    // Nothing was asked of the identity tables once authorship failed.
    expect(selectsOn('engagement_authors')).toEqual([]);
    expect(selectsOn('contacts')).toEqual([]);
  });

  it("refuses `direction = 'outgoing'` — the workspace talking is not the prospect talking", async () => {
    seedVerifiableMessage({ message: { direction: 'outgoing' } });

    expect(await verify())
      .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
  });

  it('refuses a message authored by one of the workspace\'s own connected accounts', async () => {
    // Each of the three shapes the canonical self predicate recognises, so a
    // workspace-authored row is refused however the ingester recorded it.
    const shapes: Row[] = [
      { raw_payload: { author_self: true } },
      { raw_payload: { sender_self: true } },
      { content: 'You: thanks, I will send that over' },
      {
        platform: 'linkedin',
        platform_message_id: 'urn:li:msg_message:(urn:li:fsd_profile:li-us,2-abc)',
        raw_payload: { sender_username: 'li-us' },
      },
    ];

    for (const message of shapes) {
      db.tables = {};
      seedVerifiableMessage({ message });
      expect(await verify())
        .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    }
  });

  it("`direction = 'inbound'` alone is NOT sufficient — it is a column default as often as a fact", async () => {
    // Everything else about this row is wrong, and `inbound` does not rescue it:
    // the author's platform identity resolves to a different canonical person.
    seedVerifiableMessage({
      message: { direction: 'inbound' },
      contact: { unified_person_id: PERSON_C },
    });

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    expect(out.detail).toMatch(/different canonical person/);
  });

  it('refuses an author whose platform identity is not a known contact in this tenant', async () => {
    seedSpine();
    seedThread();
    seedMessage();
    seedAuthor();
    // No `contacts` row at all: the identity resolves to nobody.
    expect(await verify())
      .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
  });

  it('refuses an author that cannot be read, or that carries no usable platform identity', async () => {
    seedSpine();
    seedThread();
    seedMessage();
    seedContact();
    // No author row for the id the message names.
    expect(await verify())
      .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });

    // A blank provider id is not an identity: it would otherwise match every
    // other author that is also missing one.
    db.tables = {};
    seedVerifiableMessage({ author: { platform_user_id: '   ' } });
    const out = await verify();
    expect(out).toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    expect(out.detail).toMatch(/no usable platform identity/);
  });

  it('refuses a contact row that came back under another tenant', async () => {
    seedVerifiableMessage({ contact: { organization_id: ORG_B } });
    db.ignoreFilters = true;

    expect(await verify())
      .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
  });

  it('refuses a THIRD PARTY posting in the prospect\'s own thread', async () => {
    // The thread IS the prospect's. The words are not: `message_type` defaults
    // to 'comment', so a thread is not single-author, and the thread link alone
    // would attribute a stranger's sentence to the prospect.
    seedSpine();
    seedThread({ unified_person_id: PERSON_A });
    seedMessage({ author_id: AUTHOR_C });
    seedAuthor({ id: AUTHOR_C, platform_user_id: 'li-stranger' });
    seedContact({
      id: 'contact-c', platform_user_id: 'li-stranger', unified_person_id: PERSON_C,
    });

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    expect(out.detail).toMatch(/different canonical person/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · THE SUBJECT, AND THE SUBJECT KIND
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · the subject must be the thread\'s own person', () => {
  it('refuses the prospect speaking in SOMEONE ELSE\'S thread', async () => {
    // Authorship holds — this really is the prospect — and the thread does not,
    // so the statement would be filed against a conversation nobody established
    // belongs to them. Step 2 and step 3 are each necessary.
    seedSpine();
    seedThread({ unified_person_id: PERSON_C });
    seedMessage();
    seedAuthor();
    seedContact();

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_subject_mismatch' });
    expect(out.detail).toMatch(/different canonical person/);
  });

  it('a NULL thread person is a refusal, not a fallback to the author\'s own resolution', async () => {
    seedVerifiableMessage({ thread: { unified_person_id: null } });

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_subject_mismatch' });
    expect(out.detail).toMatch(/resolves to no canonical person/);
  });

  it('refuses an ACCOUNT subject outright, before spending a single read', async () => {
    seedVerifiableMessage();

    const out = await verify({ subjectType: 'account', subjectId: ACCOUNT_A, personId: ACCOUNT_A });

    expect(out).toMatchObject({ verified: false, refusal: 'source_subject_mismatch' });
    expect(out.detail).toMatch(/thread resolves to a person and never to an account/);
    expect(out.detail).toMatch(/one employee speaking is not their company speaking/);
    // Decidable from the request alone, so nothing was spent on it.
    expect(db.selects).toEqual([]);
  });

  it('refuses a subject that is not the person it resolved to, and a missing person', async () => {
    seedVerifiableMessage();

    expect(await verify({ subjectId: PERSON_C }))
      .toMatchObject({ verified: false, refusal: 'source_subject_mismatch' });
    expect(await verify({ personId: '   ' }))
      .toMatchObject({ verified: false, refusal: 'source_subject_mismatch' });
    expect(db.selects).toEqual([]);
  });

  it('requires the verified tenant and refuses an empty message id without reading', async () => {
    await expect(verify({ organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    expect(await verify({ messageId: '' }))
      .toMatchObject({ verified: false, refusal: 'source_message_not_found' });
    expect(db.selects).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · THE STATEMENT AND THE INSTANT ARE DERIVED, OR REFUSED
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · an absence is refused and never filled in', () => {
  it('refuses an empty statement, however it is empty', async () => {
    for (const content of [null, '', '   ', '\n\t  \n', 'Alex:   ']) {
      db.tables = {};
      seedVerifiableMessage({ message: { content } });
      const out = await verify();
      expect({ content, refusal: out.refusal })
        .toEqual({ content, refusal: 'source_statement_absent' });
      expect(out.statement).toBeNull();
    }
  });

  it('refuses an absent source instant and substitutes NO clock', async () => {
    seedVerifiableMessage({ message: { platform_created_at: null } });

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_observation_time_absent' });
    expect(out.observedAt).toBeNull();
    // The row DOES carry our clocks. None of them was read.
    expect(rowsOf('engagement_messages')[0].created_at).toBe(OUR_CLOCK);
    expect(out.detail).toMatch(/our own clock is never substituted/);
  });

  it('refuses an unparseable source instant rather than guessing at it', async () => {
    for (const platform_created_at of ['not a date', '', '0000-13-45T99:99:99Z']) {
      db.tables = {};
      seedVerifiableMessage({ message: { platform_created_at } });
      expect({ platform_created_at, refusal: (await verify()).refusal })
        .toEqual({ platform_created_at, refusal: 'source_observation_time_absent' });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · AN UNREAD RELATION IS NOT A VERDICT ABOUT THE EVIDENCE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · a read failure is `store_unavailable`, never a refusal', () => {
  it.each([
    ['engagement_messages', { code: '42P01', message: 'relation "engagement_messages" does not exist' }],
    ['engagement_threads', { code: 'PGRST205', message: 'could not find the table in the schema cache' }],
    ['engagement_authors', { code: '42703', message: 'column does not exist' }],
    ['contacts', { code: '08006', message: 'connection failure' }],
    // The attested-identity registry. An unreadable registry is NOT an empty
    // registry: it is the one read on this path where "we could not look" and
    // "nobody is owned" would otherwise be the same value, which is the
    // fail-open this read replaces.
    [ATTESTED_ENGAGEMENT_IDENTITY_RELATION, { code: '42P01', message: 'relation does not exist' }],
  ])('%s unreadable → store_unavailable', async (table, error) => {
    seedVerifiableMessage();
    db.readErrors[table] = error as { code?: string; message?: string };

    const out = await verify();

    expect(out.verified).toBe(false);
    expect(out.refusal).toBe('store_unavailable');
    // "we could not look" and "this is not evidence" are different answers, and
    // only the first is worth retrying.
    expect(out.refusal).not.toBe('source_message_not_found');
    expect(out.refusal).not.toBe('source_not_prospect_authored');
  });

  it('a thrown transport is `store_unavailable` and not an exception out of the verifier', async () => {
    seedVerifiableMessage();
    db.throwOn = 'engagement_threads';

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'store_unavailable' });
    expect(out.detail).toMatch(/transport exploded/);
  });

  it('an illegible tenant column that persists on retry is unavailable, not a verified read', async () => {
    db.missingColumns.engagement_messages = ['organization_id', 'id'];
    seedVerifiableMessage();

    expect(await verify()).toMatchObject({ verified: false, refusal: 'store_unavailable' });
  });

  it('the default port is the one that touches a database, and it is the owned seam', async () => {
    seedVerifiableMessage();
    const out = await verifyProspectMessage({
      organizationId: ORG_A, messageId: MSG_A, subjectType: 'person',
      subjectId: PERSON_A, personId: PERSON_A,
    }, defaultProspectMessagePorts);
    expect(out.verified).toBe(true);
    expect(typeof defaultProspectMessagePorts.readRow).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · THE SEAM: ONE VERIFIED ENTRY POINT, NO SECOND VALIDATOR OR WRITER
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-3G · the capture seam, wired to the verification', () => {
  const recorded: ProblemObservationInput[] = [];
  const verifyCalls: Array<Record<string, unknown>> = [];

  const stubPorts = (
    verification: Partial<ProspectMessageVerification>,
  ): VerifiedMessageCapturePorts => ({
    record: async (input) => {
      recorded.push(input);
      return { ok: true, observationId: 'ppo-1', duplicate: false };
    },
    read: async () => ({ state: 'available', detail: null, observations: [] }),
    verify: async (args) => {
      verifyCalls.push(args as unknown as Record<string, unknown>);
      return {
        verified: false,
        statement: null,
        observedAt: null,
        origin: null,
        sourceVerification: null,
        directionAsStored: null,
        refusal: null,
        detail: 'stub',
        internalDetail: 'stub',
        ...verification,
      } as ProspectMessageVerification;
    },
  });

  const verifiedStub = (over: Partial<ProspectMessageVerification> = {}) => stubPorts({
    verified: true,
    statement: DERIVED_STATEMENT,
    observedAt: OBSERVED_AT,
    origin: { store: 'engagement_messages', recordId: MSG_A },
    sourceVerification: {
      verifier: PROSPECT_MESSAGE_VERIFIER, relation: 'engagement_messages', recordId: MSG_A,
    },
    directionAsStored: 'inbound',
    refusal: null,
    detail: 'ok',
    internalDetail: 'ok',
    ...over,
  });

  const fromMessage = (
    over: Record<string, unknown> = {},
    ports?: VerifiedMessageCapturePorts,
  ): Promise<RecordProblemObservationResult> => recordProspectProblemFromMessage({
    organizationId: ORG_A, prospectId: LEAD_A, messageId: MSG_A, subjectType: 'person', ...over,
  } as never, ports);

  beforeEach(() => { recorded.length = 0; verifyCalls.length = 0; });

  it('takes an id and NOTHING about the statement, and asks the verifier for exactly that', async () => {
    seedSpine();

    // Caller input that has no home in the parameter list, supplied anyway.
    await fromMessage({
      statement: 'a sentence nobody said',
      observedAt: '1999-01-01T00:00:00.000Z',
      origin: { store: 'crm_call_notes', recordId: 'forged' },
      confidence: 0.99,
      statementLanguage: 'xx',
      recordedByUserId: 'user-a',
      originKind: 'human',
      sourceVerification: { verifier: 'forged', relation: 'forged', recordId: 'forged' },
    }, verifiedStub());

    // The verification was asked about one message and one subject, and about
    // nothing a caller said.
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]).toEqual({
      organizationId: ORG_A,
      messageId: MSG_A,
      subjectType: 'person',
      subjectId: PERSON_A,
      personId: PERSON_A,
    });
  });

  it('hands the gate the DERIVED candidate and the server-set attestation, never the caller\'s', async () => {
    seedSpine();

    await fromMessage({
      statement: 'a sentence nobody said',
      observedAt: '1999-01-01T00:00:00.000Z',
      origin: { store: 'crm_call_notes', recordId: 'forged' },
      confidence: 0.99,
      sourceVerification: { verifier: 'forged', relation: 'forged', recordId: 'forged' },
    }, verifiedStub());

    expect(gateCalls).toHaveLength(1);
    const candidate = gateCalls[0] as {
      statement: string; observedAt: string; confidence: unknown; derivedFrom: string;
      origin: { store: string; recordId: string };
      sourceVerification: { verifier: string; relation: string; recordId: string };
    };
    expect(candidate.statement).toBe(DERIVED_STATEMENT);
    expect(candidate.observedAt).toBe(OBSERVED_AT);
    expect(candidate.origin).toEqual({ store: 'engagement_messages', recordId: MSG_A });
    // The source reports neither, so neither is invented.
    expect(candidate.confidence).toBeNull();
    // Set by the seam, never taken from a caller.
    expect(candidate.derivedFrom).toBe('prospect_statement');
    expect(candidate.sourceVerification).toEqual({
      verifier: PROSPECT_MESSAGE_VERIFIER, relation: 'engagement_messages', recordId: MSG_A,
    });
    // The gate's own requirement: the attestation names the row being cited.
    expect(candidate.sourceVerification.recordId).toBe(candidate.origin.recordId);
    expect(candidate.sourceVerification.relation).toBe(VERIFIED_MESSAGE_ORIGIN_STORE);
  });

  it('the UNVERIFIED path carries no attestation at all', async () => {
    seedSpine();

    await recordProspectProblemObservation({
      organizationId: ORG_A,
      prospectId: LEAD_A,
      subjectType: 'person',
      statement: 'the exports time out at month end',
      statementLanguage: 'en',
      origin: { store: 'crm_call_notes', recordId: 'call-1' },
      originKind: 'provider',
      recordedByUserId: null,
      sourceRecordId: null,
      observedAt: OBSERVED_AT,
      confidence: null,
      // A caller cannot smuggle one in: the field is a parameter of a private
      // function and is never read off an input.
      sourceVerification: {
        verifier: PROSPECT_MESSAGE_VERIFIER, relation: 'engagement_messages', recordId: MSG_A,
      },
    } as never, {
      record: async (input) => { recorded.push(input); return { ok: true, observationId: 'x', duplicate: false }; },
      read: async () => ({ state: 'available', detail: null, observations: [] }),
    });

    expect(gateCalls).toHaveLength(1);
    expect((gateCalls[0] as { sourceVerification?: unknown }).sourceVerification).toBeUndefined();
  });

  it('either stores the derived row, or is refused BY THE GATE and stores nothing', async () => {
    seedSpine();

    const res = await fromMessage({}, verifiedStub());

    if (gateAdmitsVerifiedMessages()) {
      // The companion change in `problemFit.ts` has landed: the same wiring now
      // reaches the repository, and what it stores is what was derived.
      expect(res.ok).toBe(true);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        organizationId: ORG_A,
        prospectId: LEAD_A,
        subjectType: 'person',
        subjectId: PERSON_A,
        statement: DERIVED_STATEMENT,
        observedAt: OBSERVED_AT,
        origin: { store: 'engagement_messages', recordId: MSG_A },
        // The storage CHECK enforces this pairing.
        originKind: 'provider',
        recordedByUserId: null,
        // The source reports neither.
        confidence: null,
        statementLanguage: null,
        sourceRecordId: null,
      });
    } else {
      // It has NOT landed, and this is the honest end state today: the audit
      // refuses `engagement_messages` as a universal claim, the attestation is
      // carried but not yet read, and NOTHING is stored on a refusal.
      expect(res).toMatchObject({ ok: false, refusal: 'inadmissible_evidence' });
      expect(recorded).toEqual([]);
      const rejections = (res as { rejections: Array<{ field: string; reason: string }> }).rejections;
      expect(rejections.some((r) => r.field === 'origin' && /engagement_messages/.test(r.reason))).toBe(true);
    }
  });

  it('returns a verification refusal unmodified and never reaches the repository', async () => {
    const cases = [
      'source_message_not_found', 'source_not_prospect_authored', 'source_subject_mismatch',
      'source_statement_absent', 'source_observation_time_absent', 'store_unavailable',
    ] as const;

    for (const refusal of cases) {
      db.tables = {}; recorded.length = 0; logs.length = 0;
      seedSpine();
      const res = await fromMessage({}, stubPorts({
        verified: false, refusal, detail: 'public detail', internalDetail: 'private detail',
      }));

      expect(res).toMatchObject({ ok: false, refusal, detail: 'public detail' });
      expect(recorded).toEqual([]);
      // The internal half goes to the log and nowhere else.
      const logged = logs.find((l) => l.event === 'problem_observation_message_unverified');
      expect(logged?.ctx.detail).toBe('private detail');
      expect(JSON.stringify(res)).not.toContain('private detail');
    }
  });

  it('a thrown verification is `store_unavailable`, and nothing is stored', async () => {
    seedSpine();
    const ports = verifiedStub();
    const res = await fromMessage({}, {
      ...ports,
      verify: async () => { throw new Error('verifier exploded'); },
    });

    expect(res).toMatchObject({ ok: false, refusal: 'store_unavailable' });
    expect(recorded).toEqual([]);
  });

  it('resolves the subject with the SAME resolver, and refuses an unresolvable prospect', async () => {
    // No spine at all: the prospect cannot be resolved, so nothing is verified.
    const res = await fromMessage({}, verifiedStub());

    expect(res).toMatchObject({ ok: false, refusal: 'subject_not_found' });
    expect(verifyCalls).toEqual([]);
    expect(recorded).toEqual([]);
    // The resolver that ran is the existing one: the same two spine reads, with
    // the tenant as a predicate on each.
    expect(db.selects.map((s) => s.table)).toEqual(['canonical_leads']);
    expect(db.selects[0].filters).toContainEqual(['company_id', ORG_A]);
  });

  it('refuses a cross-tenant prospect and never asks the verifier about the message', async () => {
    seedSpine({ org: ORG_B });

    const res = await fromMessage({}, verifiedStub());

    expect(res.ok).toBe(false);
    expect(verifyCalls).toEqual([]);
  });

  it('decides the request-only refusals BEFORE any read, on both entry points', async () => {
    seedSpine();

    for (const over of [
      { prospectId: '  ' },
      { subjectType: 'neither' },
      { messageId: '   ' },
    ]) {
      db.selects = [];
      const res = await fromMessage(over, verifiedStub());
      expect(res.ok).toBe(false);
      // Decidable from the request alone, so nothing was spent on it.
      expect(db.selects).toEqual([]);
      expect(verifyCalls).toEqual([]);
    }

    // And the shared helper still guards the supplied-statement path first: the
    // self-citing origin and the incoherent actor are refused before a read.
    db.selects = [];
    expect(await recordProspectProblemObservation({
      organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
      statement: 'x', statementLanguage: null,
      origin: { store: 'prospect_problem_observations', recordId: 'r' },
      originKind: 'provider', recordedByUserId: null, sourceRecordId: null,
      observedAt: OBSERVED_AT, confidence: null,
    })).toMatchObject({ ok: false, refusal: 'self_attributed_origin' });
    expect(db.selects).toEqual([]);

    expect(await recordProspectProblemObservation({
      organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
      statement: 'x', statementLanguage: null,
      origin: { store: 'crm_call_notes', recordId: 'r' },
      originKind: 'provider', recordedByUserId: 'user-a', sourceRecordId: null,
      observedAt: OBSERVED_AT, confidence: null,
    })).toMatchObject({ ok: false, refusal: 'origin_actor_incoherent' });
    expect(db.selects).toEqual([]);
  });

  it('requires the verified tenant, and refuses an ACCOUNT subject through the seam too', async () => {
    await expect(fromMessage({ organizationId: '  ' }, verifiedStub()))
      .rejects.toThrow(/organizationId is required/);

    db.tables = {};
    seedSpine();
    // The seam resolves the account subject and the VERIFIER refuses it: an
    // engagement message cannot support a company-attributed statement.
    const res = await recordProspectProblemFromMessage(
      { organizationId: ORG_A, prospectId: LEAD_A, messageId: MSG_A, subjectType: 'account' },
      defaultVerifiedMessageCapturePorts,
    );
    expect(res).toMatchObject({ ok: false, refusal: 'source_subject_mismatch' });
  });

  it('the seam still writes nothing itself, and its default ports are the real ones', async () => {
    seedVerifiableMessage();
    await recordProspectProblemFromMessage(
      { organizationId: ORG_A, prospectId: LEAD_A, messageId: MSG_A, subjectType: 'person' },
      defaultVerifiedMessageCapturePorts,
    );

    // The ONLY mutation that can happen anywhere on this path is the
    // repository's, on the relation the repository owns. The seam delegates and
    // the verifier reads: no engagement table and no identity table is ever
    // written, whatever the gate decides about the candidate.
    expect(db.mutations.filter((m) => m.table !== 'prospect_problem_observations')).toEqual([]);
    for (const m of db.mutations) expect(m.op).toBe('insert');
    expect(db.mutations).toHaveLength(gateAdmitsVerifiedMessages() ? 1 : 0);
    expect(PROBLEM_OBSERVATION_INGESTION_PERFORMS_NO_WRITE).toBe(true);
    expect(defaultVerifiedMessageCapturePorts.verify).toBe(verifyProspectMessage);
    expect(typeof defaultVerifiedMessageCapturePorts.record).toBe('function');
    expect(typeof defaultVerifiedMessageCapturePorts.read).toBe('function');
    // The verification really ran against the relation, end to end, and in the
    // order the module argues for: subject, then tenancy, then authorship.
    expect(db.selects.map((s) => s.table).slice(0, 6)).toEqual([
      'canonical_leads', 'unified_persons',
      'engagement_messages', 'engagement_threads', 'engagement_authors', 'contacts',
    ]);
  });

  it('adds no second writer: the only mutation available to this path is the repository port', () => {
    const src = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/prospectProblems/problemObservationIngestion.ts',
    ), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['insert', 'update', 'upsert', 'delete']) {
      expect({ verb, hit: new RegExp(`\\.\\s*${verb}\\s*\\(`).test(code) }).toEqual({ verb, hit: false });
    }
    // One gate, one repository port, one subject resolver — no second anything.
    expect(code.match(/admitProspectProblem\(/g)).toHaveLength(1);
    expect(code.match(/ports\.record\(/g)).toHaveLength(1);
    expect(code.match(/async function resolveSubject/g)).toHaveLength(1);
    expect(code).not.toMatch(/assessProblemFitReadiness/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · THE AUTHOR IS ONE OF THIS WORKSPACE'S OWN ATTESTED IDENTITIES
// ═══════════════════════════════════════════════════════════════════════════
/**
 * `isAuthorSelf` reads the MESSAGE's self-authorship hints and returns false on
 * ambiguity, so a workspace-operated account whose rows carry no hint passes it.
 * The attested-identity registry is the other half: a stated, revocable,
 * tenant-scoped record that one ENGAGEMENT identity belongs to this
 * organization. It is NEGATIVE evidence only, and it is read in the namespace
 * `engagement_authors` is actually written in.
 *
 * MODELLED, NOT VERIFIED: `attested_engagement_identities` has no migration in
 * this tree, so its columns, its uniqueness and its RLS are represented by the
 * double. What IS verified here is this module's behaviour given each shape the
 * relation can answer with.
 */
describe('WS-3G · an attested owned identity refuses the capture', () => {
  const ATT_A = 'att-a';

  /** One attestation, ACTIVE unless `revoked_at` is overridden. */
  const seedAttestation = (over: Row = {}): Row => {
    const row: Row = {
      id: ATT_A,
      organization_id: ORG_A,
      platform: 'linkedin',
      platform_user_id: 'li-alex',
      attested_as: 'tenant_own',
      statement: 'this is our own outreach account',
      attested_by_user_id: 'user-admin',
      attested_at: OUR_CLOCK,
      revoked_at: null,
      revoked_by_user_id: null,
      revoked_reason: null,
      ...over,
    };
    rowsOf(ATTESTED_ENGAGEMENT_IDENTITY_RELATION).push(row);
    return row;
  };

  const registryReads = () => selectsOn(ATTESTED_ENGAGEMENT_IDENTITY_RELATION);

  it('refuses a capture whose every prior check PASSED, and the registry is the only reason', async () => {
    // The adversarial world: the attested identity is ALSO a `contacts` row that
    // resolves to the selected person, so authorship, tenancy, the subject link
    // and the identity resolution all demonstrably hold. Nothing but the
    // attestation stands between this row and a stored observation.
    seedVerifiableMessage();
    seedAttestation();

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    // No new refusal member: the author IS one of this workspace's own
    // connected accounts, which is what this member already documents.
    expect(out.detail).toBe('the message was authored by this workspace, not by the prospect');
    // The registry fact is internal. A caller cannot act differently on it, and
    // publishing it would say which identities a tenant has registered.
    expect(out.internalDetail).toMatch(/registered owned identity/);
    expect(out.detail).not.toMatch(/attest|registr|owned identity/i);
    expect(logs.map((l) => l.event)).toContain('prospect_message_author_is_attested_identity');
    // Nothing was stored, and nothing was derived.
    expect(out.statement).toBeNull();
    expect(out.observedAt).toBeNull();
    expect(out.sourceVerification).toBeNull();
    expect(db.mutations).toEqual([]);

    // EVERY PRIOR READ RAN, AND RAN CORRECTLY — so this really is a refusal of a
    // row that passed all of them, not a short circuit somewhere earlier.
    expect(db.selects.map((s) => s.table)).toEqual([
      'engagement_messages', 'engagement_threads', 'engagement_authors', 'contacts',
      ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
    ]);
    expect(selectsOn('engagement_messages')[0].filters)
      .toEqual([['id', MSG_A], ['organization_id', ORG_A]]);
    expect(selectsOn('engagement_threads')[0].filters)
      .toEqual([['id', THREAD_A], ['organization_id', ORG_A]]);
    expect(selectsOn('engagement_authors')[0].filters).toEqual([['id', AUTHOR_A]]);
    expect(selectsOn('contacts')[0].filters).toEqual([
      ['organization_id', ORG_A], ['platform', 'linkedin'], ['platform_user_id', 'li-alex'],
    ]);
    // ...and the registry read is tenant-scoped, bounded to the ONE identity in
    // hand, and asks for ACTIVE rows only.
    expect(registryReads()).toHaveLength(1);
    expect(registryReads()[0].filters).toEqual([
      ['organization_id', ORG_A],
      ['platform', 'linkedin'],
      ['platform_user_id', 'li-alex'],
      ['revoked_at', null],
    ]);
    expect(registryReads()[0].cols).not.toBe('*');
  });

  it('SAME WORLD, OPPOSITE VERDICTS: only the registry row differs', async () => {
    // One test, two runs, one difference. Without the pair, "the attestation is
    // what refused it" is an inference rather than an observation.
    seedVerifiableMessage();
    const unregistered = await verify();

    seedAttestation();
    const registered = await verify();

    expect(unregistered.verified).toBe(true);
    expect(unregistered.statement).toBe(DERIVED_STATEMENT);
    expect(registered.verified).toBe(false);
    expect(registered.refusal).toBe('source_not_prospect_authored');
    // The world is otherwise identical: the same message, the same author, the
    // same contact, the same thread, read in the same order both times.
    expect(rowsOf('engagement_messages')).toHaveLength(1);
    expect(rowsOf('contacts')).toHaveLength(1);
    expect(registryReads()).toHaveLength(2);
  });

  it('an EMPTY registry changes nothing: the unregistered author still verifies', async () => {
    // "No match" is not proof of external authorship, and it is not a refusal
    // either. The baseline verification is exactly what it was.
    seedVerifiableMessage();
    rowsOf(ATTESTED_ENGAGEMENT_IDENTITY_RELATION);   // present and empty

    const out = await verify();

    expect(out.verified).toBe(true);
    expect(out.refusal).toBeNull();
    expect(out.statement).toBe(DERIVED_STATEMENT);
    expect(out.observedAt).toBe(OBSERVED_AT);
    // It still ASKED. An unregistered identity is not a skipped read.
    expect(registryReads()).toHaveLength(1);
  });

  it('another tenant\'s attestation does not exclude here, and the read carries THIS tenant', async () => {
    // The same identity, attested by ORG_B. An attestation is a statement by one
    // organization about its own accounts; it is not a global blocklist, and
    // honouring it here would let one tenant suppress another's evidence.
    seedVerifiableMessage();
    seedAttestation({ id: 'att-b', organization_id: ORG_B });

    const out = await verify();

    expect(out.verified).toBe(true);
    expect(registryReads()[0].filters).toContainEqual(['organization_id', ORG_A]);
    expect(registryReads()[0].filters.some(([, v]) => v === ORG_B)).toBe(false);
  });

  it('drops a foreign-tenant attestation row even when the query does not filter', async () => {
    // The predicate is what makes the read correct; the re-assertion is what
    // keeps it correct if the read is ever edited wrongly.
    seedVerifiableMessage();
    seedAttestation({ id: 'att-b', organization_id: ORG_B });
    db.ignoreFilters = true;

    expect((await verify()).verified).toBe(true);
  });

  it('REVOCATION flips the verdict within one world, and the registry is re-read every call', async () => {
    seedVerifiableMessage();
    const attestation = seedAttestation();

    const whileActive = await verify();
    expect(whileActive).toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });

    // Revoked IN PLACE. No table is reset and no row is removed, so a cached or
    // memoised owned set would keep refusing and this assertion would fail.
    attestation.revoked_at = '2026-10-28T12:00:00.000Z';
    attestation.revoked_by_user_id = 'user-admin';
    attestation.revoked_reason = 'the account was handed back';

    const afterRevocation = await verify();

    expect(afterRevocation.verified).toBe(true);
    expect(afterRevocation.statement).toBe(DERIVED_STATEMENT);
    // Once per call, both times: the read is not cached across calls.
    expect(registryReads()).toHaveLength(2);
    expect(rowsOf(ATTESTED_ENGAGEMENT_IDENTITY_RELATION)).toHaveLength(1);
  });

  it('a revoked attestation never excludes, whatever else the row says', async () => {
    seedVerifiableMessage();
    seedAttestation({ revoked_at: '2026-01-01T00:00:00.000Z', revoked_reason: 'wrong account' });
    db.ignoreFilters = true;       // the ACTIVE-ness is re-asserted on the DATA

    expect((await verify()).verified).toBe(true);
  });

  it('a registry whose `revoked_at` column is absent is store_unavailable, NOT a verified capture', async () => {
    // The behavioural half of the "do not relax this read" guard. A dropped
    // column or an unapplied migration must not read as "nobody is owned".
    seedVerifiableMessage();
    seedAttestation();
    db.missingColumns[ATTESTED_ENGAGEMENT_IDENTITY_RELATION] = ['revoked_at'];

    const out = await verify();

    expect(out).toMatchObject({ verified: false, refusal: 'store_unavailable' });
    expect(out.verified).toBe(false);
    expect(out.sourceVerification).toBeNull();
    expect(logs.map((l) => l.event)).toContain('prospect_message_owned_identity_read_unavailable');
  });

  it('an illegible tenant column on the registry is store_unavailable, and so is a thrown transport', async () => {
    seedVerifiableMessage();
    db.missingColumns[ATTESTED_ENGAGEMENT_IDENTITY_RELATION] = ['organization_id'];
    expect(await verify()).toMatchObject({ verified: false, refusal: 'store_unavailable' });

    db.missingColumns = {};
    db.throwOn = ATTESTED_ENGAGEMENT_IDENTITY_RELATION;
    expect(await verify()).toMatchObject({ verified: false, refusal: 'store_unavailable' });
  });

  it('the relaxation that exists for the MESSAGE read is applied in exactly one place', async () => {
    // STATIC GUARD. `isRelationIllegible` is correct for the message's tenant
    // predicate because the thread read supplies the tenancy independently. The
    // registry has no second source, so a relaxation there would convert an
    // unreadable registry into an empty one — the fail-open being replaced. One
    // call site, asserted on the source, so a second cannot arrive silently.
    const src = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/prospectProblems/verifyProspectMessage.ts',
    ), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/isRelationIllegible\s*\(/g)).toHaveLength(1);
    // The one site is the message read, and it is still there.
    expect(code).toMatch(/MESSAGE_COLUMNS_WITH_TENANT/);
    // Guard the guard: the symbol really is in this file.
    expect(code).toContain('isRelationIllegible');
  });

  it('the registry is read AFTER `contacts`, so a cheaper refusal never spends it', async () => {
    // An author that is not a contact of this tenant is already refused, and the
    // ordering is what makes that true rather than a coincidence.
    seedSpine();
    seedThread();
    seedMessage();
    seedAuthor();
    seedAttestation();
    // No `contacts` row at all.

    expect(await verify())
      .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    expect(registryReads()).toEqual([]);

    // ...and the same for an author that resolves to a different person.
    db.tables = {};
    seedVerifiableMessage({ contact: { unified_person_id: PERSON_C } });
    seedAttestation();
    expect(await verify())
      .toMatchObject({ verified: false, refusal: 'source_not_prospect_authored' });
    expect(registryReads()).toEqual([]);
  });

  it('the exclusion is not a substitute for any positive check', async () => {
    // With an EMPTY registry every refusal above is still exactly what it was.
    // "Not registered" is not "is the prospect".
    seedVerifiableMessage({ thread: { unified_person_id: PERSON_C } });
    expect(await verify()).toMatchObject({ refusal: 'source_subject_mismatch' });

    db.tables = {};
    seedVerifiableMessage({ message: { platform_created_at: null } });
    expect(await verify()).toMatchObject({ refusal: 'source_observation_time_absent' });

    db.tables = {};
    seedVerifiableMessage({ message: { content: '   ' } });
    expect(await verify()).toMatchObject({ refusal: 'source_statement_absent' });
  });

  it('the key it looks up is the CONTRACT\'s key, built from the author row', async () => {
    seedVerifiableMessage();
    await verify();

    const [, platform, identity] = registryReads()[0].filters.map(([, v]) => v);
    expect(engagementIdentityKey(platform as string, identity as string))
      .toBe(engagementIdentityKey('linkedin', 'li-alex'));
    // And the identity half is the author row's value, not a rewritten one.
    expect(identity).toBe(rowsOf('engagement_authors')[0].platform_user_id);
  });

  it('adds no write, and no second ownership source', () => {
    const src = fs.readFileSync(path.join(
      REPO_ROOT, 'backend/services/prospectProblems/verifyProspectMessage.ts',
    ), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['insert', 'update', 'upsert', 'delete']) {
      expect({ verb, hit: new RegExp(`\\.\\s*${verb}\\s*\\(`).test(code) }).toEqual({ verb, hit: false });
    }
    expect(PROSPECT_MESSAGE_VERIFICATION_PERFORMS_NO_WRITE).toBe(true);
    // The OAuth equivalence is not reachable from here, by name or by table.
    for (const forbidden of ['getOrgAuthorIds', 'social_accounts', 'user_company_roles']) {
      expect(code).not.toContain(forbidden);
    }
    // One normaliser: the contract's. Not the aliasing display helper.
    expect(code).not.toMatch(/constants\/platforms/);
    expect(code).toContain('engagementIdentityKey');
  });
});
