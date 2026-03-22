/**
 * Intelligence Orchestration Config Service
 *
 * Resolution logic:
 *   company override field ?? global config field
 *
 * Boost logic:
 *   If boost_until > now(): use boost_priority / boost_frequency_minutes
 *   instead of normal priority / frequency_minutes (whichever is higher priority).
 *
 * Scheduler stack:
 *   Returns all jobs sorted by effective priority (ascending — lower number = higher urgency).
 *   Callers use this stack to decide what to run next and in what order.
 */

import { supabase } from '../db/supabaseClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export const INTELLIGENCE_JOB_TYPES = [
  'signal_clustering',
  'signal_intelligence',
  'strategic_themes',
  'campaign_opportunities',
  'content_opportunities',
  'narrative_engine',
  'community_posts',
  'thread_engine',
  'engagement_capture',
  'engagement_polling',
  'intelligence_polling',
  'feedback_intelligence',
  'trend_relevance',
  'publish',
  'blog_generation',
  'hook_analysis',
] as const;

export type IntelligenceJobType = (typeof INTELLIGENCE_JOB_TYPES)[number];

export interface GlobalConfig {
  job_type:          string;
  label:             string;
  description:       string | null;
  priority:          number;
  frequency_minutes: number;
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  daily_job_limit:   number;
  updated_at:        string;
  updated_by:        string;
}

export interface CompanyOverride {
  id:                      string;
  company_id:              string;
  job_type:                string;
  priority:                number | null;
  frequency_minutes:       number | null;
  enabled:                 boolean | null;
  max_concurrent:          number | null;
  timeout_seconds:         number | null;
  retry_count:             number | null;
  model:                   string | null;
  daily_job_limit:         number | null;
  boost_until:             string | null;
  boost_priority:          number | null;
  boost_frequency_minutes: number | null;
  reason:                  string | null;
  updated_at:              string;
  updated_by:              string;
}

export interface ResolvedConfig {
  job_type:          string;
  label:             string;
  priority:          number;          // effective — after boost
  frequency_minutes: number;          // effective — after boost
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  is_boosted:        boolean;
  boost_expires_at:  string | null;
  source:            'global' | 'override' | 'boosted';
}

export interface SchedulerEntry {
  job_type:          string;
  label:             string;
  company_id:        string | null;   // null = global (non-per-company) jobs
  priority:          number;
  frequency_minutes: number;
  enabled:           boolean;
  max_concurrent:    number;
  timeout_seconds:   number;
  retry_count:       number;
  model:             string | null;
  is_boosted:        boolean;
  source:            'global' | 'override' | 'boosted';
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Core resolution: merges a global config with an optional company override.
 * Boost takes effect only if boost_until is in the future.
 */
export function resolveConfig(
  global:    GlobalConfig,
  override?: CompanyOverride | null,
): ResolvedConfig {
  const now       = Date.now();
  const isBoosted = !!override?.boost_until && new Date(override.boost_until).getTime() > now;

  const basePriority   = override?.priority          ?? global.priority;
  const baseFrequency  = override?.frequency_minutes ?? global.frequency_minutes;

  // Boost overrides priority/frequency if it gives a better (lower number = higher urgency) priority
  const effectivePriority  = isBoosted
    ? Math.min(basePriority,  override!.boost_priority          ?? basePriority)
    : basePriority;
  const effectiveFrequency = isBoosted
    ? Math.min(baseFrequency, override!.boost_frequency_minutes ?? baseFrequency)
    : baseFrequency;

  const source: ResolvedConfig['source'] = isBoosted ? 'boosted'
    : override   ? 'override'
    : 'global';

  return {
    job_type:          global.job_type,
    label:             global.label,
    priority:          effectivePriority,
    frequency_minutes: effectiveFrequency,
    enabled:           override?.enabled          ?? global.enabled,
    max_concurrent:    override?.max_concurrent   ?? global.max_concurrent,
    timeout_seconds:   override?.timeout_seconds  ?? global.timeout_seconds,
    retry_count:       override?.retry_count      ?? global.retry_count,
    model:             override?.model            ?? global.model,
    is_boosted:        isBoosted,
    boost_expires_at:  isBoosted ? override!.boost_until : null,
    source,
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

export async function getAllGlobalConfigs(): Promise<GlobalConfig[]> {
  const { data, error } = await supabase
    .from('intelligence_global_config')
    .select('*')
    .order('priority', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GlobalConfig[];
}

export async function getGlobalConfig(jobType: string): Promise<GlobalConfig | null> {
  const { data } = await supabase
    .from('intelligence_global_config')
    .select('*')
    .eq('job_type', jobType)
    .maybeSingle();
  return (data as GlobalConfig | null);
}

export async function updateGlobalConfig(
  jobType:   string,
  updates:   Partial<Omit<GlobalConfig, 'job_type' | 'updated_at'>>,
  updatedBy: string,
): Promise<GlobalConfig> {
  const { data, error } = await supabase
    .from('intelligence_global_config')
    .update({ ...updates, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('job_type', jobType)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as GlobalConfig;
}

export async function getCompanyOverrides(companyId: string): Promise<CompanyOverride[]> {
  const { data, error } = await supabase
    .from('intelligence_company_overrides')
    .select('*')
    .eq('company_id', companyId)
    .order('job_type');
  if (error) throw new Error(error.message);
  return (data ?? []) as CompanyOverride[];
}

export async function getCompanyOverride(
  companyId: string,
  jobType:   string,
): Promise<CompanyOverride | null> {
  const { data } = await supabase
    .from('intelligence_company_overrides')
    .select('*')
    .eq('company_id', companyId)
    .eq('job_type', jobType)
    .maybeSingle();
  return (data as CompanyOverride | null);
}

export async function upsertCompanyOverride(
  companyId: string,
  jobType:   string,
  fields:    Partial<Omit<CompanyOverride, 'id' | 'company_id' | 'job_type' | 'created_at' | 'updated_at'>>,
  updatedBy: string,
): Promise<CompanyOverride> {
  const { data, error } = await supabase
    .from('intelligence_company_overrides')
    .upsert({
      company_id: companyId,
      job_type:   jobType,
      ...fields,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    }, { onConflict: 'company_id,job_type' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CompanyOverride;
}

export async function deleteCompanyOverride(
  companyId: string,
  jobType:   string,
): Promise<void> {
  const { error } = await supabase
    .from('intelligence_company_overrides')
    .delete()
    .eq('company_id', companyId)
    .eq('job_type', jobType);
  if (error) throw new Error(error.message);
}

// ── Resolved config for a single company+job ──────────────────────────────────

export async function getResolvedConfig(
  companyId: string,
  jobType:   string,
): Promise<ResolvedConfig | null> {
  const [global, override] = await Promise.all([
    getGlobalConfig(jobType),
    getCompanyOverride(companyId, jobType),
  ]);
  if (!global) return null;
  return resolveConfig(global, override);
}

// ── Scheduler stack ───────────────────────────────────────────────────────────
/**
 * Returns all active (enabled) scheduler entries across all companies,
 * sorted by effective priority ascending (lower = run first).
 *
 * For global (non-per-company) jobs, company_id is null.
 * For per-company jobs with overrides, one entry per company.
 *
 * Used by the scheduler to build its run queue.
 */
export async function buildSchedulerStack(
  companyIds?: string[],
): Promise<SchedulerEntry[]> {
  const [globals, allOverrides] = await Promise.all([
    getAllGlobalConfigs(),
    companyIds && companyIds.length > 0
      ? supabase
          .from('intelligence_company_overrides')
          .select('*')
          .in('company_id', companyIds)
          .then(r => (r.data ?? []) as CompanyOverride[])
      : Promise.resolve([] as CompanyOverride[]),
  ]);

  const stack: SchedulerEntry[] = [];

  for (const global of globals) {
    // Global entry (applies when no per-company override, or for global jobs)
    const globalResolved = resolveConfig(global);
    if (!globalResolved.enabled) continue;

    // If we have companyIds, produce per-company entries
    if (companyIds && companyIds.length > 0) {
      for (const companyId of companyIds) {
        const override = allOverrides.find(
          o => o.company_id === companyId && o.job_type === global.job_type,
        ) ?? null;
        const resolved = resolveConfig(global, override);
        if (!resolved.enabled) continue;
        stack.push({ ...resolved, company_id: companyId });
      }
    } else {
      // Global stack (no company context)
      stack.push({ ...globalResolved, company_id: null });
    }
  }

  // Sort: priority ascending (1 = highest urgency), then frequency ascending
  stack.sort((a, b) => a.priority !== b.priority
    ? a.priority - b.priority
    : a.frequency_minutes - b.frequency_minutes,
  );

  return stack;
}

// ── New-account boost ──────────────────────────────────────────────────────────
/**
 * Applies a boost to all job types for a newly onboarded company.
 * Boost lasts `durationHours` hours (default: 48h).
 * Boost priority: 1 (highest). Boost frequency: 2× faster than global default.
 */
export async function applyNewAccountBoost(
  companyId:     string,
  updatedBy:     string,
  durationHours: number = 48,
): Promise<void> {
  const globals = await getAllGlobalConfigs();
  const boostUntil = new Date(Date.now() + durationHours * 3_600_000).toISOString();

  await Promise.all(globals.map(g =>
    upsertCompanyOverride(companyId, g.job_type, {
      boost_until:             boostUntil,
      boost_priority:          1,
      boost_frequency_minutes: Math.max(5, Math.floor(g.frequency_minutes / 2)),
      reason:                  `New-account boost — ${durationHours}h (applied by ${updatedBy})`,
    }, updatedBy),
  ));
}

// ── Budget helpers ────────────────────────────────────────────────────────────

/**
 * Count how many non-skipped job executions a company has started today (UTC).
 * Used by runWithConfig to enforce daily_job_limit.
 */
export async function getDailyJobCount(companyId: string): Promise<number> {
  const todayUtc = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const { count } = await supabase
    .from('intelligence_execution_log')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('started_at', `${todayUtc}T00:00:00.000Z`)
    .in('status', ['running', 'completed', 'failed']);
  return count ?? 0;
}

// ── Dynamic priority helpers ──────────────────────────────────────────────────

/**
 * Returns a priority adjustment hint for a company:
 * - 'new'      — created within the last 14 days → boost priority
 * - 'inactive' — no completed run in the last 30 days → deprioritise
 * - 'normal'   — everything else
 */
export async function getCompanyPriorityAdjustment(
  companyId: string,
): Promise<'new' | 'inactive' | 'normal'> {
  // New company check
  const { data: profile } = await supabase
    .from('company_profiles')
    .select('created_at')
    .eq('company_id', companyId)
    .maybeSingle();

  if (profile?.created_at) {
    const daysOld = (Date.now() - new Date(profile.created_at).getTime()) / 86_400_000;
    if (daysOld <= 14) return 'new';
  }

  // Inactive company check — no completed run in 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { count } = await supabase
    .from('intelligence_execution_log')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'completed')
    .gte('started_at', thirtyDaysAgo);

  if ((count ?? 0) === 0) return 'inactive';

  return 'normal';
}

// ── Execution log helpers ──────────────────────────────────────────────────────

export async function logExecutionStart(
  jobType:     string,
  companyId:   string | null,
  triggeredBy: string = 'scheduler',
): Promise<string> {
  const { data, error } = await supabase
    .from('intelligence_execution_log')
    .insert({ job_type: jobType, company_id: companyId, triggered_by: triggeredBy, status: 'running' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * Insert a single 'skipped' row without a running-state start entry.
 * Used for budget_exceeded, disabled, and deferred skips.
 */
export async function logSkipped(
  jobType:     string,
  companyId:   string | null,
  reason:      string,
  triggeredBy  = 'scheduler',
): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('intelligence_execution_log').insert({
    job_type:    jobType,
    company_id:  companyId,
    triggered_by: triggeredBy,
    status:      'skipped',
    reason,
    started_at:  now,
    finished_at: now,
    duration_ms: 0,
  });
}

export async function logExecutionEnd(
  logId:      string,
  status:     'completed' | 'failed' | 'skipped',
  result?:    Record<string, unknown>,
  error?:     string,
  reason?:    string,
): Promise<void> {
  const now       = new Date();
  const { data: existing } = await supabase
    .from('intelligence_execution_log')
    .select('started_at')
    .eq('id', logId)
    .maybeSingle();

  const durationMs = existing?.started_at
    ? now.getTime() - new Date(existing.started_at).getTime()
    : null;

  await supabase
    .from('intelligence_execution_log')
    .update({
      status,
      finished_at:  now.toISOString(),
      duration_ms:  durationMs,
      result:       result ?? null,
      error:        error  ?? null,
      reason:       reason ?? null,
    })
    .eq('id', logId);
}

export async function getRecentExecutionLogs(
  jobType?:   string,
  companyId?: string,
  limit       = 50,
): Promise<unknown[]> {
  let q = supabase
    .from('intelligence_execution_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (jobType)   q = q.eq('job_type',   jobType);
  if (companyId) q = q.eq('company_id', companyId);
  const { data } = await q;
  return data ?? [];
}
