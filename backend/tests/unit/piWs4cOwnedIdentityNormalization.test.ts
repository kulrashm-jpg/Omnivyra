/**
 * PI WS-4C — THE OWNED-IDENTITY NORMALISATION CONTRACT.
 *
 * This suite exists because the registry can be WIRED CORRECTLY AND STILL
 * PROTECT NOTHING, and the failure is silent in both directions.
 *
 * ─── THE TWO COMPETING NORMALISERS ────────────────────────────────────────
 * `backend/constants/platforms.ts` ALIASES: `x` → `twitter`, `li` → `linkedin`,
 * `tw` → `twitter`, `meta` → `facebook`. It is the DISPLAY layer's normaliser.
 * `engagementNormalizationService` — the module that actually WROTE
 * `engagement_authors.platform` — declares its own local normaliser that trims
 * and lower-cases and does not alias, so a stored author row may legitimately
 * hold `'x'` or `'li'`.
 *
 * A registry built on the aliasing helper would store `'twitter'`, never
 * equality-match the `'x'` author row it was about, and report a clean read with
 * an empty owned set — a registry that looks correct, matches nothing, and
 * silently admits exactly the messages it was installed to refuse. Both
 * assertions below about `'x'` and `'li'` are therefore CONTRACT tests, not
 * incidental coverage: they fail the moment either module reaches for the
 * display normaliser.
 *
 * ─── THE TWO NAMESPACES ───────────────────────────────────────────────────
 * `engagement_authors.platform_user_id` is a profile URL, a handle, or an
 * `anon_*` fallback. `social_accounts.platform_user_id` is an OAuth-native
 * opaque id. They are DIFFERENT NAMESPACES, which is why
 * `engagementThreadService.getOrgAuthorIds` — which compares them — is true only
 * by accident. The fixtures here use visibly distinct shapes for the two and
 * assert that premise, so no test can pass by having quietly put one namespace's
 * value in the other's table.
 *
 * ─── WHAT IS MODELLED RATHER THAN VERIFIED ────────────────────────────────
 * There is no PostgreSQL and no migration for `attested_engagement_identities`
 * in this tree, so its columns, its uniqueness and its RLS are the double's.
 * What is VERIFIED is the normalisation both edited modules apply, and their
 * behaviour given each answer the relation can give.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  selects: [] as Array<{ table: string; cols: string; filters: Array<[string, unknown]> }>,
  /** Any non-select operation at all, so "this path writes nothing" is checkable. */
  mutations: [] as Array<{ table: string; op: string }>,
  readErrors: {} as Record<string, { code?: string; message?: string }>,
  throwOn: null as string | null,
  /** Columns the deployed schema does NOT have, by table; naming one raises 42703. */
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
      ins: [] as Array<[string, unknown[]]>,
      sortCol: null as string | null,
      cap: null as number | null,
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
        ...st.ins.map(([c]) => c),
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

      let found = db.ignoreFilters
        ? rowsOf(table).slice()
        : rowsOf(table).filter((r) => st.filters.every(([c, v]) => r[c] === v)
          && st.ins.every(([c, vs]) => vs.indexOf(r[c] as never) !== -1));

      if (st.sortCol !== null) {
        const col = st.sortCol;
        // Descending, NULLS LAST — what the production call asks for explicitly.
        found = [...found].sort((a, b) => {
          const x = a[col] === null || a[col] === undefined ? null : String(a[col]);
          const y = b[col] === null || b[col] === undefined ? null : String(b[col]);
          if (x === null && y === null) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          return y.localeCompare(x);
        });
      }
      if (st.cap !== null) found = found.slice(0, st.cap);

      return mode === 'many' ? { data: found, error: null } : { data: found[0] ?? null, error: null };
    };

    const b: Record<string, unknown> = {
      select: (c: string) => { st.cols = c; return b; },
      insert: () => { st.op = 'insert'; return b; },
      update: () => { st.op = 'update'; return b; },
      upsert: () => { st.op = 'upsert'; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      // `IS NULL` is a real predicate: it is the whole definition of an ACTIVE
      // attestation, so the double applies it rather than ignoring it.
      is: (c: string, v: unknown) => { st.filters.push([c, v]); return b; },
      in: (c: string, v: unknown[]) => { st.ins.push([c, v]); return b; },
      order: (c: string) => { st.sortCol = c; return b; },
      limit: (v: number) => { st.cap = v; return b; },
      single: () => exec('single'),
      maybeSingle: () => exec('single'),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec('many').then(res, rej),
    };
    return b;
  },
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => { throw new Error('this path must not reach the table API directly'); },
  },
}));

jest.mock('../../services/logger', () => ({
  logger: {
    warn: () => {}, error: () => {}, info: () => {}, debug: () => {},
  },
}));

import fs from 'fs';
import path from 'path';
import {
  ATTESTED_ENGAGEMENT_IDENTITY_RELATION,
  engagementIdentityKey,
  normalizeEngagementIdentity,
  normalizeEngagementPlatform,
} from '../../services/engagementIdentity/attestedIdentityContract';
import { normalizePlatform } from '../../constants/platforms';
import { verifyProspectMessage } from '../../services/prospectProblems/verifyProspectMessage';
import {
  ELIGIBLE_PROSPECT_MESSAGES_RELATIONS,
  readEligibleProspectMessages,
} from '../../services/prospectProblems/eligibleProspectMessages';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const VERIFIER_FILE = 'backend/services/prospectProblems/verifyProspectMessage.ts';
const PICKER_FILE = 'backend/services/prospectProblems/eligibleProspectMessages.ts';
const codeOf = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const REGISTRY = ATTESTED_ENGAGEMENT_IDENTITY_RELATION;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const LEAD_A = 'lead-a';
const PERSON_A = 'person-a';
const ACCOUNT_A = 'account-a';
const THREAD_A = 'thread-a';
const MSG_A = 'msg-a';
const AUTHOR_A = 'author-a';

const PLATFORM_CREATED_AT = '2026-09-14T08:15:00+00:00';
const CONTENT = 'our three dashboards disagree and nobody can say which one to take to the board';

/**
 * THE ENGAGEMENT NAMESPACE: what `engagement_authors.platform_user_id` holds for
 * a live LinkedIn writer — a profile URL whose path is CASE-SIGNIFICANT.
 */
const ENGAGEMENT_IDENTITY = 'https://www.linkedin.com/in/AbC123-Ada';
/** The same identity, lower-cased. A DIFFERENT identity, and not a match. */
const ENGAGEMENT_IDENTITY_LOWER = 'https://www.linkedin.com/in/abc123-ada';
/**
 * THE OAUTH NAMESPACE: what `social_accounts.platform_user_id` holds. Visibly a
 * different shape, and deliberately sharing a substring with the profile URL so
 * that "similar" is covered as well as "equal".
 */
const OAUTH_IDENTITY = 'urn:li:person:AbC123';

/** An `x`-platform world, for the aliasing regression. */
const X_IDENTITY = 'https://x.com/AdaProspect';

interface WorldOptions {
  readonly platform?: string;
  readonly identity?: string;
  /** `contacts.platform` as the verifier will ask for it: the TRIMMED author value. */
  readonly contactPlatform?: string;
}

/**
 * The whole verifiable world for one author identity: spine, thread, message,
 * author, and the `contacts` row that resolves that identity to the person.
 *
 * The `contacts` row is seeded with the author's platform TRIMMED AND NOT
 * CASE-FOLDED, because that is what the pre-existing contacts predicate asks
 * for. Nothing here changes that read; the registry read is the one being
 * characterised.
 */
const seedWorld = (over: WorldOptions = {}): void => {
  const platform = over.platform ?? 'linkedin';
  const identity = over.identity ?? ENGAGEMENT_IDENTITY;
  const contactPlatform = over.contactPlatform ?? platform.trim();

  rowsOf('canonical_leads').push({ id: LEAD_A, company_id: ORG_A, unified_person_id: PERSON_A });
  rowsOf('unified_persons').push({ id: PERSON_A, company_id: ORG_A, account_id: ACCOUNT_A });
  rowsOf('prospect_accounts').push({ id: ACCOUNT_A, organization_id: ORG_A });
  rowsOf('engagement_threads').push({
    id: THREAD_A, platform: contactPlatform, organization_id: ORG_A, unified_person_id: PERSON_A,
  });
  rowsOf('engagement_messages').push({
    id: MSG_A,
    organization_id: ORG_A,
    thread_id: THREAD_A,
    author_id: AUTHOR_A,
    platform: contactPlatform,
    platform_message_id: 'urn:li:comment:(123,456)',
    message_type: 'comment',
    content: CONTENT,
    raw_payload: {},
    direction: 'inbound',
    platform_created_at: PLATFORM_CREATED_AT,
  });
  rowsOf('engagement_authors').push({
    id: AUTHOR_A, platform, platform_user_id: identity,
  });
  rowsOf('contacts').push({
    id: 'contact-a',
    organization_id: ORG_A,
    platform: contactPlatform,
    platform_user_id: identity,
    unified_person_id: PERSON_A,
  });
};

/** One more author in the same thread, with its own identity and contact row. */
const seedSecondAuthor = (authorId: string, identity: string, messageId: string): void => {
  rowsOf('engagement_authors').push({ id: authorId, platform: 'linkedin', platform_user_id: identity });
  rowsOf('contacts').push({
    id: `contact-${authorId}`,
    organization_id: ORG_A,
    platform: 'linkedin',
    platform_user_id: identity,
    unified_person_id: PERSON_A,
  });
  rowsOf('engagement_messages').push({
    id: messageId,
    organization_id: ORG_A,
    thread_id: THREAD_A,
    author_id: authorId,
    platform: 'linkedin',
    platform_message_id: `urn:li:comment:${messageId}`,
    message_type: 'comment',
    content: CONTENT,
    raw_payload: {},
    direction: 'inbound',
    platform_created_at: '2026-09-13T08:15:00+00:00',
  });
};

/** One attestation, ACTIVE unless `revoked_at` is overridden. */
const seedAttestation = (over: Row = {}): Row => {
  const row: Row = {
    id: 'att-a',
    organization_id: ORG_A,
    platform: 'linkedin',
    platform_user_id: ENGAGEMENT_IDENTITY,
    attested_as: 'tenant_own',
    revoked_at: null,
    ...over,
  };
  rowsOf(REGISTRY).push(row);
  return row;
};

const verify = () => verifyProspectMessage({
  organizationId: ORG_A,
  messageId: MSG_A,
  subjectType: 'person',
  subjectId: PERSON_A,
  personId: PERSON_A,
});

const pick = () => readEligibleProspectMessages({
  organizationId: ORG_A, prospectId: LEAD_A, subjectType: 'person',
}) as unknown as Promise<{
  ok: boolean;
  refusal?: string;
  messages?: Array<Record<string, unknown>>;
  ineligible?: Record<string, number>;
}>;

const registrySelects = () => db.selects.filter((s) => s.table === REGISTRY);

beforeEach(() => {
  db.tables = {};
  db.selects = [];
  db.mutations = [];
  db.readErrors = {};
  db.throwOn = null;
  db.missingColumns = {};
  db.ignoreFilters = false;
});

// ═══════════════════════════════════════════════════════════════════════════
// 0 · THE PREMISE, ASSERTED FROM THE REAL MODULES
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4C · the two normalisers really do disagree', () => {
  it('the DISPLAY helper aliases, and the CONTRACT helper does not', () => {
    // If this ever stops being true the regressions below lose their teeth, so
    // the premise is read off the real helper rather than asserted from memory.
    expect(normalizePlatform('x')).toBe('twitter');
    expect(normalizePlatform('li')).toBe('linkedin');
    expect(normalizePlatform('tw')).toBe('twitter');

    expect(normalizeEngagementPlatform('x')).toBe('x');
    expect(normalizeEngagementPlatform('li')).toBe('li');
    expect(normalizeEngagementPlatform('tw')).toBe('tw');
  });

  it('the module that WROTE `engagement_authors.platform` lower-cases and does not alias', () => {
    // The reason a stored row may hold `'x'`: the writer's own normaliser is
    // local, and it is trim + lower-case.
    const writer = fs.readFileSync(
      path.join(REPO_ROOT, 'backend/services/engagementNormalizationService.ts'), 'utf8',
    );
    expect(writer).toMatch(/const normalizePlatform\s*=\s*\(p: string\)\s*=>[^\n]*toLowerCase\(\)/);
    expect(writer).not.toMatch(/from\s+'\.\.\/constants\/platforms'/);
  });

  it('the platform half is trim + lower-case, and the identity half is TRIM ONLY', () => {
    expect(normalizeEngagementPlatform(' X ')).toBe('x');
    expect(normalizeEngagementPlatform('LinkedIn')).toBe('linkedin');
    expect(normalizeEngagementIdentity(`  ${ENGAGEMENT_IDENTITY}  `)).toBe(ENGAGEMENT_IDENTITY);
    expect(normalizeEngagementIdentity(ENGAGEMENT_IDENTITY)).not.toBe(ENGAGEMENT_IDENTITY_LOWER);
    // A blank half can never produce a key, so a blank identity cannot match a
    // blank attestation.
    expect(engagementIdentityKey('linkedin', '   ')).toBeNull();
    expect(engagementIdentityKey('   ', ENGAGEMENT_IDENTITY)).toBeNull();
  });

  it('the two namespaces are visibly different in these fixtures', () => {
    // The fixture's own premise. Without it, an "ownership match" below could be
    // an artefact of having copied one namespace's value into the other's table.
    expect(OAUTH_IDENTITY).not.toBe(ENGAGEMENT_IDENTITY);
    expect(engagementIdentityKey('linkedin', OAUTH_IDENTITY))
      .not.toBe(engagementIdentityKey('linkedin', ENGAGEMENT_IDENTITY));
    // ...and they are nonetheless SIMILAR: they share a substring, so a
    // substring or case-insensitive comparison would wrongly pair them.
    expect(ENGAGEMENT_IDENTITY).toContain('AbC123');
    expect(OAUTH_IDENTITY).toContain('AbC123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · THE ALIASING REGRESSION — `x` STAYS `x`, `li` STAYS `li`
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4C · a platform the display layer would alias still matches', () => {
  it("an author stored as `'x'` matches an attestation stored as `'x'`, and is never rewritten", async () => {
    seedWorld({ platform: 'x', identity: X_IDENTITY });
    seedAttestation({ platform: 'x', platform_user_id: X_IDENTITY });

    const out = await verify();

    expect(out.verified).toBe(false);
    expect(out.refusal).toBe('source_not_prospect_authored');
    // The predicate asked for `'x'`. A registry on the aliasing helper would
    // have asked for `'twitter'` and matched nothing at all.
    const asked = registrySelects()[0].filters;
    expect(asked).toContainEqual(['platform', 'x']);
    expect(asked.some(([, v]) => v === 'twitter')).toBe(false);
    expect(JSON.stringify(db.selects)).not.toContain('twitter');
  });

  it("an attestation stored as `'twitter'` does NOT match the `'x'` row — the alias is not a match", async () => {
    // This is what a registry built on the display normaliser would contain, and
    // it is exactly the silent no-op the contract warns about.
    seedWorld({ platform: 'x', identity: X_IDENTITY });
    seedAttestation({ platform: 'twitter', platform_user_id: X_IDENTITY });
    db.ignoreFilters = true;      // the key equality is re-asserted on the DATA

    expect((await verify()).verified).toBe(true);
  });

  it("an author stored as `'li'` matches `'li'`, and an attestation stored as `'linkedin'` does not", async () => {
    seedWorld({ platform: 'li' });
    seedAttestation({ platform: 'li' });

    expect((await verify()).refusal).toBe('source_not_prospect_authored');
    expect(registrySelects()[0].filters).toContainEqual(['platform', 'li']);
    // Assert on the PLATFORM filters only. A substring sweep of the whole query
    // log cannot express this: the identity is a LinkedIn profile URL, so the
    // string 'linkedin' appears legitimately in every read that carries it, and
    // a sweep would fail for a reason that has nothing to do with aliasing.
    // Collecting the platform values is both narrower and strictly stronger —
    // it would catch an alias applied to ANY read, not just to this one.
    const platformValues = db.selects
      .flatMap((q) => q.filters.filter(([col]) => col === 'platform').map(([, v]) => v));
    expect(platformValues).toContain('li');
    expect(platformValues).not.toContain('linkedin');

    db.tables = {};
    db.selects = [];
    seedWorld({ platform: 'li' });
    seedAttestation({ platform: 'linkedin' });
    db.ignoreFilters = true;
    expect((await verify()).verified).toBe(true);
  });

  it("platform whitespace and case follow trim + lower-case: `' X '` asks for `'x'`", async () => {
    // The author row is messy; the registry holds the writer-normalised value.
    seedWorld({ platform: ' X ', identity: X_IDENTITY, contactPlatform: 'X' });
    seedAttestation({ platform: 'x', platform_user_id: X_IDENTITY });

    const out = await verify();

    expect(out.refusal).toBe('source_not_prospect_authored');
    expect(registrySelects()[0].filters).toContainEqual(['platform', 'x']);
    // Not the untrimmed value, and not the aliased one.
    expect(registrySelects()[0].filters.some(([, v]) => v === ' X ' || v === 'twitter')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE IDENTITY HALF IS CASE-SIGNIFICANT AND VERBATIM
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4C · a profile-URL identity keeps its exact case', () => {
  it('matches the attestation byte for byte, and the predicate carries the author row\'s value', async () => {
    seedWorld();
    seedAttestation();

    const out = await verify();

    expect(out.refusal).toBe('source_not_prospect_authored');
    const asked = registrySelects()[0].filters;
    expect(asked).toContainEqual(['platform_user_id', ENGAGEMENT_IDENTITY]);
    // Verbatim: not lower-cased, not url-decoded, not reshaped.
    expect(asked.some(([, v]) => v === ENGAGEMENT_IDENTITY_LOWER)).toBe(false);
    expect(asked.find(([c]) => c === 'platform_user_id')?.[1])
      .toBe(rowsOf('engagement_authors')[0].platform_user_id);
  });

  it('a LOWER-CASED attestation of the same path does NOT match', async () => {
    // Case-folding the identity would produce a string that is not the identity
    // received, and would stop the row matching the author it describes.
    seedWorld();
    seedAttestation({ platform_user_id: ENGAGEMENT_IDENTITY_LOWER });
    db.ignoreFilters = true;

    expect((await verify()).verified).toBe(true);
  });

  it('two case-variant identities do not collapse into one match — in one batch', async () => {
    // The picker sees both authors at once, so a case-folding key would make one
    // attestation exclude BOTH messages.
    seedWorld();
    seedSecondAuthor('author-b', ENGAGEMENT_IDENTITY_LOWER, 'msg-b');
    seedAttestation();            // attests ONLY the mixed-case identity

    const r = await pick();

    expect(r.ok).toBe(true);
    expect(r.messages?.map((m) => m.messageId)).toEqual(['msg-b']);
    expect(r.ineligible).toEqual({
      examined: 2,
      subjectMismatch: 0,
      notProspectAuthored: 1,
      observationTimeAbsent: 0,
      statementAbsent: 0,
    });
  });

  it('and the verifier agrees, message for message', async () => {
    seedWorld();
    seedSecondAuthor('author-b', ENGAGEMENT_IDENTITY_LOWER, 'msg-b');
    seedAttestation();

    expect((await verify()).refusal).toBe('source_not_prospect_authored');
    const other = await verifyProspectMessage({
      organizationId: ORG_A, messageId: 'msg-b', subjectType: 'person',
      subjectId: PERSON_A, personId: PERSON_A,
    });
    expect(other.verified).toBe(true);
  });

  it('a trailing-whitespace attestation still matches: the identity is TRIMMED', async () => {
    seedWorld();
    seedAttestation({ platform_user_id: ENGAGEMENT_IDENTITY });
    // The stored value is already trimmed; what is characterised here is that
    // the LOOKUP trims the author row's value rather than sending padding.
    rowsOf('engagement_authors')[0].platform_user_id = `  ${ENGAGEMENT_IDENTITY}  `;
    rowsOf('contacts')[0].platform_user_id = ENGAGEMENT_IDENTITY;

    const out = await verify();

    expect(out.refusal).toBe('source_not_prospect_authored');
    expect(registrySelects()[0].filters).toContainEqual(['platform_user_id', ENGAGEMENT_IDENTITY]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · THE OAUTH NAMESPACE IS NOT AN OWNERSHIP SOURCE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4C · an OAuth identifier never creates an ownership match', () => {
  it('an attestation holding the OAUTH id does not match the engagement row', async () => {
    seedWorld();
    seedAttestation({ platform_user_id: OAUTH_IDENTITY });
    db.ignoreFilters = true;      // even if the query returned it, the key differs

    const out = await verify();

    expect(out.verified).toBe(true);
    expect(out.statement).toBe(CONTENT);
  });

  it('a SIMILAR OAuth id — same substring, different string — does not match either', async () => {
    seedWorld();
    seedAttestation({ platform_user_id: `urn:li:person:${ENGAGEMENT_IDENTITY}` });
    db.ignoreFilters = true;

    expect((await verify()).verified).toBe(true);
  });

  it('the OLD join would call this author the company; the message still verifies', async () => {
    // `getOrgAuthorIds` compares `engagement_authors.platform_user_id` with
    // `social_accounts.platform_user_id` for the active members of the
    // organization. Seeded here so the OLD equivalence WOULD classify this
    // author as the workspace — with NO registry row. If any of that reached
    // through, this message would be refused.
    seedWorld();
    rowsOf('user_company_roles').push({ user_id: 'user-1', company_id: ORG_A, status: 'active' });
    rowsOf('social_accounts').push({
      user_id: 'user-1', platform: 'linkedin',
      platform_user_id: ENGAGEMENT_IDENTITY, is_active: true,
    });

    const out = await verify();

    expect(out.verified).toBe(true);
    // Neither module went looking in the OAuth tables.
    const tables = db.selects.map((s) => s.table);
    expect(tables).not.toContain('social_accounts');
    expect(tables).not.toContain('user_company_roles');
    // The registry WAS asked, and answered with nothing owned.
    expect(registrySelects()).toHaveLength(1);

    // The picker says the same thing about the same world.
    db.selects = [];
    const r = await pick();
    expect(r.messages?.map((m) => m.messageId)).toEqual([MSG_A]);
    expect(db.selects.map((s) => s.table)).not.toContain('social_accounts');
  });

  it('the attested ENGAGEMENT identity excludes, in the same world the OAuth value does not', async () => {
    // The pair, so "the registry is what excludes" is observed rather than
    // inferred: one run with the OAuth value seeded, one with the engagement
    // value, and nothing else changed.
    seedWorld();
    rowsOf('user_company_roles').push({ user_id: 'user-1', company_id: ORG_A, status: 'active' });
    rowsOf('social_accounts').push({
      user_id: 'user-1', platform: 'linkedin',
      platform_user_id: OAUTH_IDENTITY, is_active: true,
    });
    seedAttestation({ platform_user_id: OAUTH_IDENTITY });
    expect((await verify()).verified).toBe(true);

    rowsOf(REGISTRY).push({
      id: 'att-b', organization_id: ORG_A, platform: 'linkedin',
      platform_user_id: ENGAGEMENT_IDENTITY, attested_as: 'tenant_own', revoked_at: null,
    });
    expect((await verify()).refusal).toBe('source_not_prospect_authored');
  });

  it('neither edited module names the OAuth equivalence, by function or by table', () => {
    for (const file of [VERIFIER_FILE, PICKER_FILE]) {
      const code = codeOf(file);
      for (const forbidden of ['getOrgAuthorIds', 'social_accounts', 'user_company_roles']) {
        expect({ file, forbidden, hit: code.indexOf(forbidden) !== -1 })
          .toEqual({ file, forbidden, hit: false });
      }
      // One normaliser, and it is the contract's.
      expect({ file, hit: /constants\/platforms/.test(code) }).toEqual({ file, hit: false });
      expect(code).toContain('engagementIdentityKey');
      // Guard the guard: the scan really read a module that does this work.
      expect(code).toContain(ATTESTED_ENGAGEMENT_IDENTITY_RELATION.slice(0, 8));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · A READ FAILURE NEVER ADMITS A MESSAGE
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4C · an unreadable registry is fail-closed on both paths', () => {
  it.each([
    ['relation absent', { code: '42P01', message: 'relation does not exist' }],
    ['schema cache', { code: 'PGRST205', message: 'could not find the table in the schema cache' }],
    ['column absent', { code: '42703', message: 'column does not exist' }],
    ['connection', { code: '08006', message: 'connection failure' }],
  ])('the verifier refuses on a %s error, and derives nothing', async (_label, error) => {
    seedWorld();
    db.readErrors[REGISTRY] = error as { code?: string; message?: string };

    const out = await verify();

    expect(out.verified).toBe(false);
    expect(out.refusal).toBe('store_unavailable');
    expect(out.statement).toBeNull();
    expect(out.sourceVerification).toBeNull();
  });

  it('a missing `revoked_at` column is unavailability, not an empty owned set', async () => {
    // The precise fail-open being replaced: an unapplied migration must not read
    // as "nobody is owned".
    seedWorld();
    seedAttestation();
    db.missingColumns[REGISTRY] = ['revoked_at'];

    expect((await verify())).toMatchObject({ verified: false, refusal: 'store_unavailable' });

    db.selects = [];
    const r = await pick();
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('store_unavailable');
    expect(r.messages).toBeUndefined();
    expect(r.ineligible).toBeUndefined();
  });

  it('a thrown transport is unavailability on both paths', async () => {
    seedWorld();
    db.throwOn = REGISTRY;

    expect(await verify()).toMatchObject({ verified: false, refusal: 'store_unavailable' });
    expect((await pick()).refusal).toBe('store_unavailable');
  });

  it('the picker refuses the WHOLE answer rather than counting a row it could not check', async () => {
    seedWorld();
    db.readErrors[REGISTRY] = { code: '42P01', message: 'relation does not exist' };

    const r = await pick();

    expect(r.ok).toBe(false);
    expect(r.messages).toBeUndefined();
    expect(r.ineligible).toBeUndefined();
  });

  it('and an UNREGISTERED identity still changes nothing: absence is not a refusal', async () => {
    seedWorld();

    const out = await verify();
    const r = await pick();

    expect(out.verified).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.messages?.map((m) => m.messageId)).toEqual([MSG_A]);
    expect(r.ineligible).toEqual({
      examined: 1,
      subjectMismatch: 0,
      notProspectAuthored: 0,
      observationTimeAbsent: 0,
      statementAbsent: 0,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · TENANT SCOPE, REVOCATION, AND NO WRITES
// ═══════════════════════════════════════════════════════════════════════════
describe('WS-4C · the registry read is tenant-scoped, active-only and read-only', () => {
  it('an ORG_B attestation of the same identity does not exclude in ORG_A', async () => {
    seedWorld();
    seedAttestation({ id: 'att-b', organization_id: ORG_B });

    expect((await verify()).verified).toBe(true);
    expect(registrySelects()[0].filters).toContainEqual(['organization_id', ORG_A]);
    expect(registrySelects()[0].filters.some(([, v]) => v === ORG_B)).toBe(false);

    db.selects = [];
    const r = await pick();
    expect(r.messages?.map((m) => m.messageId)).toEqual([MSG_A]);
    expect(db.selects.filter((s) => s.table === REGISTRY)[0].filters)
      .toContainEqual(['organization_id', ORG_A]);
  });

  it('a revoked attestation never excludes, and revoking one flips the verdict in place', async () => {
    seedWorld();
    const row = seedAttestation();

    expect((await verify()).refusal).toBe('source_not_prospect_authored');

    row.revoked_at = '2026-10-28T12:00:00.000Z';

    expect((await verify()).verified).toBe(true);
    expect(rowsOf(REGISTRY)).toHaveLength(1);
    expect(registrySelects()).toHaveLength(2);
  });

  it('neither path writes anything, whatever the registry says', async () => {
    seedWorld();
    seedAttestation();
    await verify();
    await pick();
    db.tables[REGISTRY] = [];
    await verify();
    await pick();

    expect(db.mutations).toEqual([]);
  });

  it('the picker declares the relation it reads', async () => {
    seedWorld();
    await pick();
    expect(ELIGIBLE_PROSPECT_MESSAGES_RELATIONS).toContain(REGISTRY);
    expect(db.selects.some((s) => s.table === REGISTRY)).toBe(true);
  });
});
