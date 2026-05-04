/**
 * Intelligence Scheduler
 *
 * Keeps the legacy daily intelligence export and adds the closed-loop
 * consistency scheduler for expected events, gaps, and reconciliation.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { detectIntelligenceGaps } from '../services/gapDetectionService';
import { logger } from '../services/logger';
import { reconcileIntelligenceState, type ReconciliationResult } from '../services/reconciliationService';
import { evaluateMissedExpectedEvents } from '../services/expectedEventEngine';
import { runDailyIntelligence } from '../jobs/dailyIntelligenceScheduler';

const CRON_EXPRESSION = '0 3 * * *';
const DEFAULT_CLOSED_LOOP_INTERVAL_MINUTES = 15;
const LOCKED_RESULT_ERROR = 'Skipped: closed-loop intelligence scheduler already running';

type CompanyRow = {
  id: string;
};

export type ClosedLoopIntelligenceCompanyResult = {
  company_id: string;
  expected_events_missed: number;
  gaps_created: number;
  actions_created: number;
  prompts_created: number;
  gaps_resolved: number;
  actions_completed: number;
  prompts_responded: number;
  execution_time_ms: number;
  reconciliation: ReconciliationResult | null;
  error?: string;
};

export type ClosedLoopIntelligenceSchedulerResult = {
  started_at: string;
  completed_at: string;
  execution_time_ms: number;
  companies_attempted: number;
  companies_processed: number;
  companies_failed: number;
  expected_events_missed: number;
  gaps_created: number;
  actions_created: number;
  prompts_created: number;
  gaps_resolved: number;
  actions_completed: number;
  prompts_responded: number;
  skipped: boolean;
  errors: string[];
  companies: ClosedLoopIntelligenceCompanyResult[];
};

let closedLoopSchedulerRunning = false;
let closedLoopSchedulerTimer: NodeJS.Timeout | null = null;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getClosedLoopIntelligenceIntervalMs(): number {
  const minutes = parsePositiveInteger(
    process.env.INTELLIGENCE_SCHEDULER_INTERVAL_MINUTES
      ?? process.env.CLOSED_LOOP_INTELLIGENCE_INTERVAL_MINUTES,
    DEFAULT_CLOSED_LOOP_INTERVAL_MINUTES
  );
  return minutes * 60 * 1000;
}

function getCompanyLimit(): number | null {
  const limit = parsePositiveInteger(process.env.INTELLIGENCE_SCHEDULER_COMPANY_LIMIT, 0);
  return limit > 0 ? limit : null;
}

async function loadActiveCompanyIds(): Promise<string[]> {
  let query = supabase
    .from('companies')
    .select('id')
    .eq('status', 'active');

  const limit = getCompanyLimit();
  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (!error) {
    return ((data ?? []) as CompanyRow[]).map((company) => company.id).filter(Boolean);
  }

  logger.warn('closed_loop_intelligence_active_company_lookup_failed', {
    message: error.message,
    fallback: 'all_companies',
  });

  let fallbackQuery = supabase
    .from('companies')
    .select('id');

  if (limit) {
    fallbackQuery = fallbackQuery.limit(limit);
  }

  const { data: fallbackData, error: fallbackError } = await fallbackQuery;
  if (fallbackError) {
    throw new Error(`Failed to load companies for closed-loop intelligence scheduler: ${fallbackError.message}`);
  }

  return ((fallbackData ?? []) as CompanyRow[]).map((company) => company.id).filter(Boolean);
}

function emptySchedulerResult(params: {
  startedAt: string;
  completedAt?: string;
  skipped?: boolean;
  errors?: string[];
}): ClosedLoopIntelligenceSchedulerResult {
  const completedAt = params.completedAt ?? new Date().toISOString();
  return {
    started_at: params.startedAt,
    completed_at: completedAt,
    execution_time_ms: Date.parse(completedAt) - Date.parse(params.startedAt),
    companies_attempted: 0,
    companies_processed: 0,
    companies_failed: 0,
    expected_events_missed: 0,
    gaps_created: 0,
    actions_created: 0,
    prompts_created: 0,
    gaps_resolved: 0,
    actions_completed: 0,
    prompts_responded: 0,
    skipped: params.skipped ?? false,
    errors: params.errors ?? [],
    companies: [],
  };
}

async function runForCompany(companyId: string): Promise<ClosedLoopIntelligenceCompanyResult> {
  const startedAt = Date.now();
  const missed = await evaluateMissedExpectedEvents({ companyId });
  const gaps = await detectIntelligenceGaps({ companyId });
  const reconciliation = await reconcileIntelligenceState({
    trigger: 'scheduler',
    companyId,
    context: {
      job: 'closed_loop_intelligence_scheduler',
      companyId,
    },
  });

  return {
    company_id: companyId,
    expected_events_missed: missed,
    gaps_created: gaps.gapsCreated,
    actions_created: gaps.actionsCreated,
    prompts_created: gaps.promptsCreated,
    gaps_resolved: reconciliation.gapsResolved,
    actions_completed: reconciliation.actionsCompleted,
    prompts_responded: reconciliation.promptsResponded,
    execution_time_ms: Date.now() - startedAt,
    reconciliation,
  };
}

export async function runClosedLoopIntelligenceScheduler(): Promise<ClosedLoopIntelligenceSchedulerResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  if (closedLoopSchedulerRunning) {
    logger.warn('closed_loop_intelligence_scheduler_skipped', {
      startedAt,
      reason: 'already_running',
    });
    return emptySchedulerResult({
      startedAt,
      skipped: true,
      errors: [LOCKED_RESULT_ERROR],
    });
  }

  closedLoopSchedulerRunning = true;
  const companyResults: ClosedLoopIntelligenceCompanyResult[] = [];
  const errors: string[] = [];

  try {
    logger.info('closed_loop_intelligence_scheduler_started', {
      startedAt,
      intervalMs: getClosedLoopIntelligenceIntervalMs(),
    });

    const companyIds = await loadActiveCompanyIds();
    for (const companyId of companyIds) {
      try {
        const result = await runForCompany(companyId);
        companyResults.push(result);
        logger.info('closed_loop_intelligence_company_completed', {
          companyId,
          ...result,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${companyId}: ${message}`);
        companyResults.push({
          company_id: companyId,
          expected_events_missed: 0,
          gaps_created: 0,
          actions_created: 0,
          prompts_created: 0,
          gaps_resolved: 0,
          actions_completed: 0,
          prompts_responded: 0,
          execution_time_ms: 0,
          reconciliation: null,
          error: message,
        });
        logger.error('closed_loop_intelligence_company_failed', {
          companyId,
          message,
        });
      }
    }

    const completedAt = new Date().toISOString();
    const result: ClosedLoopIntelligenceSchedulerResult = {
      started_at: startedAt,
      completed_at: completedAt,
      execution_time_ms: Date.now() - startMs,
      companies_attempted: companyIds.length,
      companies_processed: companyResults.filter((company) => !company.error).length,
      companies_failed: companyResults.filter((company) => Boolean(company.error)).length,
      expected_events_missed: companyResults.reduce((sum, company) => sum + company.expected_events_missed, 0),
      gaps_created: companyResults.reduce((sum, company) => sum + company.gaps_created, 0),
      actions_created: companyResults.reduce((sum, company) => sum + company.actions_created, 0),
      prompts_created: companyResults.reduce((sum, company) => sum + company.prompts_created, 0),
      gaps_resolved: companyResults.reduce((sum, company) => sum + company.gaps_resolved, 0),
      actions_completed: companyResults.reduce((sum, company) => sum + company.actions_completed, 0),
      prompts_responded: companyResults.reduce((sum, company) => sum + company.prompts_responded, 0),
      skipped: false,
      errors,
      companies: companyResults,
    };

    logger.info('closed_loop_intelligence_scheduler_completed', result);
    return result;
  } finally {
    closedLoopSchedulerRunning = false;
  }
}

export function startClosedLoopIntelligenceScheduler(intervalMs = getClosedLoopIntelligenceIntervalMs()): NodeJS.Timeout {
  if (closedLoopSchedulerTimer) {
    return closedLoopSchedulerTimer;
  }

  const run = () => {
    void runClosedLoopIntelligenceScheduler().catch((error) => {
      logger.error('closed_loop_intelligence_scheduler_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  closedLoopSchedulerTimer = setInterval(run, intervalMs);
  return closedLoopSchedulerTimer;
}

export function stopClosedLoopIntelligenceScheduler(): void {
  if (!closedLoopSchedulerTimer) {
    return;
  }

  clearInterval(closedLoopSchedulerTimer);
  closedLoopSchedulerTimer = null;
}

export { runDailyIntelligence, CRON_EXPRESSION };
