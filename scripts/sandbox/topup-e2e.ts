/**
 * Sandbox top-up E2E — SERVER-SIDE (no browser).
 *
 * Simulates the post-payment half of the loop against a DESIGNATED TEST ORG:
 *   create purchase → fulfill (allocate to paid pool) → invoice → re-run (idempotency).
 * Captures real before/after balances. Covers Section A (server side), C, and F.
 * The browser checkout (Razorpay/Cashfree SDK) is a separate manual step.
 *
 * ⚠ WRITES TO THE WALLET of <TEST_ORG_ID>. Use a designated test org only.
 * Guarded: requires ALLOW_SANDBOX_WALLET_WRITES=true.
 *
 * Usage:
 *   ALLOW_SANDBOX_WALLET_WRITES=true \
 *   npx tsx -r dotenv/config scripts/sandbox/topup-e2e.ts \
 *     dotenv_config_path=.env.local <TEST_ORG_ID>
 */
import { supabase } from '@/backend/db/supabaseClient';
import { getWalletSnapshot, computeAvailable } from '@/backend/services/creditPriorityService';
import { completePurchase } from '@/backend/services/purchaseService';
import { generateTopupInvoice } from '@/backend/services/billing/topupInvoiceService';

const PACKS = [
  { credits: 250, inr: 2520 },
  { credits: 500, inr: 4620 },
  { credits: 1000, inr: 8400 },
];

async function paid(orgId: string): Promise<number> {
  const w = await getWalletSnapshot(orgId);
  return w ? computeAvailable(w).paid : 0;
}

async function main() {
  if (process.env.ALLOW_SANDBOX_WALLET_WRITES !== 'true') {
    console.error('Refusing to run: set ALLOW_SANDBOX_WALLET_WRITES=true and pass a DESIGNATED test org.');
    process.exit(2);
  }
  const orgId = process.argv[2];
  if (!orgId) { console.error('Usage: topup-e2e.ts <TEST_ORG_ID>'); process.exit(2); }

  for (const pack of PACKS) {
    console.log(`\n=== ${pack.credits} credits (₹${pack.inr}) ===`);
    const before = await paid(orgId);

    const { data: purchase } = await supabase
      .from('credit_purchases')
      .insert({
        organization_id: orgId, credits: pack.credits, amount_paid: pack.inr, currency: 'INR',
        status: 'pending', provider: 'razorpay', provider_mode: 'test', fulfillment_status: 'pending',
        provider_order_id: `order_e2e_${pack.credits}_${before}`,
        provider_payload: { checkout_flow: 'orchestrator_phase1', e2e: true },
      })
      .select('id').single();
    const purchaseId = (purchase as any).id as string;

    const r1 = await completePurchase(purchaseId, `pay_e2e_${pack.credits}`);
    const mid = await paid(orgId);
    const r2 = await completePurchase(purchaseId, `pay_e2e_${pack.credits}`); // duplicate
    const after = await paid(orgId);

    const inv1 = await generateTopupInvoice(purchaseId);
    const inv2 = await generateTopupInvoice(purchaseId); // duplicate

    console.log(`paid balance: ${before} → ${mid} → ${after}`);
    console.log(`granted: ${mid - before} (expect ${pack.credits}) · dup grant: ${after - mid} (expect 0)`);
    console.log(`fulfill #1: ${r1.success} · fulfill #2 (dup): ${r2.success} (idempotent)`);
    console.log(`invoice: ${inv1?.invoiceNumber} created=${inv1?.created} · retry created=${inv2?.created} (expect false)`);
    console.log((mid - before === pack.credits && after - mid === 0 && inv2?.created === false)
      ? '✅ PASS — exact allocation, idempotent, one invoice'
      : '❌ FAIL');
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e?.message ?? e); process.exit(1); });
