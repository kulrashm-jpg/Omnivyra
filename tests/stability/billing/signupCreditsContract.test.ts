import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

/**
 * REGRESSION-LOCK: signup -> company -> initial free credits.
 *
 * SAFETY: This is a STATIC source-contract test by design. The .env.local
 * Supabase points at the SHARED PRODUCTION project and `credit_transactions`
 * is an append-only immutable ledger (a DB trigger rejects DELETE/UPDATE even
 * for service_role). Therefore this suite NEVER signs up a user, NEVER creates
 * a company, and NEVER grants credits. It only asserts the wiring still exists
 * by reading source files — zero DB writes, zero ledger rows.
 *
 * What it locks:
 *   1. pages/api/auth/signup.ts keeps its work-email + domain-eligibility
 *      gates, the signup_intents upsert, and the RESUME_SIGNUP / ACCOUNT_EXISTS
 *      response codes.
 *   2. pages/api/onboarding/setup-company.ts calls grantInitialFreeCredit and
 *      keeps the companies.website_domain -> admin_email_domain "already in
 *      system" lookup that returns companyExists.
 *   3. backend/services/initialFreeCreditService.ts sources the amount/expiry
 *      from free_credit_config WHERE category='initial_free_credit'.
 *   4. GUARD: grantInitialFreeCredit is still imported AND invoked by
 *      setup-company.ts. sync-supabase-user.ts currently has an unconditional
 *      early `return { ok: true }` that disables the signup-intent company
 *      bootstrap (the would-be credit backstop). So if a future dev deletes
 *      the onboarding-path grant without first re-enabling a sync backstop,
 *      new users would silently get 0 credits. This guard fails loudly in
 *      that case.
 */
describe('stability/billing signup -> credits contract', () => {
  test('signup.ts uses the unified eligibility gate, signup_intents upsert, and resume/exists codes', () => {
    const signup = readRepoFile('pages/api/auth/signup.ts');

    // Work-email + domain gates are now the single authoritative identity
    // engine (validateCompanyIdentity) + eligibility model. (Updated for
    // Phase 4.5/8 — the old checkDomainEligibility call moved inside the
    // engine — and re-locked under AUTH-001.)
    expectContainsAll(signup, [
      'validateCompanyIdentity',
      'identity.eligible',
      'ELIGIBILITY_MESSAGES',
      "from('signup_intents')",
      ".from('signup_intents').insert({",
      "code:  'ACCOUNT_EXISTS'",
      "code:  'RESUME_SIGNUP'",
    ]);

    // The work-email (personal-domain) gate moved into the engine, classified as
    // PUBLIC_EMAIL — the single source of truth for eligibility decisions.
    const engine = readRepoFile('backend/services/domainEligibilityService.ts');
    expectContainsAll(engine, ['isPersonalEmailDomain', "'PUBLIC_EMAIL'"]);
  });

  test('setup-company.ts keeps the domain-first "already in system" lookup returning companyExists', () => {
    const setup = readRepoFile('pages/api/onboarding/setup-company.ts');

    expectContainsAll(setup, [
      "from('companies')",
      ".eq('website_domain', websiteDomain)",
      ".eq('admin_email_domain', adminEmailDomain)",
      'companyExists:      true,',
      'matchedCompanyId:',
      'matchedCompanyName:',
    ]);

    // website_domain must be checked first, then admin_email_domain as fallback.
    expectMatchesAll(setup, [
      /\.eq\('website_domain', websiteDomain\)[\s\S]*?\.eq\('admin_email_domain', adminEmailDomain\)/,
    ]);
  });

  test('setup-company.ts grants initial free credit via the shared service for the new company', () => {
    const setup = readRepoFile('pages/api/onboarding/setup-company.ts');

    expectContainsAll(setup, [
      "import { grantInitialFreeCredit } from '../../../backend/services/initialFreeCreditService'",
      'await grantInitialFreeCredit({',
      'orgId: companyId,',
      'userId: user.id,',
    ]);

    expectMatchesAll(setup, [
      /const grantResult = await grantInitialFreeCredit\(\{\s*orgId: companyId,\s*userId: user\.id,/,
    ]);
  });

  test('initialFreeCreditService sources amount/expiry from free_credit_config category initial_free_credit', () => {
    const svc = readRepoFile('backend/services/initialFreeCreditService.ts');

    expectContainsAll(svc, [
      "export const INITIAL_FREE_CREDIT_CATEGORY = 'initial_free_credit'",
      'export async function grantInitialFreeCredit(',
      "ownedDbTable('free_credit_config')",
      '.eq(\'category\', INITIAL_FREE_CREDIT_CATEGORY)',
    ]);
  });

  test('GUARD: the onboarding credit grant is still reachable from setup-company.ts (silent-removal trap)', () => {
    const setup = readRepoFile('pages/api/onboarding/setup-company.ts');
    const sync = readRepoFile('pages/api/auth/sync-supabase-user.ts');

    // The onboarding grant must remain imported AND invoked.
    expect(setup).toContain('grantInitialFreeCredit');
    expect(setup).toMatch(/await grantInitialFreeCredit\(\{/);

    // Document the known state of the sync backstop: bootstrapCompanyFromSignupIntent
    // is currently disabled by an unconditional early return. This assertion is
    // intentionally informational-locking: if a future dev RE-ENABLES the sync
    // backstop (removing this early return) AND that becomes the credit path,
    // they must revisit this guard. Until then, setup-company.ts is the ONLY
    // reachable initial-credit grant, so its presence (asserted above) is the
    // real safety net. We assert the early return still bookends the disabled
    // bootstrap so the trap stays meaningful.
    expectContainsAll(sync, [
      'async function bootstrapCompanyFromSignupIntent(',
      'auth_sync_signup_intent_company_bootstrap_disabled',
      'return { ok: true };',
    ]);
    expectMatchesAll(sync, [
      /auth_sync_signup_intent_company_bootstrap_disabled[\s\S]*?return \{ ok: true \};/,
    ]);
  });
});
