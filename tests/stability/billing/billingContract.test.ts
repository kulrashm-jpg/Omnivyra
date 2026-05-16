import { billingLedgerRowContract } from '../contracts/contractFixtures';
import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/billing contract', () => {
  test('company billing summary keeps read-only composite response fields', () => {
    const summary = readRepoFile('pages/api/company/billing/summary.ts');

    expectContainsAll(summary, [
      'Read-only',
      'assertOrgAccess',
      'organizationId: companyId',
      'generatedAt:',
      'wallet',
      'reservations:',
      'forecast',
      'invoiceProjection',
      'contract:',
      'subscriptions',
      'flags',
      'financialControls:',
      'topModules',
      'recentEvents',
    ]);
  });

  test('company billing ledger remains org-pinned and immutable in response shape', () => {
    const ledger = readRepoFile('pages/api/company/billing/ledger.ts');

    expectContainsAll(ledger, [
      'assertOrgAccess',
      ".eq('organization_id', companyId)",
      'execution_phase',
      'credits_delta',
      'balance_after',
      'idempotency_key',
      'immutable: true',
      'pagination: { limit, offset, returned: rows.length }',
    ]);
    expect(Object.keys(billingLedgerRowContract)).toEqual(expect.arrayContaining([
      'id',
      'execution_phase',
      'credits_delta',
      'balance_after',
      'idempotency_key',
      'immutable',
    ]));
  });

  test('billing export endpoint keeps idempotent, org-scoped response contract', () => {
    const exportApi = readRepoFile('pages/api/company/billing/export.ts');

    expectContainsAll(exportApi, [
      'withIdempotency',
      "scope: 'company-billing-export'",
      'assertOrgAccess',
      'organizationId: companyId',
      'ok:       true',
      'manifest: result.manifest',
      'rowCount: result.rowCount',
      'body:     result.body',
    ]);
  });

  test('idempotency recovery services do not directly mutate financial ledger balances', () => {
    const cleaner = readRepoFile('backend/services/billing/idempotency/apiIdempotencyKeyCleaner.ts');
    const recovery = readRepoFile('backend/services/billing/idempotency/idempotencyRecoveryService.ts');

    expectContainsAll(cleaner, [
      'api_idempotency_keys',
      "status:       'failed'",
      'dryRun',
      'Critical invariant: this NEVER touches the ledger',
    ]);
    expectContainsAll(recovery, [
      'Critical invariant: this service NEVER touches `credit_transactions` or',
      'billing_operations',
      'job_execution_registry',
      'credit_action_approvals',
      'validateTransition',
    ]);
    expectMatchesAll(recovery, [
      /surface:\s+'billing_operations' \| 'job_execution_registry' \| 'credit_action_approvals'/,
      /rawStatus:\s+string/,
    ]);
  });
});
