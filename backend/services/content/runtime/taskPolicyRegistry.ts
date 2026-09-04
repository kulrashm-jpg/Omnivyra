/**
 * Writer Wave 3 — AI Runtime Consolidation: TASK POLICY REGISTRY.
 *
 * The ONE place a Writer call site asks "what model / temperature / timeout /
 * retry should this task run with?" — so the answer stops being copy-pasted as
 * `model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.7` at every
 * generation site.
 *
 * BEHAVIOR-PRESERVING — the seeded values reproduce EXACTLY what the code does
 * TODAY. Proven against the current call sites:
 *
 *   master (post/thread/blog/article/story), TEXT flow
 *     backend/services/contentGeneration/blueprintGenerator.ts:361,598
 *       model = process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature = 0.7,
 *       operation 'generateMasterContent' → gateway timeout 240_000ms (long-form)
 *   master, MEDIA flow (opts.media)
 *     blueprintGenerator.ts:308,504 → temperature = 0.3 (same model/timeout)
 *   variant (batch + single rewrite)
 *     backend/services/contentGeneration/platformVariantGenerator.ts:150,559
 *       model = process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature = 0,
 *       operations 'generatePlatformVariants'/'generateContentVariant'
 *       → gateway timeout 30_000ms (short-form default)
 *   adapt (quick-platform-adapt)
 *     pages/api/content/quick-platform-adapt.ts:335
 *       model = process.env.OPENAI_MODEL || 'gpt-4o-mini',
 *       temperature = isTightFormat ? 0.7 : 0.2   (loose 0.2 is the default;
 *       opts.tight selects 0.7), operation 'regenerateContent' → 30_000ms
 *
 * The registry does NOT change runtime behavior on its own: it is additive and
 * not yet wired into the existing call sites. Its purpose is that WHEN those
 * sites adopt it, the values they receive are byte-identical to what they hard-
 * code today. Env overrides are allowed but all default to current behavior.
 *
 * SEED — defaults to null everywhere (opt-in). Provider defaults are used today
 * (no seed is passed), so null preserves behavior.
 *
 * RETRY — DEFAULT_RETRY reproduces the gateway's real retry behavior
 * (backend/services/aiGatewayProvidersRetry.ts): one initial attempt plus a
 * single same-provider retry on rate-limit/overload (429/529) after a ~2s
 * backoff; timeouts and everything else are not retried at this layer.
 */

import type {
  RetryErrorClass,
  RetryPolicy,
  TaskPolicy,
  WriterTask,
} from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Env helpers — every override defaults to CURRENT behavior.
// ─────────────────────────────────────────────────────────────────────────────

/** The single model resolution every Writer call site uses today. */
export function resolveWriterModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

function numEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry — mirrors aiGatewayProvidersRetry.ts today.
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP status → retry class. 429/529 = rate-limit/overload (transient). */
function statusToClass(status: number | undefined): RetryErrorClass | null {
  if (status === undefined) return null;
  if (status === 429 || status === 529) return 'transient';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500 && status <= 599) return 'provider';
  return null;
}

/**
 * Classify an arbitrary thrown error into a retry disposition, matching the
 * gateway's own error taxonomy:
 *   - timeout   → PROVIDER_TIMEOUT code / 504 / 408 / AbortError / /timed out/
 *   - transient → 429 / 529 (rate limit / overload) + network codes
 *   - provider  → other 5xx
 *   - fatal     → everything else (never retried)
 */
export function classifyGatewayError(err: unknown): RetryErrorClass {
  const rec = (err && typeof err === 'object' ? err : {}) as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    response?: { status?: number };
    message?: string;
  };
  const status = rec.status ?? rec.response?.status ?? rec.statusCode;
  const code = String(rec.code ?? '');
  const name = String(rec.name ?? '');
  const message = String(rec.message ?? (err instanceof Error ? err.message : ''));

  // Timeouts first — code/name/status/message any of which the gateway sets.
  if (
    code === 'PROVIDER_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    name === 'AbortError' ||
    status === 504 ||
    status === 408 ||
    /timed out|timeout/i.test(message)
  ) {
    return 'timeout';
  }

  // Network errors are treated as transient (gateway falls back / retries).
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /fetch failed|network/i.test(message)) {
    return 'transient';
  }

  const byStatus = statusToClass(status);
  if (byStatus) return byStatus;

  return 'fatal';
}

/**
 * DEFAULT retry policy. maxAttempts 2 = 1 initial + 1 retry (the gateway's
 * single same-provider retry on rate-limit). backoff 2000ms matches the
 * gateway's `await sleep(2000)` before the retry. Both are env-overridable but
 * default to current behavior.
 */
export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: Math.max(1, numEnv('AI_TASK_RETRY_MAX_ATTEMPTS', 2)),
  backoffMs: Math.max(0, numEnv('AI_TASK_RETRY_BACKOFF_MS', 2000)),
  classify: classifyGatewayError,
};

// ─────────────────────────────────────────────────────────────────────────────
// Timeouts — mirror resolveProviderTimeoutMs(operation) in aiGatewayCore.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Long-form operations get 240s today; short-form gets the 30s default. */
const LONG_FORM_TIMEOUT_MS = numEnv('AI_TASK_TIMEOUT_LONGFORM_MS', 240_000);
const SHORT_FORM_TIMEOUT_MS = numEnv('AI_TASK_TIMEOUT_SHORTFORM_MS', 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// Options — a task's temperature can depend on a media/tight modifier without
// changing the required getTaskPolicy(task) signature (opts is optional).
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskPolicyOptions {
  /**
   * Master content only: media-dependent flow (blueprintGenerator isMediaFlow).
   * Selects temperature 0.3 instead of the 0.7 text default.
   */
  media?: boolean;
  /**
   * Adapt only: tight-format platforms (x/twitter/tiktok/pinterest) get
   * temperature 0.7 to re-imagine; loose formats stay at the 0.2 default.
   */
  tight?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// The documented current temperatures, per task. Kept as data so the unit test
// can assert them and the registry has a single value table.
// ─────────────────────────────────────────────────────────────────────────────

/** Master-content TEXT temperature (post/thread/blog/article/story). */
export const MASTER_TEXT_TEMPERATURE = 0.7;
/** Master-content MEDIA-flow temperature. */
export const MASTER_MEDIA_TEMPERATURE = 0.3;
/** Variant (per-platform rewrite) temperature. */
export const VARIANT_TEMPERATURE = 0;
/** Adapt tight-format temperature. */
export const ADAPT_TIGHT_TEMPERATURE = 0.7;
/** Adapt loose-format (default) temperature. */
export const ADAPT_LOOSE_TEMPERATURE = 0.2;

const MASTER_TASKS: ReadonlySet<WriterTask> = new Set<WriterTask>([
  'post',
  'thread',
  'blog',
  'article',
  'story',
  // B3.1 — poll/tweet are MASTER tasks for the same reason the other five are:
  // they are produced by the generateMasterContent OPERATION. The long-form
  // window is operation-keyed, not length-keyed — aiGatewayCore.ts:308 returns
  // 240_000ms for any call whose operation is in LONG_FORM_OPERATIONS, which
  // includes 'generateMasterContent'. So a poll or tweet generated as master
  // content ALREADY receives the 240s window at the gateway today; listing them
  // here makes the registry agree with observed runtime behaviour rather than
  // changing it. variant/adapt stay short-form because they use DIFFERENT
  // operations (generatePlatformVariants / regenerateContent), which are not in
  // LONG_FORM_OPERATIONS.
  'poll',
  'tweet',
]);

/**
 * Resolve the temperature + timeout for a task, honoring the media/tight
 * modifier where the current code branches on it.
 */
function resolveTemperatureAndTimeout(
  task: WriterTask,
  opts: TaskPolicyOptions,
): { temperature: number; timeoutMs: number } {
  if (task === 'variant') {
    return { temperature: VARIANT_TEMPERATURE, timeoutMs: SHORT_FORM_TIMEOUT_MS };
  }
  if (task === 'adapt') {
    return {
      temperature: opts.tight ? ADAPT_TIGHT_TEMPERATURE : ADAPT_LOOSE_TEMPERATURE,
      timeoutMs: SHORT_FORM_TIMEOUT_MS,
    };
  }
  // Master content types — the generateMasterContent path (long-form window).
  return {
    temperature: opts.media ? MASTER_MEDIA_TEMPERATURE : MASTER_TEXT_TEMPERATURE,
    timeoutMs: LONG_FORM_TIMEOUT_MS,
  };
}

/**
 * getTaskPolicy — the single lookup callers use instead of hardcoding model +
 * temperature. Returns a fully-seeded TaskPolicy whose values are identical to
 * what the corresponding call site uses today.
 *
 * @param task  one of the Writer content types, or 'variant' / 'adapt'.
 * @param opts  optional media/tight modifier (additive; the required
 *              getTaskPolicy(task) signature is preserved).
 */
export function getTaskPolicy(task: WriterTask, opts: TaskPolicyOptions = {}): TaskPolicy {
  if (!MASTER_TASKS.has(task) && task !== 'variant' && task !== 'adapt') {
    // Exhaustiveness backstop — should be unreachable given the WriterTask type.
    throw new Error(`[taskPolicyRegistry] unknown task: ${String(task)}`);
  }
  const { temperature, timeoutMs } = resolveTemperatureAndTimeout(task, opts);
  return {
    model: resolveWriterModel(),
    temperature,
    // Opt-in seed — null preserves today's provider-default (no seed passed).
    seed: null,
    retry: DEFAULT_RETRY,
    timeoutMs,
    // No current Writer generation path uses response caching.
    cache: { enabled: false },
    // All current Writer generation calls are non-streaming.
    streaming: false,
  };
}

/** Every task the registry knows about (content types + variant + adapt). */
export const ALL_WRITER_TASKS: readonly WriterTask[] = [
  'post',
  'thread',
  'blog',
  'article',
  'story',
  'poll',
  'tweet',
  'variant',
  'adapt',
];
