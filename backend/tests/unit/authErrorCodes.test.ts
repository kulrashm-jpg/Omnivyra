/**
 * Pinned matrix for the typed auth error code contract.
 *
 * The Phase 2.B login loop was rooted in CompanyContext treating EVERY
 * 401 as a session-invalid signal and calling signOut(). The fix is the
 * typed-code contract: only INVALID_SESSION / ACCOUNT_DELETED /
 * ACCOUNT_DISABLED are session-fatal. These tests pin that decision so
 * a future change can't silently re-introduce the regression.
 */

import {
  AUTH_ERROR_CODE,
  isSessionFatalCode,
  normalizeAuthCode,
  SESSION_FATAL_AUTH_CODES,
  LEGACY_AUTH_CODE_ALIASES,
} from '../../../shared/contracts/security/AuthErrorCodes';

describe('SESSION_FATAL_AUTH_CODES', () => {
  it('includes exactly the three codes that should force sign-out', () => {
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.INVALID_SESSION)).toBe(true);
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.ACCOUNT_DELETED)).toBe(true);
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.ACCOUNT_DISABLED)).toBe(true);
    expect(SESSION_FATAL_AUTH_CODES.size).toBe(3);
  });

  it('does NOT include any lifecycle / schema / load-failure code', () => {
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.USER_INVITED)).toBe(false);
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.USER_NOT_FOUND)).toBe(false);
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.SCHEMA_MISMATCH)).toBe(false);
    expect(SESSION_FATAL_AUTH_CODES.has(AUTH_ERROR_CODE.PROFILE_LOAD_FAILED)).toBe(false);
  });
});

describe('isSessionFatalCode', () => {
  it.each([
    'INVALID_SESSION',
    'ACCOUNT_DELETED',
    'ACCOUNT_DISABLED',
  ])('returns true for %s', (code) => {
    expect(isSessionFatalCode(code)).toBe(true);
  });

  it.each([
    'USER_INVITED',
    'USER_NOT_FOUND',
    'SCHEMA_MISMATCH',
    'PROFILE_LOAD_FAILED',
    'UNKNOWN_CODE',
    null,
    undefined,
    '',
  ])('returns false for %s', (code) => {
    expect(isSessionFatalCode(code as string | null | undefined)).toBe(false);
  });

  it('treats the legacy AUTH_001 alias as ACCOUNT_DELETED (session-fatal)', () => {
    expect(LEGACY_AUTH_CODE_ALIASES.AUTH_001).toBe(AUTH_ERROR_CODE.ACCOUNT_DELETED);
    expect(isSessionFatalCode('AUTH_001')).toBe(true);
  });
});

describe('normalizeAuthCode', () => {
  it('returns canonical codes unchanged', () => {
    expect(normalizeAuthCode('USER_INVITED')).toBe('USER_INVITED');
    expect(normalizeAuthCode('SCHEMA_MISMATCH')).toBe('SCHEMA_MISMATCH');
  });

  it('resolves legacy aliases to canonical codes', () => {
    expect(normalizeAuthCode('AUTH_001')).toBe('ACCOUNT_DELETED');
  });

  it('returns null for unknown codes and falsy inputs', () => {
    expect(normalizeAuthCode('BOGUS')).toBeNull();
    expect(normalizeAuthCode(null)).toBeNull();
    expect(normalizeAuthCode(undefined)).toBeNull();
    expect(normalizeAuthCode('')).toBeNull();
  });
});
