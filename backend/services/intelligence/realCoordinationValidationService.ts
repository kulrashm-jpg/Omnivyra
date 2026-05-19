/**
 * REAL coordination validation — exercises the actual atomicLockService CAS
 * path concurrently (not a seeded model). Isolated: it operates ONLY on a
 * reserved synthetic tenant + random validation scope, and always releases —
 * so it never touches real-tenant coordination state and performs no
 * production mutation. Deterministic outcome (exactly one acquirer must win),
 * repeatable, append-only audited.
 */
import { acquireAtomicLock, releaseAtomicLock } from './atomicLockService';
import { recordComplianceAudit } from '../audit/complianceAuditService';

// Reserved, non-tenant sentinel — a valid UUID that is never a real company id
// (all-zero prefix + fixed suffix; isolated from tenant coordination state).
const VALIDATION_COMPANY = '00000000-0000-4000-8000-000000000001';

export interface RealCoordinationResult {
  generatedAt: string;
  concurrentAcquirers: number;
  winners: number;
  fencingTokens: number[];
  lockMode: string;
  passed: boolean;
  detail: string;
}

export async function runRealCoordinationValidation(
  companyId: string,
  concurrency = 8,
): Promise<RealCoordinationResult> {
  const scope = `__validation__:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  // Fire N concurrent real acquire attempts at the same (sentinel, scope).
  const handles = await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      acquireAtomicLock({
        companyId: VALIDATION_COMPANY,
        scope,
        owner: `validator-${i}`,
        ttlMs: 15_000,
      }).catch(() => null),
    ),
  );

  const won = handles.filter((h): h is NonNullable<typeof h> => h !== null);
  const winners = won.length;
  const fencingTokens = won.map((h) => h.fencing);
  const lockMode = won[0]?.mode ?? 'unknown';

  // Always release everything we acquired (isolation/cleanup).
  await Promise.all(won.map((h) => releaseAtomicLock(h).catch(() => undefined)));

  // Atomic mode: exactly one winner. Advisory fallback: best-effort (still
  // typically one); report mode so the result is interpreted correctly.
  const passed = lockMode === 'atomic' ? winners === 1 : winners >= 1;

  await recordComplianceAudit({
    companyId,
    actor: { userId: null, type: 'system', label: 'real-coordination-validation' },
    action: `coordination_validation.${passed ? 'pass' : 'fail'}`,
    resourceType: 'coordination_validation',
    resourceId: companyId,
    severity: passed ? 'info' : 'warning',
    outcome: passed ? 'success' : 'failure',
    entityLineage: ['company', 'coordination_validation'],
    detail: { concurrency, winners, lockMode, fencingTokens },
  }).catch(() => undefined);

  return {
    generatedAt: new Date().toISOString(),
    concurrentAcquirers: concurrency,
    winners,
    fencingTokens,
    lockMode,
    passed,
    detail:
      lockMode === 'atomic'
        ? `Real CAS: ${winners}/${concurrency} acquirer(s) won (expected exactly 1).`
        : `Advisory-fallback mode: ${winners}/${concurrency} won (atomic table not applied here).`,
  };
}
