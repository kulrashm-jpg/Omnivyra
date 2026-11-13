/**
 * Orphan usage job — PLATFORM rows (usage_events.organization_id IS NULL).
 *
 * A platform row (billing_scope='platform') belongs to no customer company and
 * has NO credit transaction by design. Before this fix the job looked one up
 * with `.eq('organization_id', null)`, found nothing, and reported the row as
 * a billing leak ("orphan"), attributed to a `null` org bucket.
 *
 * Proven here:
 *  - a NULL-org event is not an orphan, is counted in `platformSkipped`, and
 *    never reaches a credit_transactions lookup;
 *  - CONTROL: a normal org event with no credit CONFIRM still IS an orphan, and
 *    a normal org event with one still is not;
 *  - CONTROL: with org-only events the result and the emitted anomaly are
 *    exactly the pre-fix shape (plus `platformSkipped: 0`).
 */

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn() }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

import { runOrphanUsageReconciliation } from '../../services/billing/jobs/orphanUsageReconciliationJob';
import { logger } from '../../services/logger';
import { emitAnomaly } from '../../services/billing/billingAuditEmitter';
import { incrCounter } from '../../services/billing/billingMetrics';

const ORG_A = '11111111-1111-4111-8111-111111111111'; // has a credit CONFIRM
const ORG_B = '22222222-2222-4222-8222-222222222222'; // has none -> orphan

let mockEvents: Array<Record<string, unknown>> = [];
let mockOrgsWithConfirm = new Set<string>();
let mockCreditLookups: unknown[] = [];

function mockFrom(table: string) {
  const eqs: Array<[string, unknown]> = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
  b.eq = (col: string, val: unknown) => { eqs.push([col, val]); return b; };
  b.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
    let res: unknown = { data: [], error: null };
    if (table === 'usage_events') res = { data: mockEvents, error: null };
    if (table === 'credit_transactions') {
      const org = eqs.find(([c]) => c === 'organization_id')?.[1];
      mockCreditLookups.push(org);
      res = { data: mockOrgsWithConfirm.has(String(org)) ? [{ id: 'ct-1' }] : [], error: null };
    }
    return Promise.resolve(res).then(onF, onR);
  };
  return b;
}

const ev = (id: string, organization_id: string | null, operation: string, cost_usd: number) =>
  ({ id, organization_id, operation, cost_usd, created_at: '2026-11-13T10:00:00.000Z' });

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents = [];
  mockOrgsWithConfirm = new Set([ORG_A]);
  mockCreditLookups = [];
});

describe('runOrphanUsageReconciliation — platform (NULL org) rows', () => {
  test('NULL-org event is not an orphan; CONTROL: org event without CONFIRM still is', async () => {
    mockEvents = [
      ev('e-platform', null, 'platform_op', 2.0),
      ev('e-a', ORG_A, 'op_a', 1.0),
      ev('e-b', ORG_B, 'op_b', 0.5),
    ];
    const r = await runOrphanUsageReconciliation({ windowMinutes: 60, limit: 100 });

    expect(r).toEqual({
      scanned: 3,
      orphanCount: 1,
      estimatedUntrackedUsd: 0.5,
      byOrgTop10: [{ organizationId: ORG_B, orphanCount: 1, estimatedUsd: 0.5 }],
      byOperationTop10: [{ operation: 'op_b', orphanCount: 1 }],
      platformSkipped: 1,
    });
    // The platform row never reached a credit lookup (no `.eq('organization_id', null)`).
    expect(mockCreditLookups).toEqual([ORG_A, ORG_B]);
    expect(mockCreditLookups).not.toContain(null);
    expect(logger.info).toHaveBeenCalledWith('orphan_usage_platform_rows_skipped', { platformSkipped: 1, window_minutes: 60 });
    // Anomaly reflects only the real orphan.
    expect(incrCounter).toHaveBeenCalledWith('untracked_ai_call_blocked_total', 1);
    expect((emitAnomaly as jest.Mock).mock.calls[0][0].message).toContain('orphans (no matching credit CONFIRM in ±5min): 1, estUsd=0.5000');
  });

  test('only platform rows: zero orphans, no anomaly', async () => {
    mockEvents = [ev('p1', null, 'platform_op', 1.0), ev('p2', null, 'platform_op', 1.0)];
    const r = await runOrphanUsageReconciliation();
    expect(r).toEqual({
      scanned: 2, orphanCount: 0, estimatedUntrackedUsd: 0, byOrgTop10: [], byOperationTop10: [], platformSkipped: 2,
    });
    expect(mockCreditLookups).toEqual([]);
    expect(emitAnomaly).not.toHaveBeenCalled();
    expect(incrCounter).not.toHaveBeenCalled();
  });

  test('CONTROL: org-only events produce the pre-fix result and anomaly unchanged', async () => {
    mockEvents = [
      ev('e-a', ORG_A, 'op_a', 1.0),
      ev('e-b1', ORG_B, 'op_b', 0.5),
      ev('e-b2', ORG_B, 'op_c', 0.25),
    ];
    const r = await runOrphanUsageReconciliation({ windowMinutes: 30 });
    const byOrgTop10 = [{ organizationId: ORG_B, orphanCount: 2, estimatedUsd: 0.75 }];
    const byOperationTop10 = [{ operation: 'op_b', orphanCount: 1 }, { operation: 'op_c', orphanCount: 1 }];
    expect(r).toEqual({
      scanned: 3, orphanCount: 2, estimatedUntrackedUsd: 0.75, byOrgTop10, byOperationTop10, platformSkipped: 0,
    });
    expect(mockCreditLookups).toEqual([ORG_A, ORG_B, ORG_B]);
    expect(logger.info).not.toHaveBeenCalled();
    expect(emitAnomaly).toHaveBeenCalledTimes(1);
    expect(emitAnomaly).toHaveBeenCalledWith({
      kind: 'untracked_ai_call_blocked',
      severity: 'warn',
      message: 'usage_events orphans (no matching credit CONFIRM in ±5min): 2, estUsd=0.7500',
      metadata: { window_minutes: 30, byOrgTop10, byOperationTop10 },
    });
  });
});
