/**
 * Enterprise Governance — Warm-Start Restoration (Phase 5).
 *
 * Restores in-memory review state from the Redis mirror at process boot.
 * Without warm-start, a worker restart loses every review record older
 * than the next-time-the-asset-is-touched (the on-demand re-projection
 * path); with warm-start, recent state is restored proactively so
 * dashboards, alerting, and approval workflows have continuity.
 *
 * Restoration semantics:
 *   - read most-recent N review records per known company from Redis
 *   - re-establish in-memory records via the state machine's
 *     `establishReviewRecord` then patch `currentState` and history
 *     forward — preserving idempotency against the Redis mirror
 *   - duplicate-replay protection: skip records that already exist
 *     in-memory (a previous boot may have already restored them, or
 *     the orchestrator may have already touched the asset)
 *   - bounded: at most 50 companies × 200 records per pass
 *
 * Activation: ENTERPRISE_GOVERNANCE_WARM_START_ENABLED=true. Only effective
 * when ENTERPRISE_GOVERNANCE_REDIS_ENABLED=true is also set (no Redis,
 * nothing to restore).
 *
 * Best-effort. Never throws.
 */

import {
  readMirroredReviewRecords,
  listMirroredCompanies,
} from './enterpriseGovernanceRedisPersistence';
import {
  establishReviewRecord,
  getReviewRecord,
  type ReviewState,
} from './creativeReviewStateMachine';

const MAX_COMPANIES_PER_PASS = 50;
const MAX_RECORDS_PER_COMPANY = 200;

let _alreadyRan = false;

export type WarmStartResult = {
  ranAt: string;
  companiesScanned: number;
  recordsConsidered: number;
  recordsRestored: number;
  recordsSkippedDuplicate: number;
  recordsSkippedMalformed: number;
  durationMs: number;
};

function isEnabled(): boolean {
  return String(process.env.ENTERPRISE_GOVERNANCE_WARM_START_ENABLED ?? 'false').toLowerCase() === 'true';
}

function isValidReviewState(s: unknown): s is ReviewState {
  return typeof s === 'string' && [
    'draft', 'generated', 'qa_review', 'governance_review', 'brand_review',
    'legal_review', 'approved', 'rejected', 'published', 'archived',
  ].includes(s);
}

/**
 * Run warm-start restoration. Idempotent — re-calling within the same
 * process is a no-op unless `force: true` is supplied (used by tests).
 */
export async function restoreReviewRecordsFromRedis(input: { force?: boolean } = {}): Promise<WarmStartResult> {
  const startedAt = Date.now();
  const result: WarmStartResult = {
    ranAt: new Date(startedAt).toISOString(),
    companiesScanned: 0,
    recordsConsidered: 0,
    recordsRestored: 0,
    recordsSkippedDuplicate: 0,
    recordsSkippedMalformed: 0,
    durationMs: 0,
  };

  if (!isEnabled()) {
    console.info('[creator-gov-warm-start] disabled — skipping');
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  if (_alreadyRan && !input.force) {
    console.info('[creator-gov-warm-start] already ran in this process — skipping');
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  try {
    const companies = await listMirroredCompanies(MAX_COMPANIES_PER_PASS);
    result.companiesScanned = companies.length;

    for (const companyId of companies) {
      try {
        const records = await readMirroredReviewRecords(companyId, MAX_RECORDS_PER_COMPANY);
        for (const raw of records) {
          result.recordsConsidered += 1;
          const assetId = typeof raw.assetId === 'string' ? raw.assetId : null;
          const cid = typeof raw.companyId === 'string' ? raw.companyId : companyId;
          const campaignId = typeof raw.campaignId === 'string' ? raw.campaignId : null;
          const currentState = raw.currentState;

          if (!assetId || !cid) {
            result.recordsSkippedMalformed += 1;
            continue;
          }
          if (!isValidReviewState(currentState)) {
            result.recordsSkippedMalformed += 1;
            continue;
          }

          // Duplicate-replay protection — skip if already in memory.
          if (getReviewRecord(assetId)) {
            result.recordsSkippedDuplicate += 1;
            continue;
          }

          try {
            establishReviewRecord({
              assetId,
              companyId: cid,
              campaignId,
              initialState: currentState,
              actorUserId: 'warm-start',
              actorRole: null,
            });
            result.recordsRestored += 1;
          } catch (err) {
            result.recordsSkippedMalformed += 1;
            console.warn('[creator-gov-warm-start] restore-failed', {
              assetId,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        console.warn('[creator-gov-warm-start] company-failed', {
          companyId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    _alreadyRan = true;
  } catch (err) {
    console.warn('[creator-gov-warm-start] failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  result.durationMs = Date.now() - startedAt;
  console.info('[creator-gov-warm-start] complete', JSON.stringify(result));
  return result;
}

export function warmStartDiagnostics(): {
  enabled: boolean;
  alreadyRan: boolean;
  maxCompaniesPerPass: number;
  maxRecordsPerCompany: number;
} {
  return {
    enabled: isEnabled(),
    alreadyRan: _alreadyRan,
    maxCompaniesPerPass: MAX_COMPANIES_PER_PASS,
    maxRecordsPerCompany: MAX_RECORDS_PER_COMPANY,
  };
}

export function resetWarmStartForTests(): void { _alreadyRan = false; }
