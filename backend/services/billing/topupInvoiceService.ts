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
  // MONEY: an invoice is a tax document. Every read and write below is checked,
  // and a failure THROWS (callers catch and log 'invoice deferred'); it never
  // issues an invoice without its line items, and never returns a half-built
  // draft as if it were issued. A draft left by an earlier failure is RESUMED.
  const { data: purchase, error: purchaseErr } = await supabase
    .from('credit_purchases')
    .select('id, organization_id, credits, amount_paid, currency, provider, reference_id, status, created_at')
    .eq('id', purchaseId)
    .maybeSingle();
  if (purchaseErr) throw new Error(`[topupInvoice] purchase read failed for ${purchaseId}: ${purchaseErr.message}`);
  if (!purchase) return null;
  const p = purchase as PurchaseRow;
  if (p.status !== 'completed') return null; // only invoice PAID purchases

  const invoiceNumber = invoiceNumberFor(p);

  // Idempotency: invoice_number is deterministic + UNIQUE.
  const { data: existing, error: existingErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, status')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle();
  if (existingErr) throw new Error(`[topupInvoice] invoice lookup failed for ${invoiceNumber}: ${existingErr.message}`);
  if (existing) {
    const ex = existing as { id: string; status: string | null };
    // A draft is an invoice an earlier attempt did not finish: finish it.
    if (ex.status === 'draft') {
      await finalizeTopupInvoice(ex.id, p, Number(p.amount_paid ?? 0), p.currency ?? 'INR');
    }
    return { invoiceId: ex.id, invoiceNumber, created: false };
  }

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
    const { data: raced, error: racedErr } = await supabase.from('invoices').select('id').eq('invoice_number', invoiceNumber).maybeSingle();
    if (racedErr) throw new Error(`[topupInvoice] invoice re-read failed for ${invoiceNumber}: ${racedErr.message}`);
    if (raced) return { invoiceId: (raced as any).id, invoiceNumber, created: false };
    throw new Error(`[topupInvoice] invoice insert failed for ${invoiceNumber}: ${invErr?.message ?? 'no row returned'}`);
  }
  const invoiceId = (inv as any).id as string;

  await finalizeTopupInvoice(invoiceId, p, amount, currency);
  return { invoiceId, invoiceNumber, created: true };
}

/**
 * Add the line item (if absent) and issue the invoice. Line items first: an
 * invoice is never issued without them. Each step is checked; a failure
 * throws and leaves a DRAFT that the next call resumes.
 */
async function finalizeTopupInvoice(invoiceId: string, p: PurchaseRow, amount: number, currency: string): Promise<void> {
  const { data: lines, error: linesErr } = await supabase
    .from('invoice_line_items')
    .select('id')
    .eq('invoice_id', invoiceId)
    .limit(1);
  if (linesErr) throw new Error(`[topupInvoice] line-item read failed for ${invoiceId}: ${linesErr.message}`);

  if (!Array.isArray(lines) || lines.length === 0) {
    const { error: lineErr } = await supabase.from('invoice_line_items').insert({
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
    if (lineErr) throw new Error(`[topupInvoice] line-item insert failed for ${invoiceId}: ${lineErr.message}`);
  }

  // Issue + mark paid (after line items exist). Exactly one draft row moves.
  const now = new Date().toISOString();
  const { data: issued, error: issueErr } = await supabase.from('invoices')
    .update({ status: 'paid', issued_at: now, paid_at: now, pdf_url: `/api/billing/invoices/${invoiceId}/pdf`, updated_at: now })
    .eq('id', invoiceId)
    .eq('status', 'draft')
    .select('id');
  if (issueErr) throw new Error(`[topupInvoice] issue failed for ${invoiceId}: ${issueErr.message}`);
  if (!Array.isArray(issued) || issued.length !== 1) {
    // 0 rows: a concurrent call issued it first - fine, it is issued.
    const { data: now2, error: now2Err } = await supabase.from('invoices').select('status').eq('id', invoiceId).maybeSingle();
    if (now2Err) throw new Error(`[topupInvoice] issue re-read failed for ${invoiceId}: ${now2Err.message}`);
    if ((now2 as { status?: string } | null)?.status !== 'paid') {
      throw new Error(`[topupInvoice] invoice ${invoiceId} not issued (status=${(now2 as { status?: string } | null)?.status ?? 'missing'})`);
    }
  }
}
