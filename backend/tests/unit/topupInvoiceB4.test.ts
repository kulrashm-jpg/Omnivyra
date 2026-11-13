/**
 * B4 (financial-writes contract; e9 BLOCKING, e1 ruling) - a top-up invoice is never left without its line or
 * unpaid, and a draft is resumed only when it belongs to THIS purchase.
 * The supabase fake is STATEFUL (rows persist across a retry) and injects one failure per table/op.
 */
type Row = Record<string, any>;
const mockDb: { invoices: Row[]; lines: Row[]; purchase: Row | null; fail: Record<string, { message: string } | 'zero'>; writes: string[] } = {
  invoices: [], lines: [], purchase: null, fail: {}, writes: [],
};
const take = (k: string) => { const f = mockDb.fail[k]; delete mockDb.fail[k]; return f; };

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let mode: 'select' | 'update' = 'select';
      let patch: Row = {};
      const rows = () => (table === 'invoices' ? mockDb.invoices : table === 'invoice_line_items' ? mockDb.lines : (mockDb.purchase ? [mockDb.purchase] : []));
      const hit = () => rows().filter((r) => filters.every((f) => f(r)));
      const b: any = {};
      b.select = () => {
        if (mode === 'update') {
          const f = take(`${table}:update`);
          if (f && f !== 'zero') return Promise.resolve({ data: null, error: f });
          const h = f === 'zero' ? [] : hit();
          h.forEach((r) => Object.assign(r, patch));
          mockDb.writes.push(`${table}:update`);
          return Promise.resolve({ data: h.map((r) => ({ id: r.id })), error: null });
        }
        return b;
      };
      b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
      b.maybeSingle = async () => ({ data: hit()[0] ?? null, error: null });
      // An update awaited WITHOUT .select() still applies (like PostgREST) - it just returns no rows.
      b.then = (res: any, rej: any) => {
        if (mode === 'update') {
          const f = take(`${table}:update`);
          if (f && f !== 'zero') return Promise.resolve({ data: null, error: f }).then(res, rej);
          if (f !== 'zero') hit().forEach((r) => Object.assign(r, patch));
          mockDb.writes.push(`${table}:update`);
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        return Promise.resolve({ data: hit(), error: null }).then(res, rej);
      };
      b.insert = (row: Row) => {
        const f = take(`${table}:insert`);
        const ins = { id: `${table}-${mockDb.invoices.length + mockDb.lines.length + 1}`, ...row };
        const result = f && f !== 'zero' ? { data: null, error: f } : { data: { id: ins.id }, error: null };
        if (!result.error) { (table === 'invoices' ? mockDb.invoices : mockDb.lines).push(ins); mockDb.writes.push(`${table}:insert`); }
        const p: any = Promise.resolve(result);
        p.select = () => ({ maybeSingle: async () => result });
        return p;
      };
      b.update = (p: Row) => { mode = 'update'; patch = p; return b; };
      return b;
    },
  },
}));

import { generateTopupInvoice, TopupInvoiceError } from '../../services/billing/topupInvoiceService';

const PURCHASE = { id: 'aaaaaaaa-1111-4111-8111-111111111111', organization_id: 'org-1', credits: 100, amount_paid: 500, currency: 'INR', provider: 'razorpay', reference_id: 'pay_1', status: 'completed', created_at: '2026-11-10T10:00:00Z' };
const NUMBER = 'INV-202611-AAAAAAAA';
beforeEach(() => { mockDb.invoices = []; mockDb.lines = []; mockDb.purchase = { ...PURCHASE }; mockDb.fail = {}; mockDb.writes = []; });

it('CONTROL: a fresh invoice gets exactly one line and is marked paid', async () => {
  await expect(generateTopupInvoice(PURCHASE.id)).resolves.toMatchObject({ invoiceNumber: NUMBER, created: true });
  expect(mockDb.invoices).toHaveLength(1);
  expect(mockDb.invoices[0].status).toBe('paid');
  expect(mockDb.lines).toHaveLength(1);
});

it('a FAILED line insert throws (retryable); the retry RESUMES the draft: one line, marked paid', async () => {
  mockDb.fail['invoice_line_items:insert'] = { message: 'connection reset' };
  const err = await generateTopupInvoice(PURCHASE.id).catch((e) => e);
  expect(err).toBeInstanceOf(TopupInvoiceError);
  expect(err).toMatchObject({ code: 'TOPUP_INVOICE_LINE_FAILED', retryable: true });
  expect(mockDb.invoices[0].status).toBe('draft');
  await expect(generateTopupInvoice(PURCHASE.id)).resolves.toMatchObject({ created: false });
  expect(mockDb.lines).toHaveLength(1);
  expect(mockDb.invoices[0].status).toBe('paid');
});

it('a FAILED mark-paid throws; the retry does not duplicate the line and marks it paid', async () => {
  mockDb.fail['invoices:update'] = { message: 'timeout' };
  await expect(generateTopupInvoice(PURCHASE.id)).rejects.toMatchObject({ code: 'TOPUP_INVOICE_MARK_PAID_FAILED', retryable: true });
  expect(mockDb.lines).toHaveLength(1);
  await generateTopupInvoice(PURCHASE.id);
  expect(mockDb.lines).toHaveLength(1);
  expect(mockDb.invoices[0].status).toBe('paid');
});

it('a mark-paid that matches 0 rows is a failure, not success', async () => {
  mockDb.fail['invoices:update'] = 'zero';
  await expect(generateTopupInvoice(PURCHASE.id)).rejects.toThrow(/matched 0 rows/);
});

it('an existing PAID invoice is returned untouched - no write', async () => {
  mockDb.invoices = [{ id: 'inv-p', invoice_number: NUMBER, status: 'paid', total_amount: 500, currency: 'INR', metadata: { purchase_id: PURCHASE.id } }];
  await expect(generateTopupInvoice(PURCHASE.id)).resolves.toEqual({ invoiceId: 'inv-p', invoiceNumber: NUMBER, created: false });
  expect(mockDb.writes).toEqual([]);
});

it.each([
  ['another purchase id', { purchase_id: 'bbbbbbbb-2222-4222-8222-222222222222' }, 500, 'INR'],
  ['another amount', { purchase_id: PURCHASE.id }, 999, 'INR'],
  ['another currency', { purchase_id: PURCHASE.id }, 500, 'USD'],
])('e1: a DRAFT under this number that belongs to %s is NOT resumed - permanent typed error, nothing written', async (_n, metadata, total, currency) => {
  mockDb.invoices = [{ id: 'inv-x', invoice_number: NUMBER, status: 'draft', total_amount: total, currency, metadata }];
  const err = await generateTopupInvoice(PURCHASE.id).catch((e) => e);
  expect(err).toBeInstanceOf(TopupInvoiceError);
  expect(err).toMatchObject({ code: 'TOPUP_INVOICE_OWNERSHIP_MISMATCH', retryable: false });
  expect(mockDb.writes).toEqual([]);
  expect(mockDb.lines).toEqual([]);
});
