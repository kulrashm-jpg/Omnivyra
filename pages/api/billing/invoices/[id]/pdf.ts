import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * GET /api/billing/invoices/:id/pdf?org_id=<id>
 *
 * Renders an invoice as a downloadable PDF on demand (pdfkit) from the stored
 * invoice + line items. Org-scoped, read-only. (§D/E)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import { withOrgAccess } from '../../../../../backend/middleware/withOrgAccess';
import { supabase } from '@/backend/db/supabaseClient';

const money = (a: number, c: string) => `${c === 'INR' ? '₹' : c === 'EUR' ? '€' : c === 'USD' ? '$' : c + ' '}${Number(a).toLocaleString()}`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const id = String(req.query.id ?? '');
  const orgId = String(req.query.org_id ?? '');
  if (!id || !orgId) return res.status(400).json({ error: 'id and org_id required' });

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, organization_id, invoice_number, currency, subtotal_amount, tax_amount, total_amount, status, issued_at, metadata')
    .eq('id', id)
    .maybeSingle();
  if (!invoice || (invoice as any).organization_id !== orgId) return res.status(404).json({ error: 'invoice_not_found' });
  const inv = invoice as any;

  const { data: items } = await supabase
    .from('invoice_line_items')
    .select('description, quantity, unit_price, subtotal, currency')
    .eq('invoice_id', id);

  const cur = inv.currency ?? 'INR';
  const meta = inv.metadata ?? {};

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_number}.pdf"`);
  doc.pipe(res);

  doc.fontSize(22).fillColor('#0A66C2').text('Omnivyra', { continued: false });
  doc.moveDown(0.2);
  doc.fontSize(14).fillColor('#071D3A').text('Tax Invoice');
  doc.moveDown(0.8);

  doc.fontSize(10).fillColor('#333');
  doc.text(`Invoice #: ${inv.invoice_number}`);
  doc.text(`Date: ${inv.issued_at ? new Date(inv.issued_at).toLocaleDateString() : '—'}`);
  doc.text(`Organization: ${inv.organization_id}`);
  doc.text(`Payment provider: ${meta.provider ?? '—'}`);
  doc.text(`Provider reference: ${meta.provider_reference ?? '—'}`);
  doc.text(`Status: ${String(inv.status).toUpperCase()}`);
  doc.moveDown(0.8);

  // Line items
  doc.fillColor('#0A66C2').text('Description', 50, doc.y, { continued: true });
  doc.text('Qty', 330, doc.y, { continued: true });
  doc.text('Amount', 430);
  doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#C9DDF3').stroke();
  doc.moveDown(0.4);
  doc.fillColor('#333');
  for (const li of (items ?? []) as any[]) {
    const y = doc.y;
    doc.text(String(li.description), 50, y, { width: 270, continued: false });
    doc.text(String(li.quantity), 330, y, { continued: false });
    doc.text(money(Number(li.subtotal ?? 0), li.currency ?? cur), 430, y);
    doc.moveDown(0.3);
  }
  doc.moveDown(0.6);

  // Totals
  doc.text(`Subtotal: ${money(Number(inv.subtotal_amount ?? 0), cur)}`, { align: 'right' });
  doc.text(`Tax: ${money(Number(inv.tax_amount ?? 0), cur)}`, { align: 'right' });
  doc.fontSize(12).fillColor('#071D3A').text(`Total: ${money(Number(inv.total_amount ?? 0), cur)}`, { align: 'right' });
  doc.moveDown(1);
  doc.fontSize(8).fillColor('#888').text(`${meta.credits ?? ''} top-up credits · charged in ${cur} · sandbox/test`, { align: 'center' });

  doc.end();
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/billing/invoices/:id/pdf' });
