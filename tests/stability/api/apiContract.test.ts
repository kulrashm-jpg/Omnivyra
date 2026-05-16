import { expectContainsAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/api response contract', () => {
  test('auth APIs keep consistent method and error response structures', () => {
    const files = [
      'pages/api/auth/login.ts',
      'pages/api/auth/session.ts',
      'pages/api/auth/reset.ts',
      'pages/api/auth/sync-supabase-user.ts',
    ];

    for (const file of files) {
      const source = readRepoFile(file);
      expect(source).toContain("error: 'Method not allowed'");
      expect(source).toMatch(/res\.status\(405\)\.json\(/);
    }
  });

  test('core API contracts continue to serialize object payloads, not raw strings', () => {
    const session = readRepoFile('pages/api/auth/session.ts');
    const billingSummary = readRepoFile('pages/api/company/billing/summary.ts');
    const billingLedger = readRepoFile('pages/api/company/billing/ledger.ts');

    expectContainsAll(session, [
      'return res.status(200).json({',
      'user: {',
      'session: {',
    ]);
    expectContainsAll(billingSummary, [
      'return res.status(200).json({',
      'organizationId: companyId',
    ]);
    expectContainsAll(billingLedger, [
      'return res.status(200).json({',
      'rows',
      'totalCount',
      'pagination',
    ]);
  });
});
