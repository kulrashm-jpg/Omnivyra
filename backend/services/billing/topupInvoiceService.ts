/**
 * Top-up invoice generation (§D). Creates ONE invoice + line item per PAID
 * top-up purchase, idempotently (deterministic invoice_number per purchase →
 * UNIQUE constraint blocks duplicates). Read existing on retry. PDF is rendered
 * on demand (see pages/api/billing/invoices/[id]/pdf.ts).
 *
 * Uses the existing `invoices` / `invoice_line_items` tables (no schema change).
 * Records only — no wallet/ledger writes.
 */
import { supabase } from '../../db/supabaseClient';

export interface TopupInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  created: boolean;
}

interface PurchaseRow {
  id: string;
  organization_id: string;
  credits: number;
  amount_paid: number | null;
  currency: string | null;
  provider: string | null;
  reference_id: string | null;
  status: string | null;
  created_at: string;
}

function invoiceNumberFor(purchase: PurchaseRow): string {
  const d = new Date(purchase.created_at);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `INV-${ym}-${purchase.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Generate (or return existing) invoice for a paid top-up purchase. Idempotent. */
export async function generateTopupInvoice(purchaseId: string): Promise<TopupInvoiceResult | null> {
  const { data: purchase } = await supabase
    .from('credit_purchases')
    .select('id, organization_id, credits, amount_paid, currency, provider, reference_id, status, created_at')
    .eq('id', purchaseId)
    .maybeSingle();
  if (!purchase) return null;
  const p = purchase as PurchaseRow;
  if (p.status !== 'completed') return null; // only invoice PAID purchases

  const invoiceNumber = invoiceNumberFor(p);

  // Idempotency: invoice_number is deterministic + UNIQUE.
  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle();
  if (existing) return { invoiceId: (existing as any).id, invoiceNumber, created: false };

  const amount = Number(p.amount_paid ?? 0);
  const day = new Date(p.created_at).toISOString().slice(0, 10);
  const currency = p.currency ?? 'INR';

  // Insert as draft first so line items can be added before the freeze-on-issued.
  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .insert({
      organization_id: p.organization_id,
      invoice_number: invoiceNumber,
      period_start: day,
      period_end: day,
      currency,
      subtotal_amount: amount,
      tax_amount: 0,
      total_amount: amount,
      status: 'draft',
      metadata: {
        flow: 'topup',
        purchase_id: p.id,
        credits: p.credits,
        provider: p.provider,
        provider_reference: p.reference_id,
      },
    })
    .select('id')
    .maybeSingle();

  // Race: another request created it first → return that one.
  if (invErr || !inv) {
    const { data: raced } = await supabase.from('invoices').select('id').eq('invoice_number', invoiceNumber).maybeSingle();
    if (raced) return { invoiceId: (raced as any).id, invoiceNumber, created: false };
    return null;
  }
  const invoiceId = (inv as any).id as string;

  await supabase.from('invoice_line_items').insert({
    invoice_id: invoiceId,
    description: `${p.credits} top-up credits`,
    quantity: p.credits,
    unit_price: p.credits > 0 ? amount / p.credits : amount,
    currency,
    subtotal: amount,
    tax_amount: 0,
    reference_type: 'credit_purchase',
    reference_id: p.id,
  });

  // Issue + mark paid (after line items exist).
  const now = new Date().toISOString();
  await supabase.from('invoices')
    .update({ status: 'paid', issued_at: now, paid_at: now, pdf_url: `/api/billing/invoices/${invoiceId}/pdf`, updated_at: now })
    .eq('id', invoiceId);

  return { invoiceId, invoiceNumber, created: true };
}
