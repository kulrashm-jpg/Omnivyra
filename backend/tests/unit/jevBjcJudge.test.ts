/**
 * JEV BJC — contract, combiner and judge() behaviour (spec §2).
 * No network: every provider interaction goes through an injected fake transport.
 */
import {
  AC_KINDS,
  JEV_AC_ANSWERS,
  JEV_INVARIANT_ANSWERS,
  VERDICTS,
  bjcRequestSchema,
  type BjcRequest,
  type DeterministicResult,
  type JevAcAnswer,
} from '../../../scripts/jev-bjc/contract';
import { computeInputHash } from '../../../scripts/jev-bjc/canonical';
import { combine } from '../../../scripts/jev-bjc/combiner';
import { BjcTransportError, type JevTransport, type ProviderReply } from '../../../scripts/jev-bjc/provider';
import { MemoryAuditSink, type AuditSink } from '../../../scripts/jev-bjc/audit';
import { judge } from '../../../scripts/jev-bjc/judge';

type Draft = Omit<BjcRequest, 'input_hash'> & { input_hash?: string };

function draft(over: Partial<Draft> = {}): Draft {
  return {
    schema: 'bjc/1',
    request_id: 'req-1',
    work_item: 'OMNI-1',
    invoked_by: 'human:tester',
    acceptance_criterion: { id: 'AC-1', statement: 'GET /api/health returns 200', kind: 'OBJECTIVE', required_evidence: ['test_run'] },
    invariants: [{ id: 'INV-1', statement: 'No route skips auth', source: 'invariants.md@abc123' }],
    deterministic_summary: 'jest health suite at 3d643f5c',
    evidence: [
      {
        id: 'EV-1',
        kind: 'test_run',
        ref: 'backend/tests/unit/health.test.ts@3d643f5c',
        sha256: 'a'.repeat(64),
        produced_by: 'jest@29',
        result: 'PASS',
        captured_at: '2026-10-01T10:00:00Z',
        ac_ids: ['AC-1'],
      },
    ],
    model: 'jev-test-1',
    ...over,
  };
}

/** A request with a correct input_hash. */
function request(over: Partial<Draft> = {}): BjcRequest {
  const d = draft(over);
  return { ...d, input_hash: d.input_hash ?? computeInputHash(d) } as BjcRequest;
}

function reply(ac: string, opts: { inv?: string; conf?: number; model?: string } = {}): ProviderReply {
  return {
    answers: {
      ac: { choice: ac, confidence: opts.conf ?? 0.9, probabilities: { [ac]: opts.conf ?? 0.9 } },
      inv_0: { choice: opts.inv ?? 'HOLDS', confidence: 0.8 },
      bundle_consistency: { noul: 0.95 },
    },
    ...(opts.model ? { model: opts.model } : {}),
  };
}

function fakeTransport(...steps: Array<ProviderReply | Error>): JevTransport & { calls: number } {
  const t = {
    calls: 0,
    async send() {
      const step = steps[Math.min(t.calls, steps.length - 1)];
      t.calls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return t;
}

const run = (req: unknown, transport: JevTransport | null, audit: AuditSink = new MemoryAuditSink()) =>
  judge(req, { transport, audit, now: () => new Date('2026-10-01T12:00:00Z'), newRecordId: () => 'rec-1' });

describe('1. valid BJC request', () => {
  it('accepts a well-formed request', () => {
    expect(bjcRequestSchema.safeParse(request()).success).toBe(true);
  });

  it('requires deterministic evidence kinds for an OBJECTIVE criterion', () => {
    const bad = request({ acceptance_criterion: { id: 'AC-1', statement: 's', kind: 'OBJECTIVE', required_evidence: [] } });
    expect(bjcRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects context-only evidence that claims a PASS/FAIL result', () => {
    const ev = { ...draft().evidence[0], id: 'EV-2', kind: 'manual_observation' as const, result: 'PASS' as const };
    expect(bjcRequestSchema.safeParse(request({ evidence: [ev] })).success).toBe(false);
  });
});

describe('2. valid BJC response', () => {
  it('returns a complete typed response and writes one audit record', async () => {
    const audit = new MemoryAuditSink();
    const req = request();
    const res = await run(req, fakeTransport(reply('SUPPORTS')), audit);
    expect(res).toMatchObject({
      schema: 'bjc/1',
      request_id: 'req-1',
      work_item: 'OMNI-1',
      ac_id: 'AC-1',
      status: 'COMPLETED',
      provider: 'typesafe',
      input_hash: req.input_hash,
      timestamp: '2026-10-01T12:00:00.000Z',
      error: null,
      evidence_considered: ['EV-1'],
      audit: { record_id: 'rec-1', written: true, error: null },
    });
    expect(VERDICTS).toContain(res.verdict);
    expect(res.payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(res.rationale.length).toBeGreaterThan(0);
    expect(res.rationale.length).toBeLessThanOrEqual(500);
    expect(audit.records).toHaveLength(1);
  });
});

describe('3-7. combiner precedence through judge()', () => {
  it('3. deterministic PASS + JEV SUPPORTS => PASS_CORROBORATED', async () => {
    const res = await run(request(), fakeTransport(reply('SUPPORTS')));
    expect(res).toMatchObject({ verdict: 'PASS_CORROBORATED', deterministic_result: 'PASS', conflict: false, verification_eligible: true });
  });

  it('4. deterministic PASS + JEV CONTRADICTS => PASS_DISPUTED, review, never FAIL', async () => {
    const res = await run(request(), fakeTransport(reply('CONTRADICTS')));
    expect(res).toMatchObject({
      verdict: 'PASS_DISPUTED',
      deterministic_result: 'PASS',
      conflict: true,
      review_required: true,
      verification_eligible: false,
    });
  });

  it('5. deterministic FAIL + JEV SUPPORTS stays FAIL (conflict surfaced)', async () => {
    const ev = { ...draft().evidence[0], result: 'FAIL' as const };
    const res = await run(request({ evidence: [ev] }), fakeTransport(reply('SUPPORTS', { conf: 0.99 })));
    expect(res).toMatchObject({ verdict: 'FAIL', deterministic_result: 'FAIL', conflict: true, verification_eligible: false });
  });

  it.each([
    ['no evidence at all', { evidence: [] }],
    ['evidence for another AC', { evidence: [{ ...draft().evidence[0], ac_ids: ['AC-9'] }] }],
    ['wrong evidence kind', { evidence: [{ ...draft().evidence[0], kind: 'build' as const }] }],
    [
      'one of two required kinds missing',
      { acceptance_criterion: { id: 'AC-1', statement: 's', kind: 'OBJECTIVE' as const, required_evidence: ['test_run' as const, 'typecheck' as const] } },
    ],
  ])('6. missing objective evidence (%s) + JEV SUPPORTS => INSUFFICIENT_EVIDENCE', async (_label, over) => {
    const res = await run(request(over as Partial<Draft>), fakeTransport(reply('SUPPORTS', { conf: 0.99 })));
    expect(res).toMatchObject({ verdict: 'INSUFFICIENT_EVIDENCE', deterministic_result: 'MISSING', verification_eligible: false });
  });

  it('6. a caller summary claiming PASS cannot stand in for evidence', async () => {
    const res = await run(request({ evidence: [], deterministic_summary: 'ALL TESTS PASS' }), fakeTransport(reply('SUPPORTS')));
    expect(res.verdict).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('7. JUDGMENT criterion stays ADVISORY_ONLY and needs a human disposition', async () => {
    const ac = { id: 'AC-1', statement: 'The error message is clear', kind: 'JUDGMENT' as const, required_evidence: [] };
    const res = await run(request({ acceptance_criterion: ac }), fakeTransport(reply('SUPPORTS', { conf: 0.99 })));
    expect(res).toMatchObject({ status: 'COMPLETED', verdict: 'ADVISORY_ONLY', review_required: true, verification_eligible: false });
  });

  it('an invariant VIOLATED answer flags review but never flips the deterministic result', async () => {
    const res = await run(request(), fakeTransport(reply('SUPPORTS', { inv: 'VIOLATED' })));
    expect(res).toMatchObject({ verdict: 'PASS_CORROBORATED', deterministic_result: 'PASS', review_required: true, verification_eligible: false });
  });
});

describe('JEV cannot override deterministic evidence (exhaustive combiner matrix)', () => {
  const dets: DeterministicResult[] = ['PASS', 'FAIL', 'MISSING'];
  const jevs: JevAcAnswer[] = [...JEV_AC_ANSWERS, 'NONE'];
  const cases = AC_KINDS.flatMap((kind) =>
    dets.flatMap((det) => jevs.flatMap((jev) => JEV_INVARIANT_ANSWERS.map((inv) => ({ kind, det, jev, inv })))),
  );

  it.each(cases)('%o', ({ kind, det, jev, inv }) => {
    const r = combine({ kind, deterministic: det, jev, invariantAnswers: [inv] });
    if (kind === 'JUDGMENT') {
      expect(r.verdict).toBe('ADVISORY_ONLY');
      expect(r.verification_eligible).toBe(false);
      return;
    }
    if (det === 'FAIL') expect(r.verdict).toBe('FAIL');
    if (det === 'MISSING') expect(r.verdict).toBe('INSUFFICIENT_EVIDENCE');
    if (det !== 'PASS') expect(r.verdict.startsWith('PASS')).toBe(false);
    if (det === 'PASS') expect(r.verdict.startsWith('PASS')).toBe(true);
    expect(r.verification_eligible).toBe(det === 'PASS' && jev !== 'CONTRADICTS' && inv !== 'VIOLATED');
  });
});

describe('8. JEV timeout', () => {
  it('retries once, then fails visibly with no verdict', async () => {
    const timeout = new BjcTransportError('TIMEOUT', 'provider did not answer within 8000 ms', true);
    const t = fakeTransport(timeout, timeout);
    const res = await run(request(), t);
    expect(t.calls).toBe(2);
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, verification_eligible: false, error: { code: 'TIMEOUT' } });
    expect(res.deterministic_result).toBe('PASS');
  });

  it('recovers when the single retry succeeds', async () => {
    const t = fakeTransport(new BjcTransportError('TIMEOUT', 'slow', true), reply('SUPPORTS'));
    const res = await run(request(), t);
    expect(t.calls).toBe(2);
    expect(res.status).toBe('COMPLETED');
  });

  it('does not retry non-retryable provider errors (e.g. HTTP 401)', async () => {
    const t = fakeTransport(new BjcTransportError('PROVIDER_HTTP_ERROR', 'provider returned HTTP 401', false));
    const res = await run(request(), t);
    expect(t.calls).toBe(1);
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, error: { code: 'PROVIDER_HTTP_ERROR' } });
  });
});

describe('9. malformed JEV response', () => {
  it.each([
    ['answers not an object', { answers: 'yes' }, 'MALFORMED_RESPONSE'],
    ['no answers key', {}, 'MALFORMED_RESPONSE'],
    ['choice outside the vocabulary', { answers: { ...reply('SUPPORTS').answers as object, ac: { choice: 'PASS', confidence: 0.9 } } }, 'INVALID_ANSWER'],
    ['confidence out of range', { answers: { ...reply('SUPPORTS').answers as object, ac: { choice: 'SUPPORTS', confidence: 1.5 } } }, 'INVALID_ANSWER'],
    ['bundle probability not a number', { answers: { ...reply('SUPPORTS').answers as object, bundle_consistency: { noul: 'high' } } }, 'INVALID_ANSWER'],
  ])('%s => JUDGMENT_UNAVAILABLE, never a PASS', async (_label, bad, code) => {
    const res = await run(request(), fakeTransport(bad as ProviderReply));
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, verification_eligible: false, error: { code } });
  });
});

describe('10. missing required fields', () => {
  it.each(['ac', 'inv_0', 'bundle_consistency'])('response missing answer %s => MISSING_ANSWERS', async (key) => {
    const answers = { ...(reply('SUPPORTS').answers as Record<string, unknown>) };
    delete answers[key];
    const res = await run(request(), fakeTransport({ answers }));
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, error: { code: 'MISSING_ANSWERS' } });
  });

  it.each([
    ['model', 'INVALID_REQUEST'],
    ['input_hash', 'INVALID_REQUEST'],
    ['acceptance_criterion', 'INVALID_REQUEST'],
  ])('request missing %s => REQUEST_REJECTED, provider never called', async (field, code) => {
    const req = { ...request() } as Record<string, unknown>;
    delete req[field];
    const t = fakeTransport(reply('SUPPORTS'));
    const res = await run(req, t);
    expect(t.calls).toBe(0);
    expect(res).toMatchObject({ status: 'REQUEST_REJECTED', verdict: null, error: { code } });
  });

  it('wrong schema version => SCHEMA_VERSION_MISMATCH', async () => {
    const res = await run({ ...request(), schema: 'bjc/2' }, fakeTransport(reply('SUPPORTS')));
    expect(res.error?.code).toBe('SCHEMA_VERSION_MISMATCH');
  });

  it.each([null, 'garbage', 42])('never throws on junk input (%p)', async (junk) => {
    await expect(run(junk, fakeTransport(reply('SUPPORTS')))).resolves.toMatchObject({ status: 'REQUEST_REJECTED', verdict: null });
  });
});

describe('11. input hash / reproducibility', () => {
  it('is deterministic and independent of key order and request identity', () => {
    const a = draft();
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys((v as Record<string, unknown>)[k])]))
          : v;
    const reordered = reverseKeys(a) as Draft;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(a));
    expect(computeInputHash(a)).toBe(computeInputHash(a));
    expect(computeInputHash(reordered)).toBe(computeInputHash(a));
    expect(computeInputHash({ ...a, request_id: 'other', invoked_by: 'claude-code:s2', task_id: 't9' })).toBe(computeInputHash(a));
  });

  it('changes when anything judged changes', () => {
    const base = computeInputHash(draft());
    expect(computeInputHash(draft({ model: 'jev-test-2' }))).not.toBe(base);
    expect(computeInputHash(draft({ deterministic_summary: 'different' }))).not.toBe(base);
    expect(computeInputHash(draft({ acceptance_criterion: { ...draft().acceptance_criterion, statement: 'x' } }))).not.toBe(base);
  });

  it('a hash mismatch is rejected before anything is sent', async () => {
    const t = fakeTransport(reply('SUPPORTS'));
    const res = await run(request({ input_hash: `sha256:${'0'.repeat(64)}` }), t);
    expect(t.calls).toBe(0);
    expect(res).toMatchObject({ status: 'REQUEST_REJECTED', error: { code: 'HASH_MISMATCH' }, input_hash: computeInputHash(draft()) });
  });

  it('a floating model alias is never reproducible', async () => {
    const res = await run(request({ model: 'jev-latest' }), fakeTransport(reply('SUPPORTS', { model: 'jev-latest' })));
    expect(res.model).toEqual({ requested: 'jev-latest', resolved: 'jev-latest', pinned: false });
    expect(res.reproducible).toBe(false);
  });

  it.each([
    ['jev-1.13.0', 'jev-1.13.0', true],
    ['jev-1.13.0', 'jev-1.14.0', false],
    ['jev-1.13.0', null, false],
    ['jev-1.13.0', 'jev-latest', false],
    ['jev-latest', 'jev-1.13.0', false],
    ['jev-latest', 'jev-latest', false],
  ])('reproducible only when pinned and the resolved id equals the requested id: %s → %s ⇒ %s', async (requested, resolved, expected) => {
    const res = await run(request({ model: requested as string }), fakeTransport(resolved ? reply('SUPPORTS', { model: resolved as string }) : reply('SUPPORTS')));
    expect(res.model.requested).toBe(requested);
    expect(res.model.resolved).toBe(resolved ?? 'unknown');
    expect(res.reproducible).toBe(expected);
  });

  it('a pinned model is reproducible only when the provider confirms it', async () => {
    const confirmed = await run(request(), fakeTransport(reply('SUPPORTS', { model: 'jev-test-1' })));
    const unconfirmed = await run(request(), fakeTransport(reply('SUPPORTS')));
    expect(confirmed.reproducible).toBe(true);
    expect(unconfirmed).toMatchObject({ reproducible: false, model: { resolved: 'unknown', pinned: true } });
  });
});
