/**
 * PI-SCORE-PROVENANCE-001 — the cron-runtime wrapper for score evaluation.
 *
 * This is the TRIGGER and the production wiring, and nothing else. Computing a
 * score is `assembleLeadUnderstanding`'s; building the context is
 * `buildProspectIntelligenceContext`'s; recording the result is
 * `persistScoreEvaluation`'s. This file only says WHEN, FOR WHOM, and AS WHOM.
 *
 * Modelled directly on `prospectRetryJob` (A7) — same flag posture, same
 * allow-list, same never-throws contract — because a second scheduling pattern
 * is how two jobs end up with two different ideas of what "enabled" means.
 *
 * ─── WHY A JOB AND NOT THE READ PATH ──────────────────────────────────────
 * The obvious place to persist a score is where one is already computed:
 * `GET /api/prospects/[id]`. That route rejects every non-GET method with 405,
 * and `prospectIntelligenceRead` describes itself as a READ surface that
 * "DECIDES NOTHING". Writing from it would make a safe method mutate, tie write
 * volume to page views, and let a persistence failure break a read. The scoring
 * history is a product record, not a side-effect of someone opening a page.
 *
 * ─── INERT BY DEFAULT, ON TWO INDEPENDENT SWITCHES ────────────────────────
 * Registering a job in `scheduler/cron.ts` makes it run on the next deploy, so
 * the flag is opt-IN: absent the flag this returns immediately having read
 * nothing. It then also requires an explicit tenant allow-list. Both must be set
 * deliberately before a single row is written.
 *
 * ─── WHY AN ALLOW-LIST AND NOT TENANT DISCOVERY ───────────────────────────
 * Scanning for "all tenants with prospects" is a cross-tenant read, and it makes
 * the blast radius of enabling the flag "every tenant at once". Naming the
 * tenants keeps activation a per-tenant act, exactly as A7 already decided for
 * the enrichment retry scheduler.
 *
 * ─── IT NEVER THROWS ──────────────────────────────────────────────────────
 * Cron ticks are shared. One prospect failing to score or persist is reported
 * and the cycle continues, in keeping with every other job in this scheduler.
 */

import { logger } from '../services/logger';
import { ownedDbTable } from '../db/writeOwner';
import { buildProspectIntelligenceContext } from '../services/leadUnderstanding/prospectContext';
import { assembleLeadUnderstanding } from '../services/leadUnderstanding/engines/assembly';
import { persistScoreEvaluation } from '../services/leadUnderstanding/scoreEvaluationStore';

/** Opt-IN. Absent or anything but `'true'` and this job does nothing at all. */
export const SCORE_EVALUATION_FLAG = 'PI_SCORE_EVALUATION_ENABLED';
/** Comma-separated organization ids. Empty means no tenant is in scope. */
export const SCORE_EVALUATION_TENANTS = 'PI_SCORE_EVALUATION_ORG_IDS';

/** Bounded so one tick cannot evaluate an entire tenant's backlog. */
export const SCORE_EVALUATION_BATCH = 25;

export interface ScoreEvaluationReport {
  /** false → the flag is off, or no tenant is in scope. Nothing was read. */
  readonly ran: boolean;
  readonly tenants: number;
  readonly considered: number;
  readonly evaluated: number;
  readonly written: number;
  readonly duplicates: number;
  readonly failures: number;
  readonly durationMs: number;
}

const IDLE: ScoreEvaluationReport = {
  ran: false, tenants: 0, considered: 0, evaluated: 0,
  written: 0, duplicates: 0, failures: 0, durationMs: 0,
};

/** Tenants in scope, from the allow-list. Deduplicated, order preserved. */
export function scheduledScoreTenants(raw: string | undefined): readonly string[] {
  return Array.from(new Set(
    String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  ));
}

export function scoreEvaluationEnabled(raw: string | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true';
}

/** A prospect and the subjects its evaluation is about. */
export interface DueProspect {
  readonly prospectId: string;
  readonly personId: string | null;
  readonly accountId: string | null;
}

export interface ScoreEvaluationPorts {
  listDueProspects(organizationId: string, limit: number): Promise<readonly DueProspect[]>;
  evaluateAndPersist(organizationId: string, due: DueProspect, asOf: string): Promise<'written' | 'duplicate' | 'failed'>;
}

/**
 * Which prospects this tick looks at.
 *
 * Deliberately the simplest correct rule: the tenant's most recently updated
 * prospects, bounded. It is NOT a general event architecture — trigger
 * refinement (enrichment completion, ICP ratification, attribute change) is
 * named in the gate report as deferred, and inventing an event bus here would
 * be exactly the "second framework" this workstream is forbidden to build.
 */
async function defaultListDueProspects(organizationId: string, limit: number): Promise<readonly DueProspect[]> {
  const { data, error } = await ownedDbTable('canonical_leads')
    .select('id, unified_person_id')
    .eq('company_id', organizationId)          // tenant boundary — never optional
    // `created_at` is the ONLY temporal column `canonical_leads` has. An earlier
    // revision ordered by `updated_at`, which does not exist: PostgREST answered
    // 42703, the error was swallowed below, and the job reported a clean cycle
    // having considered zero prospects — every hour, indefinitely. Real-transport
    // certification found it; the seam tests could not, because they injected
    // this port. Ordering must name a column the schema actually has.
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    // A discovery query that fails must not look like a tenant with no work.
    // The cycle still continues (one tenant never ends the tick), but the reason
    // is now visible instead of being indistinguishable from an empty backlog.
    logger.warn?.('prospect_score_due_query_failed', {
      organizationId, code: error.code ?? null, message: error.message,
    });
    return [];
  }
  if (!Array.isArray(data)) return [];
  return (data as unknown as Array<Record<string, unknown>>)
    .map((r) => ({
      prospectId: String(r.id ?? ''),
      personId: r.unified_person_id === null || r.unified_person_id === undefined
        ? null : String(r.unified_person_id),
      // The account is reached through the person; leaving it null is honest
      // when the prospect has no resolved person, and the column is nullable.
      accountId: null as string | null,
    }))
    .filter((d) => d.prospectId.length > 0);
}

async function defaultEvaluateAndPersist(
  organizationId: string, due: DueProspect, asOf: string,
): Promise<'written' | 'duplicate' | 'failed'> {
  const built = await buildProspectIntelligenceContext({
    organizationId, prospectId: due.prospectId, asOf,
  });
  if (!built?.context) return 'failed';

  // The canonical evaluator. Called exactly as the read path calls it, so the
  // persisted score is the same score by construction rather than by agreement.
  const { understanding } = assembleLeadUnderstanding(built.context);

  // The ICP the evaluator actually used, from the context result's own evidence
  // block — never re-read, so the recorded version cannot drift from the scored one.
  const icp = built.evidence?.ratifiedIcp ?? null;

  const result = await persistScoreEvaluation(understanding, {
    organizationId,
    prospectId: due.prospectId,
    personId: due.personId,
    accountId: due.accountId,
    icpId: icp?.icpId ?? null,
    icpVersion: icp?.version ?? null,
    asOf,
    contextGaps: built.gaps ?? [],
  });

  if (result.error) return 'failed';
  return result.written ? 'written' : 'duplicate';
}

export const productionScoreEvaluationPorts: ScoreEvaluationPorts = {
  listDueProspects: defaultListDueProspects,
  evaluateAndPersist: defaultEvaluateAndPersist,
};

export async function runProspectScoreEvaluationJob(
  ports: ScoreEvaluationPorts = productionScoreEvaluationPorts,
  env: NodeJS.ProcessEnv = process.env,
  now: string = new Date().toISOString(),
): Promise<ScoreEvaluationReport> {
  if (!scoreEvaluationEnabled(env[SCORE_EVALUATION_FLAG])) return IDLE;

  const tenants = scheduledScoreTenants(env[SCORE_EVALUATION_TENANTS]);
  if (tenants.length === 0) return IDLE;

  const started = Date.now();
  let considered = 0; let evaluated = 0; let written = 0; let duplicates = 0; let failures = 0;

  for (const organizationId of tenants) {
    let dueList: readonly DueProspect[] = [];
    try {
      dueList = await ports.listDueProspects(organizationId, SCORE_EVALUATION_BATCH);
    } catch {
      failures += 1;
      continue;
    }
    considered += dueList.length;

    for (const due of dueList) {
      try {
        const outcome = await ports.evaluateAndPersist(organizationId, due, now);
        evaluated += 1;
        if (outcome === 'written') written += 1;
        else if (outcome === 'duplicate') duplicates += 1;
        else failures += 1;
      } catch {
        // One prospect never ends the cycle.
        failures += 1;
      }
    }
  }

  const report: ScoreEvaluationReport = {
    ran: true, tenants: tenants.length, considered, evaluated,
    written, duplicates, failures, durationMs: Date.now() - started,
  };

  logger.info?.('prospect_score_evaluation_cycle', {
    tenants: report.tenants, considered, evaluated, written, duplicates, failures,
  });
  return report;
}
