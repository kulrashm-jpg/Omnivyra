/**
 * zod 3 -> zod 4 behaviour-preservation helpers (security/zod4).
 *
 * zod 4 changed two things this codebase depends on and that cannot be
 * restored by a plain API rename:
 *
 *   1. `z.string().url()` now trims the value and strips tab/newline from the
 *      parsed output. zod 3 accepted exactly when `new URL(raw)` parsed and
 *      returned the raw string unchanged. `v3Url()` restores that.
 *   2. Default error messages were rewritten. The Chrome-extension API returns
 *      `issues[0].message` to its client, so `v3MessageErrorMap` reproduces the
 *      zod 3 default messages for every issue kind those schemas can raise.
 *      Schema-level messages (e.g. `.min(1, 'msg')`) take precedence over a
 *      per-parse error map in zod 4, exactly as they did in zod 3.
 *
 * Both are pinned by backend/tests/unit/zodMajorUpgradeCharacterization.test.ts
 * against outcomes captured from zod 3.25.76.
 */
import { z } from 'zod';

/** zod 3 `z.string().url(message)`: WHATWG URL parse of the raw value, raw value kept. */
export function v3Url(message?: string) {
  return z.string().superRefine((value, ctx) => {
    try {
      new URL(value);
    } catch {
      ctx.addIssue({ code: 'invalid_format', format: 'url', input: value, message: message ?? 'Invalid url' });
    }
  });
}

/** zod 3 `getParsedType` names, used in "Expected X, received Y". */
function v3ParsedType(data: unknown): string {
  switch (typeof data) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return 'string';
    case 'number':
      return Number.isNaN(data) ? 'nan' : 'number';
    case 'boolean':
      return 'boolean';
    case 'function':
      return 'function';
    case 'bigint':
      return 'bigint';
    case 'symbol':
      return 'symbol';
    case 'object':
      if (Array.isArray(data)) return 'array';
      if (data === null) return 'null';
      if (typeof (data as { then?: unknown }).then === 'function' && typeof (data as { catch?: unknown }).catch === 'function') {
        return 'promise';
      }
      if (typeof Map !== 'undefined' && data instanceof Map) return 'map';
      if (typeof Set !== 'undefined' && data instanceof Set) return 'set';
      if (typeof Date !== 'undefined' && data instanceof Date) return 'date';
      return 'object';
    default:
      return 'unknown';
  }
}

/** zod 3 `util.joinValues`. */
function v3JoinValues(values: readonly unknown[]): string {
  return values.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(' | ');
}

function tooSmallMessage(origin: string, minimum: unknown, inclusive: boolean, exact: boolean): string | undefined {
  if (origin === 'string') {
    return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${minimum} character(s)`;
  }
  if (origin === 'number' || origin === 'int') {
    return `Number must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${minimum}`;
  }
  if (origin === 'array') {
    return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${minimum} element(s)`;
  }
  return undefined;
}

function tooBigMessage(origin: string, maximum: unknown, inclusive: boolean, exact: boolean): string | undefined {
  if (origin === 'string') {
    return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${maximum} character(s)`;
  }
  if (origin === 'number' || origin === 'int') {
    return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${maximum}`;
  }
  if (origin === 'array') {
    return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${maximum} element(s)`;
  }
  return undefined;
}

type AnyIssue = Record<string, any> & { code?: string; input?: unknown };

/**
 * zod 4 rejects ±Infinity at the number type check. zod 3 passed it to the
 * schema's checks in declaration order; reproduce the first failing check's
 * zod 3 message.
 */
function v3InfinityMessage(issue: AnyIssue): string | undefined {
  const input = issue.input as number;
  const checks: any[] = issue.inst?._zod?.def?.checks ?? [];
  for (const ch of checks) {
    const def = ch?._zod?.def ?? {};
    if (def.check === 'number_format' && String(def.format ?? '').includes('int')) {
      return 'Expected integer, received float';
    }
    if (def.check === 'greater_than' && !(def.inclusive ? input >= def.value : input > def.value)) {
      return tooSmallMessage('number', def.value, Boolean(def.inclusive), false);
    }
    if (def.check === 'less_than' && !(def.inclusive ? input <= def.value : input < def.value)) {
      return tooBigMessage('number', def.value, Boolean(def.inclusive), false);
    }
  }
  return undefined;
}

const V3_FORMAT_NAMES: Record<string, string> = {
  guid: 'uuid',
  uuid: 'uuid',
  url: 'url',
  datetime: 'datetime',
  email: 'email',
};

/**
 * Per-parse zod 4 error map that reproduces zod 3's default English messages.
 * Use as `schema.parse(data, { error: v3MessageErrorMap })`.
 */
export const v3MessageErrorMap = (raw: unknown): string | undefined => {
  const issue = raw as AnyIssue;
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) return 'Required';
      if (issue.expected === 'int') return 'Expected integer, received float';
      if (issue.expected === 'number' && typeof issue.input === 'number' && !Number.isNaN(issue.input) && !Number.isFinite(issue.input)) {
        return v3InfinityMessage(issue);
      }
      // zod 4 names a record's type "record"; zod 3 called it "object".
      const expected = issue.expected === 'record' ? 'object' : issue.expected;
      return `Expected ${expected}, received ${v3ParsedType(issue.input)}`;
    }
    case 'invalid_value': {
      if (issue.input === undefined) return 'Required';
      const values: unknown[] = issue.values ?? [];
      const isEnum = issue.inst?._zod?.def?.type === 'enum';
      if (isEnum) {
        if (typeof issue.input !== 'string') return `Expected ${v3JoinValues(values)}, received ${v3ParsedType(issue.input)}`;
        return `Invalid enum value. Expected ${v3JoinValues(values)}, received '${issue.input}'`;
      }
      if (values.length === 1) return `Invalid literal value, expected ${JSON.stringify(values[0])}`;
      return undefined;
    }
    case 'too_small':
      return tooSmallMessage(issue.origin, issue.minimum, Boolean(issue.inclusive), Boolean(issue.exact));
    case 'too_big':
      return tooBigMessage(issue.origin, issue.maximum, Boolean(issue.inclusive), Boolean(issue.exact));
    case 'invalid_format':
      if (issue.format === 'regex') return 'Invalid';
      return `Invalid ${V3_FORMAT_NAMES[issue.format] ?? issue.format}`;
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${(issue.keys ?? []).map((k: string) => `'${k}'`).join(', ')}`;
    case 'invalid_union':
      return 'Invalid input';
    case 'custom':
      return 'Invalid input';
    default:
      return undefined;
  }
};
