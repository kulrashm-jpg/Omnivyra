/**
 * AUTH-001 §6 — canonical password policy.
 *
 * Locks the single 8–128 length policy that replaced the divergent client
 * (8–20) vs server (8–128) bounds.
 */
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePassword,
  PASSWORD_LENGTH_MESSAGE,
} from '../../../lib/auth/passwordPolicy';

describe('AUTH-001 §6 — canonical password policy', () => {
  test('bounds are 8–128 (NIST 800-63B length-only)', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  test('accepts lengths inside the bounds', () => {
    expect(validatePassword('a'.repeat(8)).valid).toBe(true);
    expect(validatePassword('a'.repeat(21)).valid).toBe(true); // old client bound rejected this
    expect(validatePassword('a'.repeat(128)).valid).toBe(true);
  });

  test('rejects lengths outside the bounds with the canonical message', () => {
    for (const pw of ['a'.repeat(7), 'a'.repeat(129), '']) {
      const result = validatePassword(pw);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.reason).toBe(PASSWORD_LENGTH_MESSAGE);
    }
  });

  test('no composition rules — long simple passphrases pass', () => {
    expect(validatePassword('correct horse battery staple').valid).toBe(true);
  });
});
