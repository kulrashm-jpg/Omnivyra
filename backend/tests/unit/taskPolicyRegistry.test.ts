/**
 * Writer Wave 3 — Task Policy Registry.
 *
 * Pins that getTaskPolicy() returns a fully-seeded policy for EVERY Writer task
 * and that the seeded values are byte-identical to what the corresponding call
 * sites hardcode today (behavior-preserving):
 *   - master text  temp 0.7   (blueprintGenerator.ts:361,598)
 *   - master media temp 0.3   (blueprintGenerator.ts:308,504)
 *   - variant      temp 0     (platformVariantGenerator.ts:150,559)
 *   - adapt tight  temp 0.7 / loose 0.2 (quick-platform-adapt.ts:335)
 *   - model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
 *   - long-form timeout 240_000ms / short-form 30_000ms (aiGatewayCore)
 *   - DEFAULT_RETRY maxAttempts 2, backoff 2000ms, gateway error classification
 */

import {
  getTaskPolicy,
  DEFAULT_RETRY,
  classifyGatewayError,
  resolveWriterModel,
  ALL_WRITER_TASKS,
  MASTER_TEXT_TEMPERATURE,
  MASTER_MEDIA_TEMPERATURE,
  VARIANT_TEMPERATURE,
  ADAPT_TIGHT_TEMPERATURE,
  ADAPT_LOOSE_TEMPERATURE,
} from '../../services/content/runtime/taskPolicyRegistry';
import type { WriterContentType, WriterTask } from '../../services/content/runtime/contracts';

const EXPECTED_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CONTENT_TYPES: WriterContentType[] = ['post', 'thread', 'blog', 'article', 'story'];
const LONG_FORM_TIMEOUT = 240_000;
const SHORT_FORM_TIMEOUT = 30_000;

describe('taskPolicyRegistry — coverage', () => {
  it('returns a fully-seeded policy for every Writer task (content types + variant + adapt)', () => {
    for (const task of ALL_WRITER_TASKS as WriterTask[]) {
      const policy = getTaskPolicy(task);
      expect(policy).toBeDefined();
      expect(policy.model).toBe(EXPECTED_MODEL);
      expect(typeof policy.temperature).toBe('number');
      expect(policy.seed).toBeNull();
      expect(policy.streaming).toBe(false);
      expect(policy.cache).toEqual({ enabled: false });
      expect(policy.timeoutMs).toBeGreaterThan(0);
      expect(policy.retry).toBe(DEFAULT_RETRY);
    }
  });

  it('exposes exactly the 7 known tasks (5 content types + variant + adapt)', () => {
    expect([...ALL_WRITER_TASKS].sort()).toEqual(
      ['adapt', 'article', 'blog', 'post', 'story', 'thread', 'variant'].sort(),
    );
  });
});

describe('taskPolicyRegistry — behavior-preserving values', () => {
  it('master content types default to TEXT temperature 0.7 and long-form timeout', () => {
    for (const ct of CONTENT_TYPES) {
      const policy = getTaskPolicy(ct);
      expect(policy.temperature).toBe(MASTER_TEXT_TEMPERATURE);
      expect(policy.temperature).toBe(0.7);
      expect(policy.timeoutMs).toBe(LONG_FORM_TIMEOUT);
    }
  });

  it('post/thread MEDIA flow uses temperature 0.3', () => {
    for (const ct of ['post', 'thread'] as WriterContentType[]) {
      const policy = getTaskPolicy(ct, { media: true });
      expect(policy.temperature).toBe(MASTER_MEDIA_TEMPERATURE);
      expect(policy.temperature).toBe(0.3);
      expect(policy.timeoutMs).toBe(LONG_FORM_TIMEOUT);
    }
  });

  it('variant uses temperature 0 and short-form timeout', () => {
    const policy = getTaskPolicy('variant');
    expect(policy.temperature).toBe(VARIANT_TEMPERATURE);
    expect(policy.temperature).toBe(0);
    expect(policy.timeoutMs).toBe(SHORT_FORM_TIMEOUT);
  });

  it('adapt uses loose temperature 0.2 by default and tight 0.7 for tight formats', () => {
    const loose = getTaskPolicy('adapt');
    expect(loose.temperature).toBe(ADAPT_LOOSE_TEMPERATURE);
    expect(loose.temperature).toBe(0.2);
    expect(loose.timeoutMs).toBe(SHORT_FORM_TIMEOUT);

    const tight = getTaskPolicy('adapt', { tight: true });
    expect(tight.temperature).toBe(ADAPT_TIGHT_TEMPERATURE);
    expect(tight.temperature).toBe(0.7);
    expect(tight.timeoutMs).toBe(SHORT_FORM_TIMEOUT);
  });

  it('resolveWriterModel matches the OPENAI_MODEL || gpt-4o-mini contract', () => {
    expect(resolveWriterModel()).toBe(EXPECTED_MODEL);
  });
});

describe('DEFAULT_RETRY', () => {
  it('is a single-retry policy with a 2s backoff (gateway parity)', () => {
    expect(DEFAULT_RETRY.maxAttempts).toBe(2);
    expect(DEFAULT_RETRY.backoffMs).toBe(2000);
    expect(typeof DEFAULT_RETRY.classify).toBe('function');
  });
});

describe('classifyGatewayError', () => {
  it('classifies timeouts', () => {
    expect(classifyGatewayError({ code: 'PROVIDER_TIMEOUT', status: 504 })).toBe('timeout');
    expect(classifyGatewayError({ name: 'AbortError' })).toBe('timeout');
    expect(classifyGatewayError({ status: 408 })).toBe('timeout');
    expect(classifyGatewayError(new Error('request timed out after 30000ms'))).toBe('timeout');
  });

  it('classifies 429/529 rate-limit/overload and network errors as transient', () => {
    expect(classifyGatewayError({ status: 429 })).toBe('transient');
    expect(classifyGatewayError({ status: 529 })).toBe('transient');
    expect(classifyGatewayError({ code: 'ECONNREFUSED' })).toBe('transient');
    expect(classifyGatewayError(new Error('fetch failed'))).toBe('transient');
  });

  it('classifies other 5xx as provider', () => {
    expect(classifyGatewayError({ status: 500 })).toBe('provider');
    expect(classifyGatewayError({ response: { status: 503 } })).toBe('provider');
  });

  it('classifies everything else as fatal', () => {
    expect(classifyGatewayError({ status: 400 })).toBe('fatal');
    expect(classifyGatewayError(new Error('bad prompt'))).toBe('fatal');
    expect(classifyGatewayError(null)).toBe('fatal');
    expect(classifyGatewayError(undefined)).toBe('fatal');
  });
});
