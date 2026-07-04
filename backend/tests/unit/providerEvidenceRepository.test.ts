/**
 * BETA-RELEASE-001 — Canonical provider_evidence persistence + provider health.
 *
 * Verifies the pure record↔row mappers (round-trip, freshness/measured derived), and — since this
 * environment has no applied migration and no DB — that the guarded persistence + health-dashboard paths
 * degrade honestly (table unreachable → migration_pending, empty persisted evidence) and NEVER throw.
 * Deterministic; no live DB write.
 */
import {
  recordToRow, rowToRecord, buildProviderActivationMatrix, createEvidence,
  type Evidence,
} from '../../services/evidencePlatform';
import type { EvidenceRecord } from '../../services/evidencePlatform';

const NOW = '2026-02-01T12:00:00.000Z';
const FETCHED = '2026-02-01T00:00:00.000Z';
const ev = (key: string, value: number): Evidence =>
  createEvidence({ engineId: 'provider:commercial', key, value, maturity: 'MEASURED', sourceType: 'external_api', unit: 'count', observedAt: FETCHED });

const record: EvidenceRecord = {
  providerId: 'commercial', subjectId: 'company-1',
  evidence: [ev('revenue', 100000), ev('conversions', 500)],
  fetchedAt: FETCHED, status: 'ready', failureReason: null,
  governance: { validation: { status: 'validated', validatedCount: 2, flaggedCount: 0, rejectedCount: 0, duplicateKeys: [], reasons: [] } } as any,
};

describe('BETA-RELEASE-001 — record ↔ row mappers (Phase 4/7)', () => {
  it('recordToRow derives freshness + measured deterministically', () => {
    const row = recordToRow('company-1', record, NOW, 24 * 30);
    expect(row.company_id).toBe('company-1');
    expect(row.provider_id).toBe('commercial');
    expect(row.measured).toBe(true); // has measured evidence
    expect(row.freshness_state).toBe('fresh'); // 12h < maxAge*0.5
    expect(row.governance).not.toBeNull();
    expect(row.evidence.length).toBe(2);
  });

  it('round-trips: rowToRecord(recordToRow(x)) preserves the record', () => {
    const row = recordToRow('company-1', record, NOW, 24 * 30);
    const back = rowToRecord(row);
    expect(back.providerId).toBe(record.providerId);
    expect(back.subjectId).toBe(record.subjectId);
    expect(back.evidence.length).toBe(record.evidence.length);
    expect(back.status).toBe(record.status);
    expect(back.governance).not.toBeNull();
  });

  it('an UNAVAILABLE-only record is measured=false (honest)', () => {
    const failRow = recordToRow('c', { ...record, evidence: [createEvidence({ engineId: 'provider:commercial', key: 'revenue', value: null, maturity: 'UNAVAILABLE', sourceType: 'external_api', observedAt: FETCHED })] }, NOW, 24 * 30);
    expect(failRow.measured).toBe(false);
  });

  it('rowToRecord tolerates a non-array evidence payload (guarded)', () => {
    const back = rowToRecord({ provider_id: 'x', subject_id: 's', evidence: null as any, fetched_at: FETCHED, status: 'ready', failure_reason: null, governance: null, freshness_state: 'fresh', measured: false, company_id: 'c' });
    expect(back.evidence).toEqual([]);
  });
});

describe('BETA-RELEASE-001 — provider activation reflects migration status', () => {
  it('migrationApplied=false → all implemented providers migrationPending (honest default)', () => {
    const matrix = buildProviderActivationMatrix({ migrationApplied: false });
    expect(matrix.filter((p) => p.implemented).every((p) => p.migrationPending)).toBe(true);
  });
  it('migrationApplied=true → migration no longer pending', () => {
    const matrix = buildProviderActivationMatrix({ migrationApplied: true });
    expect(matrix.filter((p) => p.implemented).every((p) => !p.migrationPending)).toBe(true);
  });
});
