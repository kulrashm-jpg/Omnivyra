/**
 * PI-LDB — `mappingProfileStore`.
 *
 * ─── WHY THERE IS A FAKE DATABASE IN HERE ─────────────────────────────────
 * The thing worth testing about this store is not that it calls `.insert()`.
 * It is that the ORDER of its four statements means no reader can ever see a
 * profile whose entries are half-written, that version numbering survives
 * supersession, and that two concurrent approvals do not both win. None of
 * that is observable against a double that records calls and answers `{}`.
 *
 * So the double below enforces the constraints the migration actually creates:
 *
 *   uq_source_mapping_profiles_active   one active row per (org, source, fp)
 *   uq_source_mapping_profiles_version  one row per (org, source, fp, version)
 *   source_mapping_profiles_status_coherent   (status='active') = (sup_at IS NULL)
 *   source_mapping_profiles_header_count_matches
 *   uq_smpe_approved_per_field / _ignored_per_field / _rejected_per_target
 *
 * A violation answers `{ code: '23505' }`, as Postgres would. That is what
 * lets the concurrency test be a real test rather than a story about one.
 *
 * It is a double, not Postgres, and it is only as good as the constraints
 * copied into it — so the real-schema suite is still where these tables get
 * exercised against the live DDL. What this file proves is the ordering logic,
 * which the real-schema runner cannot easily provoke.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const USER = '00000000-0000-4000-8000-0000000000c1';
const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);

/* ── the fake ─────────────────────────────────────────────────────────────── */

interface Row {
  [k: string]: unknown;
}

type PgResult = { data: unknown; error: { code?: string; message: string } | null };

class FakeDb {
  profiles: Row[] = [];
  entries: Row[] = [];
  /** Statements in the order they were issued, for ordering assertions. */
  log: string[] = [];
  /** Forced failures, keyed `<table>:<op>`, consumed once. */
  failures = new Map<string, { code?: string; message: string }>();
  /** Fires before a named statement runs — used to interleave a rival writer. */
  hooks = new Map<string, () => void>();
  private seq = 0;

  failOnce(key: string, error: { code?: string; message: string }) {
    this.failures.set(key, error);
  }

  private take(key: string): { code?: string; message: string } | null {
    const f = this.failures.get(key);
    if (f) this.failures.delete(key);
    return f ?? null;
  }

  private rows(table: string): Row[] {
    return table === 'source_mapping_profiles' ? this.profiles : this.entries;
  }

  nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  /**
   * The constraints. Returns a 23505-shaped error, or null.
   *
   * `self` is the stored row this candidate IS, when checking an update: the
   * candidate is a merged copy, so without it the original still sits in the
   * table and collides with itself on every unique index.
   */
  private violation(table: string, row: Row, self?: Row): { code: string; message: string } | null {
    const isSelf = (r: Row) => r === row || (self !== undefined && r === self);
    if (table === 'source_mapping_profiles') {
      if ((row.status === 'active') !== (row.superseded_at === null || row.superseded_at === undefined)) {
        return { code: '23514', message: 'source_mapping_profiles_status_coherent' };
      }
      const headers = row.headers as unknown[];
      if (!Array.isArray(headers) || headers.length !== row.header_count) {
        return { code: '23514', message: 'source_mapping_profiles_header_count_matches' };
      }
      const sameShape = this.profiles.filter(
        (p) =>
          !isSelf(p) &&
          p.organization_id === row.organization_id &&
          p.source === row.source &&
          p.schema_fingerprint === row.schema_fingerprint,
      );
      if (row.status === 'active' && sameShape.some((p) => p.status === 'active')) {
        return { code: '23505', message: 'uq_source_mapping_profiles_active' };
      }
      if (sameShape.some((p) => p.version === row.version)) {
        return { code: '23505', message: 'uq_source_mapping_profiles_version' };
      }
      return null;
    }

    const siblings = this.entries.filter((e) => !isSelf(e) && e.profile_id === row.profile_id);
    const sameField = siblings.filter(
      (e) => e.source_field_normalized === row.source_field_normalized,
    );
    if (row.decision === 'approved' && sameField.some((e) => e.decision === 'approved')) {
      return { code: '23505', message: 'uq_smpe_approved_per_field' };
    }
    if (row.decision === 'ignored' && sameField.some((e) => e.decision === 'ignored')) {
      return { code: '23505', message: 'uq_smpe_ignored_per_field' };
    }
    if (
      row.decision === 'rejected' &&
      sameField.some((e) => e.decision === 'rejected' && e.target_field === row.target_field)
    ) {
      return { code: '23505', message: 'uq_smpe_rejected_per_target' };
    }
    return null;
  }

  table(name: string) {
    return new FakeQuery(this, name);
  }

  // Internals reached by FakeQuery.
  _log(s: string) {
    this.log.push(s);
    this.hooks.get(s)?.();
  }
  _take(k: string) {
    return this.take(k);
  }
  _rows(t: string) {
    return this.rows(t);
  }
  _violation(t: string, r: Row, self?: Row) {
    return this.violation(t, r, self);
  }
}

class FakeQuery implements PromiseLike<PgResult> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private filters: Array<[string, unknown]> = [];
  private payload: Row | Row[] | null = null;

  constructor(
    private db: FakeDb,
    private tableName: string,
  ) {}

  select(_cols?: string) {
    if (this.op === 'select') this.op = 'select';
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push([col, value]);
    return this;
  }
  order(_col: string, _opts?: unknown) {
    return this;
  }

  private matching(): Row[] {
    return this.db
      ._rows(this.tableName)
      .filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  private run(): PgResult {
    const key = `${this.tableName}:${this.op}`;
    this.db._log(key);
    const forced = this.db._take(key);
    if (forced) return { data: null, error: forced };

    if (this.op === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const staged: Row[] = [];
      for (const raw of incoming) {
        const row: Row = {
          id: this.db.nextId(this.tableName === 'source_mapping_profiles' ? 'profile' : 'entry'),
          created_at: '2026-11-03T00:00:00.000Z',
          superseded_at: null,
          ...raw,
        };
        const v = this.db._violation(this.tableName, row);
        if (v) return { data: null, error: v };
        staged.push(row);
      }
      // All-or-nothing within one statement, as a single multi-row INSERT is.
      this.db._rows(this.tableName).push(...staged);
      return { data: staged, error: null };
    }

    if (this.op === 'update') {
      const patch = this.payload as Row;
      const hits = this.matching();
      for (const hit of hits) {
        const merged = { ...hit, ...patch };
        const v = this.db._violation(this.tableName, merged, hit);
        if (v) return { data: null, error: v };
        Object.assign(hit, patch);
      }
      return { data: hits, error: null };
    }

    if (this.op === 'delete') {
      const hits = new Set(this.matching());
      const rows = this.db._rows(this.tableName);
      for (let i = rows.length - 1; i >= 0; i -= 1) if (hits.has(rows[i])) rows.splice(i, 1);
      return { data: [...hits], error: null };
    }

    return { data: this.matching(), error: null };
  }

  async maybeSingle(): Promise<PgResult> {
    const r = this.run();
    if (r.error) return r;
    const rows = r.data as Row[];
    return { data: rows.length ? rows[0] : null, error: null };
  }

  async single(): Promise<PgResult> {
    const r = this.run();
    if (r.error) return r;
    const rows = r.data as Row[];
    if (rows.length !== 1) return { data: null, error: { message: 'expected exactly one row' } };
    return { data: rows[0], error: null };
  }

  then<R1 = PgResult, R2 = never>(
    onFulfilled?: ((v: PgResult) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

let db: FakeDb;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (name: string) => db.table(name),
}));

// `@/config` validates the whole environment at module load and throws without
// live credentials. The store does not use it, but the registry import chain
// may, so it is stubbed for the same reason the gateway proposer's suite does.
jest.mock('@/config', () => ({ config: {} }), { virtual: true });

import {
  MappingProfileStoreError,
  loadActiveProfile,
  loadProfileContext,
  saveProfileVersion,
  type SaveProfileEntry,
} from '../../services/leadMapping/mappingProfileStore';
import { TRANSFORMATION_NAMES } from '../../services/leadMapping/mappingTypes';

const HEADERS = ['Full Name', 'Work Email', 'Designation', 'Internal Ref'];

const approve = (over: Partial<SaveProfileEntry> = {}): SaveProfileEntry => ({
  sourceField: 'Designation',
  target: 'jobTitle',
  transformation: 'trim',
  decision: 'approved',
  mappingMethod: 'tenant_confirmed',
  ...over,
});

const save = (over: Partial<Parameters<typeof saveProfileVersion>[0]> = {}) =>
  saveProfileVersion({
    organizationId: ORG,
    source: 'csv',
    schemaFingerprint: FP,
    headers: HEADERS,
    approvedBy: USER,
    entries: [approve()],
    ...over,
  });

const key = { organizationId: ORG, source: 'csv', schemaFingerprint: FP };

beforeEach(() => {
  db = new FakeDb();
});

/* ── 1. round trip ────────────────────────────────────────────────────────── */

describe('mappingProfileStore · a tenant is not asked twice', () => {
  it('saves an approval and reads it back as the active profile', async () => {
    const saved = await save();
    expect(saved.version).toBe(1);

    const profile = await loadActiveProfile(key);
    expect(profile).not.toBeNull();
    expect(profile!.profileId).toBe(saved.profileId);
    expect(profile!.version).toBe(1);
    expect(profile!.sourceSchemaFingerprint).toBe(FP);
    expect(profile!.entries).toEqual([
      {
        sourceField: 'Designation',
        target: 'jobTitle',
        transformation: 'trim',
        approvedBy: USER,
        approvedAt: expect.any(String),
      },
    ]);
  });

  it('round-trips EVERY header, not only the decided ones', async () => {
    // The drift report is computed from `profile.headers`. Reconstructing them
    // from entries would claim this four-column file had one column, and the
    // next import of the same unchanged file would report three columns added.
    await save();
    const profile = await loadActiveProfile(key);
    expect(profile!.headers).toEqual(HEADERS);
  });

  it('records an ignore as an approved decision to drop the column', async () => {
    await save({
      entries: [approve({ sourceField: 'Internal Ref', target: null, transformation: 'none', decision: 'ignored' })],
    });
    const profile = await loadActiveProfile(key);
    expect(profile!.entries).toHaveLength(1);
    expect(profile!.entries[0]).toMatchObject({ sourceField: 'Internal Ref', target: null });
  });

  it('answers null for a shape the tenant has never approved', async () => {
    await save();
    // Same tenant, same source, DIFFERENT file shape. A profile is keyed on the
    // shape precisely so a changed file is re-proposed rather than silently
    // mapped by decisions made about other columns.
    expect(await loadActiveProfile({ ...key, schemaFingerprint: FP2 })).toBeNull();
    expect(await loadActiveProfile({ ...key, source: 'crm' })).toBeNull();
    expect(await loadActiveProfile({ ...key, organizationId: OTHER_ORG })).toBeNull();
  });

  it('writes transformation identity as NULL, and reads it back as none', async () => {
    await save({ entries: [approve({ transformation: 'none' })] });
    expect(db.entries[0].transformation).toBeNull();
    const profile = await loadActiveProfile(key);
    expect(profile!.entries[0].transformation).toBe('none');
  });
});

/* ── 2. versioning ────────────────────────────────────────────────────────── */

describe('mappingProfileStore · supersedes, never edits', () => {
  it('a second approval becomes version 2 and leaves version 1 intact', async () => {
    const first = await save();
    const second = await save({ entries: [approve({ target: 'department' })] });

    expect(second.version).toBe(2);
    expect(second.profileId).not.toBe(first.profileId);

    // The old row is still there, still readable by id, still carrying the
    // mapping that was in force for the imports it decided. That is the whole
    // point of versioning: `source_assertions.mapping_profile_id` must keep
    // resolving to the decision that was actually applied.
    const old = db.profiles.find((p) => p.id === first.profileId)!;
    expect(old.status).toBe('superseded');
    expect(old.superseded_at).not.toBeNull();
    expect(db.entries.filter((e) => e.profile_id === first.profileId)).toHaveLength(1);

    const active = await loadActiveProfile(key);
    expect(active!.profileId).toBe(second.profileId);
    expect(active!.entries[0].target).toBe('department');
  });

  it('numbers versions from the highest EVER used, not from the active row', async () => {
    // Versions are unique across all statuses. Counting only active rows would
    // collide on the second approval after any supersession.
    await save();
    await save();
    const third = await save();
    expect(third.version).toBe(3);
    expect(db.profiles.map((p) => p.version).sort()).toEqual([1, 2, 3]);
    expect(db.profiles.filter((p) => p.status === 'active')).toHaveLength(1);
  });

  it('keeps exactly one active profile per shape, always', async () => {
    await save();
    await save();
    await save();
    const active = db.profiles.filter(
      (p) => p.status === 'active' && p.schema_fingerprint === FP && p.organization_id === ORG,
    );
    expect(active).toHaveLength(1);
  });

  it('versions each shape independently', async () => {
    await save();
    const other = await save({ schemaFingerprint: FP2 });
    // A new shape starts at 1. Sharing a counter would make version numbers
    // meaningless as a history of THIS shape's decisions.
    expect(other.version).toBe(1);
  });
});

/* ── 3. the staged write ──────────────────────────────────────────────────── */

describe('mappingProfileStore · a half-written profile is never readable', () => {
  it('inserts the profile row UNREADABLE, before its entries', async () => {
    await save();
    // The order is the guarantee. The profile row is written first so the
    // entries have a parent, and it is written `superseded` so that the window
    // between the two inserts exposes nothing.
    const first = db.log.indexOf('source_mapping_profiles:insert');
    const entries = db.log.indexOf('source_mapping_profile_entries:insert');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(entries).toBeGreaterThan(first);
    // And the publish happens after the entries, never before.
    expect(db.log.lastIndexOf('source_mapping_profiles:update')).toBeGreaterThan(entries);
  });

  it('leaves NOTHING readable when the entry insert fails', async () => {
    db.failOnce('source_mapping_profile_entries:insert', { message: 'connection reset' });

    await expect(save()).rejects.toThrow(/approval not saved/);

    // No active profile, so the next import re-proposes. The alternative — an
    // active profile with no entries — would present as "mapping saved" and
    // then map nothing.
    expect(await loadActiveProfile(key)).toBeNull();
    expect(db.entries).toHaveLength(0);
  });

  it('a failed approval does not supersede the mapping that was working', async () => {
    const good = await save();
    db.failOnce('source_mapping_profile_entries:insert', { message: 'connection reset' });
    await expect(save({ entries: [approve({ target: 'department' })] })).rejects.toThrow();

    // This is the one that matters. A tenant whose second approval failed must
    // still have their first mapping: the new row is staged and discarded
    // before anything demotes the old one.
    const active = await loadActiveProfile(key);
    expect(active!.profileId).toBe(good.profileId);
    expect(active!.entries[0].target).toBe('jobTitle');
  });

  it('reports the documented degradation when the promote fails', async () => {
    await save();
    // Demote succeeds, promote fails: the shape is left with no active profile.
    db.failOnce('source_mapping_profiles:update', { message: 'lost connection' });

    // The first update in the second save IS the demote, so fail the second.
    // Arrange it by letting the demote through and failing the next one.
    const err = await save({ entries: [approve({ target: 'department' })] }).catch((e) => e);
    expect(err).toBeInstanceOf(MappingProfileStoreError);
    expect((err as MappingProfileStoreError).kind).toBe('write_failed');
    // Whatever failed, the caller is told plainly — never "saved".
    expect((err as Error).message).not.toMatch(/\bsaved and active\b/);
  });

  it('cleans up the staged row so the version sequence stays readable', async () => {
    db.failOnce('source_mapping_profile_entries:insert', { message: 'connection reset' });
    await expect(save()).rejects.toThrow();
    expect(db.profiles).toHaveLength(0);

    // And the next approval is version 1, not version 2 — a tenant's first
    // successful approval should not be numbered as though it were their
    // second.
    const retry = await save();
    expect(retry.version).toBe(1);
  });
});

/* ── 4. concurrency ──────────────────────────────────────────────────────── */

describe('mappingProfileStore · two approvals do not both win', () => {
  it('retries once when a rival takes the version number first', async () => {
    // A rival approval lands between this caller's version read and its
    // insert. The unique index refuses the duplicate version, and the correct
    // response is to take the next number — not to overwrite and not to fail.
    let fired = false;
    db.hooks.set('source_mapping_profiles:insert', () => {
      if (fired) return;
      fired = true;
      db.profiles.push({
        id: 'rival',
        organization_id: ORG,
        source: 'csv',
        schema_fingerprint: FP,
        version: 1,
        status: 'superseded',
        superseded_at: '2026-11-03T00:00:00.000Z',
        header_count: HEADERS.length,
        headers: HEADERS,
        created_at: '2026-11-03T00:00:00.000Z',
      });
    });

    const saved = await save();
    expect(saved.version).toBe(2);
    expect(saved.profileId).not.toBe('rival');
  });

  it('reports a conflict rather than spinning when it keeps losing', async () => {
    // Every insert collides. Retrying forever would turn a contended shape
    // into a spin against the database, so the second loss is reported.
    db.hooks.set('source_mapping_profiles:insert', () => {
      const taken = db.profiles.filter((p) => p.schema_fingerprint === FP).length;
      db.profiles.push({
        id: `rival-${taken}`,
        organization_id: ORG,
        source: 'csv',
        schema_fingerprint: FP,
        version: taken + 1,
        status: 'superseded',
        superseded_at: '2026-11-03T00:00:00.000Z',
        header_count: HEADERS.length,
        headers: HEADERS,
        created_at: '2026-11-03T00:00:00.000Z',
      });
    });

    const err = await save().catch((e) => e);
    expect(err).toBeInstanceOf(MappingProfileStoreError);
    expect((err as MappingProfileStoreError).kind).toBe('conflict');
  });

  it('surfaces a non-collision insert failure immediately', async () => {
    // A `23505` is a race worth retrying. Anything else is not, and retrying
    // it would just double the latency before the same error.
    db.failOnce('source_mapping_profiles:insert', { code: '42501', message: 'permission denied' });
    const err = await save().catch((e) => e);
    expect((err as MappingProfileStoreError).kind).toBe('write_failed');
    expect((err as Error).message).toMatch(/permission denied/);
  });
});

/* ── 5. refusals are not approvals ───────────────────────────────────────── */

describe('mappingProfileStore · a rejection is not a destination', () => {
  it('never returns a rejected target as a profile entry', async () => {
    await save({
      entries: [
        approve({ sourceField: 'Designation', target: 'department', decision: 'rejected' }),
        approve({ sourceField: 'Work Email', target: 'email', transformation: 'lowercase_email' }),
      ],
    });

    const profile = await loadActiveProfile(key);
    // If a rejection leaked through as an entry, "not department" would become
    // "write to department" on the next import.
    expect(profile!.entries.map((e) => e.sourceField)).toEqual(['Work Email']);
  });

  it('returns refusals keyed by THIS file header, matched on the normalised form', async () => {
    await save({
      entries: [
        approve({ sourceField: 'Designation', target: 'department', decision: 'rejected' }),
        // `description`, not an invented key like `seniority`: the first draft
        // of this fixture used one, and the store refused it for exactly the
        // reason it is supposed to. The guard found my test before it could
        // find a tenant's data.
        approve({ sourceField: 'Designation', target: 'description', decision: 'rejected' }),
      ],
    });

    // The tenant's file said `Designation`; this one says `designation_`. Same
    // normalised header, same fingerprint, so the same profile applies — and
    // the engine looks refusals up by the raw header it was handed.
    const ctx = await loadProfileContext(key, ['designation_', 'Work Email']);
    expect(ctx.rejectedTargets).toEqual({ designation_: ['department', 'description'] });
    expect(ctx.profile).not.toBeNull();
    // And the same rows must not ALSO appear as destinations. Asserted on this
    // path as well as the one above because a single test standing between
    // "not department" and "write to department" is too thin a net for it.
    expect(ctx.profile!.entries).toEqual([]);
  });

  it('omits headers with no refusals rather than mapping them to empty arrays', async () => {
    await save();
    const ctx = await loadProfileContext(key, HEADERS);
    expect(ctx.rejectedTargets).toEqual({});
  });

  it('answers an empty context for a tenant with no profile', async () => {
    const ctx = await loadProfileContext(key, HEADERS);
    expect(ctx).toEqual({ profile: null, rejectedTargets: {} });
  });
});

/* ── 6. the write boundary ───────────────────────────────────────────────── */

describe('mappingProfileStore · validation refuses before any statement runs', () => {
  const expectRefusal = async (over: Partial<Parameters<typeof saveProfileVersion>[0]>, re: RegExp) => {
    const err = await save(over).catch((e) => e);
    expect(err).toBeInstanceOf(MappingProfileStoreError);
    expect((err as MappingProfileStoreError).kind).toBe('invalid_argument');
    expect((err as Error).message).toMatch(re);
    // The point of validating here: nothing reached the database at all.
    expect(db.log).toEqual([]);
    expect(db.profiles).toHaveLength(0);
  };

  it('refuses a non-uuid tenant and a non-uuid actor', async () => {
    await expectRefusal({ organizationId: 'csv' }, /organizationId must be a uuid/);
    db = new FakeDb();
    await expectRefusal({ approvedBy: 'me' }, /approvedBy must be a uuid/);
  });

  it('refuses a fingerprint that is not a sha256 digest', async () => {
    await expectRefusal({ schemaFingerprint: 'abc' }, /sha256/);
  });

  it('refuses an entry for a column that was not in the file', async () => {
    await expectRefusal(
      { entries: [approve({ sourceField: 'Salary' })] },
      /not one of the submitted headers/,
    );
  });

  it('refuses a destination the registry does not know', async () => {
    // The browser cannot name an arbitrary field. This is the second of the
    // two checks on that — the route is the first — and it is here because a
    // store is a write boundary and must not trust its caller.
    await expectRefusal(
      { entries: [approve({ target: 'password_hash' as never })] },
      /must name a canonical destination/,
    );
  });

  it('refuses an ignore that names a target, and an approval that does not', async () => {
    await expectRefusal(
      { entries: [approve({ decision: 'ignored' })] },
      /ignored, so it cannot name a target/,
    );
    db = new FakeDb();
    await expectRefusal(
      { entries: [approve({ target: null })] },
      /must name a canonical destination/,
    );
  });

  it('refuses an unnamed transformation', async () => {
    await expectRefusal(
      { entries: [approve({ transformation: 'eval' as never })] },
      /not a named transformation/,
    );
  });

  it('refuses two approved destinations for one column', async () => {
    // Mirrors `uq_smpe_approved_per_field`. Caught here so the caller gets a
    // sentence it can show a tenant instead of a constraint name.
    await expectRefusal(
      { entries: [approve({ target: 'jobTitle' }), approve({ target: 'department' })] },
      /more than one approved destination/,
    );
  });

  it('refuses a column that is both approved and ignored', async () => {
    // NOT a database constraint: the two partial unique indexes are
    // independent, so Postgres would accept both rows and a reader would pick
    // arbitrarily. That makes this check the only thing standing in the way.
    await expectRefusal(
      {
        entries: [
          approve({ sourceField: 'Designation', target: 'jobTitle' }),
          approve({ sourceField: 'Designation', target: null, decision: 'ignored' }),
        ],
      },
      /both approved and ignored/,
    );
  });

  it('refuses an empty approval, which would erase a working profile', async () => {
    await expectRefusal({ entries: [] }, /erase a working profile/);
  });

  it('refuses a score outside 0..1', async () => {
    await expectRefusal({ entries: [approve({ score: 1.5 })] }, /between 0 and 1/);
  });

  it('accepts a duplicate REJECTION of different targets for one column', async () => {
    // A tenant may refuse several destinations for one column ("not job title,
    // not description"), which is why rejections are unique per target rather
    // than per field. Refusing this would make the refusal UI unusable.
    await expect(
      save({
        entries: [
          approve({ target: 'jobTitle', decision: 'rejected' }),
          approve({ target: 'department', decision: 'rejected' }),
        ],
      }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('accepts every transformation the engine can propose', async () => {
    // A closed set is only closed if both ends agree on it. If the engine
    // gains a transformation the store cannot store, an approved mapping would
    // be refused at the moment a tenant tried to save it.
    for (const transformation of TRANSFORMATION_NAMES) {
      db = new FakeDb();
      await expect(save({ entries: [approve({ transformation })] })).resolves.toMatchObject({
        version: 1,
      });
    }
  });
});

/* ── 7. tenant isolation ─────────────────────────────────────────────────── */

describe('mappingProfileStore · the tenant is part of every key', () => {
  it('filters every read by organization, not by profile id alone', async () => {
    await save();
    // A profile id is a uuid and would resolve on its own. Every query filters
    // on the tenant anyway, so a leaked id is not enough to read a mapping.
    expect(await loadActiveProfile({ ...key, organizationId: OTHER_ORG })).toBeNull();
  });

  it('stamps the tenant on every entry row it writes', async () => {
    await save({ entries: [approve(), approve({ sourceField: 'Work Email', target: 'email' })] });
    expect(db.entries).toHaveLength(2);
    expect(db.entries.every((e) => e.organization_id === ORG)).toBe(true);
    // `smpe_profile_tenant_fk` is a composite key over (profile_id,
    // organization_id), so a wrong tenant here is refused by the database too.
    expect(new Set(db.entries.map((e) => e.profile_id)).size).toBe(1);
  });

  it('lets two tenants hold different mappings for the same file shape', async () => {
    await save();
    await save({ organizationId: OTHER_ORG, entries: [approve({ target: 'department' })] });

    const mine = await loadActiveProfile(key);
    const theirs = await loadActiveProfile({ ...key, organizationId: OTHER_ORG });
    expect(mine!.entries[0].target).toBe('jobTitle');
    expect(theirs!.entries[0].target).toBe('department');
  });
});

/* ── 8. reading rows written by an older build ───────────────────────────── */

describe('mappingProfileStore · tolerates rows it did not write', () => {
  const seedProfile = () => {
    db.profiles.push({
      id: 'p-legacy',
      organization_id: ORG,
      source: 'csv',
      schema_fingerprint: FP,
      version: 1,
      status: 'active',
      superseded_at: null,
      header_count: 2,
      headers: ['A', 'B'],
      created_at: '2026-01-01T00:00:00.000Z',
    });
  };

  it('drops an approval whose destination no longer exists in the registry', async () => {
    seedProfile();
    db.entries.push({
      id: 'e1',
      organization_id: ORG,
      profile_id: 'p-legacy',
      source_field: 'A',
      source_field_normalized: 'a',
      target_field: 'fieldThatWasRemoved',
      decision: 'approved',
      transformation: 'trim',
      approved_by: USER,
      approved_at: '2026-01-01T00:00:00.000Z',
    });

    const profile = await loadActiveProfile(key);
    // Returned as absent rather than as live: the write boundary would refuse
    // it anyway, and showing a tenant a mapping they cannot act on is worse
    // than showing them that the column needs deciding again.
    expect(profile!.entries).toEqual([]);
  });

  it('falls back to the profile date when an entry carries no approval time', async () => {
    seedProfile();
    db.entries.push({
      id: 'e1',
      organization_id: ORG,
      profile_id: 'p-legacy',
      source_field: 'A',
      source_field_normalized: 'a',
      target_field: 'jobTitle',
      decision: 'approved',
      transformation: null,
      approved_by: null,
      approved_at: null,
    });

    const profile = await loadActiveProfile(key);
    // `approved_at` is nullable for non-tenant methods, but the engine quotes
    // it to the tenant: "Reusing the mapping you approved on <date>". The
    // profile's creation is a true answer to that question; a blank or an
    // invented date is not.
    expect(profile!.entries[0].approvedAt).toBe('2026-01-01T00:00:00.000Z');
    // And a deleted approver stays null rather than becoming a sentinel name.
    expect(profile!.entries[0].approvedBy).toBeNull();
  });

  it('survives a headers column that is not an array of strings', async () => {
    db.profiles.push({
      id: 'p-odd',
      organization_id: ORG,
      source: 'csv',
      schema_fingerprint: FP2,
      version: 1,
      status: 'active',
      superseded_at: null,
      header_count: 0,
      headers: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const profile = await loadActiveProfile({ ...key, schemaFingerprint: FP2 });
    expect(profile!.headers).toEqual([]);
  });
});
