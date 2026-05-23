export type StructuredCapacityCounts = {
  post: number;
  video: number;
  blog: number;
  story: number;
  thread: number;
};

export type StructuredCapacityBreakdown = Record<string, number>;
export type StructuredCapacityCountsWithBreakdown = StructuredCapacityCounts & {
  breakdown?: StructuredCapacityBreakdown;
  _declared_none?: boolean;
};

const EMPTY_CAPACITY_COUNTS: StructuredCapacityCounts = {
  post: 0,
  video: 0,
  blog: 0,
  story: 0,
  thread: 0,
};

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function parseFrequencyPerWeek(s: string): number {
  const t = String(s || '').trim().toLowerCase();
  const m = t.match(/^(\d+)\s*\/?\s*w/);
  if (m) return clampInt(parseInt(m[1] || '0', 10));
  if (/^daily$/i.test(t) || /^daily\b/.test(t)) return 5;
  const n = parseInt(t, 10);
  if (Number.isFinite(n) && n >= 0) return clampInt(n);
  return 0;
}

function parseCountsFromText(text: string): StructuredCapacityCounts {
  const t = String(text || '').toLowerCase();
  const out: StructuredCapacityCounts = { ...EMPTY_CAPACITY_COUNTS };
  const isNo =
    /\b(no|none|zero|don'?t have|do not have|not yet|n\/a)\b/.test(t) && !/\b\d+\b/.test(t);
  if (isNo) return out;

  const addMatches = (re: RegExp, key: keyof StructuredCapacityCounts) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n > 0) out[key] += n;
    }
  };

  addMatches(/\b(\d{1,3})\s*(?:posts?|feed\s*posts?)\b/g, 'post');
  addMatches(/\b(\d{1,3})\s*videos?\b/g, 'video');
  addMatches(/\b(\d{1,3})\s*(?:blogs?|articles?)\b/g, 'blog');
  addMatches(/\b(\d{1,3})\s*white\s*papers?\b/g, 'blog');
  addMatches(/\b(\d{1,3})\s*stories?\b/g, 'story');
  addMatches(/\b(\d{1,3})\s*threads?\b/g, 'thread');

  return out;
}

function parseCountsWithBreakdownFromText(text: string): { counts: StructuredCapacityCounts; breakdown: StructuredCapacityBreakdown } {
  const t = String(text || '').toLowerCase();
  const breakdown: StructuredCapacityBreakdown = {};
  const counts: StructuredCapacityCounts = parseCountsFromText(text);

  const addBreakdown = (key: string, n: number) => {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return;
    const v = clampInt(n);
    if (v <= 0) return;
    breakdown[k] = (breakdown[k] ?? 0) + v;
  };

  const addMatchesBreakdown = (re: RegExp, breakdownKey: string, rollup: keyof StructuredCapacityCounts) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n <= 0) continue;
      addBreakdown(breakdownKey, n);
      counts[rollup] += n;
    }
  };

  const addMatchesBreakdownOnly = (re: RegExp, breakdownKey: string) => {
    let m: RegExpExecArray | null = null;
    while ((m = re.exec(t)) !== null) {
      const n = clampInt(parseInt(m[1] || '0', 10));
      if (n <= 0) continue;
      addBreakdown(breakdownKey, n);
    }
  };

  addMatchesBreakdown(/\b(\d{1,3})\s*reels?\b/g, 'reels', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*shorts?\b/g, 'shorts', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:long[-\s]?form|long)\s*videos?\b/g, 'long_videos', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*carousels?\b/g, 'carousels', 'post');
  addMatchesBreakdown(/\b(\d{1,3})\s*images?\b/g, 'images', 'post');
  addMatchesBreakdownOnly(/\b(\d{1,3})\s*white\s*papers?\b/g, 'white_papers');
  addMatchesBreakdown(/\b(\d{1,3})\s*lives?\b/g, 'lives', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*spaces?\b/g, 'spaces', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:songs?|audio)\b/g, 'audio', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*podcasts?\b/g, 'podcasts', 'video');
  addMatchesBreakdown(/\b(\d{1,3})\s*newsletters?\b/g, 'newsletters', 'blog');
  addMatchesBreakdown(/\b(\d{1,3})\s*webinars?\b/g, 'webinars', 'blog');
  addMatchesBreakdown(/\b(\d{1,3})\s*(?:slides?|slideware)\b/g, 'slides', 'blog');

  const tagToKey = (tag: string): string | null => {
    const n = String(tag || '').toLowerCase();
    if (n.includes('reel')) return 'reels';
    if (n.includes('short')) return 'shorts';
    if (n.includes('long')) return 'long_videos';
    if (n.includes('carousel')) return 'carousels';
    if (n.includes('image')) return 'images';
    if (n.includes('live')) return 'lives';
    if (n.includes('space')) return 'spaces';
    if (n.includes('podcast')) return 'podcasts';
    if (n.includes('audio') || n.includes('song')) return 'audio';
    if (n.includes('newsletter')) return 'newsletters';
    if (n.includes('webinar')) return 'webinars';
    if (n.includes('slide')) return 'slides';
    if (n.includes('article')) return 'articles';
    if (n.includes('white')) return 'white_papers';
    return null;
  };

  const taggedVideo = /\b(\d{1,3})\s*videos?(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  let m: RegExpExecArray | null = null;
  while ((m = taggedVideo.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }
  const taggedPost = /\b(\d{1,3})\s*(?:posts?|feed\s*posts?)(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  while ((m = taggedPost.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }
  const taggedBlog = /\b(\d{1,3})\s*(?:blogs?|articles?)(?:\s*\/\s*week)?\s*\(([^)]+)\)/g;
  while ((m = taggedBlog.exec(t)) !== null) {
    const n = clampInt(parseInt(m[1] || '0', 10));
    const key = tagToKey(String(m[2] || ''));
    if (n > 0 && key) addBreakdown(key, n);
  }

  return { counts, breakdown };
}

const PLANNING_LABEL_TO_KEY: Record<string, keyof StructuredCapacityCounts> = {
  post: 'post', posts: 'post', 'text post': 'post', 'text posts': 'post',
  carousel: 'post', carousels: 'post', image: 'post', images: 'post',
  video: 'video', videos: 'video', 'long videos': 'video', 'long video': 'video',
  reel: 'video', reels: 'video', short: 'video', shorts: 'video',
  song: 'video', songs: 'video', audio: 'video', podcast: 'video', podcasts: 'video',
  space: 'video', spaces: 'video',
  blog: 'blog', blogs: 'blog',
  article: 'blog', articles: 'blog',
  newsletter: 'blog', newsletters: 'blog',
  'white paper': 'blog', 'white papers': 'blog', whitepaper: 'blog', whitepapers: 'blog',
  webinar: 'blog', webinars: 'blog',
  slide: 'blog', slides: 'blog', slideware: 'blog',
  story: 'story', stories: 'story',
  thread: 'thread', threads: 'thread',
};

export function normalizeCapacityCountsWithBreakdown(value: unknown): StructuredCapacityCountsWithBreakdown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const counts = normalizeCapacityCounts(obj);
    const breakdownRaw = obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
      ? (obj.breakdown as Record<string, unknown>)
      : null;
    const breakdown: StructuredCapacityBreakdown = {};
    if (breakdownRaw) {
      for (const [k, v] of Object.entries(breakdownRaw)) {
        const n = clampInt(typeof v === 'number' ? v : Number(v));
        if (n > 0) breakdown[String(k).toLowerCase()] = n;
      }
    }
    const declaredNone = Boolean((obj as any)._declared_none || (obj as any).declared_none || (obj as any).declaredNone);
    const withMeta = declaredNone ? ({ ...counts, _declared_none: true } as StructuredCapacityCountsWithBreakdown) : counts;
    return Object.keys(breakdown).length > 0
      ? ({ ...withMeta, breakdown } as StructuredCapacityCountsWithBreakdown)
      : (withMeta as StructuredCapacityCountsWithBreakdown);
  }
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    const isNo =
      /\b(no|none|zero|don'?t have|do not have|no content|not yet|n\/a)\b/.test(t) &&
      !/\b\d+\b/.test(t) &&
      !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b/i.test(value);
    const parsed = parseCountsWithBreakdownFromText(value);
    const base: StructuredCapacityCountsWithBreakdown = isNo
      ? ({ ...parsed.counts, _declared_none: true } as StructuredCapacityCountsWithBreakdown)
      : (parsed.counts as StructuredCapacityCountsWithBreakdown);
    return Object.keys(parsed.breakdown).length > 0
      ? ({ ...base, breakdown: parsed.breakdown } as StructuredCapacityCountsWithBreakdown)
      : base;
  }
  return { ...EMPTY_CAPACITY_COUNTS };
}

export function normalizeCapacityCounts(value: unknown): StructuredCapacityCounts {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const out: StructuredCapacityCounts = { ...EMPTY_CAPACITY_COUNTS };
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'breakdown' || k === '_declared_none' || k === 'declared_none' || k === 'declaredNone') continue;
      const n = clampInt(typeof v === 'number' ? v : Number(v));
      if (n <= 0) continue;
      const key = PLANNING_LABEL_TO_KEY[k.toLowerCase()] ?? PLANNING_LABEL_TO_KEY[k] ?? (k.toLowerCase() as keyof StructuredCapacityCounts);
      if (key && key in out) {
        out[key] += n;
      } else if (['post', 'video', 'blog', 'story', 'thread'].includes(String(k).toLowerCase())) {
        out[k.toLowerCase() as keyof StructuredCapacityCounts] += n;
      } else {
        out.post += n;
      }
    }
    return out;
  }
  if (typeof value === 'string') return parseCountsFromText(value);
  return { ...EMPTY_CAPACITY_COUNTS };
}

// ============================================================
// Canonical planner-capacity ingress contract
// ============================================================
//
// Single source of truth for the shape the capacity validator and
// downstream planner code expect. Every assembler of
// collectedPlanningContext (BOLT pipeline, /api/campaigns/ai/plan,
// recommendation→campaign builders) MUST funnel raw inputs through
// `normalizePlannerCapacityInputs` so the downstream contract is a
// hard invariant rather than a defensive convention.
//
// Semantic split (the historical drift this resolves):
//   - has_existing_content : boolean
//       The declarative answer to the conversational gather-phase
//       question "Do you already have content to use?". This is the
//       only thing the legacy string `'Yes' | 'No'` ever meant; we
//       lift it out so the planner / prompt builder can branch on
//       intent without re-parsing strings.
//   - available_content    : Record<string, number>
//       Numeric inventory keyed by content type. ALWAYS a record.
//       When the user said "No" / "none", this is `{}` AND
//       `has_existing_content === false`.
//   - weekly_capacity      : Record<string, number>
//       Sustainable per-week production rate. ALWAYS a record.
//   - platform_content_requests : array (passed through; shape
//       validated by the validator itself — not this normalizer's
//       responsibility because per-row platform/content_type pairs
//       are routing semantics, not capacity semantics).
//
// Deprecated: `content_capacity` is a mirror of `weekly_capacity`
// kept only because legacy UI panels (QuickPickCapacityPanels,
// useCampaignAiQuickPickState) still read it as a fallback. The
// normalizer mirrors weekly_capacity → content_capacity so those
// readers keep working. Schedule its removal one release after
// the UI quick-pick panels migrate to `weekly_capacity`.
// ============================================================

export interface PlannerCapacityIngressInput {
  /** Raw value from caller. Can be string ('No', 'Yes', '3 posts'), record, or undefined. */
  available_content?: unknown;
  /** Raw value from caller. Can be record or undefined. */
  weekly_capacity?: unknown;
  /** Legacy alias for weekly_capacity. Read defensively; never trust over weekly_capacity. */
  content_capacity?: unknown;
  /** Optional explicit override of the boolean derived from `available_content`. */
  has_existing_content?: boolean | null;
  /**
   * Optional telemetry context. When supplied, the normalizer emits a
   * `planner_contract_violation` event for any input that arrived in a
   * non-canonical shape (string available_content, mirror-only weekly_capacity,
   * etc.). Pass it when the caller has stable correlation IDs in scope;
   * omit it for unit-test or one-off invocations where telemetry would
   * add noise.
   */
  _telemetry?: {
    caller: string;
    run_id?: string | null;
    planner_mode?: string | null;
    campaign_type?: string | null;
  };
}

export interface PlannerCapacityNormalized {
  has_existing_content: boolean;
  available_content: StructuredCapacityCountsWithBreakdown;
  weekly_capacity: StructuredCapacityCountsWithBreakdown;
  /** Mirror of weekly_capacity. Deprecated; emitted only for legacy readers. */
  content_capacity: StructuredCapacityCountsWithBreakdown;
}

const STRING_DECLARES_NONE_RX =
  /^\s*(no|none|zero|n\/a|nothing|i\s+don'?t\s+have|i\s+do\s+not\s+have|not\s+yet)\s*\.?\s*$/i;

function deriveHasExistingContent(rawAvailable: unknown, explicit: boolean | null | undefined): boolean {
  // Caller-supplied explicit flag always wins (used when the gather-
  // phase QA already split the answer).
  if (typeof explicit === 'boolean') return explicit;
  // String 'No' / 'none' / 'n/a' / 'i don't have' → false. Anything
  // numeric in the string ("2 posts, 1 video") implies true.
  if (typeof rawAvailable === 'string') {
    if (STRING_DECLARES_NONE_RX.test(rawAvailable)) return false;
    if (/\b\d+\b/.test(rawAvailable)) return true;
    // Free-form string with no clear signal — treat as false. The
    // user wrote something but didn't quantify; safer to assume no
    // inventory than to assume some.
    return false;
  }
  // Numeric record with any non-zero value → true.
  if (rawAvailable && typeof rawAvailable === 'object' && !Array.isArray(rawAvailable)) {
    const counts = normalizeCapacityCounts(rawAvailable);
    return counts.post + counts.video + counts.blog + counts.story + counts.thread > 0;
  }
  return false;
}

/**
 * The canonical planner-capacity ingress. Every caller assembling
 * `collectedPlanningContext` / `prefilledPlanning` must run raw
 * capacity inputs through this function before passing them to the
 * orchestrator. Returns a fully-typed, shape-locked payload that
 * downstream code can rely on without defensive re-parsing.
 *
 * Behavior:
 *   - `available_content` string 'No' / 'none' → `{}` + has_existing_content=false
 *   - `available_content` string with numbers → parsed via existing
 *     text-extraction (parseCountsWithBreakdownFromText) + has_existing_content=true
 *   - `available_content` record → clamped, breakdown preserved
 *   - `weekly_capacity` ALWAYS resolves to a record. Falls back to
 *     `content_capacity` for legacy callers that only set the mirror.
 *   - `content_capacity` is emitted as a strict mirror of weekly_capacity
 *     so legacy UI readers keep working until they migrate.
 *
 * Stable, deterministic, side-effect-free — safe to call multiple
 * times on the same input (idempotent).
 */
export function normalizePlannerCapacityInputs(
  input: PlannerCapacityIngressInput
): PlannerCapacityNormalized {
  const has_existing_content = deriveHasExistingContent(input.available_content, input.has_existing_content);

  const available_content = normalizeCapacityCountsWithBreakdown(input.available_content);
  // If the caller said "no existing content" but the string happened
  // to match some loose digit pattern, prefer the explicit signal
  // and zero the inventory. Defensive: this only happens when the
  // QA gate already determined intent.
  if (input.has_existing_content === false) {
    available_content.post = 0;
    available_content.video = 0;
    available_content.blog = 0;
    available_content.story = 0;
    available_content.thread = 0;
    available_content._declared_none = true;
    delete (available_content as { breakdown?: unknown }).breakdown;
  }

  // weekly_capacity wins over content_capacity. We do NOT silently
  // sum the two — that would mask a misconfigured caller. The fact
  // that the validator reads weekly_capacity and the UI sometimes
  // reads content_capacity is exactly the drift we're isolating.
  const weeklyRaw = input.weekly_capacity ?? input.content_capacity;
  const weekly_capacity = normalizeCapacityCountsWithBreakdown(weeklyRaw);

  // ── Structured contract-violation telemetry ─────────────────────
  // Emit ONLY at the contract boundary. Cheap: at most two short
  // emissions per planner ingress (one for available_content, one
  // for weekly_capacity), and only when an input arrives in a
  // non-canonical shape that required compatibility coercion.
  // Skipped entirely when _telemetry is not supplied (unit tests).
  if (input._telemetry) {
    const t = input._telemetry;
    const availType = input.available_content == null
      ? 'null'
      : Array.isArray(input.available_content)
        ? 'array'
        : typeof input.available_content;
    // Anything other than 'object' or 'null' for available_content
    // means we had to interpret it (string, number, array). Object
    // is the canonical shape; null means "not supplied".
    if (availType !== 'object' && availType !== 'null') {
      emitPlannerContractViolation({
        field: 'available_content',
        received_type: availType,
        normalized: true,
        caller: t.caller,
        run_id: t.run_id ?? null,
        planner_mode: t.planner_mode,
        campaign_type: t.campaign_type,
      });
    }
    // Mirror-drift signal: caller supplied content_capacity but not
    // weekly_capacity. Allowed for legacy compatibility, but emitted
    // as its OWN event name (planner_legacy_contract_usage) so the
    // compatibility-retirement dashboard can roll up frequency by
    // caller without filtering against the broader violation feed.
    // TODO(remove-after-weekly-capacity-cutover): drop this branch
    // and the content_capacity mirror in the normalizer return value
    // once dashboard shows zero `planner_legacy_contract_usage`
    // events for `legacy_field: 'content_capacity'` across a full
    // release cycle.
    if (input.weekly_capacity == null && input.content_capacity != null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { emitStructuredEvent } = require('../../observability/runtime/structuredTelemetry') as typeof import('../../observability/runtime/structuredTelemetry');
      emitStructuredEvent(
        'planner_legacy_contract_usage',
        'warn',
        { run_id: t.run_id ?? null, planner_stage: t.planner_mode ?? null },
        {
          legacy_field: 'content_capacity',
          canonical_field: 'weekly_capacity',
          caller: t.caller,
          planner_mode: t.planner_mode ?? null,
          campaign_type: t.campaign_type ?? null,
          normalized_successfully: true,
          contract_version: PLANNER_CONTRACT_VERSION,
          removal_target: 'next_release',
        },
      );
    }
  }

  return {
    has_existing_content,
    available_content,
    weekly_capacity,
    // Strict mirror so legacy readers don't break before the
    // deprecation lands. Same reference would be unsafe (a mutation
    // in one would leak to the other); clone so each is independent.
    // TODO(remove-after-weekly-capacity-cutover): drop this field
    // from the return shape and from PlannerCapacityNormalized once
    // dashboard shows zero `planner_legacy_contract_usage` events
    // with `legacy_field: 'content_capacity'` across a full release
    // cycle, AND the four UI quick-pick consumers have migrated to
    // read `weekly_capacity`. See
    // docs/planner-compatibility-retirement.md §1.
    content_capacity: { ...weekly_capacity, breakdown: weekly_capacity.breakdown ? { ...weekly_capacity.breakdown } : undefined },
  };
}

/**
 * Lightweight runtime contract assertion for code that has ALREADY
 * been normalized. Use this at validator ingress and similar
 * choke points to make contract violations fail loudly instead of
 * silently returning 0. Throws a descriptive error if `value` is
 * not a non-null object — strings, arrays, numbers, null, undefined
 * all reject.
 *
 * Performance: one typeof + one isArray check. Zero allocations.
 */
export function assertCapacityRecord(value: unknown, fieldName: string): asserts value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    const observedType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    throw new Error(
      `[capacity-contract] expected ${fieldName} to be a normalized record (Record<string, number>), got ${observedType} (value: ${JSON.stringify(value)?.slice(0, 80) ?? '<unstringifiable>'}). ` +
      `All planner ingress paths must funnel raw capacity inputs through normalizePlannerCapacityInputs() in campaignAiCapacity.ts before reaching the validator.`
    );
  }
}

// ============================================================
// Planner contract violation telemetry
// ============================================================
//
// Single emission point for "an input reached the validator in a
// shape that should have been normalized at ingress". Designed for
// query-ability — every event has the same field names so log
// aggregation (Datadog/Logflare/grep) can roll them up by `field`,
// `caller`, `received_type` over time and identify which path is
// still emitting unnormalized inputs.
//
// Contract version bumps when the canonical shape changes. v2.0 is
// the current shape (has_existing_content + numeric record split).
// v1.x was the legacy dual-semantic 'available_content: string |
// record'. Future shape changes should bump major version; analyses
// can then filter to events emitted under a specific contract version.
//
// Performance constraints (per the stabilization spec):
//   - zero deep cloning
//   - single JSON.stringify per emission
//   - emission only at normalization OR validator ingress (never in
//     per-loop / per-row code paths)
// ============================================================

export const PLANNER_CONTRACT_VERSION = 'v2.0';

// ============================================================
// Staged contract enforcement mode
// ============================================================
//
// Three modes, governed by env var PLANNER_CONTRACT_ENFORCEMENT_MODE:
//
//   shadow — telemetry-only at 'info' severity (silent in alerting)
//   warn   — telemetry at 'warn' severity (alerting visible)        ← DEFAULT
//   strict — telemetry at 'error' severity + throw on violation
//
// Default 'warn' matches the prior behavior of
// `emitPlannerContractViolation` and is non-breaking. Promote to
// 'strict' only after a soak period where 'warn' produces zero
// emissions across all planner ingress paths — that's the operator's
// signal that no legacy caller is left.
//
// Read once at module load; never re-read. Env mutation after first
// import is invisible (intentional — enforcement mode must not be
// switchable mid-process).
// ============================================================

export type PlannerEnforcementMode = 'shadow' | 'warn' | 'strict';

const PLANNER_ENFORCEMENT_MODE: PlannerEnforcementMode = (() => {
  const raw = String(process.env.PLANNER_CONTRACT_ENFORCEMENT_MODE ?? 'warn').toLowerCase();
  if (raw === 'shadow' || raw === 'warn' || raw === 'strict') return raw;
  return 'warn';
})();

export function getPlannerEnforcementMode(): PlannerEnforcementMode {
  return PLANNER_ENFORCEMENT_MODE;
}

export interface PlannerContractViolationContext {
  /** Canonical field name that violated the contract. */
  field: 'available_content' | 'weekly_capacity' | 'content_capacity' | 'platform_content_requests' | 'has_existing_content';
  /** runtime typeof the observed value. Pass `Array.isArray(v) ? 'array' : typeof v`. */
  received_type: string;
  /** Whether the normalizer was able to recover a usable value (true) or had to fall back to defaults (false). */
  normalized: boolean;
  /** Best-effort caller attribution — typically the BOLT pipeline, plan.ts route, or recommendation builder. */
  caller: string;
  /** BOLT run id when available; null for non-BOLT planner paths. */
  run_id: string | null;
  /** Optional planner mode (`generate_plan` / `refine_day` / `platform_customize`). */
  planner_mode?: string | null;
  /** Optional campaign type (BOLT text / creator / combined, manual, etc.). */
  campaign_type?: string | null;
  /** True when the legacy `content_capacity` mirror path was used to recover the value. */
  used_legacy_mirror?: boolean;
}

/**
 * Emit a single structured `planner_contract_violation` event.
 *
 * Call ONLY at:
 *   - the normalizer (normalizePlannerCapacityInputs) when an input
 *     arrives in a non-canonical shape that triggers compatibility
 *     coercion, OR
 *   - the validator (capacityExpectationValidator) when post-ingress
 *     code sees an unnormalized shape (chokepoint bypass).
 *
 * Do NOT call in per-row / per-platform / per-loop code paths — the
 * event is designed for emission at the contract boundary.
 *
 * Uses the canonical envelope from
 * `observability/runtime/structuredTelemetry.ts` so deployment_id,
 * git_sha, worker_pid, timestamp are stamped consistently across all
 * planner operational events.
 */
export function emitPlannerContractViolation(
  ctx: PlannerContractViolationContext,
  severity: 'info' | 'warn' | 'error' = 'warn',
): void {
  // Lazy import keeps this module loadable in environments where the
  // observability barrel isn't initialised yet (unit-test isolation).
  // The cost is one require() per emission, which only fires at the
  // contract boundary — not in hot loops.
  // TODO(remove-after-module-load-order-verified): convert to a
  // top-of-file static import once unit-test isolation is confirmed
  // safe. See docs/planner-cleanup-inventory.md §4.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitStructuredEvent } = require('../../observability/runtime/structuredTelemetry') as typeof import('../../observability/runtime/structuredTelemetry');
  emitStructuredEvent(
    'planner_contract_violation',
    severity,
    { run_id: ctx.run_id, planner_stage: ctx.planner_mode ?? null },
    {
      field: ctx.field,
      received_type: ctx.received_type,
      normalized: ctx.normalized,
      caller: ctx.caller,
      planner_mode: ctx.planner_mode ?? null,
      campaign_type: ctx.campaign_type ?? null,
      used_legacy_mirror: ctx.used_legacy_mirror ?? false,
      contract_version: PLANNER_CONTRACT_VERSION,
    },
  );
}

// ============================================================
// Centralized contract enforcement
// ============================================================
//
// Single chokepoint that takes the enforcement-mode env into account
// and either emits-only or throws based on the resolved mode. Callers
// reaching this helper have ALREADY been through normalization and
// are observing a non-canonical input shape — that's a chokepoint
// bypass, not legitimate adapter input.
//
// shadow mode  → emit at 'info' severity, return false (caller does NOT throw)
// warn mode    → emit at 'warn' severity, return false (caller does NOT throw)
// strict mode  → emit at 'error' severity, return true (caller MUST throw or refuse)
//
// Returning a boolean instead of throwing internally lets callers
// shape the error message with their own context (the validator
// returns 0 in non-strict modes; in strict mode it can throw with
// a meaningful "expected normalized record at <fieldName>" message).
//
// IMPORTANT: This helper does NOT mutate the value or normalize it
// — that's the normalizer's job, not the enforcer's. The enforcer
// only reports + signals. Mixing those concerns would re-introduce
// the silent-coercion pattern the user explicitly rejected.
// ============================================================
export function enforceCapacityContract(
  value: unknown,
  fieldName: PlannerContractViolationContext['field'],
  runId: string | null,
): { shouldThrow: boolean } {
  // Canonical: non-null object that's not an array.
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return { shouldThrow: false };
  }
  const mode = PLANNER_ENFORCEMENT_MODE;
  const severity: 'info' | 'warn' | 'error' =
    mode === 'shadow' ? 'info' : mode === 'strict' ? 'error' : 'warn';
  emitPlannerContractViolation(
    {
      field: fieldName,
      received_type: Array.isArray(value) ? 'array' : (value == null ? 'null' : typeof value),
      normalized: false,
      caller: 'enforceCapacityContract',
      run_id: runId,
    },
    severity,
  );
  return { shouldThrow: mode === 'strict' };
}
