/**
 * Row failure diagnostics (closure-pass follow-up Part 2) tests.
 *
 * Covers:
 *   - recordRowFailure passes the right shape to the DB insert
 *   - recordRowFailureBatch passes an array
 *   - both never throw on DB failure (best-effort contract)
 *   - failure_category is derived from BOLT_ERROR_CODE_CATEGORY
 *   - empty/null inputs are handled
 */

import { BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

const insertMock = jest.fn();

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => ({ insert: insertMock })),
}));

import {
  recordRowFailure,
  recordRowFailureBatch,
} from '../../services/boltRowFailureDiagnostics';

beforeEach(() => {
  insertMock.mockReset();
  insertMock.mockResolvedValue({ data: null, error: null });
});

describe('recordRowFailure', () => {
  test('inserts a single row with the documented shape', async () => {
    await recordRowFailure({
      runId: 'run-1',
      campaignId: 'camp-1',
      companyId: 'co-1',
      dailyPlanId: 'plan-1',
      weekNumber: 2,
      activityId: 'act-1',
      platform: 'linkedin',
      contentType: 'post',
      stage: 'generate-weekly-structure',
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM,
      message: 'missing platform',
      field: 'platform',
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row.run_id).toBe('run-1');
    expect(row.campaign_id).toBe('camp-1');
    expect(row.platform).toBe('linkedin');
    expect(row.content_type).toBe('post');
    expect(row.failure_code).toBe(BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM);
    expect(row.failure_category).toBe('DAILY_PLAN_FAILURE');
    expect(row.failure_field).toBe('platform');
    expect(row.stage).toBe('generate-weekly-structure');
  });

  test('never throws when the DB insert rejects', async () => {
    insertMock.mockRejectedValueOnce(new Error('db down'));
    await expect(recordRowFailure({
      runId: 'r', code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE, message: 'm',
    })).resolves.toBeUndefined();
  });

  test('null/undefined optional fields are normalized to null', async () => {
    await recordRowFailure({
      runId: 'r1',
      code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE,
      message: 'm',
    });
    const row = insertMock.mock.calls[0][0];
    expect(row.campaign_id).toBeNull();
    expect(row.daily_plan_id).toBeNull();
    expect(row.activity_id).toBeNull();
    expect(row.failure_details).toBeNull();
  });
});

describe('recordRowFailureBatch', () => {
  test('inserts an array of rows in one call', async () => {
    await recordRowFailureBatch([
      { runId: 'r', code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM, message: 'm1' },
      { runId: 'r', code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE, message: 'm2' },
    ]);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const arg = insertMock.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toHaveLength(2);
  });

  test('no-ops on empty array (no DB call)', async () => {
    await recordRowFailureBatch([]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test('never throws when the DB insert rejects', async () => {
    insertMock.mockRejectedValueOnce(new Error('db down'));
    await expect(recordRowFailureBatch([
      { runId: 'r', code: BOLT_ERROR_CODES.DAILY_PLAN_UNSCHEDULABLE, message: 'm' },
    ])).resolves.toBeUndefined();
  });
});

describe('Deduplication is the caller\'s responsibility', () => {
  // Per spec: "no duplicate records". Our writer does NOT de-dupe inside
  // the function — duplicate avoidance is achieved by callers wiring at
  // ONE rejection site per row. This test documents that contract.
  test('two identical recordRowFailure calls produce two DB inserts', async () => {
    const row = {
      runId: 'dup-run',
      code: BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM,
      message: 'dup',
    } as const;
    await recordRowFailure(row);
    await recordRowFailure(row);
    expect(insertMock).toHaveBeenCalledTimes(2);
  });
});
