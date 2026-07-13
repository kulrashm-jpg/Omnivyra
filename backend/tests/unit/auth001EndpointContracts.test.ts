/**
 * AUTH-001 — endpoint source contracts (verification gate, check-user
 * neutralization, CAPTCHA wiring, correlation persistence, DB migration).
 *
 * STATIC source-contract tests (same pattern as
 * tests/stability/billing/signupCreditsContract.test.ts): the .env.local
 * Supabase is the shared production project, so these tests never sign up,
 * verify, or grant anything — they lock the wiring by reading source.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const containsAll = (src: string, tokens: string[]) => {
  for (const token of tokens) expect(src).toContain(token);
};

describe('AUTH-001 §1 — app-level email-verification gate', () => {
  test('every protected signup-journey endpoint enforces EMAIL_NOT_VERIFIED', () => {
    for (const file of [
      'pages/api/onboarding/setup-company.ts',
      'pages/api/onboarding/complete.ts',
      'pages/api/onboarding/profile.ts',
      'pages/api/onboarding/request-company-access.ts',
      'pages/api/auth/verify-email.ts',
    ]) {
      const src = read(file);
      expect(src).toContain("code: 'EMAIL_NOT_VERIFIED'");
      expect(src).toMatch(/emailVerified/);
    }
  });

  test('post-login-route routes unverified sessions back to login', () => {
    containsAll(read('pages/api/auth/post-login-route.ts'), [
      'authResult.user.emailVerified',
      'reason=verify_email',
    ]);
  });

  test('sync-supabase-user mirrors the auth confirm state — no unconditional true stamp', () => {
    const src = read('pages/api/auth/sync-supabase-user.ts');
    expect(src).toContain('is_email_verified: identity.emailVerified');
    expect(src).not.toContain('is_email_verified: true,');
  });

  test('the legacy auth facade exposes emailVerified for gate callers', () => {
    expect(read('backend/services/supabaseAuthService.ts')).toContain('emailVerified: result.user.emailVerified');
  });
});

describe('AUTH-001 §2 — check-user oracle neutralized', () => {
  test('rate-limited, constant response, fail-closed, no auth-admin fallback', () => {
    const src = read('pages/api/auth/check-user.ts');
    containsAll(src, [
      'checkRateLimit',
      "keyPrefix: 'rl:auth:check-user'",
      'logSecurityEvent',
      'res.status(500)',
    ]);
    // Constant response: no code path may return exists:true.
    expect(src).not.toMatch(/exists:\s*true/);
    // The second (auth admin REST) lookup path is gone — one code path only.
    expect(src).not.toContain('/auth/v1/admin/users');
  });
});

describe('AUTH-001 §3/§4 — CAPTCHA + rate-limit wiring', () => {
  test('signup, resend-verification, and reset verify CAPTCHA tokens', () => {
    for (const file of [
      'pages/api/auth/signup.ts',
      'pages/api/auth/resend-verification.ts',
      'pages/api/auth/reset.ts',
    ]) {
      containsAll(read(file), ['verifyCaptchaToken', 'CAPTCHA_FAILED_RESPONSE']);
    }
  });

  test('client forms send captchaToken and render the shared widget', () => {
    containsAll(read('pages/create-account.tsx'), ['CaptchaWidget', 'captchaToken']);
    containsAll(read('pages/login.tsx'), ['CaptchaWidget', 'captchaToken']);
  });

  test('setup-company and request-company-access now carry rate limits', () => {
    containsAll(read('pages/api/onboarding/setup-company.ts'), [
      "keyPrefix: 'rl:onboarding:setup-company'",
      "keyPrefix: 'rl:uid:setup-company'",
    ]);
    expect(read('pages/api/onboarding/request-company-access.ts')).toContain(
      "keyPrefix: 'rl:uid:request-company-access'",
    );
  });
});

describe('AUTH-001 §9/§10 — events + correlation persisted end to end', () => {
  test('signup.ts mints/reuses the journey ID and persists it on the intent', () => {
    containsAll(read('pages/api/auth/signup.ts'), [
      'ensureSignupCorrelationId',
      'correlation_id:           correlationId',
      "emitOutcome('SignupAttempted', 'allowed')",
      "emitOutcome('SignupValidated', 'allowed')",
      'signupRejectionEventFor',
    ]);
  });

  test('verification, onboarding, company, and credit stages all emit journey events', () => {
    expect(read('pages/api/auth/verify-email.ts')).toContain("event:         'VerificationSucceeded'");
    expect(read('pages/api/auth/resend-verification.ts')).toContain("event:         'VerificationSent'");
    expect(read('pages/api/onboarding/profile.ts')).toContain("event:         'OnboardingStarted'");
    const setup = read('pages/api/onboarding/setup-company.ts');
    containsAll(setup, ["'CompanyCreated'", "'OnboardingCompleted'", "'CreditsGranted'", "'CompanyExists'"]);
    const complete = read('pages/api/onboarding/complete.ts');
    containsAll(complete, ["'CreditsGranted'", "'OnboardingCompleted'"]);
  });
});

describe('AUTH-001 §8 — database hardening migration', () => {
  test('migration adds both partial unique indexes with duplicate safety', () => {
    const sql = read('supabase/migrations/20260713_auth001_signup_hardening.sql');
    containsAll(sql, [
      'idx_signup_intents_email_pending_unique',
      "WHERE status = 'pending'",
      'idx_companies_website_domain_unique',
      'RAISE WARNING',
    ]);
    // No destructive statements.
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  });
});
