/**
 * W4 — scheduled refresh of tenant sending-domain verification.
 *
 * FR-1 (approved): a domain may send only while `verified_at` records a
 * successful, validated SES read within the last 48 hours. This worker keeps
 * held identities inside that window. It is a SERVICE only: nothing schedules
 * it yet (activation = a CRON_SECRET-guarded route + a vercel.json cron entry,
 * deliberately not added here).
 *
 * WHAT IT REFRESHES. Live rows (`removed_at IS NULL`) whose SES identity
 * Omnivyra holds (`ses_identity_state` 'created' | 'adopted'), when they are
 * due: never checked, last checked more than REFRESH_AFTER ago, or — after a
 * retryable SES error (`ses_throttled` / `ses_unavailable`) — more than
 * RETRY_AFTER ago. 'none' rows are completed by the interactive registration
 * retry; 'missing' rows need re-registration; deletion states are not refreshed.
 *
 * EVERY GUARANTEE COMES FROM `refreshSendingDomainStatus`: ownership is
 * re-checked, the identity must be a DOMAIN identity with EXACTLY the tenant's
 * configuration set, an absent identity becomes 'missing', an error never
 * upgrades a status, and `verified_at` moves only on a successful read. The
 * worker adds claiming, scheduling, back-off and circuit-breaking around it.
 *
 * CLAIMING (cross-process, no extra schema). A row is claimed by a
 * compare-and-set on `last_checked_at`: the UPDATE sets it to the claim time
 * ONLY IF it still holds the value this worker read, scoped by id AND
 * organization_id. Exactly one concurrent worker can win; the others see zero
 * rows and skip. The claim time also makes the row ineligible until it is due
 * again, which is the lease: a worker that dies mid-refresh leaves a row that
 * becomes eligible again after RETRY_AFTER/REFRESH_AFTER — no lock to release.
 *
 * BACK-OFF / FAIL CLOSED.
 *   throttled                         → stop this run (account-level back-off)
 *   access_denied | provider_not_configured → stop this run (every call would
 *                                        fail the same way); nothing upgrades
 *   other errors / malformed / not adoptable → recorded on that row; continue
 * Each row is attempted at most once per run; retries happen on later runs.
 *
 * NEVER deletes an SES identity: the identity port has no delete operation.
 * Logs carry row/tenant ids and outcome codes only — never credentials.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { logger } from '../logger';
import { refreshSendingDomainStatus, SENDING_DOMAINS_TABLE } from './sendingDomainService';
import type { SesIdentityApi } from './sesIdentityPort';

/** Refresh a held identity at least this often (4 chances inside the 48 h window). */
export const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
/** Retry a row whose last refresh hit a retryable SES error after this long. */
export const RETRY_AFTER_MS = 30 * 60 * 1000;
export const DEFAULT_BATCH_SIZE = 10;
/** At most this many refreshes per tenant per run, so no tenant monopolises a run. */
export const DEFAULT_PER_TENANT_LIMIT = 2;
/** How many candidate rows one run inspects (oldest-checked first). */
export const CANDIDATE_SCAN_LIMIT = 200;

const REFRESHABLE_STATES = ['created', 'adopted'] as const;
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set(['ses_throttled', 'ses_unavailable']);
const STOP_RUN_REASONS: Readonly<Record<string, string>> = {
  ses_throttled: 'throttled',
  ses_access_denied: 'access_denied',
  ses_provider_not_configured: 'provider_not_configured',
};

type Row = Record<string, unknown>;

export interface RefreshWorkerLog {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
}

export interface RefreshWorkerDeps {
  ses?: SesIdentityApi;
  now?: () => Date;
  batchSize?: number;
  perTenantLimit?: number;
  log?: RefreshWorkerLog;
}

export type RowResult = 'refreshed' | 'retryable_failure' | 'terminal_failure' | 'not_found' | 'claim_lost' | 'claim_failed';

export interface RefreshRunSummary {
  scanned: number;
  due: number;
  claimed: number;
  refreshed: number;
  retryable: number;
  terminal: number;
  claimLost: number;
  /** Why the run stopped early, or null when it completed its batch. */
  stoppedEarly: 'throttled' | 'access_denied' | 'provider_not_configured' | 'candidate_read_failed' | null;
  outcomes: Array<{ id: string; organizationId: string; result: RowResult; reason: string | null }>;
}

const ms = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Is this row due for a refresh at `nowMs`? Pure. */
export function isRefreshDue(row: Row, nowMs: number): boolean {
  if (row.removed_at !== null && row.removed_at !== undefined) return false;
  if (!REFRESHABLE_STATES.includes(row.ses_identity_state as never)) return false;
  const checked = ms(row.last_checked_at);
  if (checked === null) return true;
  if (checked > nowMs) return false; // claimed by another worker with a skewed clock: leave it
  const age = nowMs - checked;
  if (age >= REFRESH_AFTER_MS) return true;
  return typeof row.last_error_code === 'string' && RETRYABLE_ERROR_CODES.has(row.last_error_code) && age >= RETRY_AFTER_MS;
}

async function readCandidates(): Promise<Row[] | null> {
  try {
    const res = await ownedDbTable(SENDING_DOMAINS_TABLE)
      .select('id, organization_id, ses_identity_state, last_checked_at, last_error_code, removed_at')
      .is('removed_at', null)
      .in('ses_identity_state', [...REFRESHABLE_STATES])
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(CANDIDATE_SCAN_LIMIT);
    if (res?.error) return null;
    return Array.isArray(res?.data) ? (res.data as Row[]) : [];
  } catch {
    return null;
  }
}

/**
 * Compare-and-set claim. Returns 'claimed', 'lost' (another worker changed the
 * row first) or 'failed' (the write could not be performed).
 */
async function claimRow(row: Row, claimAt: string): Promise<'claimed' | 'lost' | 'failed'> {
  try {
    let q = ownedDbTable(SENDING_DOMAINS_TABLE)
      .update({ last_checked_at: claimAt })
      .eq('id', String(row.id))
      .eq('organization_id', String(row.organization_id))
      .is('removed_at', null)
      .in('ses_identity_state', [...REFRESHABLE_STATES]);
    q = row.last_checked_at === null || row.last_checked_at === undefined
      ? q.is('last_checked_at', null)
      : q.eq('last_checked_at', String(row.last_checked_at));
    const res = await q.select('id');
    if (res?.error) return 'failed';
    return Array.isArray(res?.data) && res.data.length === 1 ? 'claimed' : 'lost';
  } catch {
    return 'failed';
  }
}

/** One refresh pass. Safe to run concurrently from several processes. */
export async function runSendingDomainRefresh(deps: RefreshWorkerDeps = {}): Promise<RefreshRunSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? logger;
  const batchSize = Math.max(0, Math.floor(deps.batchSize ?? DEFAULT_BATCH_SIZE));
  const perTenantLimit = Math.max(1, Math.floor(deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT));
  const summary: RefreshRunSummary = {
    scanned: 0, due: 0, claimed: 0, refreshed: 0, retryable: 0, terminal: 0, claimLost: 0, stoppedEarly: null, outcomes: [],
  };

  const candidates = await readCandidates();
  if (candidates === null) {
    summary.stoppedEarly = 'candidate_read_failed';
    log.warn('sending_domain_refresh_candidates_unreadable', {});
    return summary;
  }
  summary.scanned = candidates.length;
  const nowMs = now().getTime();
  const due = candidates.filter((r) => isRefreshDue(r, nowMs));
  summary.due = due.length;

  const perTenant = new Map<string, number>();
  for (const row of due) {
    if (summary.claimed >= batchSize) break;
    const organizationId = String(row.organization_id ?? '');
    const id = String(row.id ?? '');
    if (!organizationId || !id) continue;
    if ((perTenant.get(organizationId) ?? 0) >= perTenantLimit) continue;

    const claim = await claimRow(row, now().toISOString());
    if (claim !== 'claimed') {
      if (claim === 'lost') summary.claimLost += 1;
      summary.outcomes.push({ id, organizationId, result: claim === 'lost' ? 'claim_lost' : 'claim_failed', reason: null });
      continue;
    }
    summary.claimed += 1;
    perTenant.set(organizationId, (perTenant.get(organizationId) ?? 0) + 1);

    let outcome;
    try {
      outcome = await refreshSendingDomainStatus(organizationId, id, { ses: deps.ses, now });
    } catch {
      outcome = { status: 'retryable_failure' as const, domain: null, reason: 'refresh_threw' };
    }
    summary.outcomes.push({ id, organizationId, result: outcome.status, reason: outcome.reason });
    if (outcome.status === 'refreshed') summary.refreshed += 1;
    else if (outcome.status === 'retryable_failure') summary.retryable += 1;
    else summary.terminal += 1;
    log.info('sending_domain_refresh_row', { sendingDomainId: id, organizationId, result: outcome.status, reason: outcome.reason });

    const stop = outcome.reason ? STOP_RUN_REASONS[outcome.reason] : undefined;
    if (stop) {
      summary.stoppedEarly = stop as RefreshRunSummary['stoppedEarly'];
      log.warn('sending_domain_refresh_stopped', { reason: stop });
      break;
    }
  }

  log.info('sending_domain_refresh_run', {
    scanned: summary.scanned, due: summary.due, claimed: summary.claimed, refreshed: summary.refreshed,
    retryable: summary.retryable, terminal: summary.terminal, claimLost: summary.claimLost, stoppedEarly: summary.stoppedEarly,
  });
  return summary;
}
