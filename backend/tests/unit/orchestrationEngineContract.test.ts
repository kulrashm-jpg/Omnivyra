/**
 * Cross-engine contract — the shared pieces every adapter depends on stay in
 * step: the engine vocabulary, the request-ledger CHECK, and one adapter per
 * channel. Integration-owner suite; adapters are added to ADAPTERS on integration.
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }), { virtual: true });
// Importing the RPA worker opens a BullMQ/Redis connection; no adapter here calls it.
jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({ executeRpaTask: jest.fn() }));

import { ENGINE_NAMES, buildAdapterRegistry, createWs3Adapter, type EngineAdapter } from '../../services/orchestration/engineAdapters';
import { createWhatsAppAdapter } from '../../services/orchestration/whatsappEngineAdapter';
import { createSocialPublishAdapter } from '../../services/orchestration/socialPublishEngineAdapter';
import { createCommunityAdapter } from '../../services/orchestration/communityEngineAdapter';
import { createBrowserAdapter } from '../../services/orchestration/browserEngineAdapter';
import { WORKFLOW_STEP_CHANNELS } from '../../services/workflows/workflowStore';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// Every adapter, whether or not the sweeper runs it (see the registration test).
const ADAPTERS: readonly EngineAdapter[] = [
  createWs3Adapter(), createWhatsAppAdapter(),
  createSocialPublishAdapter(), createCommunityAdapter(), createBrowserAdapter(),
];

describe('engine contract — shared vocabulary', () => {
  it('the request ledger accepts exactly the adapter-fronted engines (all but ws3)', () => {
    const sql = read('supabase/migrations/20270111100008_orchestration_engine_requests_engines.sql');
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

  it('every engine in the vocabulary has exactly one adapter', () => {
    expect(ADAPTERS.map((a) => a.engine).sort()).toEqual([...ENGINE_NAMES].sort());
  });

  it('the sweeper runs every engine; each one fails closed on its own gates', () => {
    // Since 2026-10-28 social_post gained its observe contract and community its
    // verified-identity link, so a step on those channels now gets the engine's own
    // answer instead of "no engine". The browser adapter claims no channel, so
    // registering it routes nothing to it. WORKFLOW_ORCHESTRATION_ENABLED stays off.
    const sweeper = read('backend/services/workflowExecution/workflowProgressionSweeper.ts');
    for (const make of ['createWs3Adapter', 'createWhatsAppAdapter', 'createSocialPublishAdapter', 'createCommunityAdapter', 'createBrowserAdapter']) {
      expect(sweeper).toContain(`${make}()`);
    }
    // The registry entry is the lazy wrapper; its channel must stay what the adapter claims.
    expect(createCommunityAdapter().channels).toEqual(['community']);
    expect(() => buildAdapterRegistry(ADAPTERS)).not.toThrow();
    expect(buildAdapterRegistry(ADAPTERS).has('browser')).toBe(false);
  });

  it('the widening migration is additive, guarded and has a rollback that refuses while rows depend on it', () => {
    const sql = read('supabase/migrations/20270111100008_orchestration_engine_requests_engines.sql');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS execution_engine_requests_engine_valid/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|ALTER COLUMN/i);
    const rb = read('supabase/migrations/rollbacks/orchestration_engine_requests_engines_rollback.sql');
    expect(rb).toMatch(/WHERE engine <> 'whatsapp'/);
  });
});
