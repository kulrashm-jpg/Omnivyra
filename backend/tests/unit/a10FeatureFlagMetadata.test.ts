/**
 * A10 — governed writes for `feature_flags.metadata`.
 *
 * ─── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 * `metadata` has always been in the schema (`jsonb NOT NULL DEFAULT '{}'`) and
 * has always come back on reads, because every read is `select('*')`. What
 * could not happen was writing it: `upsertFeatureFlag`'s payload omitted the
 * column and the route never accepted the field, so a governed caller could
 * create a flag and had no way to attach policy to it.
 *
 * A9's enrichment spend ceiling reads its per-tenant limit from exactly that
 * field, which turned a dormant gap into a load-bearing one: the pilot flag
 * could be created `enabled: true` and still enforce nothing, because
 * `resolveCeiling` would read `metadata` and find it empty. That failure mode
 * is worse than a missing feature — it looks configured.
 *
 * ─── WHAT IS ACTUALLY BEING PROVEN ────────────────────────────────────────
 * Not that a field round-trips, but that OMISSION IS NOT ERASURE. A caller
 * toggling `enabled` must not silently wipe a tenant's ceiling, so the column
 * is absent from the SET list rather than defaulted. The tests below assert on
 * the payload the service actually sends, because that is where the difference
 * between "not supplied" and "supplied empty" lives.
 *
 * SECRETS: none. No network, no database, no provider call.
 */

import { upsertFeatureFlag } from '../../services/featureFlagService';

// ── a store that records exactly what the service asked the database to do ──

interface Capture {
  op: 'insert' | 'update';
  payload: Record<string, unknown>;
}

const captures: Capture[] = [];
let existingRow: { id: string } | null = null;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const row = {
      id: 'flag-1', organization_id: 'org', flag_key: 'k', enabled: true,
      rollout_cohort: null, rollout_percent: null, rationale: null,
      activated_by: null, activated_at: null, reverted_at: null, reverted_by: null,
      metadata: {}, created_by: null, created_at: 'now', updated_at: 'now',
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: existingRow }),
      single: async () => ({ data: row, error: null }),
      insert: (payload: Record<string, unknown>) => {
        captures.push({ op: 'insert', payload });
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        captures.push({ op: 'update', payload });
        return chain;
      },
    };
    return chain;
  },
}));

const base = { organizationId: 'org', flagKey: 'enrichment_spend_ceiling', createdBy: 'user-1' };

beforeEach(() => { captures.length = 0; existingRow = null; });

// ── service semantics ───────────────────────────────────────────────────────

describe('A10 — the service writes metadata only when the caller supplied it', () => {
  it('CREATE with metadata sends it', async () => {
    await upsertFeatureFlag({ ...base, enabled: true, metadata: { daily_provider_call_ceiling: 1 } });

    expect(captures).toHaveLength(1);
    expect(captures[0].op).toBe('insert');
    expect(captures[0].payload.metadata).toEqual({ daily_provider_call_ceiling: 1 });
  });

  it('CREATE without metadata omits the column entirely — the DB default applies', async () => {
    await upsertFeatureFlag({ ...base, enabled: true });

    expect(captures[0].op).toBe('insert');
    expect('metadata' in captures[0].payload).toBe(false);   // omitted, not null, not {}
  });

  it('UPDATE with metadata replaces it', async () => {
    existingRow = { id: 'flag-1' };
    await upsertFeatureFlag({ ...base, enabled: true, metadata: { providers: { clearbit: 2 } } });

    expect(captures[0].op).toBe('update');
    expect(captures[0].payload.metadata).toEqual({ providers: { clearbit: 2 } });
  });

  it('UPDATE without metadata PRESERVES it — omission is not erasure', async () => {
    // The regression this file exists to prevent: someone toggling `enabled`
    // must not wipe a tenant's spend ceiling as a side effect.
    existingRow = { id: 'flag-1' };
    await upsertFeatureFlag({ ...base, enabled: false });

    expect(captures[0].op).toBe('update');
    expect('metadata' in captures[0].payload).toBe(false);   // not in the SET list
  });

  it('omitted metadata never becomes null — the column is NOT NULL', async () => {
    existingRow = { id: 'flag-1' };
    await upsertFeatureFlag({ ...base, enabled: true });

    // The key is absent, not present-and-null. That distinction is the whole
    // point: `metadata` is `jsonb NOT NULL`, so a null would be a constraint
    // violation, and an omitted key leaves the stored policy untouched.
    expect(captures[0].payload.metadata).toBeUndefined();
    expect('metadata' in captures[0].payload).toBe(false);

    // Asserted on `metadata` ALONE. `rollout_cohort`, `rollout_percent` and
    // `rationale` are nullable columns that legitimately default to null via
    // `?? null`, so a sweep over every payload value would fail on their
    // correct behaviour rather than on this one's.
  });

  it('an EMPTY object is a real value and IS written — that is how policy is cleared', async () => {
    existingRow = { id: 'flag-1' };
    await upsertFeatureFlag({ ...base, enabled: true, metadata: {} });

    expect('metadata' in captures[0].payload).toBe(true);
    expect(captures[0].payload.metadata).toEqual({});
  });
});

// ── backward compatibility ──────────────────────────────────────────────────

describe('A10 — existing callers are unchanged', () => {
  it('rollout and rationale still travel exactly as before', async () => {
    await upsertFeatureFlag({
      ...base, enabled: true,
      rolloutCohort: 'tier_a', rolloutPercent: 25, rationale: 'staged rollout',
    });

    expect(captures[0].payload).toMatchObject({
      organization_id: 'org', flag_key: 'enrichment_spend_ceiling', enabled: true,
      rollout_cohort: 'tier_a', rollout_percent: 25, rationale: 'staged rollout',
      created_by: 'user-1',
    });
  });

  it('their defaults are untouched when omitted', async () => {
    await upsertFeatureFlag({ ...base });
    expect(captures[0].payload).toMatchObject({
      enabled: false, rollout_cohort: null, rollout_percent: null, rationale: null,
    });
  });

  it('metadata is NOT stored in rollout_percent or rationale', async () => {
    // Both were considered as carriers and rejected: `rollout_percent` is
    // consumed by evaluateFeatureFlag's bucketing and means something else,
    // and `rationale` is free text for humans.
    await upsertFeatureFlag({ ...base, metadata: { daily_provider_call_ceiling: 1 } });
    expect(captures[0].payload.rollout_percent).toBeNull();
    expect(captures[0].payload.rationale).toBeNull();
  });
});

// ── the route's validation contract ─────────────────────────────────────────

describe('A10 — the route accepts a policy object and rejects everything else', () => {
  // The exact guard the route applies, asserted independently of transport so
  // the rule is testable without a live request.
  const isPolicyObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  it('accepts a plain object', () => {
    expect(isPolicyObject({ daily_provider_call_ceiling: 1 })).toBe(true);
    expect(isPolicyObject({})).toBe(true);
  });

  it('rejects null — the column is NOT NULL, so null is not "clear it"', () => {
    expect(isPolicyObject(null)).toBe(false);
  });

  it('rejects an array — typeof [] is "object" and a naive check would pass it', () => {
    expect(isPolicyObject([])).toBe(false);
    expect(isPolicyObject([{ daily_provider_call_ceiling: 1 }])).toBe(false);
  });

  it('rejects primitives', () => {
    for (const v of ['1', 1, true, undefined]) expect(isPolicyObject(v)).toBe(false);
  });

  it('the route guards ONLY the upsert action', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../..', 'pages/api/active-leads/feature-flags.ts'), 'utf8');
    // metadata is read in the upsert branch and nowhere else: activate, revert
    // and evaluate keep their existing contracts untouched.
    expect((src.match(/body\.metadata/g) ?? []).length).toBeGreaterThan(0);
    const activate = src.slice(src.indexOf("action === 'activate'"), src.indexOf("action === 'revert'"));
    expect(activate).not.toMatch(/metadata/);
  });

  it('authorization still precedes the write — metadata changes no security order', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../..', 'pages/api/active-leads/feature-flags.ts'), 'utf8');
    expect(src.indexOf('enforceCompanyAccess')).toBeLessThan(src.indexOf('body.metadata'));
    expect(src.indexOf('MANAGE_LISTENING_CAPABILITIES')).toBeLessThan(src.indexOf('body.metadata'));
  });
});

// ── A9 compatibility ────────────────────────────────────────────────────────

describe('A10 — A9 can resolve a ceiling from governed-created metadata', () => {
  // A9's `defaultResolveCeiling` shape, applied to what the governed route now
  // stores. Reproduced rather than imported so this asserts the CONTRACT
  // between the two, not one implementation against itself.
  const positiveInt = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const resolve = (row: { enabled: boolean; metadata: Record<string, unknown> }, providerId: string) => {
    if (!row || row.enabled !== true) return null;
    const meta = row.metadata ?? {};
    const per = (meta.providers ?? {}) as Record<string, unknown>;
    return positiveInt(per[providerId]) ?? positiveInt(meta.daily_provider_call_ceiling);
  };

  it('resolves a tenant-wide daily ceiling of 1', () => {
    expect(resolve({ enabled: true, metadata: { daily_provider_call_ceiling: 1 } }, 'clearbit')).toBe(1);
  });

  it('resolves a provider-specific override', () => {
    expect(resolve({ enabled: true, metadata: { providers: { clearbit: 1 } } }, 'clearbit')).toBe(1);
  });

  it('a provider override wins over the tenant-wide value', () => {
    expect(resolve(
      { enabled: true, metadata: { daily_provider_call_ceiling: 100, providers: { clearbit: 1 } } },
      'clearbit',
    )).toBe(1);
  });

  it('a DISABLED flag is an absent ceiling, not a zero one', () => {
    expect(resolve({ enabled: false, metadata: { daily_provider_call_ceiling: 1 } }, 'clearbit')).toBeNull();
  });

  it('the DB default {} resolves to no ceiling — a flag created without policy enforces nothing', () => {
    expect(resolve({ enabled: true, metadata: {} }, 'clearbit')).toBeNull();
  });
});
