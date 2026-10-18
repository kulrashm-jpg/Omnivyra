/**
 * R1-HIST-01 — `scan_metadata.persisted` must mean DURABLY stored, never "the call resolved".
 *
 * THE DEFECT
 * `HistoricalStore.isOperational()` is documented as "True when the underlying backend is
 * reachable AND writes are durable". `InMemoryHistoryStore.isOperational()` returns a hard-coded
 * `true` — but its writes land in a process-local map that, in the provider registry's own words,
 * "resets on every cold start". On serverless that is effectively every request.
 *
 * The consequence chain, all of which is real code:
 *
 *   providerRegistry   installs the durable store ONLY when SUPABASE_HISTORY_ENABLED === 'true'
 *                      AND the admin client resolves; otherwise it RETAINS the in-memory store
 *   snapshotWriter     returns written:false only when isOperational() is false — so it proceeds
 *   snapshotWriter     returns an unconditional written:true once the write resolves
 *   builderAssembly    scan_metadata.persisted = persisted.written      → true
 *
 * So a report can state that it persisted its score history when nothing durable was written.
 * That is the "UNAVAILABLE → PRESENTED AS FACT" transition this programme exists to remove, and
 * it is the same OUTCOME as GAP-13 (report says persisted, table stays empty) reached by a
 * different route — GAP-13 fixed only the lazy-thenable bug.
 *
 * THE CONTRACT THIS PINS
 * "Executed" and "durable" are two different facts and are reported separately. A store DECLARES
 * its durability, exactly as an ads client declares its platform rather than the orchestrator
 * inferring one. `persisted` is the conjunction.
 *
 * Note what is deliberately NOT done: `isOperational()` is not flipped to false for the in-memory
 * store. It is genuinely reachable and its writes genuinely execute — `report1SnapshotComparability
 * Identity.test.ts` relies on exactly that — so suppressing the write would trade one false
 * statement for another.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  InMemoryHistoryStore,
  registerHistoricalStore,
  type HistoricalStore,
} from '../../services/intelligence/historicalPersistence';
import { SupabaseHistoryStore } from '../../services/intelligence/supabaseHistoryStore';
import { persistCanonicalSnapshot } from '../../services/intelligence/snapshotWriter';
import { emptyCanonicalScore } from '../../services/canonicalReport/canonicalReportTypes';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

const COMPANY = 'co-durable-honesty';
const ENGINE = 'engine-1';

function score(value: number | null) {
  return { ...emptyCanonicalScore(value == null ? 'insufficient_signal' : 'measured'), value };
}

function report(authority: number): CanonicalReport {
  return {
    authority_overview: { overall_score: score(authority), maturity: 'building_baseline' },
    ai_surface_presence: { score: score(authority - 5) },
    benchmark: { state: 'unavailable', overlay: null },
    maturity_stage: { stage: 'building_baseline' },
    pillars: [{ pillar: 'authority', score: score(authority), primary_signal: null }],
    action_playbook: { actions: [] },
    strategic_playbook: { actions: [] },
    evidence_trace: {
      overall: { count: 0, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] },
      by_pillar: {},
      by_dimension: {},
    },
  } as unknown as CanonicalReport;
}

/**
 * A store that IS durable, so the durable branch is proven reachable rather than asserted.
 *
 * Composed rather than subclassed. `InMemoryHistoryStore.durable` is declared `= false`, which
 * TypeScript infers as the LITERAL type `false`, so a subclass cannot widen it to `true` (TS2416)
 * — and that narrowing is correct, because an in-memory store is never durable. A durable fake is
 * therefore not "an in-memory store that happens to be durable"; it is a different store reusing
 * the same storage behaviour. Same idiom as the non-operational store further down.
 */
function fakeDurableStore(): HistoricalStore {
  return Object.assign(new InMemoryHistoryStore(), { durable: true as const });
}

function persist() {
  return persistCanonicalSnapshot({
    companyId: COMPANY,
    report: report(40),
    scanProfile: 'standard',
    engineVersion: ENGINE,
    providerOutcomes: [],
    domain: 'https://www.example.com/',
  });
}

describe('R1-HIST-01 — a store declares its own durability', () => {
  it('the in-memory store declares itself NOT durable', () => {
    expect(new InMemoryHistoryStore().durable).toBe(false);
  });

  it('the Supabase store declares itself durable', () => {
    expect(new SupabaseHistoryStore({} as never).durable).toBe(true);
  });

  it('durability is part of the HistoricalStore contract, not an optional extra', () => {
    const store: HistoricalStore = new InMemoryHistoryStore();
    expect(typeof store.durable).toBe('boolean');
  });
});

describe('R1-HIST-01 — the writer reports execution and durability separately', () => {
  it('a VOLATILE store still executes the write — the fix suppresses nothing', async () => {
    registerHistoricalStore(new InMemoryHistoryStore());
    const result = await persist();
    expect(result.written).toBe(true);
  });

  it('…but it is NOT reported as durable', async () => {
    registerHistoricalStore(new InMemoryHistoryStore());
    const result = await persist();
    expect(result.durable).toBe(false);
  });

  it('a DURABLE store reports durable — the branch is reachable, so the test is not vacuous', async () => {
    registerHistoricalStore(fakeDurableStore());
    const result = await persist();
    expect(result.written).toBe(true);
    expect(result.durable).toBe(true);
  });

  it('a non-operational store is neither written nor durable', async () => {
    const dead: HistoricalStore = Object.assign(new InMemoryHistoryStore(), {
      isOperational: async () => false,
    });
    registerHistoricalStore(dead);
    const result = await persist();
    expect(result.written).toBe(false);
    expect(result.durable).toBe(false);
    expect(result.reason).toBe('history-store-not-operational');
  });
});

describe('R1-HIST-01 — the report composes `persisted` from BOTH facts (source contract)', () => {
  const assembly = readFileSync(
    join(__dirname, '../../services/canonicalReport/canonicalReportBuilderAssembly.ts'),
    'utf8',
  );

  it('scan_metadata.persisted is not assigned from `written` alone', () => {
    expect(assembly).not.toMatch(/scan_metadata\.persisted\s*=\s*persisted\.written\s*;/);
  });

  it('scan_metadata.persisted requires durability as well as execution', () => {
    expect(assembly).toMatch(
      /scan_metadata\.persisted\s*=\s*persisted\.written\s*&&\s*persisted\.durable\s*;/,
    );
  });
});
