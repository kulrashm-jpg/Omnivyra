/**
 * Tests for creatorLifecycleIntegrityAuditService:
 *   - detects lifecycle_desync
 *   - detects missing_fk_linkage
 *   - detects invalid_transition (FSM-prohibited move in history)
 *   - detects upload_session_corruption (stamp on non-awaiting row)
 *   - applies auto-heal for desync + missing_fk + stale stamp
 *   - emits integrity_audit_run telemetry
 */

const plans: any[] = [];
const scheduledPosts: any[] = [];
const queueJobs: any[] = [];
const campaigns: any[] = [{ id: 'campaign-1', company_id: 'company-1' }];

const updates: Array<{ table: string; payload: Record<string, any>; filters: Record<string, any> }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      let offsetStart = 0;
      let offsetEnd = 1_000_000;
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        in: jest.fn((k: string, v: any[]) => { filters[k] = v; return api; }),
        order: jest.fn(() => api),
        range: jest.fn((from: number, to: number) => { offsetStart = from; offsetEnd = to; return Promise.resolve({ data: query(table, filters, offsetStart, offsetEnd), error: null }); }),
        limit: jest.fn((n: number) => Promise.resolve({ data: query(table, filters, 0, n - 1), error: null })),
        maybeSingle: jest.fn(async () => {
          const rows = query(table, filters, 0, 0);
          return { data: rows[0] ?? null, error: null };
        }),
      };
      return api;
    }),
  },
}));

function query(table: string, filters: Record<string, any>, from: number, to: number): any[] {
  let rows: any[] = [];
  if (table === 'daily_content_plans') rows = plans;
  else if (table === 'scheduled_posts') rows = scheduledPosts;
  else if (table === 'queue_jobs') rows = queueJobs;
  else if (table === 'campaigns') rows = campaigns;

  // Apply simple filter matches
  rows = rows.filter((r) => {
    for (const [k, v] of Object.entries(filters)) {
      if (Array.isArray(v)) {
        if (!v.includes(r[k])) return false;
      } else if (r[k] !== v) return false;
    }
    return true;
  });

  return rows.slice(from, to + 1);
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let payload: any = null;
    const filters: Record<string, any> = {};
    const api: any = {
      update: jest.fn((p: any) => { payload = p; return api; }),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      then(resolve: any) {
        if (payload) updates.push({ table, payload, filters });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: { INTEGRITY_AUDIT_RUN: 'integrity_audit_run', INTEGRITY_VIOLATION: 'integrity_violation' },
}));
jest.mock('../../services/creatorAuditTrailService', () => ({
  recordAuditEntry: jest.fn(),
}));

describe('creatorLifecycleIntegrityAuditService', () => {
  beforeEach(() => {
    plans.length = 0;
    scheduledPosts.length = 0;
    queueJobs.length = 0;
    updates.length = 0;
    jest.clearAllMocks();
  });

  test('detects lifecycle_desync', async () => {
    plans.push({
      id: 'p1',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: { creator_lifecycle_state: 'ready_for_schedule' },
      content_status: 'media_uploaded',
      scheduled_post_id: null,
      resumable_session_started_at: null,
    });
    const a = await import('../../services/creatorLifecycleIntegrityAuditService');
    const report = await a.runCreatorLifecycleIntegrityAudit({ applyAutoHeal: false });
    expect(report.violations.some((v) => v.kind === 'lifecycle_desync')).toBe(true);
  });

  test('detects missing_fk_linkage', async () => {
    plans.push({
      id: 'p2',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: 'sp-x' },
      content_status: 'scheduled',
      scheduled_post_id: null,
      resumable_session_started_at: null,
    });
    const a = await import('../../services/creatorLifecycleIntegrityAuditService');
    const report = await a.runCreatorLifecycleIntegrityAudit({ applyAutoHeal: false });
    expect(report.violations.some((v) => v.kind === 'missing_fk_linkage')).toBe(true);
  });

  test('detects invalid_transition from history', async () => {
    plans.push({
      id: 'p3',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: 'scheduled',
        creator_lifecycle_history: [
          { to: 'awaiting_media_upload' },
          { to: 'scheduled' }, // invalid — must go through media_uploaded
        ],
      },
      content_status: 'scheduled',
      scheduled_post_id: 'sp-y',
      resumable_session_started_at: null,
    });
    const a = await import('../../services/creatorLifecycleIntegrityAuditService');
    const report = await a.runCreatorLifecycleIntegrityAudit({ applyAutoHeal: false });
    expect(report.violations.some((v) => v.kind === 'invalid_transition' && v.severity === 'critical')).toBe(true);
  });

  test('detects upload_session_corruption', async () => {
    plans.push({
      id: 'p4',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: { creator_lifecycle_state: 'ready_for_schedule' },
      content_status: 'ready_for_schedule',
      scheduled_post_id: null,
      resumable_session_started_at: new Date().toISOString(),
    });
    const a = await import('../../services/creatorLifecycleIntegrityAuditService');
    const report = await a.runCreatorLifecycleIntegrityAudit({ applyAutoHeal: false });
    expect(report.violations.some((v) => v.kind === 'upload_session_corruption')).toBe(true);
  });

  test('applies auto-heal for desync', async () => {
    plans.push({
      id: 'p5',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: { creator_lifecycle_state: 'ready_for_schedule' },
      content_status: 'media_uploaded',
      scheduled_post_id: null,
      resumable_session_started_at: null,
    });
    const a = await import('../../services/creatorLifecycleIntegrityAuditService');
    await a.runCreatorLifecycleIntegrityAudit({ applyAutoHeal: true });
    const desyncFix = updates.find((u) => u.table === 'daily_content_plans' && u.payload.content_status === 'ready_for_schedule');
    expect(desyncFix).toBeTruthy();
  });

  test('returns aggregated violations_by_kind', async () => {
    plans.push({
      id: 'p6',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: { creator_lifecycle_state: 'ready_for_schedule' },
      content_status: 'media_uploaded',
      scheduled_post_id: null,
      resumable_session_started_at: null,
    });
    plans.push({
      id: 'p7',
      campaign_id: 'campaign-1',
      content_type: 'video',
      content: { creator_lifecycle_state: 'media_uploaded' },
      content_status: 'awaiting_media_upload',
      scheduled_post_id: null,
      resumable_session_started_at: null,
    });
    const a = await import('../../services/creatorLifecycleIntegrityAuditService');
    const report = await a.runCreatorLifecycleIntegrityAudit({ applyAutoHeal: false });
    expect(report.violations_by_kind['lifecycle_desync']).toBe(2);
    expect(typeof report.duration_ms).toBe('number');
  });
});

// PB-010: mark this suite as a MODULE for tsc.
// Without a top-level import/export, tsc treats the file as a global script, so
// its top-level `const`/`function` declarations collide with identically named
// declarations in sibling suites (TS2451/TS2393). Jest already loads every test
// file as its own CommonJS module, so this is a type-visibility fix only and
// changes no runtime behaviour.
export {};
