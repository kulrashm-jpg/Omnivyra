/**
 * Real-schema cover for 20270217000036_billing_operations_update_guard (e1, 2026-11-13; BLOCKING money).
 *
 * The defect: openBillingOperation upserted on idempotency_key with ON CONFLICT DO UPDATE, so re-opening a key
 * rewrote the row (id replaced, organization moved, confirmed -> initiated, metadata wiped). virality-6f reproduced it
 * on this schema: id_changed=t org_moved_to_b=t status=initiated amount_charged=5 metadata={}.
 * This suite runs the EXACT statement PostgREST emitted for that upsert and asserts the trigger refuses it - both the
 * cross-organization open and the same-organization retry - while the legitimate transitions still succeed.
 * HEAD control: without the migration every "refused" case below succeeds (the probe above).
 */
import { db, inRollback, attempt, seedTenants, ORG_A, ORG_B } from './setup';

const KEY = 'rs-billing-guard-key';

/** What PostgREST sent for .upsert(payload, { onConflict: 'idempotency_key', ignoreDuplicates: false }). */
const OLD_UPSERT = `
  INSERT INTO public.billing_operations
    (id, correlation_id, module, action, organization_id, actor_user_id, idempotency_key, amount_estimated, status, metadata)
  VALUES (gen_random_uuid(), 'c2', 'ai', 'act', $1, NULL, $2, NULL, 'initiated', '{}'::jsonb)
  ON CONFLICT (idempotency_key) DO UPDATE SET
    id = EXCLUDED.id, correlation_id = EXCLUDED.correlation_id, module = EXCLUDED.module, action = EXCLUDED.action,
    organization_id = EXCLUDED.organization_id, actor_user_id = EXCLUDED.actor_user_id,
    idempotency_key = EXCLUDED.idempotency_key, amount_estimated = EXCLUDED.amount_estimated,
    status = EXCLUDED.status, metadata = EXCLUDED.metadata`;

async function settledRow(org: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO public.billing_operations
       (id, correlation_id, module, action, organization_id, actor_user_id, idempotency_key, amount_estimated, status, metadata)
     VALUES (gen_random_uuid(), 'c1', 'ai', 'act', $1, NULL, $2, 5, 'initiated', '{"ai_result": {"v": 1}}'::jsonb)
     RETURNING id`,
    [org, KEY],
  );
  await db.query(
    `UPDATE public.billing_operations SET status = 'confirmed', amount_charged = 5, completed_at = now() WHERE id = $1`,
    [rows[0].id],
  );
  return rows[0].id as string;
}

const snapshot = async (id: string) =>
  (await db.query(`SELECT id, organization_id, status, amount_charged, metadata FROM public.billing_operations WHERE id = $1`, [id])).rows[0];

describe('billing_operations_row_guard', () => {
  it('the trigger is installed, enabled, and not executable by client roles', async () => {
    const { rows } = await db.query(
      `SELECT t.tgenabled FROM pg_trigger t
        WHERE t.tgrelid = 'public.billing_operations'::regclass AND t.tgname = 'billing_operations_row_guard' AND NOT t.tgisinternal`);
    expect(rows).toHaveLength(1);
    expect(rows[0].tgenabled).not.toBe('D');
    const priv = await db.query(
      `SELECT has_function_privilege('anon', 'public.billing_operations_row_guard()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.billing_operations_row_guard()', 'EXECUTE') AS auth`);
    expect(priv.rows[0]).toEqual({ anon: false, auth: false });
  });

  it("CROSS-ORGANIZATION re-open of a settled key is REFUSED and A's row is unchanged (6f's probe)", async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await settledRow(ORG_A);
      const before = await snapshot(id);
      expect(await attempt(OLD_UPSERT, [ORG_B, KEY])).toBe('P0001');
      expect(await snapshot(id)).toEqual(before);
    });
  });

  it('SAME-ORGANIZATION retry of a settled key is REFUSED (status, amount and metadata survive)', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await settledRow(ORG_A);
      const before = await snapshot(id);
      expect(await attempt(OLD_UPSERT, [ORG_A, KEY])).toBe('P0001');
      expect(await snapshot(id)).toMatchObject({ ...before, status: 'confirmed', amount_charged: 5, metadata: { ai_result: { v: 1 } } });
    });
  });

  it('the new app path (plain INSERT) gets 23505 on a re-open and writes nothing', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await settledRow(ORG_A);
      const before = await snapshot(id);
      expect(await attempt(
        `INSERT INTO public.billing_operations (id, correlation_id, module, action, organization_id, idempotency_key, status, metadata)
         VALUES (gen_random_uuid(), 'c3', 'ai', 'act', $1, $2, 'initiated', '{}'::jsonb)`, [ORG_B, KEY])).toBe('23505');
      expect(await snapshot(id)).toEqual(before);
    });
  });

  it('identity columns are immutable; a final status never changes; nothing returns to initiated', async () => {
    await inRollback(async () => {
      await seedTenants();
      const id = await settledRow(ORG_A);
      expect(await attempt(`UPDATE public.billing_operations SET organization_id = $2 WHERE id = $1`, [id, ORG_B])).toBe('P0001');
      expect(await attempt(`UPDATE public.billing_operations SET idempotency_key = 'other' WHERE id = $1`, [id])).toBe('P0001');
      expect(await attempt(`UPDATE public.billing_operations SET status = 'error' WHERE id = $1`, [id])).toBe('P0001');
      expect(await attempt(`UPDATE public.billing_operations SET status = 'initiated' WHERE id = $1`, [id])).toBe('P0001');
    });
  });

  it('LEGITIMATE transitions still succeed: settle, recover an errored row, metadata-only updates on a final row', async () => {
    await inRollback(async () => {
      await seedTenants();
      const { rows } = await db.query(
        `INSERT INTO public.billing_operations (id, correlation_id, module, action, organization_id, idempotency_key, status, metadata)
         VALUES (gen_random_uuid(), 'c4', 'ai', 'act', $1, 'rs-legit', 'initiated', '{}'::jsonb) RETURNING id`, [ORG_A]);
      const id = rows[0].id as string;
      expect(await attempt(`UPDATE public.billing_operations SET status = 'held' WHERE id = $1`, [id])).toBe('ok');
      await db.query(`UPDATE public.billing_operations SET status = 'error' WHERE id = $1`, [id]);           // recovery
      expect(await attempt(`UPDATE public.billing_operations SET status = 'confirmed', amount_charged = 3 WHERE id = $1`, [id])).toBe('ok');
      await db.query(`UPDATE public.billing_operations SET status = 'confirmed', amount_charged = 3 WHERE id = $1`, [id]);
      // aiExecutionResultStore save / lifecycle prune: metadata only, on a FINAL row
      expect(await attempt(`UPDATE public.billing_operations SET metadata = '{"ai_result": {"v": 2}}'::jsonb WHERE id = $1`, [id])).toBe('ok');
      // a re-confirm with the same status is not a transition
      expect(await attempt(`UPDATE public.billing_operations SET status = 'confirmed', completed_at = now() WHERE id = $1`, [id])).toBe('ok');
    });
  });
});
