/**
 * OPS RESTORE — 2026-07-10, approved by Kuldeep in-session.
 *
 * On 2026-07-09T19:38:37Z the credit projection self-heal
 * (creditProjectionReconciler) rebuilt org 4bdbec26's wallet from per-row
 * ledger deltas. That math is unfaithful to the live RPC's settle encoding
 * (settles return the unspent hold remainder WITHOUT a delta row), so the
 * rebuild moved 1,185 already-settled credits into reserved_free:
 *   free_balance 2399 → 1214, reserved_free (unknown) → 1862.
 *
 * Authoritative state per the immutable ledger:
 *   - last transaction (2026-07-09T10:42:08Z) balance_after = 2399
 *   - every hold idempotency key has a matching confirm/release → no open
 *     holds → reserved_free = 0
 *
 * This script restores exactly that state. GUARDED: refuses to run unless
 * the wallet still shows the corrupted values (1214/1862), so it is
 * idempotent and cannot clobber later legitimate activity.
 *
 * Run: node scripts/ops/restore-wallet-projection-20260710.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const CORRUPT = { free_balance: 1214, reserved_free: 1862 };
const RESTORE = { free_balance: 2399, reserved_free: 0 };

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: before, error: readErr } = await sb
    .from('organization_credits')
    .select('free_balance,reserved_free,paid_balance,incentive_balance,updated_at')
    .eq('organization_id', ORG)
    .maybeSingle();
  if (readErr) throw new Error('read failed: ' + readErr.message);
  console.log('BEFORE:', JSON.stringify(before));

  if (!before || before.free_balance !== CORRUPT.free_balance || before.reserved_free !== CORRUPT.reserved_free) {
    console.log('GUARD: wallet no longer shows the corrupted 1214/1862 state — nothing to do.');
    return;
  }

  const { error: writeErr } = await sb
    .from('organization_credits')
    .update({ ...RESTORE, updated_at: new Date().toISOString() })
    .eq('organization_id', ORG);
  if (writeErr) throw new Error('write failed: ' + writeErr.message);

  const { data: after } = await sb
    .from('organization_credits')
    .select('free_balance,reserved_free,paid_balance,incentive_balance,updated_at')
    .eq('organization_id', ORG)
    .maybeSingle();
  console.log('AFTER:', JSON.stringify(after));
  console.log('RESTORED — available credits back to 2399, reserved cleared.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
