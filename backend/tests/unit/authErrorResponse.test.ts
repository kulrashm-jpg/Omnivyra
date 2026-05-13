/**
 * Pin the auth error envelope contract:
 *   - Every registry code yields a complete envelope.
 *   - The validator rejects every malformed shape we've actually seen
 *     in the wild (string error only, missing code, wrong types).
 *   - The validator detects a server claiming a fatality that disagrees
 *     with the registry — surfaces this as a soft problem.
 */

import {
  buildAuthErrorResponse,
  validateAuthErrorResponse,
  isAuthErrorResponse,
} from '../../../shared/contracts/security/AuthErrorResponse';
import {
  AUTH_ERROR_REGISTRY,
} from '../../../shared/contracts/security/AuthErrorRegistry';
import { AUTH_ERROR_CODE } from '../../../shared/contracts/security/AuthErrorCodes';

describe('buildAuthErrorResponse', () => {
  for (const code of Object.values(AUTH_ERROR_CODE)) {
    it(`produces a complete envelope for ${code}`, () => {
      const out = buildAuthErrorResponse({ code });
      expect(out.code).toBe(code);
      const contract = AUTH_ERROR_REGISTRY[code];
      expect(out.category).toBe(contract.category);
      expect(out.fatal).toBe(contract.fatal);
      expect(out.retryable).toBe(contract.retryable);
      expect(out.error).toBeTruthy();
    });
  }

  it('uses errorOverride when supplied', () => {
    const out = buildAuthErrorResponse({
      code: AUTH_ERROR_CODE.USER_NOT_FOUND,
      errorOverride: 'custom-text',
    });
    expect(out.error).toBe('custom-text');
  });

  it('attaches details + retryAfterMs when supplied', () => {
    const out = buildAuthErrorResponse({
      code: AUTH_ERROR_CODE.SCHEMA_MISMATCH,
      details: 'columns missing',
      retryAfterMs: 2_500,
    });
    expect(out.details).toBe('columns missing');
    expect(out.retryAfterMs).toBe(2_500);
  });
});

describe('isAuthErrorResponse', () => {
  it('rejects raw legacy shapes', () => {
    expect(isAuthErrorResponse({ error: 'X' })).toBe(false);
    expect(isAuthErrorResponse({ error: 'X', code: 'INVALID_SESSION' })).toBe(false);
    expect(isAuthErrorResponse(null)).toBe(false);
    expect(isAuthErrorResponse('string')).toBe(false);
  });

  it('accepts a fully-formed envelope', () => {
    const built = buildAuthErrorResponse({ code: AUTH_ERROR_CODE.USER_INVITED });
    expect(isAuthErrorResponse(built)).toBe(true);
  });
});

describe('validateAuthErrorResponse', () => {
  it('valid=true for a well-formed envelope built by buildAuthErrorResponse', () => {
    const built = buildAuthErrorResponse({ code: AUTH_ERROR_CODE.PROFILE_LOAD_FAILED });
    const v = validateAuthErrorResponse(built);
    expect(v.valid).toBe(true);
    expect(v.problems).toEqual([]);
    expect(v.payload?.code).toBe(AUTH_ERROR_CODE.PROFILE_LOAD_FAILED);
  });

  it('reports specific problems for each malformed field', () => {
    const v = validateAuthErrorResponse({
      error:     42,           // wrong type
      code:      'INVALID_SESSION',
      category:  'session',
      fatal:     'yes',        // wrong type
      retryable: false,
    });
    expect(v.valid).toBe(false);
    expect(v.problems).toEqual(expect.arrayContaining(['error_not_string', 'fatal_not_boolean']));
    expect(v.payload).toBeNull();
  });

  it('rejects unknown codes', () => {
    const v = validateAuthErrorResponse({
      error:     'x',
      code:      'BOGUS_CODE',
      category:  'session',
      fatal:     true,
      retryable: false,
    });
    expect(v.valid).toBe(false);
    expect(v.problems).toContain('code_not_in_registry');
  });

  it('soft-flags fatality disagreement with the registry', () => {
    const v = validateAuthErrorResponse({
      error:     'x',
      code:      'INVALID_SESSION',
      category:  'session',
      fatal:     false,        // disagrees with registry (must be true)
      retryable: false,
    });
    expect(v.problems).toContain('fatal_disagrees_with_registry');
  });

  it('rejects non-object inputs', () => {
    expect(validateAuthErrorResponse(null).valid).toBe(false);
    expect(validateAuthErrorResponse(undefined).valid).toBe(false);
    expect(validateAuthErrorResponse(7).valid).toBe(false);
    expect(validateAuthErrorResponse('x').valid).toBe(false);
  });
});
