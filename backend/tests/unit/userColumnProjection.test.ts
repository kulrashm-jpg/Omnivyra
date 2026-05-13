/**
 * Schema-tolerance regression tests for tolerantUserSelect.
 *
 * The Phase 2.B regression was: code shipped that SELECTed `users.status`
 * before every environment had run the migration. The full SELECT errored
 * with PGRST204 → callers got `data: null` → entire auth surface treated
 * the user as "not found" → login loop.
 *
 * These tests pin the tolerant-select contract:
 *   1. Full SELECT succeeds → return the full row, no fallback.
 *   2. Full SELECT errors with PGRST204 → fall back to BASE columns and
 *      synthesize lifecycle defaults.
 *   3. Full SELECT errors with a real PostgREST error → return null
 *      (do NOT fall back, do NOT silently treat as no-user).
 *   4. Missing-column detection covers status / session_revoked_after /
 *      activated_at by name.
 */

const dbMock = jest.fn();
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (...args: unknown[]) => dbMock(...args),
}));

import {
  isMissingColumnError,
  tolerantUserSelect,
} from '../../services/userColumnProjection';

interface ChainStub {
  select: jest.Mock;
  eq:     jest.Mock;
  maybeSingle: jest.Mock;
}

function buildChain(result: { data?: unknown; error?: { message?: string; code?: string } | null }): ChainStub {
  const chain: ChainStub = {
    select: jest.fn(() => chain),
    eq:     jest.fn(() => chain),
    maybeSingle: jest.fn().mockResolvedValue({
      data:  result.data ?? null,
      error: result.error ?? null,
    }),
  };
  return chain;
}

beforeEach(() => dbMock.mockReset());

describe('isMissingColumnError', () => {
  it('detects PGRST204 by error code', () => {
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true);
  });

  it('detects each lifecycle column by message text', () => {
    expect(isMissingColumnError({
      message: "Could not find the 'status' column of 'users' in the schema cache",
    })).toBe(true);
    expect(isMissingColumnError({
      message: "Could not find the 'session_revoked_after' column of 'users' in the schema cache",
    })).toBe(true);
    expect(isMissingColumnError({
      message: "Could not find the 'activated_at' column of 'users' in the schema cache",
    })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError({ code: 'PGRST116', message: 'no rows found' })).toBe(false);
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false);
  });
});

describe('tolerantUserSelect', () => {
  it('returns the full row on success without falling back', async () => {
    const fullRow = {
      id:         'u1',
      supabase_uid: 'sub-1',
      email:      'a@b.com',
      is_deleted: false,
      status:     'active',
      session_revoked_after: null,
      activated_at: '2026-05-13T12:00:00Z',
    };
    dbMock.mockReturnValueOnce(buildChain({ data: fullRow }));

    const out = await tolerantUserSelect({
      resolver:     'test.full_success',
      filterColumn: 'supabase_uid',
      filterValue:  'sub-1',
    });

    expect(out.fellBack).toBe(false);
    expect(out.missingColumns).toEqual([]);
    expect(out.row).toMatchObject({ id: 'u1', status: 'active', activated_at: '2026-05-13T12:00:00Z' });
    expect(dbMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to BASE columns when status column is missing', async () => {
    dbMock.mockReturnValueOnce(buildChain({
      error: { code: 'PGRST204', message: "Could not find the 'status' column of 'users' in the schema cache" },
    }));
    dbMock.mockReturnValueOnce(buildChain({
      data: { id: 'u2', supabase_uid: 'sub-2', email: 'b@c.com', is_deleted: false },
    }));

    const out = await tolerantUserSelect({
      resolver:     'test.fallback_missing_status',
      filterColumn: 'supabase_uid',
      filterValue:  'sub-2',
    });

    expect(out.fellBack).toBe(true);
    expect(out.missingColumns).toContain('status');
    expect(out.row).toMatchObject({
      id:         'u2',
      is_deleted: false,
      status:     null,
      session_revoked_after: null,
      activated_at: null,
    });
    expect(dbMock).toHaveBeenCalledTimes(2);
  });

  it('falls back on multiple missing-column messages together', async () => {
    dbMock.mockReturnValueOnce(buildChain({
      error: {
        code: 'PGRST204',
        message:
          "Could not find the 'session_revoked_after' column of 'users' in the schema cache. " +
          "Could not find the 'activated_at' column of 'users' in the schema cache",
      },
    }));
    dbMock.mockReturnValueOnce(buildChain({
      data: { id: 'u3', supabase_uid: null, email: 'c@d.com', is_deleted: false },
    }));

    const out = await tolerantUserSelect({
      resolver:     'test.fallback_multiple',
      filterColumn: 'email',
      filterValue:  'c@d.com',
    });

    expect(out.fellBack).toBe(true);
    expect(out.missingColumns).toEqual(expect.arrayContaining(['session_revoked_after', 'activated_at']));
  });

  it('returns null without falling back on unrelated PostgREST errors', async () => {
    dbMock.mockReturnValueOnce(buildChain({
      error: { code: 'PGRST301', message: 'JWT expired' },
    }));

    const out = await tolerantUserSelect({
      resolver:     'test.real_error',
      filterColumn: 'supabase_uid',
      filterValue:  'sub-x',
    });

    expect(out.fellBack).toBe(false);
    expect(out.row).toBeNull();
    expect(dbMock).toHaveBeenCalledTimes(1);
  });

  it('returns null cleanly when the row genuinely does not exist', async () => {
    dbMock.mockReturnValueOnce(buildChain({ data: null, error: null }));

    const out = await tolerantUserSelect({
      resolver:     'test.no_row',
      filterColumn: 'supabase_uid',
      filterValue:  'sub-missing',
    });

    expect(out.fellBack).toBe(false);
    expect(out.row).toBeNull();
  });

  it('returns the soft-deleted row with is_deleted=true via fallback', async () => {
    dbMock.mockReturnValueOnce(buildChain({
      error: { code: 'PGRST204', message: "Could not find the 'status' column of 'users' in the schema cache" },
    }));
    dbMock.mockReturnValueOnce(buildChain({
      data: { id: 'u4', supabase_uid: 'sub-4', email: 'd@e.com', is_deleted: true },
    }));

    const out = await tolerantUserSelect({
      resolver:     'test.soft_deleted_fallback',
      filterColumn: 'supabase_uid',
      filterValue:  'sub-4',
    });

    expect(out.row).toMatchObject({ is_deleted: true, status: null });
  });
});
