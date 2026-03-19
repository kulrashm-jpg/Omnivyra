/**
 * Confidence Calibrator — Edge Case Fix #3
 *
 * Tracks real-world outcomes (user accepted / edited the plan) and computes
 * a segment-specific confidence threshold so the refinement gate (#4) doesn't drift.
 *
 * How it works:
 *   - Each time a plan is generated, record (jobId, confidence, planTier, industry)
 *   - Each time a user acts on the plan, record the outcome
 *   - Weekly: compute optimal threshold per segment (binary search on acceptance rate)
 *   - Runtime: resolve the effective threshold from the calibrated segment or fallback
 *
 * Storage: Supabase `campaign_confidence_outcomes` table.
 * Weekly job: call calibrateThresholds() from a cron or admin endpoint.
 *
 * In-process cache: thresholds are cached for 1 hour to avoid DB hit on every job.
 */

import { supabase } from '../db/supabaseClient';

// ── Default threshold per plan tier ──────────────────────────────────────────

const DEFAULT_THRESHOLDS: Record<string, number> = {
  free:         0.60,
  starter:      0.62,
  growth:       0.65,
  pro:          0.70,
  enterprise:   0.72,
};
const FALLBACK_THRESHOLD = 0.65;

// ── In-process threshold cache (1-hour TTL) ───────────────────────────────────

interface CachedThreshold {
  value: number;
  at:    number;
}
const _cache = new Map<string, CachedThreshold>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheKey(planTier: string, industry: string): string {
  return `${planTier}:${industry || 'generic'}`;
}

// ── Outcome recording ─────────────────────────────────────────────────────────

export type ConfidenceOutcome =
  | 'accepted'        // user clicked "looks good" or published without edits
  | 'edited_minor'    // user made 1–3 edits
  | 'edited_major'    // user made 4+ edits or regenerated
  | 'rejected';       // user discarded or regenerated from scratch

/**
 * Record a plan outcome for calibration.
 * Call from the plan finalize endpoint and from the plan edit tracker.
 * Fire-and-forget — never await in the hot path.
 */
export async function recordOutcome(opts: {
  jobId:     string;
  campaignId: string;
  confidence: number;
  planTier:  string;
  industry:  string;
  outcome:   ConfidenceOutcome;
  editCount?: number;
}): Promise<void> {
  try {
    await supabase.from('campaign_confidence_outcomes').insert({
      job_id:      opts.jobId,
      campaign_id: opts.campaignId,
      confidence:  opts.confidence,
      plan_tier:   opts.planTier,
      industry:    opts.industry || 'generic',
      outcome:     opts.outcome,
      edit_count:  opts.editCount ?? 0,
      recorded_at: new Date().toISOString(),
    });
  } catch { /* fail-safe — outcome recording must never crash callers */ }
}

// ── Calibration ───────────────────────────────────────────────────────────────

/**
 * Compute optimal refinement threshold per (planTier, industry) segment.
 * Run weekly via cron. Reads last 90 days of outcomes.
 *
 * Algorithm:
 *   For each segment, find the confidence threshold T such that:
 *   - Plans with confidence < T that were refined had higher acceptance rate
 *   - Plans with confidence ≥ T that were NOT refined also had high acceptance rate
 *
 *   Binary search over T ∈ [0.50, 0.90] stepping by 0.05.
 */
export async function calibrateThresholds(): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: outcomes, error } = await supabase
    .from('campaign_confidence_outcomes')
    .select('confidence, plan_tier, industry, outcome')
    .gte('recorded_at', since);

  if (error || !outcomes || outcomes.length < 50) {
    // Not enough data — keep defaults
    return DEFAULT_THRESHOLDS;
  }

  // Group by segment
  const segments = new Map<string, Array<{ confidence: number; accepted: boolean }>>();
  for (const row of outcomes) {
    const key = cacheKey(row.plan_tier ?? 'growth', row.industry ?? 'generic');
    if (!segments.has(key)) segments.set(key, []);
    segments.get(key)!.push({
      confidence: Number(row.confidence ?? 0),
      accepted:   row.outcome === 'accepted' || row.outcome === 'edited_minor',
    });
  }

  const result: Record<string, number> = { ...DEFAULT_THRESHOLDS };

  for (const [key, data] of segments) {
    if (data.length < 20) continue; // not enough data for this segment

    let bestThreshold = FALLBACK_THRESHOLD;
    let bestScore = -Infinity;

    for (let t = 0.50; t <= 0.90; t += 0.05) {
      // Count true positives (refined plans that should have been refined)
      const belowT  = data.filter(d => d.confidence < t);
      const aboveT  = data.filter(d => d.confidence >= t);

      const belowAccepted = belowT.filter(d => d.accepted).length;
      const aboveAccepted = aboveT.filter(d => d.accepted).length;

      // Score: maximize acceptance rate on both sides
      const belowRate = belowT.length > 0 ? belowAccepted / belowT.length : 0;
      const aboveRate = aboveT.length > 0 ? aboveAccepted / aboveT.length : 0;
      const score     = belowRate * 0.5 + aboveRate * 0.5;

      if (score > bestScore) {
        bestScore     = score;
        bestThreshold = t;
      }
    }

    result[key] = bestThreshold;

    // Update in-process cache
    _cache.set(key, { value: bestThreshold, at: Date.now() });
  }

  // Persist calibrated thresholds for observability
  try {
    await supabase.from('campaign_confidence_calibration').upsert(
      Object.entries(result).map(([key, value]) => ({
        segment_key:  key,
        threshold:    value,
        calibrated_at: new Date().toISOString(),
      })),
      { onConflict: 'segment_key' },
    );
  } catch { /* non-fatal */ }

  return result;
}

// ── Runtime resolution ────────────────────────────────────────────────────────

/**
 * Get the effective refinement confidence threshold for a plan.
 * Uses cached calibrated value, falling back to plan-tier default.
 */
export async function getRefinementThreshold(
  planTier: string,
  industry: string,
): Promise<number> {
  const key     = cacheKey(planTier, industry);
  const cached  = _cache.get(key);

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  // Try to load from DB (latest calibration)
  try {
    const { data } = await supabase
      .from('campaign_confidence_calibration')
      .select('threshold')
      .eq('segment_key', key)
      .maybeSingle();

    if (data?.threshold) {
      const threshold = Number(data.threshold);
      _cache.set(key, { value: threshold, at: Date.now() });
      return threshold;
    }
  } catch { /* fall through */ }

  return DEFAULT_THRESHOLDS[planTier] ?? FALLBACK_THRESHOLD;
}
