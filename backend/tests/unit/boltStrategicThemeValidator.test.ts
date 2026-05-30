/**
 * Strategic-theme structural validator (Part 3) regression tests.
 */

import {
  validateStrategicTheme,
  assertValidStrategicTheme,
} from '../../../lib/shared/bolt/strategicThemeValidator';
import { BoltError, BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';

describe('validateStrategicTheme', () => {
  test('rejects null', () => {
    const r = validateStrategicTheme(null);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('THEME_MISSING');
  });
  test('rejects non-object', () => {
    expect(validateStrategicTheme('not an object').errors[0].code).toBe('THEME_INVALID_SHAPE');
    expect(validateStrategicTheme(42).errors[0].code).toBe('THEME_INVALID_SHAPE');
    expect(validateStrategicTheme([]).errors[0].code).toBe('THEME_INVALID_SHAPE');
  });
  test('rejects cyclic theme (serialization failure)', () => {
    const theme: Record<string, unknown> = { title: 'OK' };
    theme.self = theme;
    const r = validateStrategicTheme(theme);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('THEME_SERIALIZATION_FAILED');
  });
  test('rejects theme missing a title field', () => {
    const r = validateStrategicTheme({ description: 'something' });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('THEME_MISSING_REQUIRED_FIELD');
    expect(r.errors[0].field).toBe('title');
  });
  test('accepts theme with title at top level', () => {
    const r = validateStrategicTheme({ title: 'Launch comms' });
    expect(r.ok).toBe(true);
  });
  test('accepts theme with polished_title via core', () => {
    const r = validateStrategicTheme({ core: { polished_title: 'Launch comms' } });
    expect(r.ok).toBe(true);
  });
  test('rejects empty blueprint sub-object', () => {
    const r = validateStrategicTheme({
      title: 'OK',
      blueprint: {}, // present but empty → reject
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe('blueprint');
  });
  test('accepts blueprint with primary_recommendations', () => {
    const r = validateStrategicTheme({
      title: 'OK',
      blueprint: { primary_recommendations: ['topic 1'] },
    });
    expect(r.ok).toBe(true);
  });
  test('rejects array context_payload', () => {
    const r = validateStrategicTheme({
      title: 'OK',
      context_payload: ['not', 'an', 'object'],
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe('context_payload');
  });
  test('rejects array metadata', () => {
    const r = validateStrategicTheme({
      title: 'OK',
      metadata: ['no'],
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe('metadata');
  });
});

describe('assertValidStrategicTheme', () => {
  test('throws BoltError on first error', () => {
    expect(() => assertValidStrategicTheme(null)).toThrow(BoltError);
    try {
      assertValidStrategicTheme(null);
    } catch (e) {
      expect((e as BoltError).code).toBe(BOLT_ERROR_CODES.THEME_MISSING);
    }
  });
  test('does not throw on valid theme', () => {
    expect(() => assertValidStrategicTheme({ title: 'OK' })).not.toThrow();
  });
});
