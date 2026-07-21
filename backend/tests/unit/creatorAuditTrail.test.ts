/**
 * Tests for creatorAuditTrailService:
 *   - recordAuditEntry batches + flushes
 *   - getAuditHistoryForPlan returns rows
 *   - failures NEVER throw
 */

const inserts: Array<Array<Record<string, unknown>>> = [];
let insertShouldThrow = false;
let selectRows: Array<Record<string, unknown>> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((_table: string) => {
      const filters: Record<string, any> = {};
      let limit = 100;
      const api: any = {
        insert: jest.fn(async (rows: any[]) => {
          if (insertShouldThrow) throw new Error('db down');
          inserts.push(rows);
          return { data: rows, error: null };
        }),
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        order: jest.fn(() => api),
        limit: jest.fn((n: number) => { limit = n; return Promise.resolve({ data: selectRows.slice(0, limit), error: null }); }),
      };
      return api;
    }),
  },
}));

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('creatorAuditTrailService', () => {
  beforeEach(() => {
    inserts.length = 0;
    selectRows = [];
    insertShouldThrow = false;
    jest.clearAllMocks();
  });

  test('recordAuditEntry batches + flushes', async () => {
    const a = await import('../../services/creatorAuditTrailService');
    a.__resetCreatorAuditTrailForTests();
    a.recordAuditEntry({ action: 'upload_completed', dailyPlanId: 'plan-1' });
    a.recordAuditEntry({ action: 'schedule_attached', scheduledPostId: 'sp-1' });
    await a.flushCreatorAuditTrail();
    expect(inserts.length).toBe(1);
    expect(inserts[0].length).toBe(2);
    expect((inserts[0][0] as any).action).toBe('upload_completed');
    expect((inserts[0][1] as any).scheduled_post_id).toBe('sp-1');
  });

  test('getAuditHistoryForPlan returns rows', async () => {
    selectRows = [
      { id: '1', action: 'upload_initiated', daily_plan_id: 'plan-x' },
      { id: '2', action: 'upload_completed', daily_plan_id: 'plan-x' },
    ];
    const a = await import('../../services/creatorAuditTrailService');
    const history = await a.getAuditHistoryForPlan('plan-x');
    expect(history.length).toBe(2);
  });

  test('NEVER throws when DB insert fails', async () => {
    insertShouldThrow = true;
    const a = await import('../../services/creatorAuditTrailService');
    a.__resetCreatorAuditTrailForTests();
    a.recordAuditEntry({ action: 'upload_failed' });
    await expect(a.flushCreatorAuditTrail()).resolves.toBeUndefined();
  });
});

// PB-010: mark this suite as a MODULE for tsc.
// Without a top-level import/export, tsc treats the file as a global script, so
// its top-level `const`/`function` declarations collide with identically named
// declarations in sibling suites (TS2451/TS2393). Jest already loads every test
// file as its own CommonJS module, so this is a type-visibility fix only and
// changes no runtime behaviour.
export {};
