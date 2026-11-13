/**
 * 039 - platform-scope spend has ONE home: platform_usage_events (e9 re-plan; e1's five conditions).
 *
 * The fake supabase is STATEFUL and enforces the real unique key (platform_usage_events.idempotency_key -> 23505),
 * so "already_recorded" is earned, not asserted. The pricing estimators are spies.
 */
import * as fs from 'fs';
import * as path from 'path';

type Row = Record<string, unknown>;
const mockDb: { tables: Record<string, Row[]>; failInsert: Record<string, { message: string; code?: string } | null> } = { tables: {}, failInsert: {} };

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const rows = () => (mockDb.tables[table] ??= []);
      const filters: Array<(r: Row) => boolean> = [];
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
      b.gte = (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; };
      b.lte = (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return b; };
      b.limit = () => b;
      b.then = (res: any, rej: any) => Promise.resolve({ data: rows().filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej);
      b.insert = (input: Row | Row[]) => {
        const f = mockDb.failInsert[table];
        if (f) return Promise.resolve({ error: f });
        const list = ([] as Row[]).concat(input);
        if (table === 'platform_usage_events'
            && list.some((n) => rows().some((r) => r.idempotency_key === n.idempotency_key))) {
          return Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "platform_usage_events_idempotency_uidx"', code: '23505' } });
        }
        rows().push(...list.map((r) => ({ ...r })));
        return Promise.resolve({ error: null });
      };
      return b;
    },
  },
}));
const usageEventsInserts: Row[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    insert: (row: Row) => { if (table === 'usage_events') usageEventsInserts.push(row); return Promise.resolve({ error: null }); },
  }),
}));
const mockUnified = jest.fn(async (_row: Row) => undefined);
jest.mock('../../services/unifiedTransactionService', () => ({ recordUnifiedTransaction: (row: Row) => mockUnified(row) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const mockEmbed = jest.fn(async (_p: string, _m: string, tokens: number) => ({ unitCostPer1k: 0.02, totalUsd: (tokens / 1000) * 0.02, row: { kind: 'embedding' } }));
const mockCompletion = jest.fn(async (_p: string, _m: string, i: number, o: number) => ({ inputCostUsd: i / 1000, outputCostUsd: (o / 1000) * 2, totalUsd: i / 1000 + (o / 1000) * 2, row: { kind: 'completion' } }));
jest.mock('../../services/pricingService', () => ({
  ...jest.requireActual('../../services/pricingService'),
  estimateEmbeddingCostUsd: (...a: [string, string, number]) => mockEmbed(...a),
  estimateCompletionCostUsd: (...a: [string, string, number, number]) => mockCompletion(...a),
  recordCostAnomaly: jest.fn(async () => undefined),
}));

import { logger } from '../../services/logger';
import { getCounter } from '../../services/billing/billingMetrics';
import {
  recordPlatformUsage, buildPlatformCallKey, platformResourceOf, UNATTRIBUTED_RESOURCE,
} from '../../services/billing/platformUsageLedgerService';
import { logUsageEvent } from '../../services/usageLedgerService';
import { PLATFORM_SENTINEL_ORG } from '../../services/billing/platformSentinel';
import { capturePlatformProviderCost } from '../../services/billing/blackHoleCostCapture';
import { captureProbeCost, extractProbeResponseId } from '../../services/intelligence/probeCostCapture';
import { getPlatformCostAccounting } from '../../services/billing/economicAccountingService';

const ORG = '11111111-1111-4111-8111-111111111111';
const platformRows = () => mockDb.tables.platform_usage_events ?? [];
const errorEvents = () => (logger.error as jest.Mock).mock.calls.map((c) => c[0]);
beforeEach(() => {
  mockDb.tables = {}; mockDb.failInsert = {}; usageEventsInserts.length = 0;
  mockUnified.mockClear(); mockEmbed.mockClear(); mockCompletion.mockClear();
  (logger.error as jest.Mock).mockClear(); (logger.warn as jest.Mock).mockClear();
});

const base = {
  providerName: 'openai', modelName: 'gpt-4o-mini', sourceType: 'llm' as const, sourceName: 'openai:gpt-4o-mini',
  processType: 'generateX', resourceType: UNATTRIBUTED_RESOURCE, resourceId: null, totalTokens: 30,
  inputTokens: 10, outputTokens: 20, idempotencyKey: 'k-1',
};

describe('recordPlatformUsage (039)', () => {
  it('e1 #4: a PRE-PRICED row never calls the pricing lookup; its amount is kept', async () => {
    const r = await recordPlatformUsage({ ...base, prePriced: { totalCost: 0.125 } });
    expect(r).toMatchObject({ ok: true, action: 'recorded', totalCost: 0.125 });
    expect(mockCompletion).not.toHaveBeenCalled();
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(platformRows()[0]).toMatchObject({ total_cost: 0.125, resource_type: 'unattributed', resource_id: null });
  });

  it('CONTROL: an un-priced llm row IS priced org-free as a COMPLETION (not as an embedding)', async () => {
    const r = await recordPlatformUsage({ ...base });
    expect(mockCompletion).toHaveBeenCalledWith('openai', 'gpt-4o-mini', 10, 20, expect.any(Date));
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, totalCost: 0.05 });
  });

  it.each([[Number.NaN], [-0.01], [Number.POSITIVE_INFINITY]])('e1 #3: a pre-priced amount of %p is refused, nothing written', async (bad) => {
    expect(await recordPlatformUsage({ ...base, prePriced: { totalCost: bad } })).toEqual({ ok: false, reason: 'invalid_pre_priced_cost' });
    expect(platformRows()).toHaveLength(0);
  });

  it('the two-way resource rule: unattributed WITH an id and attributed WITHOUT one are refused', async () => {
    expect(await recordPlatformUsage({ ...base, resourceId: ORG })).toMatchObject({ ok: false, reason: 'unattributed_with_resource_id' });
    expect(await recordPlatformUsage({ ...base, resourceType: 'platform_topic_node', resourceId: null })).toMatchObject({ ok: false, reason: 'missing_resource' });
    expect(platformRows()).toHaveLength(0);
  });

  it('model_name may be NULL only for external_api', async () => {
    expect(await recordPlatformUsage({ ...base, modelName: null })).toMatchObject({ ok: false });
    expect(await recordPlatformUsage({ ...base, modelName: null, sourceType: 'external_api', prePriced: { totalCost: 0 } })).toMatchObject({ ok: true });
  });

  it('a 23505 on the key (by code) is already_recorded - one row', async () => {
    await recordPlatformUsage({ ...base, prePriced: { totalCost: 1 } });
    expect(await recordPlatformUsage({ ...base, prePriced: { totalCost: 1 } })).toMatchObject({ ok: true, action: 'already_recorded' });
    expect(platformRows()).toHaveLength(1);
  });
});

describe('buildPlatformCallKey / platformResourceOf', () => {
  const id = { writer: 'gateway' as const, callId: 'c-1', kind: 'final', attempt: 1 };
  it('one key = one billed provider ATTEMPT', () => {
    expect(buildPlatformCallKey('openai', id)).toBe(buildPlatformCallKey('openai', { ...id }));
    expect(buildPlatformCallKey('openai', { ...id, attempt: 2 })).not.toBe(buildPlatformCallKey('openai', id));
    expect(buildPlatformCallKey('openai', { ...id, kind: 'attempt_error' })).not.toBe(buildPlatformCallKey('openai', id));
    expect(buildPlatformCallKey('openai', { ...id, callId: 'c-2' })).not.toBe(buildPlatformCallKey('openai', id));
    // the provider response id is the most specific identity
    expect(buildPlatformCallKey('openai', { ...id, responseId: 'resp-9' })).toBe(buildPlatformCallKey('openai', { ...id, callId: 'other', responseId: 'resp-9' }));
  });
  it('e1: only a uuid reference becomes the resource; anything else is unattributed with NULL', () => {
    expect(platformResourceOf('campaign', ORG)).toEqual({ resourceType: 'campaign', resourceId: ORG });
    expect(platformResourceOf('campaign', 'not-a-uuid')).toEqual({ resourceType: 'unattributed', resourceId: null });
    expect(platformResourceOf(null, ORG)).toEqual({ resourceType: 'unattributed', resourceId: null });
  });
});

const gw = (over: Record<string, unknown> = {}) => ({
  organization_id: PLATFORM_SENTINEL_ORG, source_type: 'llm' as const, provider_name: 'openai', model_name: 'gpt-4o-mini',
  source_name: 'openai:gpt-4o-mini', process_type: 'generateCampaignPlan', input_tokens: 10, output_tokens: 20, total_tokens: 30,
  platform_call: { writer: 'gateway' as const, callId: 'call-A', kind: 'final', attempt: 1 },
  ...over,
});

describe('logUsageEvent: THE choke point (e1 #5)', () => {
  it.each([['the sentinel org', PLATFORM_SENTINEL_ORG], ['a NULL org', null]])('%s writes platform_usage_events ONLY - never usage_events, never unified', async (_n, org) => {
    await logUsageEvent(gw({ organization_id: org }) as any);
    expect(usageEventsInserts).toEqual([]);
    expect(mockUnified).not.toHaveBeenCalled();
    expect(platformRows()).toHaveLength(1);
    expect(platformRows()[0]).toMatchObject({ source_type: 'llm', total_cost: 0.05, resource_type: 'unattributed', resource_id: null,
      idempotency_key: buildPlatformCallKey('openai', { writer: 'gateway', callId: 'call-A', kind: 'final', attempt: 1 }) });
    expect(platformRows()[0].metadata).toMatchObject({ platform_scope: true, call_id: 'call-A', provider_attempt: 1 });
  });

  it('CONTROL: a real company still writes usage_events + unified exactly as before, and NO platform row', async () => {
    await logUsageEvent(gw({ organization_id: ORG, total_cost_usd: 0.05, platform_call: undefined }) as any);
    expect(usageEventsInserts).toHaveLength(1);
    expect(usageEventsInserts[0].organization_id).toBe(ORG);
    expect(mockUnified).toHaveBeenCalledTimes(1);
    expect(platformRows()).toHaveLength(0);
  });

  it('e1 #2: re-running the SAME write is already_recorded (one row); a 2nd PROVIDER attempt is a new row', async () => {
    await logUsageEvent(gw() as any);
    await logUsageEvent(gw() as any);
    expect(platformRows()).toHaveLength(1);
    await logUsageEvent(gw({ platform_call: { writer: 'gateway', callId: 'call-A', kind: 'final', attempt: 2 } }) as any);
    await logUsageEvent(gw({ platform_call: { writer: 'gateway', callId: 'call-A', kind: 'attempt_error', attempt: 1 }, error_flag: true }) as any);
    expect(platformRows()).toHaveLength(3);
  });

  it('a platform-scope write WITHOUT a call identity is refused LOUDLY - logged + counted, nothing written, no throw', async () => {
    const before = getCounter('platform_usage_write_failed_total');
    await expect(logUsageEvent(gw({ platform_call: undefined }) as any)).resolves.toBeUndefined();
    expect(platformRows()).toHaveLength(0);
    expect(usageEventsInserts).toEqual([]);
    expect(errorEvents()).toContain('platform_usage_write_failed');
    expect((logger.error as jest.Mock).mock.calls.find((c) => c[0] === 'platform_usage_write_failed')[1]).toMatchObject({ reason: 'missing_call_identity' });
    expect(getCounter('platform_usage_write_failed_total')).toBe(before + 1);
  });

  it('e1 #5: a platform-ledger WRITE FAILURE never throws into the AI path, and is never silent', async () => {
    mockDb.failInsert.platform_usage_events = { message: 'connection reset', code: '08006' };
    const before = getCounter('platform_usage_write_failed_total');
    await expect(logUsageEvent(gw() as any)).resolves.toBeUndefined();
    expect((logger.error as jest.Mock).mock.calls.find((c) => c[0] === 'platform_usage_write_failed')[1]).toMatchObject({ reason: 'insert_failed:connection reset', writer: 'gateway' });
    expect(getCounter('platform_usage_write_failed_total')).toBe(before + 1);
    expect(usageEventsInserts).toEqual([]);
  });

  it('cache-hit and external-API rows are written at zero cost without pricing; external_api may have no model', async () => {
    await logUsageEvent(gw({ source_type: 'cache', input_tokens: 0, output_tokens: 0, total_tokens: 0, platform_call: { writer: 'gateway', callId: 'c', kind: 'cache_hit', attempt: 1 } }) as any);
    await logUsageEvent(gw({ source_type: 'external_api', provider_name: 'trend_vendor', model_name: null, process_type: 'external_api_request', total_cost: 0, platform_call: { writer: 'external_api', callId: 'e', kind: 'ok', attempt: 1 } }) as any);
    expect(mockCompletion).not.toHaveBeenCalled();
    expect(platformRows().map((r) => [r.source_type, r.total_cost, r.model_name])).toEqual([['cache', 0, 'gpt-4o-mini'], ['external_api', 0, null]]);
  });
});

describe('AI-visibility probes (e1 #1)', () => {
  const body = { model: 'gpt-4o-mini', usage: { prompt_tokens: 100, completion_tokens: 50 }, choices: [{ message: { content: 'I cannot help.' } }] };
  it('two genuine calls with BYTE-IDENTICAL bodies and no response id are TWO rows (distinct call ids)', async () => {
    await captureProbeCost({ providerId: 'chatgpt', json: body, callId: 'probe-1' });
    await captureProbeCost({ providerId: 'chatgpt', json: body, callId: 'probe-2' });
    expect(platformRows()).toHaveLength(2);
    expect(platformRows().every((r) => r.source_type === 'system' && (r.metadata as Row).activity === 'ai_visibility_probe')).toBe(true);
    expect(usageEventsInserts).toEqual([]);
    expect(mockCompletion).not.toHaveBeenCalled(); // pre-priced static estimate, not re-priced
  });
  it('the provider response id keys the row when present (gemini responseId, others id)', async () => {
    expect(extractProbeResponseId('gemini', { responseId: 'g-1' })).toBe('g-1');
    expect(extractProbeResponseId('claude', { id: 'msg_1' })).toBe('msg_1');
    expect(extractProbeResponseId('chatgpt', {})).toBeNull();
    await capturePlatformProviderCost({ provider: 'claude', model: 'claude-3-5-sonnet', inputTokens: 1, outputTokens: 1, activity: 'ai_visibility_probe', callId: 'x', responseId: 'msg_1' });
    expect(platformRows()[0].idempotency_key).toBe(buildPlatformCallKey('claude', { writer: 'probe', callId: 'ignored', kind: 'final', responseId: 'msg_1' }));
  });
});

describe('platform cost accounting reads platform_usage_events', () => {
  it('the platform total includes the platform ledger, with activity from metadata', async () => {
    mockDb.tables.platform_usage_events = [
      { process_type: 'insight_generation', provider_name: 'claude', model_name: 'm', total_tokens: 2, total_cost: 0.25, metadata: { activity: 'ai_visibility_probe' }, created_at: '2026-11-10T00:00:00Z' },
      { process_type: 'embed', provider_name: 'openai', model_name: 'e', total_tokens: 5, total_cost: null, metadata: {}, created_at: '2026-11-10T00:00:00Z' },
    ];
    mockDb.tables.unified_transactions = [];
    const r = await getPlatformCostAccounting({ since: '2026-11-01T00:00:00Z' } as any);
    expect(r.totalPlatformCostUsd).toBeCloseTo(0.25, 10);
    expect(r.events).toBe(2);
    expect(r.byActivity.map((a: any) => a.key)).toEqual(expect.arrayContaining(['ai_visibility_probe', 'embed']));
  });
});

/* ── Write-shape contract (e9 / e1): ONE home, proven by the shape of every writer ─────────────────────────── */
const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['backend', 'lib', 'pages'];
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'tests' || e.name === '__tests__' || e.name.startsWith('.')) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
/** Balanced-paren extraction of `name(...)` call arguments; null when unparseable. */
function callArgs(src: string, at: number): string | null {
  const open = src.indexOf('(', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}
const SENTINEL = /UNKNOWN_ORG|PLATFORM_SENTINEL_ORG|00000000-0000-0000-0000-000000000000/;
// Removes line and block comments while leaving string / template literals intact (a '//' inside a URL string stays).
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const q = ch; out += ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } out += src[i]; i++; }
      if (i < src.length) { out += src[i]; i++; }
      continue;
    }
    out += ch; i++;
  }
  return out;
}
/** Returns violations for one file's text. */
function scanWriteShape(rel: string, raw: string): string[] {
  const src = stripComments(raw);
  const v: string[] = [];
  // (1) usage_events is written ONLY by usageLedgerService (which routes platform scope away from it).
  for (const m of src.matchAll(/(?:from|ownedDbTable|tenantTable)\(\s*['"`]usage_events['"`]\s*\)/g)) {
    const tail = src.slice(m.index!, m.index! + 400);
    if (/\.\s*(insert|upsert|update)\s*\(/.test(tail.split(';')[0]) && !rel.endsWith('services/usageLedgerService.ts')) {
      v.push(`${rel}: writes usage_events outside usageLedgerService`);
    }
  }
  // (2) every logUsageEvent call whose org may be the sentinel / NULL carries a platform_call identity.
  for (const m of src.matchAll(/\blogUsageEvent\s*\(/g)) {
    if (/function\s+logUsageEvent\s*\($/.test(src.slice(Math.max(0, m.index! - 30), m.index! + 'logUsageEvent('.length))) continue;
    const args = callArgs(src, m.index!);
    if (args === null) { v.push(`${rel}: unparseable logUsageEvent call`); continue; }
    const org = /organization_id\s*:\s*([^,\n]+)/.exec(args);
    if (!org) { v.push(`${rel}: logUsageEvent call without a parseable organization_id`); continue; }
    const mayBePlatform = SENTINEL.test(org[1]) || /^\s*null\b/.test(org[1]);
    if (mayBePlatform && !/\bplatform_call\s*:/.test(args)) v.push(`${rel}: platform-scope logUsageEvent without platform_call`);
  }
  // (3) the sentinel is never written straight into usage_events / unified_transactions.
  for (const m of src.matchAll(/(?:from|ownedDbTable)\(\s*['"`](usage_events|unified_transactions)['"`]\s*\)/g)) {
    const stmt = src.slice(m.index!, m.index! + 1200).split(/;\s*\n/)[0];
    if (/\.\s*(insert|upsert)\s*\(/.test(stmt) && SENTINEL.test(stmt)) v.push(`${rel}: writes the sentinel org into ${m[1]}`);
  }
  return v;
}

describe('write-shape contract: platform spend has ONE home', () => {
  it('POSITIVE CONTROLS: the scanner FAILS a sentinel usage_events writer, an unkeyed platform logUsageEvent, and an unparseable call', () => {
    expect(scanWriteShape('backend/fixture/a.ts', "await ownedDbTable('usage_events').insert({ organization_id: UNKNOWN_ORG, total_cost: 1 });"))
      .toEqual(expect.arrayContaining([expect.stringMatching(/writes usage_events outside usageLedgerService/), expect.stringMatching(/writes the sentinel org into usage_events/)]));
    expect(scanWriteShape('backend/fixture/b.ts', 'void logUsageEvent({ organization_id: request.companyId ?? UNKNOWN_ORG, source_type: "llm" });'))
      .toEqual([expect.stringMatching(/without platform_call/)]);
    expect(scanWriteShape('backend/fixture/c.ts', 'void logUsageEvent({ organization_id: null, source_type: "system"'))
      .toEqual([expect.stringMatching(/unparseable/)]);
    // a mention inside a comment is not a call (and a '//' inside a string is not a comment)
    expect(scanWriteShape('backend/fixture/e.ts', '// logUsageEvent (identical shape)\n/* logUsageEvent( */ const u = "https://x"; void logUsageEvent({ organization_id: null, platform_call: { writer: "probe" } });')).toEqual([]);
    // and a correct writer passes
    expect(scanWriteShape('backend/fixture/d.ts', 'void logUsageEvent({ organization_id: x ?? UNKNOWN_ORG, platform_call: { writer: "gateway" } });')).toEqual([]);
  });

  it('the codebase: no violations, and the scan actually saw the platform writers (non-vacuous)', () => {
    const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)));
    const violations: string[] = [];
    let platformCalls = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      violations.push(...scanWriteShape(rel, src));
      platformCalls += (src.match(/\bplatform_call\s*:/g) ?? []).length;
    }
    expect(violations).toEqual([]);
    // gateway (5) + external API (2) + probe (1) + the logUsageEvent parameter itself
    expect(platformCalls).toBeGreaterThanOrEqual(8);
  });
});
