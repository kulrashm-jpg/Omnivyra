/**
 * Capture a small, queryable snapshot of the strategy + execution
 * configuration AT THE MOMENT a BOLT pipeline failure happens.
 *
 * The dashboard uses this to answer "what's different about the
 * failing strategy vs the one that succeeded?" without operators
 * having to chase campaign_versions / source_strategic_theme rows.
 *
 * Pure function. Reads from the BOLT run payload only — does NOT
 * fetch from Supabase, and never throws. Returns a small JSON
 * shape constrained to the fields most likely to differ between
 * a failing and a succeeding strategy:
 *
 *   - campaign_mode              ('text' | 'creator' | 'combined')
 *   - outcome_view               (week_plan | daily_plan | schedule | …)
 *   - selected_platforms[]       (lower-cased, twitter→x)
 *   - creator_formats[]          (when present)
 *   - text_formats[]             (when present)
 *   - frequency_per_week         (number, when present)
 *   - duration_weeks             (number, when present)
 *   - tone                       (free-form)
 *   - target_regions[]           (when present)
 *   - source_opportunity_id      (when present)
 *   - source_recommendation_id   (when present)
 *   - strategic_theme_title      (when present)
 *   - has_attachments_required   (boolean, derived from creator_formats)
 *
 * Every field is optional — the snapshot is best-effort and
 * resilient to incomplete payloads. Fields the caller doesn't
 * provide are simply omitted.
 */

const MAX_STRING_BYTES = 500;

function truncate(text: string | null | undefined): string | null {
  if (text == null) return null;
  const s = String(text);
  if (s.length <= MAX_STRING_BYTES) return s;
  return `${s.slice(0, MAX_STRING_BYTES)}…[truncated]`;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

function lowerStringArray(value: unknown): string[] | null {
  const arr = toStringArray(value);
  if (!arr) return null;
  return arr.map((v) => v.toLowerCase().replace(/^twitter$/i, 'x'));
}

function getKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

export interface StrategySnapshot {
  campaign_mode?: string;
  outcome_view?: string;
  selected_platforms?: string[];
  creator_formats?: string[];
  text_formats?: string[];
  frequency_per_week?: number;
  duration_weeks?: number;
  tone?: string;
  target_regions?: string[];
  source_opportunity_id?: string;
  source_recommendation_id?: string;
  strategic_theme_title?: string;
  has_attachments_required?: boolean;
  /** Eligible platforms after capability filter — useful when
   *  selected_platforms got narrowed by the picker filter. */
  eligible_platforms?: string[];
  /** Part 7 — sibling differential. Populated at enqueue time by
   *  computeSiblingDifferential and attached here so the failure
   *  drawer can show "differs from succeeded sibling X in [fields]". */
  sibling_differential?: {
    has_siblings: boolean;
    sibling_count: number;
    latest_succeeded_sibling_run_id: string | null;
    differs_from_succeeded_sibling: string[];
    differs_from_failed_sibling: string[];
  };
}

export interface CaptureStrategySnapshotInput {
  executionConfig?: Record<string, unknown> | null;
  sourceStrategicTheme?: Record<string, unknown> | null;
  outcomeView?: string | null;
  sourceOpportunityId?: string | null;
  sourceRecommendationId?: string | null;
  regionsFromCard?: string[] | null;
  eligiblePlatforms?: string[] | null;
}

export function captureStrategySnapshot(input: CaptureStrategySnapshotInput): StrategySnapshot {
  const out: StrategySnapshot = {};
  const ec = input.executionConfig ?? null;

  try {
    const mode = String(getKey(ec, 'campaign_mode') ?? '').toLowerCase().trim();
    if (mode) out.campaign_mode = mode;

    if (input.outcomeView) out.outcome_view = input.outcomeView;

    const sel = lowerStringArray(getKey(ec, 'selected_platforms'));
    if (sel) out.selected_platforms = sel;

    const cf = toStringArray(getKey(ec, 'creator_formats'));
    if (cf) {
      out.creator_formats = cf;
      // Derived hint — true if any of the formats requires an
      // uploaded asset. Hard-coded list here mirrors the same
      // formats isAttachmentRequiredFormat enumerates, but we
      // intentionally do NOT import that helper so this snapshot
      // stays a leaf-level pure function (no orchestrator deps).
      const ATTACHMENT_FORMATS = new Set(['carousel', 'reel', 'story', 'video', 'image']);
      out.has_attachments_required = cf.some((f) => ATTACHMENT_FORMATS.has(f.toLowerCase().trim()));
    }

    const tf = toStringArray(getKey(ec, 'text_formats'));
    if (tf) out.text_formats = tf;

    const freq = Number(getKey(ec, 'frequency_per_week') ?? NaN);
    if (Number.isFinite(freq) && freq > 0) out.frequency_per_week = freq;

    const dw = Number(getKey(ec, 'duration_weeks') ?? NaN);
    if (Number.isFinite(dw) && dw > 0) out.duration_weeks = dw;

    const tone = String(getKey(ec, 'tone') ?? '').trim();
    if (tone) {
      const t = truncate(tone);
      if (t) out.tone = t;
    }

    const regions = toStringArray(input.regionsFromCard ?? getKey(ec, 'target_regions'));
    if (regions) out.target_regions = regions;

    if (input.sourceOpportunityId) out.source_opportunity_id = input.sourceOpportunityId;
    if (input.sourceRecommendationId) out.source_recommendation_id = input.sourceRecommendationId;

    const themeTitle = getKey(input.sourceStrategicTheme, 'title')
      ?? getKey(getKey(input.sourceStrategicTheme, 'blueprint'), 'topic')
      ?? getKey(input.sourceStrategicTheme, 'topic');
    if (themeTitle) {
      const tt = truncate(String(themeTitle));
      if (tt) out.strategic_theme_title = tt;
    }

    const eligible = toStringArray(input.eligiblePlatforms);
    if (eligible) out.eligible_platforms = eligible;
  } catch {
    // Snapshot is best-effort. Never throw from a catch path.
  }

  return out;
}
