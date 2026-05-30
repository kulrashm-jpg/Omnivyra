/**
 * BOLT failure classifier.
 *
 * Normalizes an unknown thrown value (or a NormalizedPipelineError)
 * into the 10-category vocabulary the failure dashboard groups by.
 *
 * This is orthogonal to `normalizePipelineError.type`:
 *   - `normalizePipelineError.type` is a 7-bucket runtime classifier
 *     that mainly drives the retriable hint. It already ships and is
 *     written to bolt_execution_events.metadata.
 *   - `classifyBoltFailure` is the operator-facing taxonomy for the
 *     failure dashboard. It includes pipeline-stage signals that
 *     normalizePipelineError can't see (e.g. UNSUPPORTED_FORMAT vs
 *     VALIDATION_ERROR vs BLUEPRINT_FAILURE).
 *
 * Both classifiers live side-by-side. The dashboard reads
 * `normalized_error_type` (this file). The user-friendly mapping
 * resolver reads it too — see backend/services/userFriendlyErrorService.ts
 * for the expanded mappings keyed off this enum.
 *
 * Categories (per the implementation spec, plus 'OTHER' safety
 * valve so unmatched failures don't collapse into UNKNOWN):
 *
 *   UNSUPPORTED_FORMAT       — creator/text format not in registry
 *   PROVIDER_TIMEOUT         — LLM provider hit a deadline
 *   PROVIDER_RATE_LIMIT      — provider rejected with 429 / quota
 *   PLAN_PARSE_FAILURE       — LLM output failed structured parse
 *   BLUEPRINT_FAILURE        — campaign blueprint commit / save error
 *   DAILY_PLAN_FAILURE       — generate-weekly-structure / per-day
 *   SCHEDULING_FAILURE       — schedule-structured-plan stage
 *   SUPABASE_ERROR           — Postgres / Supabase RPC blew up
 *   VALIDATION_ERROR         — config / execution-input rejection
 *   UNKNOWN                  — we couldn't classify it
 *   OTHER                    — explicitly bucketed but non-canonical
 */

import type { NormalizedPipelineError } from './normalizePipelineError';
import { isBoltError, BOLT_ERROR_CODE_CATEGORY } from './boltErrorCodes';

export type BoltFailureCategory =
  | 'UNSUPPORTED_FORMAT'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMIT'
  | 'PLAN_PARSE_FAILURE'
  | 'BLUEPRINT_FAILURE'
  | 'DAILY_PLAN_FAILURE'
  | 'SCHEDULING_FAILURE'
  | 'SUPABASE_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN'
  | 'OTHER';

export type BoltFailureProvider =
  | 'openai'
  | 'anthropic'
  | 'supabase'
  | 'redis'
  | 'bullmq'
  | 'self'
  | 'unknown';

export interface ClassifiedBoltFailure {
  category: BoltFailureCategory;
  provider: BoltFailureProvider;
  retriable: boolean;
}

export interface ClassifyBoltFailureInput {
  /** Pre-normalized message + code + type, if the caller already has one. */
  normalized?: NormalizedPipelineError;
  /** Raw thrown value, when no normalized form is available. */
  error?: unknown;
  /** Catch-site stage. Strong signal for BLUEPRINT/DAILY/SCHEDULING bucketing. */
  stage?: string | null;
  /** Pipeline mode tag — week_plan / daily_plan / schedule / repurpose. */
  pipelineMode?: string | null;
}

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

function stageMatches(stage: string | null | undefined, needles: string[]): boolean {
  const s = lower(stage);
  if (!s) return false;
  return needles.some((n) => s.includes(n));
}

function detectProvider(message: string, code: string | null | undefined, stage: string | null | undefined): BoltFailureProvider {
  const m = lower(message);
  const c = lower(code);
  const s = lower(stage);

  if (m.includes('openai') || m.includes('gpt-') || m.includes('chat completion')) return 'openai';
  if (m.includes('anthropic') || m.includes('claude')) return 'anthropic';
  if (c === '23505' || c === '23503' || c === '23514' || m.includes('postgres') || m.includes('relation') || m.includes('column') || m.includes('rls')) {
    return 'supabase';
  }
  if (m.includes('redis') || m.includes('upstash') || c === 'eaiagain' || (m.includes('connection') && (m.includes('rediss://') || m.includes('redis://')))) {
    return 'redis';
  }
  if (m.includes('bullmq') || m.includes('queue') && m.includes('job')) return 'bullmq';
  // Source-recommendation / ai/plan throws are usually self-attributed —
  // the LLM call is wrapped further down, so the throw at the boundary
  // here is internal logic (e.g. campaign_versions update failed).
  if (s.startsWith('pre-validate') || s.startsWith('validate-')) return 'self';
  return 'unknown';
}

/**
 * Categorize a BOLT pipeline failure. Pure function; safe to call from
 * any catch path. Returns 'UNKNOWN' rather than throwing when nothing
 * matches — the goal is to NEVER lose a failure to a classifier bug.
 */
export function classifyBoltFailure(input: ClassifyBoltFailureInput): ClassifiedBoltFailure {
  // BoltError carries an explicit category — trust it. Lets every
  // validator/persistence wrapper that throws BoltError skip the
  // message-pattern matching path entirely.
  if (isBoltError(input.error)) {
    const cat = BOLT_ERROR_CODE_CATEGORY[input.error.code] ?? 'UNKNOWN';
    return {
      category: cat,
      provider: cat === 'SUPABASE_ERROR' ? 'supabase'
        : cat === 'UNSUPPORTED_FORMAT' || cat === 'VALIDATION_ERROR' || cat === 'BLUEPRINT_FAILURE' ? 'self'
        : 'unknown',
      retriable: cat === 'PROVIDER_TIMEOUT' || cat === 'PROVIDER_RATE_LIMIT' || cat === 'SUPABASE_ERROR',
    };
  }

  const normalized = input.normalized;
  const rawMessage = normalized?.message
    ?? (input.error instanceof Error ? input.error.message : String(input.error ?? ''));
  const code = normalized?.code ?? null;
  const stage = input.stage ?? null;
  const type = normalized?.type ?? null;
  const message = lower(rawMessage);

  const provider = detectProvider(rawMessage, code, stage);

  // ── Stage-first classification (strongest signal) ──────────────
  // The catch-site name uniquely identifies several buckets even
  // when the underlying message is generic.
  if (stageMatches(stage, ['pre-validate', 'validate-execution-config', 'validate-platforms'])) {
    // pre-validate-creator-format throws "Unsupported creator format: …"
    // pre-validate-creator-schedule + validate-execution-config emit
    // generic "BOLT execution blocked" / "Missing execution inputs".
    if (message.includes('unsupported creator format') || message.includes('unsupported format')) {
      return { category: 'UNSUPPORTED_FORMAT', provider: 'self', retriable: false };
    }
    return { category: 'VALIDATION_ERROR', provider: 'self', retriable: false };
  }

  if (stageMatches(stage, ['commit-plan', 'commit-campaign-plan'])) {
    return { category: 'BLUEPRINT_FAILURE', provider, retriable: provider !== 'self' };
  }

  if (stageMatches(stage, ['generate-weekly-structure', 'generate-weekly', 'daily-plan'])) {
    return { category: 'DAILY_PLAN_FAILURE', provider, retriable: true };
  }

  if (stageMatches(stage, ['schedule-structured-plan', 'schedule-creating-content', 'schedule-repurposing-content', 'schedule-writing-posts'])) {
    return { category: 'SCHEDULING_FAILURE', provider, retriable: true };
  }

  // ── Message-based classification (fallback for outer/ai-plan) ──
  if (
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('429') ||
    message.includes('quota') ||
    code === 'rate_limit_exceeded' ||
    code === 'insufficient_quota'
  ) {
    return { category: 'PROVIDER_RATE_LIMIT', provider: provider === 'unknown' ? 'openai' : provider, retriable: true };
  }

  if (
    type === 'timeout' ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    code === 'ETIMEDOUT'
  ) {
    return { category: 'PROVIDER_TIMEOUT', provider: provider === 'unknown' ? 'openai' : provider, retriable: true };
  }

  if (
    message.includes('did not return a valid plan') ||
    message.includes('parse') && (message.includes('json') || message.includes('plan') || message.includes('skeleton')) ||
    message.includes('malformed') ||
    message.includes('repair') && message.includes('skeleton')
  ) {
    return { category: 'PLAN_PARSE_FAILURE', provider: provider === 'unknown' ? 'openai' : provider, retriable: true };
  }

  if (
    type === 'db_constraint' ||
    provider === 'supabase' ||
    message.includes('rls') ||
    message.includes('row-level security') ||
    message.includes('violates check constraint') ||
    message.includes('violates foreign key') ||
    message.includes('duplicate key')
  ) {
    return { category: 'SUPABASE_ERROR', provider: 'supabase', retriable: false };
  }

  if (
    type === 'validation' ||
    message.includes('bolt execution blocked') ||
    message.includes('missing execution inputs') ||
    message.includes('invalid') ||
    message.includes('required')
  ) {
    return { category: 'VALIDATION_ERROR', provider, retriable: false };
  }

  if (message.includes('unsupported creator format') || message.includes('unsupported format')) {
    return { category: 'UNSUPPORTED_FORMAT', provider: 'self', retriable: false };
  }

  // ── Stage-name fallback ────────────────────────────────────────
  // Closure pass: every BOLT stage now has a default category so
  // even unconverted throws never land in UNKNOWN. The dashboard's
  // `unknown_count` tile is the safety net for genuine surprises.
  if (stageMatches(stage, ['ai/plan', 'ai-plan'])) {
    return { category: 'PLAN_PARSE_FAILURE', provider: provider === 'unknown' ? 'openai' : provider, retriable: true };
  }
  if (stageMatches(stage, ['creator-asset', 'creator_asset'])) {
    return { category: 'DAILY_PLAN_FAILURE', provider: provider === 'unknown' ? 'self' : provider, retriable: true };
  }
  if (stageMatches(stage, ['source-recommendation'])) {
    return { category: 'VALIDATION_ERROR', provider: provider === 'unknown' ? 'self' : provider, retriable: true };
  }
  if (stageMatches(stage, ['commit-plan', 'commit-campaign-plan'])) {
    return { category: 'BLUEPRINT_FAILURE', provider: provider === 'unknown' ? 'self' : provider, retriable: true };
  }
  if (stageMatches(stage, ['pipeline-outer'])) {
    // The outer catch always wraps something the per-stage catch
    // already classified. Default to PROVIDER_TIMEOUT to flag the
    // most likely cause — long-running stages overrunning their
    // budget — and leave the dashboard's `unknown_count` for true
    // unclassifiable throws.
    return { category: 'PROVIDER_TIMEOUT', provider, retriable: true };
  }

  return { category: 'UNKNOWN', provider, retriable: normalized?.retriable ?? true };
}
