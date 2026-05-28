/**
 * G11 — Schedule-time character-limit guard.
 *
 * Rejects (or warns about) content that exceeds the platform's per-character
 * limit BEFORE the row reaches the DB. The DB-level chk_<platform>_content
 * constraints already enforce these limits, but their error is opaque
 * (`new row for relation "scheduled_posts" violates check constraint
 * "chk_linkedin_content"`). This guard converts that into a clean 422 with
 * the platform, the actual length, and the configured maximum.
 *
 * It also serves as the explicit reject-at-schedule contract the G11 spec
 * asked for ("DO NOT auto-truncate, mutate content silently") — the
 * silent-truncation that lives in
 * `lib/shared/contentFormatter.ts::formatContentForPlatform` happens at
 * PUBLISH time inside platform adapters and is out of scope for this phase
 * (touching adapter behavior is explicitly forbidden by the strict rules).
 *
 * Roll-out is env-gated to match the platform's pattern (PUBLISH_GUARD_MODE):
 *
 *   SCHEDULE_CHAR_LIMIT_MODE:
 *     'off'     (default) — guard is fully bypassed; existing behavior
 *                           (DB constraint catches overflow as 500).
 *     'warn'              — log a structured warning + telemetry, allow the
 *                           write. Used during canary observation.
 *     'enforce'           — reject with 422 SCHEDULE_CHAR_LIMIT_EXCEEDED.
 *
 * Read direct from process.env on every call (no caching) so a runtime flip
 * via vercel env update takes effect on the next request.
 */

import { getPlatformLimits } from '@/lib/shared/contentFormatter';
import { logPipelineEvent } from '@/lib/shared/observability';

export type ScheduleCharLimitMode = 'off' | 'warn' | 'enforce';

export function getScheduleCharLimitMode(): ScheduleCharLimitMode {
  const raw = String(process.env.SCHEDULE_CHAR_LIMIT_MODE ?? 'off').toLowerCase().trim();
  if (raw === 'warn') return 'warn';
  if (raw === 'enforce') return 'enforce';
  return 'off';
}

export type CharLimitCheckResult =
  | { ok: true; mode: ScheduleCharLimitMode; platform: string; actualChars: number; maxChars: number }
  | {
      ok: false;
      mode: ScheduleCharLimitMode;
      code: 'SCHEDULE_CHAR_LIMIT_EXCEEDED';
      message: string;
      platform: string;
      actualChars: number;
      maxChars: number;
      excessChars: number;
      /** True only when the mode is 'enforce'; warn-mode returns ok:false WITH
       *  this flag false so callers can log without rejecting. */
      shouldReject: boolean;
    };

/**
 * Check a single piece of content against the platform's char limit.
 *
 * Returns `ok: true` when within limit OR when the guard is disabled.
 * Returns `ok: false` with `shouldReject:true` when over limit AND in
 * enforce mode. Returns `ok: false` with `shouldReject:false` when over
 * limit in warn mode — caller should log telemetry but continue.
 */
export function checkScheduleCharLimit(input: {
  platform: string;
  content: string;
}): CharLimitCheckResult {
  const mode = getScheduleCharLimitMode();
  const platform = String(input.platform ?? '').trim().toLowerCase();
  const content = String(input.content ?? '');
  const actualChars = content.length;
  const limits = getPlatformLimits(platform);
  const maxChars = limits.maxChars;

  if (mode === 'off') {
    return { ok: true, mode, platform, actualChars, maxChars };
  }

  if (actualChars <= maxChars) {
    return { ok: true, mode, platform, actualChars, maxChars };
  }

  const excessChars = actualChars - maxChars;
  // Phase C — content-policy observability. Emit on every overflow detection
  // (warn AND enforce) so dashboards can track overflow rate per platform
  // even while the guard is rolled out gradually.
  logPipelineEvent('schedule.char_limit_overflow', mode === 'enforce' ? 'warn' : 'info', {
    platform, actualChars, maxChars, excessChars, mode,
  }, { dedupeKey: `schedule.char_limit.${platform}`, throttleMs: 5_000 });
  return {
    ok: false,
    mode,
    code: 'SCHEDULE_CHAR_LIMIT_EXCEEDED',
    message: `Content exceeds the ${platform} character limit (${actualChars}/${maxChars}; ${excessChars} over).`,
    platform,
    actualChars,
    maxChars,
    excessChars,
    shouldReject: mode === 'enforce',
  };
}

/**
 * Multi-node variant: check each node's content against the limit. Returns
 * the first failing node when any are over (in enforce mode); otherwise
 * returns the first warning when any are over (in warn mode); otherwise
 * `ok:true`. Used for thread payloads where any single segment exceeding
 * the limit is a publish blocker.
 */
export function checkScheduleCharLimitForNodes(input: {
  platform: string;
  nodes: Array<{ content: string; position?: number }>;
}): CharLimitCheckResult & { failedPosition?: number } {
  const mode = getScheduleCharLimitMode();
  if (mode === 'off') {
    return { ok: true, mode, platform: input.platform, actualChars: 0, maxChars: 0 };
  }
  let firstWarning: (CharLimitCheckResult & { failedPosition?: number }) | null = null;
  for (let i = 0; i < input.nodes.length; i++) {
    const node = input.nodes[i];
    const result = checkScheduleCharLimit({
      platform: input.platform,
      content: node?.content ?? '',
    });
    if (result.ok === false) {
      const annotated = { ...result, failedPosition: typeof node?.position === 'number' ? node.position : i };
      if (annotated.shouldReject) {
        return annotated;
      }
      if (!firstWarning) firstWarning = annotated;
    }
  }
  if (firstWarning) return firstWarning;
  return { ok: true, mode, platform: input.platform, actualChars: 0, maxChars: 0 };
}
