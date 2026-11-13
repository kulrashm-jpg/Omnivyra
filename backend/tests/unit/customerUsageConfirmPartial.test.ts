/**
 * e9 ruling 2026-11-13 (BLOCKING launch, customer-visible): live prod settles every token-priced action with ONE
 * credit_transactions row of execution_phase 'confirm_partial' (C100: the live apply_credit_partial_confirm). The
 * customer-facing usage readers counted only 'confirm', so customers saw their balance drop while their usage, billing
 * history and usage export showed less than they were charged. Fixtures use the LIVE row shape (transaction_type
 * 'deduction', note defaulting to the caller's note, deltas = -(consumed)).
 */
import * as fs from 'fs';
import * as path from 'path';

const LIVE_CONFIRM_PARTIAL = {
  id: 'cp-1', organization_id: 'org-1', transaction_type: 'deduction', execution_phase: 'confirm_partial',
  credits_delta: -4, reference_type: 'content_generation', reference_id: null, note: 'content generation',
  parent_transaction_id: 'hold-1', idempotency_key: 'k:confirm', created_at: '2026-11-13T10:00:00Z',
};
const FIXED_CONFIRM = { ...LIVE_CONFIRM_PARTIAL, id: 'c-1', execution_phase: 'confirm', credits_delta: -2 };

// Fake PostgREST: applies .eq / .in on execution_phase to the fixture rows (a filter that misses a phase misses the row).
const rows = [LIVE_CONFIRM_PARTIAL, FIXED_CONFIRM];
function query(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  const q: any = {};
  q.select = () => q;
  q.order = () => q;
  q.gte = () => q;
  q.lte = () => q;
  q.limit = () => q;
  q.eq = (col: string, v: unknown) => { if (col === 'execution_phase') filters.push((r) => r[col] === v); return q; };
  q.in = (col: string, v: unknown[]) => { if (col === 'execution_phase') filters.push((r) => v.includes(r[col])); return q; };
  q.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: table === 'credit_transactions' ? rows.filter((r) => filters.every((f) => f(r as never))) : [], error: null });
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => query(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => query(t) }));
jest.mock('../../services/billing/exports/auditManifestService', () => ({ recordExportManifest: jest.fn(async () => ({ id: 'm' })) }));
jest.mock('../../services/monetizationBetaAccessService', () => ({
  getOrganizationBetaTag: jest.fn(async () => ({ beta_cohort: null, beta_access_level: null, monetization_beta_enabled: false })),
}));

import { exportCompanyUsage, exportReservationLifecycle } from '../../services/billing/exports/ledgerExportService';
import { listCustomerBillingEvents } from '../../services/customerBillingProjectionService';

describe('customer-visible usage includes LIVE confirm_partial settles', () => {
  it('usage export (company/billing/export -> exportCompanyUsage) includes the confirm_partial row', async () => {
    const r = await exportCompanyUsage({ format: 'json' as never, requestedBy: 'u', organizationId: 'org-1' });
    expect(r.rowCount).toBe(2);
    expect(r.body).toContain('cp-1');
  });

  it('reservation lifecycle export includes the confirm_partial row', async () => {
    const r = await exportReservationLifecycle({ format: 'json' as never, requestedBy: 'u', organizationId: 'org-1' });
    expect(r.body).toContain('cp-1');
  });

  it('billing history (credits/transactions) shows the confirm_partial row as "credits used" with its charge', async () => {
    const events = await listCustomerBillingEvents({ organizationId: 'org-1' });
    const ev = events.find((e) => e.id === 'cp-1');
    expect(ev).toMatchObject({ type: 'charge', status: 'completed', customer_state: 'credits_used', credits: 4 });
  });
});

describe('the two usage summary routes count confirm_partial (source pin; mutation-checked)', () => {
  const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  it.each(['pages/api/credits/summary.ts', 'pages/api/company/billing/summary.ts'])('%s', (rel) => {
    const s = src(rel);
    expect(s).toMatch(/const CONFIRM_PHASES: readonly string\[\] = \['confirm', 'confirm_partial'\];/);
    expect(s).toMatch(/\.in\('execution_phase', \[\.\.\.CONFIRM_PHASES\]\)/);
    // positive control for the negative: the old single-phase filter is gone
    expect(s).not.toMatch(/\.eq\('execution_phase', 'confirm'\)/);
  });
});
