/**
 * Invoice Preparation Service — Phase E (scaffolding)
 *
 * Generates draft invoices from credit consumption + payment activity over
 * a period. Stripe Tax / Avalara integration is Sprint 6+ scope per the
 * audit roadmap, so this service only produces DRAFT invoices and leaves
 * tax_amount = 0. The line items are derived from credit_transactions
 * (CONFIRM phase) grouped by action — finance can then review the draft
 * before issuing.
 *
 * The invoices table is in 20260664_phase2_governance_and_payment_foundation.sql;
 * invoice_line_items are frozen once status leaves 'draft' (DB trigger).
 */

import { randomUUID } from 'crypto';
import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { incrCounter } from '../billingMetrics';

export interface PrepareInvoiceArgs {
  organizationId: string;
  periodStart:    string;             // ISO date
  periodEnd:      string;             // ISO date
  currency?:      string;             // default 'USD'
  preparedBy:     string;             // actor user id
  metadata?:      Record<string, unknown>;
}

export interface InvoiceDraft {
  id:               string;
  invoiceNumber:    string;
  subtotalAmount:   number;
  totalAmount:      number;
  currency:         string;
  lineItems:        Array<{
    description:    string;
    quantity:       number;
    unitPrice:      number;
    subtotal:       number;
    referenceType?: string;
  }>;
}

export async function prepareDraftInvoice(args: PrepareInvoiceArgs): Promise<InvoiceDraft | null> {
  const currency = args.currency ?? 'USD';

  // 1. Compute the period rollup from credit_transactions CONFIRM rows
  const { data: txns, error } = await supabase
    .from('credit_transactions')
    .select('credits_delta, usd_equivalent, reference_type, created_at')
    .eq('organization_id', args.organizationId)
    .eq('execution_phase', 'confirm')
    .gte('created_at', args.periodStart)
    .lte('created_at', args.periodEnd);

  if (error) {
    logger.error('invoice_period_query_failed', { org: args.organizationId, message: error.message });
    return null;
  }
  const rows = (txns ?? []) as Array<{ credits_delta: number; usd_equivalent: number | null; reference_type: string | null }>;
  if (rows.length === 0) return null;

  // 2. Group by reference_type so each action is a line item.
  const groups = new Map<string, { credits: number; usd: number; count: number }>();
  for (const r of rows) {
    const key = r.reference_type ?? 'unknown';
    const usd = Number(r.usd_equivalent ?? 0);
    const credits = Math.abs(Number(r.credits_delta ?? 0));
    const cur = groups.get(key) ?? { credits: 0, usd: 0, count: 0 };
    cur.credits += credits;
    cur.usd     += usd;
    cur.count   += 1;
    groups.set(key, cur);
  }

  const lineItems: InvoiceDraft['lineItems'] = [];
  let subtotal = 0;
  for (const [refType, agg] of groups) {
    const unitPrice = agg.credits > 0 ? agg.usd / agg.credits : 0;
    lineItems.push({
      description:   `Usage: ${refType} (${agg.count} events, ${agg.credits} credits)`,
      quantity:      agg.credits,
      unitPrice,
      subtotal:      agg.usd,
      referenceType: refType,
    });
    subtotal += agg.usd;
  }

  // 3. Insert draft invoice
  const invoiceId = randomUUID();
  const invoiceNumber = `INV-${args.organizationId.slice(0, 8)}-${Date.now()}`;
  const { error: invErr } = await supabase.from('invoices').insert({
    id:             invoiceId,
    organization_id: args.organizationId,
    invoice_number: invoiceNumber,
    period_start:   args.periodStart.slice(0, 10),
    period_end:     args.periodEnd.slice(0, 10),
    currency,
    subtotal_amount: subtotal,
    tax_amount:     0,
    total_amount:   subtotal,
    status:         'draft',
    metadata:       { prepared_by: args.preparedBy, ...(args.metadata ?? {}) },
  });
  if (invErr) {
    logger.error('invoice_draft_insert_failed', { org: args.organizationId, message: invErr.message });
    return null;
  }

  // 4. Insert line items
  if (lineItems.length > 0) {
    const { error: liErr } = await supabase.from('invoice_line_items').insert(
      lineItems.map(li => ({
        invoice_id:    invoiceId,
        description:   li.description,
        quantity:      li.quantity,
        unit_price:    li.unitPrice,
        currency,
        subtotal:      li.subtotal,
        reference_type: li.referenceType ?? null,
      })),
    );
    if (liErr) {
      logger.error('invoice_line_items_insert_failed', { invoiceId, message: liErr.message });
    }
  }

  incrCounter('billing_operations_total');  // closest existing counter family

  return {
    id:             invoiceId,
    invoiceNumber,
    subtotalAmount: subtotal,
    totalAmount:    subtotal,
    currency,
    lineItems,
  };
}
