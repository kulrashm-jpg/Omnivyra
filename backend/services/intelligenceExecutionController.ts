/**
 * Intelligence Execution Controller
 * Controls execution frequency, protects resources, prioritizes companies.
 * Does NOT change intelligence logic — only controls when processes execute.
 */

import { supabase } from '../db/supabaseClient';

export type ExecutionType =
  | 'intelligence_cycle'
  | 'simulation_run'
  | 'optimization_run'
  | 'learning_cycle';

export type PriorityLevel = 'HIGH' | 'NORMAL' | 'LOW';

export const LIMITS = {
  max_cycles_per_hour: 6,
  high_priority_cycle_limit: 12,
  max_simulations_per_hour: 10,
  max_optimizations_per_day: 4,
  max_learning_runs_per_hour: 4,
} as const;

async function getPriority(companyId: string): Promise<PriorityLevel> {
  const { data } = await supabase
    .from('company_execution_priority')
    .select('priority_level')
    .eq('company_id', companyId)
    .maybeSingle();
  const level = (data?.priority_level ?? 'NORMAL') as string;
  if (level === 'HIGH' || level === 'NORMAL' || level === 'LOW') return level;
  return 'NORMAL';
}

async function countExecutionsInLastHour(
  companyId: string,
  executionType: ExecutionType
): Promise<number> {
  const since = new Date();
  since.setHours(since.getHours() - 1);
  const sinceStr = since.toISOString();
  const { count, error } = await supabase
    .from('intelligence_execution_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('execution_type', executionType)
    .gte('executed_at', sinceStr);
  if (error) return 0;
  return count ?? 0;
}

async function countOptimizationsToday(companyId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from('intelligence_execution_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('execution_type', 'optimization_run')
    .eq('execution_date', today);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Check if intelligence cycle can run.
 */
export async function canRunCycle(companyId: string): Promise<boolean> {
  const priority = await getPriority(companyId);
  const count = await countExecutionsInLastHour(companyId, 'intelligence_cycle');
  const limit = priority === 'HIGH' ? LIMITS.high_priority_cycle_limit : LIMITS.max_cycles_per_hour;
  return count < limit;
}

/**
 * Check if optimization can run.
 */
export async function canRunOptimization(companyId: string): Promise<boolean> {
  const count = await countOptimizationsToday(companyId);
  return count < LIMITS.max_optimizations_per_day;
}

/**
 * Check if simulation can run.
 */
export async function canRunSimulation(companyId: string): Promise<boolean> {
  const count = await countExecutionsInLastHour(companyId, 'simulation_run');
  return count < LIMITS.max_simulations_per_hour;
}

/**
 * Check if learning cycle can run.
 */
export async function canRunLearning(companyId: string): Promise<boolean> {
  const count = await countExecutionsInLastHour(companyId, 'learning_cycle');
  return count < LIMITS.max_learning_runs_per_hour;
}

/**
 * Record execution and optionally log to execution_logs.
 */
export async function recordExecution(
  companyId: string,
  executionType: ExecutionType,
  options?: { status?: string; latencyMs?: number }
): Promise<void> {
  await supabase.from('intelligence_execution_metrics').insert({
    company_id: companyId,
    execution_type: executionType,
    executed_at: new Date().toISOString(),
  });

  const status = options?.status ?? 'success';
  await supabase.from('intelligence_execution_logs').insert({
    company_id: companyId,
    execution_type: executionType,
    status,
    latency_ms: options?.latencyMs ?? null,
    created_at: new Date().toISOString(),
  });
}

/**
 * Record skipped execution (due to limits).
 */
export async function recordExecutionSkipped(
  companyId: string,
  executionType: ExecutionType,
  reason: string
): Promise<void> {
  await supabase.from('intelligence_execution_logs').insert({
    company_id: companyId,
    execution_type: executionType,
    status: 'skipped_due_to_limits',
    latency_ms: null,
    created_at: new Date().toISOString(),
  });
}

/**
 * Get execution eligibility for a company.
 */
export async function getExecutionEligibility(companyId: string): Promise<{
  can_run_cycle: boolean;
  can_run_optimization: boolean;
  can_run_simulation: boolean;
  can_run_learning: boolean;
  priority: PriorityLevel;
  limits: typeof LIMITS;
}> {
  const [can_run_cycle, can_run_optimization, can_run_simulation, can_run_learning, priority] =
    await Promise.all([
      canRunCycle(companyId),
      canRunOptimization(companyId),
      canRunSimulation(companyId),
      canRunLearning(companyId),
      getPriority(companyId),
    ]);
  return {
    can_run_cycle,
    can_run_optimization,
    can_run_simulation,
    can_run_learning,
    priority,
    limits: LIMITS,
  };
}
