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

/**
 * A top-up invoice write that did not happen (B4). `retryable` says whether running generateTopupInvoice again can
 * succeed (a failed write: yes - the draft is resumed) or not (an ownership mismatch: no - an operator must look).
 */
export class TopupInvoiceError extends Error {
  constructor(
    public readonly code: 'TOPUP_INVOICE_READ_FAILED' | 'TOPUP_INVOICE_LINE_FAILED' | 'TOPUP_INVOICE_MARK_PAID_FAILED' | 'TOPUP_INVOICE_OWNERSHIP_MISMATCH',
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'TopupInvoiceError';
  }
}

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
  const amount = Number(p.amount_paid ?? 0);
  const currency = p.currency ?? 'INR';

  // Idempotency: invoice_number is deterministic + UNIQUE.
  const { data: existing, error: existingErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total_amount, currency, metadata')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle();
  if (existingErr) {
    throw new TopupInvoiceError('TOPUP_INVOICE_READ_FAILED', true, `invoice lookup failed for ${invoiceNumber}: ${existingErr.message}`);
  }
  if (existing) return resumeExisting(existing as ExistingInvoice, p, invoiceNumber, amount, currency);

  const day = new Date(p.created_at).toISOString().slice(0, 10);

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

  // Race: another request created it first → resume THAT one (same ownership guard).
  if (invErr || !inv) {
    const { data: raced } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total_amount, currency, metadata')
      .eq('invoice_number', invoiceNumber)
      .maybeSingle();
    if (raced) return resumeExisting(raced as ExistingInvoice, p, invoiceNumber, amount, currency);
    return null;
  }
  const invoiceId = (inv as any).id as string;
  await ensureLineAndMarkPaid(invoiceId, p, amount, currency);
  return { invoiceId, invoiceNumber, created: true };
}

interface ExistingInvoice {
  id: string;
  invoice_number: string;
  status: string | null;
  total_amount: number | string | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * B4 (financial-writes contract; e9 BLOCKING, e1 ruling). An invoice that already exists under this number is
 * returned untouched only when it is PAID. A DRAFT is what a failed run leaves behind (line insert or mark-paid
 * failed): returning it as "done" was a permanent gap - the invoice would never get its line or be marked paid.
 * It is RESUMED - but only after proving it belongs to THIS purchase (same purchase id, same amount, same
 * currency): invoice numbers derive from a prefix of the purchase id, so a reused number must never attach this
 * purchase's line to someone else's draft. A mismatch is a permanent, typed error and touches nothing.
 */
async function resumeExisting(
  existing: ExistingInvoice, p: PurchaseRow, invoiceNumber: string, amount: number, currency: string,
): Promise<TopupInvoiceResult> {
  const md = existing.metadata ?? {};
  const owned = md.purchase_id === p.id
    && Number(existing.total_amount ?? NaN) === amount
    && (existing.currency ?? null) === currency;
  if (!owned) {
    throw new TopupInvoiceError('TOPUP_INVOICE_OWNERSHIP_MISMATCH', false,
      `invoice ${invoiceNumber} exists for purchase ${String(md.purchase_id ?? 'unknown')} (${String(existing.total_amount)} ${String(existing.currency)}), not ${p.id} (${amount} ${currency})`);
  }
  if (existing.status === 'paid') return { invoiceId: existing.id, invoiceNumber, created: false };
  await ensureLineAndMarkPaid(existing.id, p, amount, currency);
  return { invoiceId: existing.id, invoiceNumber, created: false };
}

/** The line item (once - looked up by invoice + purchase reference) then issue + mark paid. Each write is READ. */
async function ensureLineAndMarkPaid(invoiceId: string, p: PurchaseRow, amount: number, currency: string): Promise<void> {
  const { data: lines, error: lineReadErr } = await supabase
    .from('invoice_line_items')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('reference_type', 'credit_purchase')
    .eq('reference_id', p.id);
  if (lineReadErr) {
    throw new TopupInvoiceError('TOPUP_INVOICE_READ_FAILED', true, `line lookup failed for invoice ${invoiceId}: ${lineReadErr.message}`);
  }
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
    if (lineErr) {
      throw new TopupInvoiceError('TOPUP_INVOICE_LINE_FAILED', true, `line insert failed for invoice ${invoiceId}: ${lineErr.message}`);
    }
  }

  // Issue + mark paid (after the line exists). Must change exactly one row.
  const now = new Date().toISOString();
  const { data: paid, error: paidErr } = await supabase.from('invoices')
    .update({ status: 'paid', issued_at: now, paid_at: now, pdf_url: `/api/billing/invoices/${invoiceId}/pdf`, updated_at: now })
    .eq('id', invoiceId)
    .select('id');
  if (paidErr || !Array.isArray(paid) || paid.length !== 1) {
    throw new TopupInvoiceError('TOPUP_INVOICE_MARK_PAID_FAILED', true,
      `mark-paid failed for invoice ${invoiceId}: ${paidErr?.message ?? `matched ${Array.isArray(paid) ? paid.length : 'no'} rows`}`);
  }
}
