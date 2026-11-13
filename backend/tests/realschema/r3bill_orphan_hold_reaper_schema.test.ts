/**
 * R3 Workstream E (2026-11-03) — credit orphan-HOLD reaper vs the REAL schema.
 *
 * The reaper and its preflight reconciler select `credit_transactions.metadata`
 * (added by 20260625_monetization_invariant_hardening). The production-shaped
 * baseline has no such column: 20260625 was only applied surgically for
 * credit_purchases. And `credit_transactions` is append-only
 * (raise_ledger_immutable, 20260663), so the reconciler's `stampHold` UPDATE of
 * that column can never succeed even once the column exists.
 *
 * These cases pin what the code does on each schema, so whoever decides where
 * quarantine state lives (side table vs column) does it with evidence:
 *   A. Production shape: the reaper throws every run and releases nothing; the
 *      invariant audit silently reports no stale holds. The failure is visible
 *      in logs only: monetization_operational_events lacks the 20260628 columns
 *      (escalation_priority, …), so every ops-event insert is refused too.
 *   B. Column-only apply of 20260625's ADD COLUMN: the quarantine stamp is
 *      refused (and the refusal swallowed), so the reaper then releases a hold
 *      the reconciler had just decided to quarantine. Re-runs stay idempotent and
 *      a hold with a terminal sibling stays untouched.
 *
 * Same harness as the other realschema suites: REAL services, DB transport
 * translated to SQL, throwaway DB, every case inside a rollback.
 */

jest.mock('../../db/supabaseClient', () =>
  require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'r3bill'));
jest.mock('../../db/writeOwner', () => ({
  __esModule: true,
  ownedDbTable: (table: string) => require('../../db/supabaseClient').supabase.from(table),
  ownedDbRpc: (fn: string, args: Record<string, unknown>) => require('../../db/supabaseClient').supabase.rpc(fn, args),
}));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn(async () => undefined) }));
// The real-schema jest config maps no `@/` alias. The credit execution chain
// needs two: a real pure helper, and config for one module-load threshold.
jest.mock('@/lib/shared/uuid', () => jest.requireActual('../../../lib/shared/uuid'), { virtual: true });
jest.mock('@/config', () => ({ config: { COST_REQUEST_THRESHOLD_USD: 1 } }), { virtual: true });

import { attempt, db, inRollback } from './setup';

/* eslint-disable @typescript-eslint/no-var-requires */
const { reapOrphanHolds } = require('../../services/creditOrphanHoldReaper');
const { auditMonetizationInvariants } = require('../../services/monetizationReservationReconciliationService');
/* eslint-enable @typescript-eslint/no-var-requires */

const DB_URL = process.env.W6_DB_URL ?? '';
// The hold-release gate (holdReleaseGate, e9 2026-11-13) is default-OFF; this suite exercises the release path itself.
process.env.CREDIT_HOLD_REAP_ENABLED = 'true';
if (!/@(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(DB_URL)) {
  throw new Error('r3bill_orphan_hold_reaper_schema refuses a non-loopback W6_DB_URL');
}

/** Synthetic tenant for a disposable DB. Never a production identifier. */
const ORG = '0eda0896-0000-4000-8000-0000000000e1';

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function wallet(): Promise<{ free_balance: number; reserved_free: number }> {
  return (await q('SELECT free_balance, reserved_free FROM public.organization_credits WHERE organization_id=$1', [ORG])).rows[0];
}

async function seedWallet(): Promise<void> {
  await q(`INSERT INTO public.organization_credits (organization_id, free_balance) VALUES ($1, 100)`, [ORG]);
}

/** A HOLD through the real RPC, exactly as executeWithCredits writes it. */
async function hold(baseKey: string, referenceType: string, amount = 10): Promise<string> {
  await q(
    `SELECT public.apply_credit_reservation(p_org_id => $1, p_phase => 'hold', p_free_amount => $2,
       p_idempotency_key => $3, p_reference_type => $4, p_note => 'r3bill', p_performed_by => $1, p_category => 'free')`,
    [ORG, amount, `${baseKey}:hold`, referenceType],
  );
  return (await q(`SELECT id FROM public.credit_transactions WHERE idempotency_key=$1`, [`${baseKey}:hold`])).rows[0].id;
}

async function phases(baseKey: string): Promise<string[]> {
  return (await q(
    `SELECT execution_phase FROM public.credit_transactions WHERE idempotency_key LIKE $1 ORDER BY execution_phase`,
    [`${baseKey}:%`],
  )).rows.map((r) => r.execution_phase);
}

async function storedEvents(name: string): Promise<number> {
  return (await q(
    `SELECT count(*)::int n FROM public.monetization_operational_events WHERE event_name=$1 AND (organization_id=$2 OR organization_id IS NULL)`,
    [name, ORG],
  )).rows[0].n;
}

// Ops events reach only the logger on this schema; spy on what an operator sees.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../../services/logger');
const logged = (level: 'error' | 'warn', event: string): number =>
  (logger[level] as jest.Mock).mock.calls.filter((c) => c[0] === event).length;
const insertRefusedFor = (event: string): number =>
  (logger.error as jest.Mock).mock.calls.filter((c) =>
    c[0] === 'monetization.operational_event_insert_failed'
    && c[1]?.eventName === event
    && /escalation_priority/.test(String(c[1]?.message))).length;
beforeEach(() => {
  jest.spyOn(logger, 'error');
  jest.spyOn(logger, 'warn');
});
afterEach(() => jest.restoreAllMocks());

const hasMetadataColumn = async (): Promise<boolean> =>
  (await q(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_transactions' AND column_name='metadata'`)).rowCount === 1;

// minAgeSeconds 0: the DB stamps created_at at transaction start, before the
// JS cutoff, so a HOLD written in this transaction is already "old enough".
const reap = () => reapOrphanHolds({ minAgeSeconds: 0, orgId: ORG });

describe('R3 reaper — production-shaped schema (no credit_transactions.metadata)', () => {
  it('the column the reaper selects does not exist on the replayed schema', async () => {
    expect(await hasMetadataColumn()).toBe(false);
  });

  it('every run throws and releases nothing; the failure reaches the logs but not the ops-event table', async () => {
    await inRollback(async () => {
      await seedWallet();
      await hold('r3bill:a', 'unmapped_reference_r3');
      expect(await wallet()).toEqual({ free_balance: 90, reserved_free: 10 });

      await expect(reap()).rejects.toThrow(/orphan_hold_reaper_query_failed: .*metadata/);

      expect(logged('error', 'orphan_hold_reaper_query_failed')).toBe(1);
      expect(logged('error', 'orphan_hold_reaper_preflight_reconciliation_failed')).toBe(1);
      expect(insertRefusedFor('monetization.orphan_hold_reaper_query_failed')).toBe(1);
      expect(await storedEvents('monetization.orphan_hold_reaper_query_failed')).toBe(0);
      expect(await phases('r3bill:a')).toEqual(['hold']);
      expect(await wallet()).toEqual({ free_balance: 90, reserved_free: 10 });
    });
  });

  it('the invariant audit reports NO stale holds while one exists (query error swallowed)', async () => {
    await inRollback(async () => {
      await seedWallet();
      const id = await hold('r3bill:b', 'unmapped_reference_r3');
      const audit = await auditMonetizationInvariants({ staleHoldSeconds: 0, limit: 50 });
      expect(audit.stale_holds).toEqual([]);
      // The hold is real and stale by the audit's own definition.
      expect((await q(`SELECT count(*)::int n FROM public.credit_transactions WHERE id=$1 AND execution_phase='hold'`, [id])).rows[0].n).toBe(1);
    });
  });
});

describe('R3 reaper — after a column-only apply of 20260625 (ADD COLUMN metadata)', () => {
  const addColumn = () =>
    q(`ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb`);

  it('the HOLD row stays append-only: a metadata stamp is refused with LEDGER_IMMUTABLE', async () => {
    await inRollback(async () => {
      await addColumn();
      await seedWallet();
      const id = await hold('r3bill:c', 'unmapped_reference_r3');
      expect(await attempt(`UPDATE public.credit_transactions SET metadata='{"reconciliation_status":"quarantined"}' WHERE id=$1`, [id])).toBe('P0001');
    });
  });

  it('a hold the reconciler QUARANTINES is then RELEASED by the reaper (stamp silently lost)', async () => {
    await inRollback(async () => {
      await addColumn();
      await seedWallet();
      const id = await hold('r3bill:d', 'unmapped_reference_r3');

      const r = await reap();

      // The preflight reconciler decided "quarantine" and said so (in the logs)…
      expect(logged('warn', 'monetization.reservation_quarantined')).toBe(1);
      // …but the stamp never landed, so the reaper did not see it.
      expect((await q(`SELECT metadata FROM public.credit_transactions WHERE id=$1`, [id])).rows[0].metadata).toEqual({});
      expect(r).toMatchObject({ scanned: 1, released: 1, skippedQuarantined: 0, failed: 0, releasedHoldIds: [id] });
      expect(await phases('r3bill:d')).toEqual(['hold', 'release']);
      expect(await wallet()).toEqual({ free_balance: 100, reserved_free: 0 });
    });
  });

  it('a re-run is a no-op: the RELEASE sibling is found, nothing is released twice', async () => {
    await inRollback(async () => {
      await addColumn();
      await seedWallet();
      await hold('r3bill:e', 'unmapped_reference_r3');
      expect((await reap()).released).toBe(1);

      const again = await reap();
      expect(again).toMatchObject({ released: 0, skippedHasSibling: 1, failed: 0 });
      expect(await phases('r3bill:e')).toEqual(['hold', 'release']);
      expect(await wallet()).toEqual({ free_balance: 100, reserved_free: 0 });
    });
  });

  it('a hold that already has a CONFIRM sibling is left untouched', async () => {
    await inRollback(async () => {
      await addColumn();
      await seedWallet();
      const id = await hold('r3bill:f', 'unmapped_reference_r3');
      await q(
        `SELECT public.apply_credit_reservation(p_org_id => $1, p_phase => 'confirm', p_free_amount => 10,
           p_idempotency_key => 'r3bill:f:confirm', p_reference_type => 'unmapped_reference_r3', p_note => 'r3bill',
           p_performed_by => $1, p_parent_id => $2, p_category => 'free')`,
        [ORG, id],
      );
      const before = await wallet();

      const r = await reap();
      expect(r).toMatchObject({ released: 0, skippedHasSibling: 1, failed: 0 });
      expect(await phases('r3bill:f')).toEqual(['confirm', 'hold']);
      expect(await wallet()).toEqual(before);
    });
  });
});
