// BETA-PHASE2-EXEC-002 — Authority Trajectory historical accumulation.
//
// Demonstrates the full persisted-history → trajectory chain through the REAL
// bridge (`CanonicalTrajectoryHistoryStore` → `getHistoricalStore()`), proving
// the honest accumulation contract with NO synthetic/inferred/fabricated
// history:
//
//   0 snapshots → insufficient_history (velocity null)
//   1 snapshot  → insufficient_history (cannot compute velocity from one point)
//   2+ snapshots → measured classification + real velocity
//
// The store is the in-memory canonical store (same interface + code path the
// Supabase store implements); this keeps the test deterministic and offline
// while exercising writeSnapshot → getHistoricalStore → bridge → adapter.

import { randomUUID } from 'crypto';
import {
  getHistoricalStore,
  registerHistoricalStore,
  InMemoryHistoryStore,
  type ReportSnapshotRecord,
} from '../../services/intelligence/historicalPersistence';
import { ReportScoreHistoryAdapter } from '../../services/intelligence/adapters/reportScoreHistoryAdapter';
import { CanonicalTrajectoryHistoryStore } from '../../services/intelligence/adapters/trajectoryHistoryStore';
import { emptyCanonicalScore } from '../../services/canonicalReport/canonicalReportTypes';

const COMPANY = 'co-trajectory-accumulation';

function score(value: number) {
  return { ...emptyCanonicalScore('measured'), value };
}

function snapshotRecord(authorityValue: number, observedAt: string): ReportSnapshotRecord {
  return {
    id: randomUUID(),
    company_id: COMPANY,
    observed_at: observedAt,
    authority_score: score(authorityValue),
    ai_visibility_score: score(Math.max(0, authorityValue - 5)),
    maturity: 'building_baseline',
    maturity_stage: 'building_baseline',
    scan_profile: 'standard',
    source_metadata: { engine_version: 'test', providers_used: [], providers_unavailable: [] },
  };
}

async function write(records: ReportSnapshotRecord[]): Promise<void> {
  const store = getHistoricalStore();
  for (const snapshot of records) {
    await store.writeSnapshot({
      snapshot,
      pillars: [],
      providers: [],
      benchmark: null,
      recommendations: [],
      evidence: [],
    });
  }
}

const adapter = () => new ReportScoreHistoryAdapter(new CanonicalTrajectoryHistoryStore());

describe('BETA-PHASE2-EXEC-002 — Authority Trajectory historical accumulation', () => {
  beforeEach(() => {
    // Start every case from a clean, durable-shaped store (no leakage/no synthesis).
    registerHistoricalStore(new InMemoryHistoryStore());
  });

  it('0 snapshots → insufficient_history (no fabricated velocity)', async () => {
    const result = await adapter().lookup({ companyId: COMPANY });
    expect(result.snapshots).toHaveLength(0);
    expect(result.velocity.classification).toBe('insufficient_history');
    expect(result.velocity.authority_per_30d).toBeNull();
    expect(result.forecast).toBeNull();
  });

  it('1 snapshot → insufficient_history (cannot compute velocity from one point)', async () => {
    await write([snapshotRecord(50, '2026-06-01T00:00:00Z')]);
    const result = await adapter().lookup({ companyId: COMPANY });
    expect(result.snapshots).toHaveLength(1);
    expect(result.velocity.classification).toBe('insufficient_history');
    expect(result.velocity.authority_per_30d).toBeNull();
  });

  it('2+ snapshots → measured classification + real velocity, only what was written', async () => {
    await write([
      snapshotRecord(40, '2026-06-01T00:00:00Z'),
      snapshotRecord(58, '2026-07-01T00:00:00Z'),
    ]);
    const result = await adapter().lookup({ companyId: COMPANY });

    expect(result.snapshots).toHaveLength(2);
    // measured = a real classification, NOT the insufficient sentinel
    expect(result.velocity.classification).not.toBe('insufficient_history');
    expect(result.velocity.authority_per_30d).not.toBeNull();
    // no fabrication: exactly the two written points, sorted ascending by observed_at
    expect(result.snapshots.map((s) => s.observed_at)).toEqual([
      '2026-06-01T00:00:00Z',
      '2026-07-01T00:00:00Z',
    ]);
    // authority went 40 → 58 over ~30d → ~+18 per 30d
    expect(result.snapshots[0].authority_score.value).toBe(40);
    expect(result.snapshots[1].authority_score.value).toBe(58);
  });
});
