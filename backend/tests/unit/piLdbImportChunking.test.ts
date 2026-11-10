/**
 * PI-LDB — chunked submission and retry.
 *
 * The CSV route answers 413 above `MAX_BATCH_SIZE`, so chunking is a
 * correctness requirement rather than a performance choice, and these tests
 * assert the properties that make a partial import honest: what landed stays
 * landed, what did not is retryable, and the retry is a distinguishable unit
 * of work.
 *
 * `post` is injected throughout — no network, no Supabase session, no route.
 */

import {
  MAX_BATCH_SIZE,
  recordsForRetry,
  submitChunks,
  type SubmitProgress,
} from '../../../lib/prospects/import/submitChunks';
import type { ImportOutcome } from '../../../lib/prospects/import/types';

const ORG = '00000000-0000-4000-8000-0000000000aa';

const records = (n: number): Array<Record<string, unknown>> =>
  Array.from({ length: n }, (_, i) => ({ email: `p${i}@example.com` }));

/** A post that succeeds, echoing one ok outcome per submitted record. */
const okPost = (calls: Array<{ count: number; runId: string }>) =>
  async (
    _companyId: string,
    body: { records: ReadonlyArray<Record<string, unknown>>; ingestionRunId: string },
  ) => {
    calls.push({ count: body.records.length, runId: body.ingestionRunId });
    return {
      ok: true,
      status: 200,
      json: {
        source: 'csv',
        total: body.records.length,
        succeeded: body.records.length,
        failed: 0,
        outcomes: body.records.map((_, i) => ({ externalId: `csv:${i}`, ok: true })),
      },
    };
  };

describe('the synchronous request ceiling (D4)', () => {
  it('is 100 records, as the owner ruled', () => {
    // Pinned as a literal in exactly one place. Every other assertion in this
    // file derives from the constant, so this is the only test that fails if
    // the value is changed - which is the point: changing a platform-safety
    // bound should require editing the test that states it.
    expect(MAX_BATCH_SIZE).toBe(100);
  });

  it('equals the ceiling the SERVER enforces', () => {
    // This is a client bundle and cannot import the server module, so the value
    // is restated there. Compare the server's SOURCE TEXT rather than trusting
    // the comment that says they match: a drift here makes the client provoke
    // a 413 on every oversized chunk.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    const m = src.match(new RegExp('export const MAX_BATCH_SIZE = ([0-9_]+);'));
    expect(m).not.toBeNull();
    expect(Number((m as RegExpMatchArray)[1].replace(/_/g, ''))).toBe(MAX_BATCH_SIZE);
  });
});

describe('batching', () => {
  it('never submits more than the route accepts', async () => {
    const calls: Array<{ count: number; runId: string }> = [];
    const result = await submitChunks({
      companyId: ORG,
      records: records(2_500),
      ingestionRunId: 'run-1',
      post: okPost(calls),
    });

    // Derived from the constant on purpose: this test owns the CHUNKING, and
    // 'the value is 100' is pinned once, in its own test below. Asserted as
    // properties so it cannot pass for the wrong shape: every chunk is full
    // except the last, nothing exceeds the ceiling, and the parts sum to the
    // whole.
    expect(calls).toHaveLength(Math.ceil(2_500 / MAX_BATCH_SIZE));
    for (const call of calls) expect(call.count).toBeLessThanOrEqual(MAX_BATCH_SIZE);
    for (const call of calls.slice(0, -1)) expect(call.count).toBe(MAX_BATCH_SIZE);
    expect(calls.reduce((t, c) => t + c.count, 0)).toBe(2_500);
    expect(result.recordsSent).toBe(2_500);
    expect(result.succeeded).toBe(2_500);
  });

  it('clamps an oversized chunkSize rather than provoking a 413', async () => {
    const calls: Array<{ count: number; runId: string }> = [];
    await submitChunks({
      companyId: ORG,
      records: records(1_200),
      ingestionRunId: 'run-1',
      chunkSize: 99_999,
      post: okPost(calls),
    });
    expect(calls).toHaveLength(Math.ceil(1_200 / MAX_BATCH_SIZE));
    for (const call of calls) expect(call.count).toBeLessThanOrEqual(MAX_BATCH_SIZE);
    expect(calls.reduce((t, c) => t + c.count, 0)).toBe(1_200);
  });

  it('shares ONE run id across every chunk of one import', async () => {
    const calls: Array<{ count: number; runId: string }> = [];
    await submitChunks({
      companyId: ORG,
      records: records(2_100),
      ingestionRunId: 'run-abc',
      post: okPost(calls),
    });
    // The route dedup-keys its telemetry on this, so one import must be one
    // unit of work rather than three unrelated batches.
    expect(new Set(calls.map((c) => c.runId))).toEqual(new Set(['run-abc']));
  });

  it('submits sequentially, never concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await submitChunks({
      companyId: ORG,
      records: records(3_000),
      ingestionRunId: 'run-1',
      post: async (_c, body) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return {
          ok: true,
          status: 200,
          json: { succeeded: body.records.length, failed: 0, outcomes: [] },
        };
      },
    });
    // The orchestrator resolves identity; two chunks carrying the same person
    // at once is the race worth not inventing.
    expect(maxInFlight).toBe(1);
  });
});

describe('progress', () => {
  it('reports counts that only ever move forward', async () => {
    const seen: SubmitProgress[] = [];
    await submitChunks({
      companyId: ORG,
      records: records(2_500),
      ingestionRunId: 'run-1',
      onProgress: (p) => seen.push({ ...p }),
      post: okPost([]),
    });

    expect(seen[0]).toMatchObject({ chunksDone: 0, recordsSent: 0, recordsTotal: 2_500 });
    expect(seen[seen.length - 1]).toMatchObject({
      chunksDone: Math.ceil(2_500 / MAX_BATCH_SIZE),
      chunksTotal: Math.ceil(2_500 / MAX_BATCH_SIZE),
      recordsSent: 2_500,
      succeeded: 2_500,
    });
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].recordsSent).toBeGreaterThanOrEqual(seen[i - 1].recordsSent);
    }
  });
});

describe('a partial import tells the truth', () => {
  it('stops on a chunk failure and keeps what already landed', async () => {
    let call = 0;
    const result = await submitChunks({
      companyId: ORG,
      records: records(3_000),
      ingestionRunId: 'run-1',
      post: async (_c, body) => {
        call += 1;
        if (call === 2) {
          return { ok: false, status: 500, json: { error: 'upstream exploded' } };
        }
        return {
          ok: true,
          status: 200,
          json: {
            succeeded: body.records.length,
            failed: 0,
            outcomes: body.records.map((_, i) => ({ externalId: `csv:${i}`, ok: true })),
          },
        };
      },
    });

    // No rollback, and no pretending: the first chunk is durable.
    expect(result.succeeded).toBe(MAX_BATCH_SIZE);
    expect(result.recordsSent).toBe(MAX_BATCH_SIZE);
    expect(result.transportError).toContain('upstream exploded');
    expect(result.aborted).toBe(false);
  });

  it('passes the gate\'s own code through so the UI can distinguish it', async () => {
    const result = await submitChunks({
      companyId: ORG,
      records: records(10),
      ingestionRunId: 'run-1',
      post: async () => ({
        ok: false,
        status: 404,
        json: { error: 'Lead ingestion is not enabled.', code: 'LEAD_INGESTION_DISABLED' },
      }),
    });
    expect(result.transportError).toContain('LEAD_INGESTION_DISABLED');
    expect(result.succeeded).toBe(0);
  });

  it('a thrown transport error does not lose earlier chunks', async () => {
    let call = 0;
    const result = await submitChunks({
      companyId: ORG,
      records: records(2_000),
      ingestionRunId: 'run-1',
      post: async (_c, body) => {
        call += 1;
        if (call === 2) throw new Error('network died');
        return {
          ok: true,
          status: 200,
          json: { succeeded: body.records.length, failed: 0, outcomes: [] },
        };
      },
    });
    expect(result.succeeded).toBe(MAX_BATCH_SIZE);
    expect(result.transportError).toBe('network died');
  });

  it('an abort stops the run and reports partial results, not a failure', async () => {
    const controller = new AbortController();
    const result = await submitChunks({
      companyId: ORG,
      records: records(3_000),
      ingestionRunId: 'run-1',
      signal: controller.signal,
      post: async (_c, body) => {
        controller.abort();
        return {
          ok: true,
          status: 200,
          json: { succeeded: body.records.length, failed: 0, outcomes: [] },
        };
      },
    });

    expect(result.aborted).toBe(true);
    expect(result.transportError).toBeNull();
    expect(result.succeeded).toBe(MAX_BATCH_SIZE);
  });
});

describe('retry', () => {
  const submitted = records(5);

  it('retries only the records that did not land', () => {
    const outcomes: ImportOutcome[] = [
      { externalId: 'csv:0', ok: true },
      { externalId: 'csv:1', ok: false, rejection: 'validation_failed' },
      { externalId: 'csv:2', ok: true },
      { externalId: 'csv:3', ok: false, rejection: 'identity_failed' },
      { externalId: 'csv:4', ok: true },
    ];
    expect(recordsForRetry(submitted, outcomes)).toEqual([submitted[1], submitted[3]]);
  });

  it('retries records that have NO outcome, because they were never sent', () => {
    // A chunk-level failure leaves the tail with no outcome at all. Those are
    // as much "not imported" as a rejection, and a retry keyed on failed
    // external ids alone would silently abandon them.
    const outcomes: ImportOutcome[] = [
      { externalId: 'csv:0', ok: true },
      { externalId: 'csv:1', ok: true },
    ];
    expect(recordsForRetry(submitted, outcomes)).toEqual([
      submitted[2],
      submitted[3],
      submitted[4],
    ]);
  });

  it('retries a failed record whose row carried no reference', () => {
    // A null externalId is exactly the case an id-keyed retry would drop.
    const outcomes: ImportOutcome[] = [
      { externalId: null, ok: false, rejection: 'validation_failed' },
      { externalId: 'csv:1', ok: true },
      { externalId: 'csv:2', ok: true },
      { externalId: 'csv:3', ok: true },
      { externalId: 'csv:4', ok: true },
    ];
    expect(recordsForRetry(submitted, outcomes)).toEqual([submitted[0]]);
  });

  it('offers nothing to retry when everything landed', () => {
    const outcomes: ImportOutcome[] = submitted.map((_, i) => ({
      externalId: `csv:${i}`,
      ok: true,
    }));
    expect(recordsForRetry(submitted, outcomes)).toEqual([]);
  });

  it('a retry is a distinguishable unit of work', async () => {
    const calls: Array<{ count: number; runId: string }> = [];
    await submitChunks({
      companyId: ORG,
      records: records(10),
      ingestionRunId: 'run-original',
      post: okPost(calls),
    });
    await submitChunks({
      companyId: ORG,
      records: records(2),
      ingestionRunId: 'run-retry',
      post: okPost(calls),
    });
    // Distinct ids, so the audit trail shows an operator decision rather than
    // one batch that mysteriously grew.
    expect(calls.map((c) => c.runId)).toEqual(['run-original', 'run-retry']);
  });
});

describe('degenerate input', () => {
  it('sends nothing for an empty record set', async () => {
    const calls: Array<{ count: number; runId: string }> = [];
    const result = await submitChunks({
      companyId: ORG,
      records: [],
      ingestionRunId: 'run-1',
      post: okPost(calls),
    });
    expect(calls).toHaveLength(0);
    expect(result.recordsSent).toBe(0);
    expect(result.transportError).toBeNull();
  });

  it('a malformed success body does not crash the run', async () => {
    const result = await submitChunks({
      companyId: ORG,
      records: records(5),
      ingestionRunId: 'run-1',
      post: async () => ({ ok: true, status: 200, json: { outcomes: 'not-an-array' } }),
    });
    expect(result.outcomes).toEqual([]);
    expect(result.succeeded).toBe(0);
    expect(result.recordsSent).toBe(5);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * The approval idempotency key.
 *
 * `withIdempotency` answers 409 IDEMPOTENCY_CONFLICT when a key is reused with
 * a different body. A key of `company:fingerprint` alone would therefore
 * REFUSE a tenant who changes one column and re-approves the same file layout
 * — which is exactly what `source_mapping_profiles.version` exists to support.
 * So the key must identify the DECISION, not the schema.
 * ────────────────────────────────────────────────────────────────────────*/

describe('mappingApprovalKey', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mappingApprovalKey } = require('../../../components/prospects/import/importClient');

  const ORG_B = '00000000-0000-4000-8000-0000000000bb';
  const FP = 'a'.repeat(64);
  const entry = (over: Record<string, unknown> = {}) => ({
    sourceField: 'Email',
    target: 'email',
    transformation: 'lowercase_email',
    decision: 'approved',
    ...over,
  });

  it('is stable for the same decision, so a genuine retry replays', () => {
    expect(mappingApprovalKey(ORG_B, FP, [entry()])).toBe(
      mappingApprovalKey(ORG_B, FP, [entry()]),
    );
  });

  it('ignores column ORDER, which is not part of the decision', () => {
    const a = [entry({ sourceField: 'Email' }), entry({ sourceField: 'Name', target: 'fullName' })];
    const b = [entry({ sourceField: 'Name', target: 'fullName' }), entry({ sourceField: 'Email' })];
    expect(mappingApprovalKey(ORG_B, FP, a)).toBe(mappingApprovalKey(ORG_B, FP, b));
  });

  it('CHANGES when a destination changes, so re-approving versions instead of 409ing', () => {
    const first = mappingApprovalKey(ORG_B, FP, [entry({ target: 'email' })]);
    const changed = mappingApprovalKey(ORG_B, FP, [entry({ target: 'referenceId' })]);
    expect(changed).not.toBe(first);
  });

  it('changes when a column is newly ignored', () => {
    const approved = mappingApprovalKey(ORG_B, FP, [entry()]);
    const ignored = mappingApprovalKey(ORG_B, FP, [
      entry({ target: null, decision: 'ignored', transformation: 'none' }),
    ]);
    expect(ignored).not.toBe(approved);
  });

  it('changes when a transformation changes', () => {
    expect(mappingApprovalKey(ORG_B, FP, [entry({ transformation: 'trim' })])).not.toBe(
      mappingApprovalKey(ORG_B, FP, [entry({ transformation: 'lowercase_email' })]),
    );
  });

  it('is scoped per tenant and per schema', () => {
    const base = mappingApprovalKey(ORG_B, FP, [entry()]);
    expect(mappingApprovalKey(ORG, FP, [entry()])).not.toBe(base);
    expect(mappingApprovalKey(ORG_B, 'b'.repeat(64), [entry()])).not.toBe(base);
  });

  it('stays short enough for an HTTP header value', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      entry({ sourceField: `column number ${i} with a long heading`, target: 'email' }),
    );
    expect(mappingApprovalKey(ORG_B, FP, many).length).toBeLessThan(120);
  });
});
