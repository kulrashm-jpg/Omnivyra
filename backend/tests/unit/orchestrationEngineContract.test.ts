/**
 * Cross-engine contract — the shared pieces every adapter depends on stay in
 * step: the engine vocabulary, the request-ledger CHECK, and one adapter per
 * channel. Integration-owner suite; adapters are added to ADAPTERS on integration.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });

import { ENGINE_NAMES, buildAdapterRegistry, createWs3Adapter, type EngineAdapter } from '../../services/orchestration/engineAdapters';
import { createWhatsAppAdapter } from '../../services/orchestration/whatsappEngineAdapter';
import { WORKFLOW_STEP_CHANNELS } from '../../services/workflows/workflowStore';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const ADAPTERS: readonly EngineAdapter[] = [createWs3Adapter(), createWhatsAppAdapter()];

describe('engine contract — shared vocabulary', () => {
  it('the request ledger accepts exactly the adapter-fronted engines (all but ws3)', () => {
    const sql = read('supabase/migrations/20261231000001_orchestration_engine_requests_engines.sql');
    const m = /CHECK \(engine IN \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = [...(m as RegExpExecArray)[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual(ENGINE_NAMES.filter((e) => e !== 'ws3').sort());
  });

  it('every registered adapter claims distinct, authorable channels', () => {
    const registry = buildAdapterRegistry(ADAPTERS);
    for (const [channel, adapter] of registry) {
      expect(WORKFLOW_STEP_CHANNELS).toContain(channel);
      expect(ENGINE_NAMES).toContain(adapter.engine);
    }
    expect(new Set(ADAPTERS.map((a) => a.engine)).size).toBe(ADAPTERS.length);
  });

  it('two adapters claiming one channel is refused, not silently re-routed', () => {
    expect(() => buildAdapterRegistry([...ADAPTERS, { ...ADAPTERS[0], engine: 'browser' }])).toThrow(/two engine adapters claim/);
  });

  it('the widening migration is additive, guarded and has a rollback that refuses while rows depend on it', () => {
    const sql = read('supabase/migrations/20261231000001_orchestration_engine_requests_engines.sql');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS execution_engine_requests_engine_valid/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|ALTER COLUMN/i);
    const rb = read('supabase/migrations/rollbacks/orchestration_engine_requests_engines_rollback.sql');
    expect(rb).toMatch(/WHERE engine <> 'whatsapp'/);
  });
});
