/**
 * STAGING-ONLY validation harness — exactly-once top-up allocation.
 *
 * Proves: a duplicate verify (or webhook race) grants credits EXACTLY ONCE.
 * Run ONLY against a non-prod Supabase with RAZORPAY_STAGING_ENABLED=true and
 * test keys, AFTER completing one real Razorpay TEST checkout to obtain a valid
 * order/payment/signature.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/staging/validate-topup-idempotency.ts \
 *     dotenv_config_path=.env.staging \
 *     <orgId> <razorpay_order_id> <razorpay_payment_id> <razorpay_signature>
 *
 * Safety: refuses to run if NODE_ENV=production without an explicit override.
 */
import { getTotalAvailable } from '@/backend/services/creditPriorityService';
import { verifyAndFulfillRazorpayStagingPayment } from '@/backend/services/payments/razorpayStagingService';

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_STAGING_HARNESS_IN_PROD !== 'true') {
    console.error('Refusing to run in production. This is a staging-only harness.');
    process.exit(2);
  }
  const [orgId, orderId, paymentId, signature] = process.argv.slice(2);
  if (!orgId || !orderId || !paymentId || !signature) {
    console.error('args: <orgId> <order_id> <payment_id> <signature>');
    process.exit(2);
  }

  const before = (await getTotalAvailable(orgId)) ?? 0;
  console.log(`balance before: ${before}`);

  const args = { orderId, paymentId, signature, expectedOrganizationId: orgId, requestedBy: 'harness' };
  const r1 = await verifyAndFulfillRazorpayStagingPayment(args);
  console.log(`verify #1: ${JSON.stringify(r1)}`);
  const mid = (await getTotalAvailable(orgId)) ?? 0;

  // Duplicate verify — must be a no-op for the wallet.
  const r2 = await verifyAndFulfillRazorpayStagingPayment(args);
  console.log(`verify #2 (duplicate): ${JSON.stringify(r2)}`);
  const after = (await getTotalAvailable(orgId)) ?? 0;

  const grantedFirst = mid - before;
  const grantedSecond = after - mid;
  console.log(`\nbalance: ${before} → ${mid} → ${after}`);
  console.log(`granted on 1st verify: ${grantedFirst} · granted on 2nd (duplicate): ${grantedSecond}`);
  console.log(
    grantedSecond === 0
      ? '✅ PASS — exactly-once: the duplicate verify granted 0 credits.'
      : '❌ FAIL — duplicate verify granted credits (idempotency broken).',
  );
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });
