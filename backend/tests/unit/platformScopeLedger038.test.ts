/**
 * Platform-scope ledger rows (6f; migration 20270217000038, e9 ruling P1, e1 ledger sign-off).
 *   - the all-zero UNKNOWN_ORG sentinel (and a null org) is written to usage_events as an explicit PLATFORM row:
 *     organization_id NULL + metadata.billing_scope 'platform' - never a fake tenant;
 *   - platform rows are NOT written to unified_transactions (P1: so the platform read and the unified read never
 *     double-count); a real company is written to both, exactly as before;
 *   - a failed usage_events insert is LOGGED (it used to vanish unread);
 *   - economicAccounting's platform read takes EVERY null-org row (any source_type), and its total equals that
 *     population exactly, with no double count against the unified read;
 *   - the named sentinel equals every UNKNOWN_ORG definition in the code (positive control on the literal).
 */
import * as fs from 'fs';
import * as path from 'path';

const inserts: Array<{ table: string; row: Record<string, any> }> = [];
let insertError: { message: string } | null = null;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    insert: (row: Record<string, any>) => { inserts.push({ table, row }); return Promise.resolve({ error: insertError, data: null }); },
  }),
}));
const unifiedCalls: Array<Record<string, any>> = [];
jest.mock('../../services/unifiedTransactionService', () => ({
  recordUnifiedTransaction: jest.fn(async (row: Record<string, any>) => { unifiedCalls.push(row); }),
}));
const logged: Array<[string, Record<string, unknown>]> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    info: () => undefined, debug: () => undefined,
    warn: (e: string, p: Record<string, unknown>) => { logged.push([e, p]); },
    error: (e: string, p: Record<string, unknown>) => { logged.push([e, p]); },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ledger = require('../../services/usageLedgerService');
const { ledgerScopeOf, PLATFORM_SENTINEL_ORG, logUsageEvent } = ledger;

const ORG = '11111111-1111-4111-8111-111111111111';
const base = {
  source_type: 'llm' as const, provider_name: 'openai', model_name: 'gpt-4o', source_name: 'ai_gateway',
  process_type: 'generateCampaignPlan', input_tokens: 10, output_tokens: 20, total_tokens: 30, total_cost: 0.5,
  beta_cohort: null, monetization_beta_enabled: false,
};
beforeEach(() => { inserts.length = 0; unifiedCalls.length = 0; logged.length = 0; insertError = null; });

describe('ledgerScopeOf', () => {
  it('the sentinel and a null org are PLATFORM; a real company is itself', () => {
    expect(ledgerScopeOf(PLATFORM_SENTINEL_ORG)).toEqual({ organization_id: null, platform: true });
    expect(ledgerScopeOf(null)).toEqual({ organization_id: null, platform: true });
    expect(ledgerScopeOf(undefined)).toEqual({ organization_id: null, platform: true });
    expect(ledgerScopeOf(ORG)).toEqual({ organization_id: ORG, platform: false });
  });

  it('POSITIVE CONTROL: the named sentinel equals every UNKNOWN_ORG definition in the code', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const rel of ['backend/services/aiGatewayCore.ts', 'backend/services/externalApi/execution.ts', 'backend/services/llm/openaiAdapter.ts']) {
      const m = /UNKNOWN_ORG\s*=\s*'([0-9a-f-]{36})'/.exec(fs.readFileSync(path.join(root, rel), 'utf8'));
      expect(m && m[1]).toBe(PLATFORM_SENTINEL_ORG);
    }
  });
});

describe('logUsageEvent', () => {
  it('the SENTINEL org: usage_events gets organization_id NULL + billing_scope platform; NO unified write', async () => {
    await logUsageEvent({ ...base, organization_id: PLATFORM_SENTINEL_ORG });
    const usage = inserts.filter((i) => i.table === 'usage_events');
    expect(usage).toHaveLength(1);
    expect(usage[0].row.organization_id).toBeNull();
    expect(usage[0].row.metadata).toMatchObject({ billing_scope: 'platform' });
    expect(unifiedCalls).toEqual([]);
  });

  it('a NULL org: the same platform row (the documented path now satisfies the 038 CHECK)', async () => {
    await logUsageEvent({ ...base, organization_id: null });
    const usage = inserts.filter((i) => i.table === 'usage_events');
    expect(usage[0].row).toMatchObject({ organization_id: null, metadata: expect.objectContaining({ billing_scope: 'platform' }) });
    expect(unifiedCalls).toEqual([]);
  });

  it('CONTROL: a real company is written to BOTH ledgers, with no billing_scope marker', async () => {
    await logUsageEvent({ ...base, organization_id: ORG });
    const usage = inserts.filter((i) => i.table === 'usage_events');
    expect(usage[0].row.organization_id).toBe(ORG);
    expect(usage[0].row.metadata).not.toHaveProperty('billing_scope');
    expect(unifiedCalls).toHaveLength(1);
    expect(unifiedCalls[0].organization_id).toBe(ORG);
  });

  it('a failed usage_events insert is LOGGED (it used to vanish unread)', async () => {
    insertError = { message: 'null value in column "organization_id" violates not-null constraint' };
    await logUsageEvent({ ...base, organization_id: PLATFORM_SENTINEL_ORG });
    expect(logged).toEqual(expect.arrayContaining([
      ['usage_event_insert_failed', expect.objectContaining({ reason: 'insert_failed', platform: true })],
    ]));
  });
});
