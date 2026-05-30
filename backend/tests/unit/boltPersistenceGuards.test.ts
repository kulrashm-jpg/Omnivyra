/**
 * Persistence guards (Part 6) regression tests — focused on
 * the BoltError surface (codes + cause preservation).
 */

import {
  withBlueprintSaveGuard,
  withDailyPlanSaveGuard,
} from '../../services/boltPersistenceGuards';
import { BoltError, BOLT_ERROR_CODES, isBoltError } from '../../../lib/shared/bolt/boltErrorCodes';

describe('withBlueprintSaveGuard', () => {
  test('passes through the resolved value when fn succeeds', async () => {
    const out = await withBlueprintSaveGuard({}, async () => 42);
    expect(out).toBe(42);
  });
  test('wraps generic Error into BoltError with BLUEPRINT_SAVE_FAILED', async () => {
    await expect(withBlueprintSaveGuard({ campaign_id: 'c1' }, async () => {
      throw new Error('insert failed');
    })).rejects.toMatchObject({
      code: BOLT_ERROR_CODES.BLUEPRINT_SAVE_FAILED,
    });
  });
  test('preserves an existing BoltError untouched', async () => {
    const inner = new BoltError(BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED, 'oh no');
    try {
      await withBlueprintSaveGuard({}, async () => { throw inner; });
      fail('expected throw');
    } catch (e) {
      expect(isBoltError(e)).toBe(true);
      expect((e as BoltError).code).toBe(BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED);
    }
  });
  test('stashes the raw error message in details.db_error', async () => {
    try {
      await withBlueprintSaveGuard({ campaign_id: 'c1' }, async () => {
        throw new Error('row not found');
      });
      fail('expected throw');
    } catch (e) {
      const be = e as BoltError;
      expect(be.details?.db_error).toBe('row not found');
      expect(be.details?.campaign_id).toBe('c1');
    }
  });
});

describe('withDailyPlanSaveGuard', () => {
  test('wraps generic Error into DAILY_PLAN_SAVE_FAILED', async () => {
    await expect(withDailyPlanSaveGuard({}, async () => {
      throw new Error('boom');
    })).rejects.toMatchObject({
      code: BOLT_ERROR_CODES.DAILY_PLAN_SAVE_FAILED,
    });
  });
});
