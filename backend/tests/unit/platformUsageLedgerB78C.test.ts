/**
 * B7.8-C Phase 2 — platform usage ledger foundation tests.
 *
 * The decisive assertions are negative: this ledger NEVER touches a customer
 * billing table and NEVER performs a credit conversion.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

const mockEstimate = jest.fn();
const mockCreditRate = jest.fn();
jest.mock('../../services/pricingService', () => ({
  estimateEmbeddingCostUsd: (...a: unknown[]) => mockEstimate(...a),
  // Present so a call would be observable. It must NEVER fire.
  fetchCreditRateUsd: (...a: unknown[]) => mockCreditRate(...a),
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../../db/supabaseClient';
import {
  recordPlatformUsage,
  buildPlatformUsageKey,
} from '../../services/billing/platformUsageLedgerService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const TOPIC = 'aaaa0000-0000-4000-8000-00000000000a';
const TOPIC_B = 'bbbb0000-0000-4000-8000-00000000000b';

/** Every table touched and every row inserted. */
let touched: string[];
let inserts: Array<{ table: string; row: Record<string, unknown> }>;
let insertError: { message: string } | null;

function install() {
  touched = []; inserts = []; insertError = null;
  mockFrom.mockImplementation(((table: string) => {
    touched.push(table);
    return {
      insert: async (row: Record<string, unknown>) => {
        if (!insertError) inserts.push({ table, row });
        return { error: insertError };
      },
    } as never;
  }) as never);
}

const base = {
  providerName: 'openai',
  modelName: 'text-embedding-3-small',
  sourceName: 'knowledge_graph',
  processType: 'platform_topic_embedding',
  resourceType: 'platform_topic_node',
  resourceId: TOPIC,
  totalTokens: 6,
  now: new Date('2026-08-13T10:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  install();
  mockEstimate.mockResolvedValue({ unitCostPer1k: 0.00002, totalUsd: 0.00000012, row: { input_per_1k_usd: 0.00002 } });
});

/* ── 1-6: recording and cost ───────────────────────────────────────────── */

describe('B7.8-C · platform usage ledger', () => {
  it('1. records a platform usage row', async () => {
    const r = await recordPlatformUsage(base);
    expect(r).toMatchObject({ ok: true, action: 'recorded' });
    expect(inserts).toHaveLength(1);
  });

  it('2. never requires — or writes — an organization', async () => {
    await recordPlatformUsage(base);
    const row = inserts[0].row;
    for (const forbidden of ['organization_id', 'company_id', 'campaign_id', 'user_id']) {
      expect(row).not.toHaveProperty(forbidden);
    }
  });

  it('3. touches ONLY platform_usage_events — no customer billing table', async () => {
    await recordPlatformUsage(base);
    expect(touched).toEqual(['platform_usage_events']);
    expect(touched).not.toContain('usage_events');
    expect(touched).not.toContain('unified_transactions');
  });

  it('4. calculates provider USD from the org-free pricing seam', async () => {
    const r = await recordPlatformUsage(base);
    expect(mockEstimate).toHaveBeenCalledWith('openai', 'text-embedding-3-small', 6, base.now);
    expect((r as { totalCost: number }).totalCost).toBeCloseTo(0.00000012, 10);
    expect(inserts[0].row.unit_cost).toBe(0.00002);
  });

  it('5. NEVER performs a customer credit conversion', async () => {
    await recordPlatformUsage(base);
    expect(mockCreditRate).not.toHaveBeenCalled();
    // And no credits column is ever written.
    expect(inserts[0].row).not.toHaveProperty('credits_charged');
    expect(inserts[0].row).not.toHaveProperty('credits_value_usd');
  });

  it('6. records a pricing snapshot for reconciliation', async () => {
    await recordPlatformUsage(base);
    const snap = inserts[0].row.pricing_snapshot as Record<string, unknown>;
    expect(snap.source).toBe('model_pricing');
    expect(snap.kind).toBe('embedding');
    expect(snap.resolved_at).toBeTruthy();
  });

  it('records the resource so spend can be reconciled against work done', async () => {
    await recordPlatformUsage(base);
    expect(inserts[0].row.resource_type).toBe('platform_topic_node');
    expect(inserts[0].row.resource_id).toBe(TOPIC);
  });
});

/* ── 7-8: idempotency ──────────────────────────────────────────────────── */

describe('B7.8-C · idempotency', () => {
  it('7. same resource + model + day ⇒ one key; a duplicate insert is SUCCESS', async () => {
    const first = await recordPlatformUsage(base);
    insertError = { message: 'duplicate key value violates unique constraint' };
    const second = await recordPlatformUsage(base);
    expect(second).toMatchObject({ ok: true, action: 'already_recorded' });
    expect((second as { idempotencyKey: string }).idempotencyKey)
      .toBe((first as { idempotencyKey: string }).idempotencyKey);
  });

  it('8. different resource / model / day ⇒ distinct keys', () => {
    const k = (p: Partial<Parameters<typeof buildPlatformUsageKey>[0]>) => buildPlatformUsageKey({
      resourceType: 'platform_topic_node', resourceId: TOPIC,
      modelName: 'text-embedding-3-small', day: '2026-08-13', ...p,
    });
    const baseKey = k({});
    expect(k({ resourceId: TOPIC_B })).not.toBe(baseKey);
    expect(k({ modelName: 'text-embedding-3-large' })).not.toBe(baseKey);
    expect(k({ day: '2026-08-14' })).not.toBe(baseKey);
    expect(k({})).toBe(baseKey);                       // deterministic
    expect(baseKey).toMatch(/^[0-9a-f]{32}$/);         // house convention
  });
});

/* ── 9-10: failure containment ─────────────────────────────────────────── */

describe('B7.8-C · failure containment', () => {
  it('9. a real insert failure returns a typed error — never a silent success', async () => {
    insertError = { message: 'deadlock detected' };
    const r = await recordPlatformUsage(base);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toContain('insert_failed');
  });

  it('9b. a client explosion is contained, not thrown', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(recordPlatformUsage(base)).resolves.toMatchObject({ ok: false });
  });

  it('10. unresolved pricing still records the spend, marked unresolved', async () => {
    mockEstimate.mockRejectedValue(new Error('PricingMissingError'));
    const r = await recordPlatformUsage(base);
    expect(r).toMatchObject({ ok: true, action: 'recorded' });
    // Spend is NOT lost, and cost is null rather than a fabricated zero.
    expect(inserts[0].row.total_cost).toBeNull();
    expect((inserts[0].row.pricing_snapshot as Record<string, unknown>).source).toBe('unresolved');
  });

  it('refuses incomplete input before any write', async () => {
    expect(await recordPlatformUsage({ ...base, providerName: '' })).toMatchObject({ ok: false, reason: 'missing_provider_or_model' });
    expect(await recordPlatformUsage({ ...base, resourceId: '' })).toMatchObject({ ok: false, reason: 'missing_resource' });
    expect(inserts).toHaveLength(0);
  });
});

/* ── migration / schema (source proof) ─────────────────────────────────── */

describe('B7.8-C · migration and rollback contract', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const ddl = fs.readFileSync(path.join(REPO, 'supabase/migrations/20260930120000_platform_usage_events.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(REPO, 'supabase/migrations/rollbacks/platform_usage_events_rollback.sql'), 'utf8');
  const code = ddl.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('declares every required column', () => {
    for (const col of ['provider_name', 'model_name', 'model_version', 'source_type', 'source_name',
      'process_type', 'input_tokens', 'output_tokens', 'total_tokens', 'unit_cost', 'total_cost',
      'pricing_snapshot', 'metadata', 'resource_type', 'resource_id', 'idempotency_key', 'created_at']) {
      expect(code).toMatch(new RegExp('^\\s*' + col + '\\s', 'm'));
    }
  });

  it('declares NO tenant column', () => {
    for (const col of ['organization_id', 'company_id', 'campaign_id', 'user_id']) {
      expect(code).not.toMatch(new RegExp('^\\s*' + col + '\\s', 'm'));
    }
  });

  it('enforces UNIQUE idempotency and the required indexes', () => {
    expect(code).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,120}\(idempotency_key\)/);
    expect(code).toMatch(/\(created_at DESC\)/);
    expect(code).toMatch(/\(resource_type, resource_id\)/);
  });

  it('enables RLS with ZERO policies', () => {
    expect(code).toMatch(/ALTER TABLE public\.platform_usage_events ENABLE ROW LEVEL SECURITY/);
    expect(code).not.toMatch(/CREATE POLICY/);
  });

  it('never targets a customer billing table with DDL or DML', () => {
    // The COMMENT text NAMES those tables (explaining the separation), so match
    // on statements that would TARGET them, not on any mention.
    expect(code).not.toMatch(/(ALTER|DROP|INSERT INTO|UPDATE|DELETE FROM)s+(TABLEs+)?(public.)?(usage_events|unified_transactions)/i);
    expect(code).not.toMatch(/DROP/);
    // The only table this migration creates or alters is its own.
    for (const m of code.match(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)s+public.(w+)/g) ?? []) {
      expect(m).toContain('platform_usage_events');
    }
  });

  it('has no credits column — platform spend charges nobody', () => {
    expect(code).not.toMatch(/credits_charged|credits_value_usd/);
  });

  it('rollback guards financial data and asserts billing tables survive', () => {
    expect(rollback).toMatch(/ROLLBACK ABORTED[\s\S]{0,220}financial row/);
    expect(rollback).toMatch(/usage_events/);            // the survival assertion
    expect((rollback.match(/DROP TABLE IF EXISTS public\.(\w+)/g) ?? [])).toEqual(
      ['DROP TABLE IF EXISTS public.platform_usage_events']);
  });
});
