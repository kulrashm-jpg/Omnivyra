/**
 * Billing Center — READ-ONLY aggregator for the customer billing page.
 *
 * Composes existing data only (no new tables, no mutation):
 *   - current plan      → organization_plan_assignments → pricing_plans.plan_key
 *   - credit pools      → creditAccountabilityService (plan / bonus / top-up)
 *   - billing history   → credit_purchases
 *   - invoice history   → invoices
 *   - payment methods   → none stored per-org (no gateway) → empty
 *
 * Consumption priority (plan → bonus → top-up; top-up never expires) is enforced
 * by the wallet (creditPriorityService); this only SURFACES it.
 */
import { supabase } from '../db/supabaseClient';
import { getCreditAccountability, type CreditAccountability } from './creditAccountabilityService';
import { getAllocationStatus, type AllocationStatus } from './subscriptionAllocationService';

export interface BillingHistoryItem {
  id: string;
  credits: number;
  amount_paid: number | null;
  currency: string | null;
  status: string | null;
  provider: string | null;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

export interface PaymentMethodItem {
  id: string;
  brand: string | null;
  last4: string | null;
  is_default: boolean;
}

export interface BillingCenter {
  currentPlan: { key: string | null };
  credits: CreditAccountability | null;
  allocation: AllocationStatus | null;
  billingHistory: BillingHistoryItem[];
  invoices: InvoiceItem[];
  paymentMethods: PaymentMethodItem[];
}

export async function getBillingCenter(orgId: string): Promise<BillingCenter> {
  const [assignment, credits, allocation, purchases, invoices] = await Promise.all([
    supabase.from('organization_plan_assignments').select('plan_id').eq('organization_id', orgId).maybeSingle(),
    getCreditAccountability(orgId),
    getAllocationStatus(orgId),
    supabase
      .from('credit_purchases')
      .select('id, credits, amount_paid, currency, status, provider, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('invoices')
      .select('id, invoice_number, period_start, period_end, total_amount, currency, status, issued_at, paid_at')
      .eq('organization_id', orgId)
      .order('period_end', { ascending: false })
      .limit(50),
  ]);

  let planKey: string | null = null;
  const planId = (assignment.data as { plan_id?: string } | null)?.plan_id;
  if (planId) {
    const { data: plan } = await supabase.from('pricing_plans').select('plan_key').eq('id', planId).maybeSingle();
    planKey = (plan as { plan_key?: string } | null)?.plan_key ?? null;
  }

  return {
    currentPlan: { key: planKey },
    credits,
    allocation,
    billingHistory: (purchases.data ?? []) as BillingHistoryItem[],
    invoices: (invoices.data ?? []) as InvoiceItem[],
    // No per-org payment-method vault (no gateway). Methods are entered at checkout.
    paymentMethods: [],
  };
}
