/**
 * Activity Economy Catalog — Phase 8A (INERT / catalog-only).
 *
 * Defines the Omnivyra credit-economy model as a small set of reusable
 * ACTIVITY CLASSES, and maps every CreditAction onto exactly one class.
 *
 * WHAT THIS IS:
 *   A declarative source of truth for the economics each activity will run on
 *   once the economy is activated — entry consumption (non-refundable charge at
 *   first billable resource), the min/max credit band, the exposure to reserve,
 *   and the abandonment timeout.
 *
 * WHAT THIS IS NOT (Phase 8A guardrails):
 *   - It is NOT wired into any charging path. Nothing here is read by
 *     executeWithCredits / HOLD / CONFIRM / RELEASE / reconciliation.
 *   - It changes NO billing behavior, NO enforcement, NO dark gates.
 *   - It is pure (no DB, no I/O) so it is trivially safe to import anywhere and
 *     to unit-test without a Supabase client.
 *
 * The companion schema proposal (supabase/migrations/20260822_activity_economy_
 * catalog.sql) persists this same shape for a LATER, separately-approved phase;
 * that migration is intentionally UNAPPLIED. Until then, THIS FILE is the
 * runtime source of truth.
 *
 * Design rule (per Phase 8A): do NOT define economics 46 times. Economics live
 * on the CLASS; activities inherit them by membership. Class bands are chosen so
 * each member's current flat fee (credit_cost_config) sits inside [min, max] —
 * i.e. activating the economy re-prices nothing.
 */

import type { CreditAction } from './creditDeductionService';

export type ActivityClass =
  | 'REPLY'              // micro single-shot suggestions / chat turns / auto-post
  | 'SHORT_GENERATION'   // short content pieces (rewrite, basic post, repurpose)
  | 'LONG_GENERATION'    // long-form, token-priced (master content, blog article)
  | 'DEEP_RESEARCH'      // heavy multi-step analysis & strategy synthesis
  | 'INTELLIGENCE_SCAN'  // background / value-gated scans (leads, signals, optimization)
  | 'AUTOMATION'         // campaign builders & async orchestration
  | 'IMAGE_GENERATION'   // asset render (reserved — see note below)
  | 'VIDEO_GENERATION'   // asset render (reserved — future)
  | 'VOICE'              // per-minute voice
  | 'SYSTEM';            // metering-only infra ops (embeddings, external APIs)

export interface ActivityClassEconomics {
  /** Non-refundable credits consumed when the first billable resource is used. */
  entryConsumptionCredits: number;
  /** Floor of the activity's credit band (entry <= min). */
  minimumCredits: number;
  /** Ceiling — the most this activity can settle at (the exposure envelope). */
  maximumCredits: number;
  /** Idle window after which an incomplete activity's exposure is released. */
  abandonmentTimeoutSeconds: number;
}

/**
 * Class economics. Invariants enforced by tests + the schema CHECK constraints:
 *   entryConsumptionCredits <= minimumCredits <= maximumCredits
 *   abandonmentTimeoutSeconds >= 0
 */
export const ACTIVITY_CLASS_ECONOMICS: Record<ActivityClass, ActivityClassEconomics> = {
  REPLY:             { entryConsumptionCredits: 1,  minimumCredits: 1,  maximumCredits: 3,   abandonmentTimeoutSeconds: 300 },
  SHORT_GENERATION:  { entryConsumptionCredits: 2,  minimumCredits: 3,  maximumCredits: 15,  abandonmentTimeoutSeconds: 600 },
  LONG_GENERATION:   { entryConsumptionCredits: 10, minimumCredits: 10, maximumCredits: 60,  abandonmentTimeoutSeconds: 1800 },
  DEEP_RESEARCH:     { entryConsumptionCredits: 15, minimumCredits: 20, maximumCredits: 90,  abandonmentTimeoutSeconds: 3600 },
  INTELLIGENCE_SCAN: { entryConsumptionCredits: 2,  minimumCredits: 2,  maximumCredits: 30,  abandonmentTimeoutSeconds: 1800 },
  AUTOMATION:        { entryConsumptionCredits: 20, minimumCredits: 40, maximumCredits: 120, abandonmentTimeoutSeconds: 7200 },
  IMAGE_GENERATION:  { entryConsumptionCredits: 2,  minimumCredits: 2,  maximumCredits: 12,  abandonmentTimeoutSeconds: 900 },
  VIDEO_GENERATION:  { entryConsumptionCredits: 10, minimumCredits: 20, maximumCredits: 150, abandonmentTimeoutSeconds: 3600 },
  VOICE:             { entryConsumptionCredits: 2,  minimumCredits: 5,  maximumCredits: 60,  abandonmentTimeoutSeconds: 1800 },
  SYSTEM:            { entryConsumptionCredits: 0,  minimumCredits: 0,  maximumCredits: 0,   abandonmentTimeoutSeconds: 60 },
};

/**
 * Every CreditAction → its class. Typed as Record<CreditAction, …> so the
 * compiler REFUSES to build if any CreditAction is left unmapped (this is the
 * "no activity left unmapped" guarantee, enforced at compile time).
 *
 * IMAGE_GENERATION / VIDEO_GENERATION map the Phase 10D image_generation /
 * video_generation actions. Their ACTUAL per-asset cost is resolved from the
 * existing creator/costProfiles.ts profiles via creator/assetActivityEconomics.ts
 * (passed to the engine as amountOverride) — the class supplies entry/exposure,
 * the cost profile supplies the settled amount. No parallel economy.
 */
export const ACTIVITY_CLASS_MAP: Record<CreditAction, ActivityClass> = {
  // REPLY — micro single-shot
  ai_reply:                        'REPLY',
  auto_post:                       'REPLY',
  reply_generation:                'REPLY',
  blog_brief_suggestions:          'REPLY',
  content_suggestions:             'REPLY',
  chat_theme_refine:               'REPLY',
  engagement_refine:               'REPLY',
  campaign_chat:                   'REPLY',
  campaign_suggest_update:         'REPLY',
  campaign_suggest_duration:       'REPLY',
  campaign_preplanning:            'REPLY',
  recommendations_preview_strategy:'REPLY',
  recommendations_group_preview:   'REPLY',

  // SHORT_GENERATION — short produced content
  content_rewrite:                 'SHORT_GENERATION',
  content_basic:                   'SHORT_GENERATION',
  blog_rewrite_hook:               'SHORT_GENERATION',
  content_repurpose:               'SHORT_GENERATION',
  quick_platform_adapt:            'SHORT_GENERATION',
  creator_content:                 'SHORT_GENERATION',
  skeleton_command:                'SHORT_GENERATION',

  // LONG_GENERATION — long-form, token-priced
  content_generation:              'LONG_GENERATION',
  blog_generation:                 'LONG_GENERATION',

  // DEEP_RESEARCH — heavy synthesis
  trend_analysis:                  'DEEP_RESEARCH',
  market_insight_manual:           'DEEP_RESEARCH',
  website_audit:                   'DEEP_RESEARCH',
  deep_analysis:                   'DEEP_RESEARCH',
  full_strategy:                   'DEEP_RESEARCH',

  // INTELLIGENCE_SCAN — background / value-gated
  prediction:                      'INTELLIGENCE_SCAN',
  insight_generation:              'INTELLIGENCE_SCAN',
  pattern_detection:               'INTELLIGENCE_SCAN',
  market_positioning:              'INTELLIGENCE_SCAN',
  competitor_signals:              'INTELLIGENCE_SCAN',
  lead_detection:                  'INTELLIGENCE_SCAN',
  daily_insight_scan:              'INTELLIGENCE_SCAN',
  campaign_optimization:           'INTELLIGENCE_SCAN',
  optimization_loop:               'INTELLIGENCE_SCAN',
  portfolio_decision:              'INTELLIGENCE_SCAN',
  strategy_evolution:              'INTELLIGENCE_SCAN',
  recommendations_generate:        'INTELLIGENCE_SCAN',
  recommendations_opportunities:   'INTELLIGENCE_SCAN',
  lead_qualification:              'INTELLIGENCE_SCAN',
  lead_predictive_scoring:         'INTELLIGENCE_SCAN',

  // AUTOMATION — campaign builders / async orchestration
  campaign_creation:               'AUTOMATION',
  campaign_generation:             'AUTOMATION',
  async_campaign_planning:         'AUTOMATION',

  // VOICE — per minute
  voice_per_minute:                'VOICE',

  // ASSET / IMAGE / VIDEO generation (Phase 10D). image/carousel/infographic
  // asset generation → IMAGE_GENERATION; video → VIDEO_GENERATION. Actual cost
  // resolved from the existing per-asset cost profiles via
  // creator/assetActivityEconomics.ts (no parallel economy).
  image_generation:                'IMAGE_GENERATION',
  video_generation:                'VIDEO_GENERATION',
};

/**
 * Metering-only pricing keys that are NOT user CreditActions but still resolve
 * to the SYSTEM class (so resolveActivityEconomics is total over the pricing
 * surface, not just user activities).
 */
export const SYSTEM_PRICING_KEYS: ReadonlySet<string> = new Set(['embedding', 'external_api']);

export interface ResolvedActivityEconomics {
  activity: string;
  activityClass: ActivityClass;
  entryConsumption: number;
  minimumCredits: number;
  maximumCredits: number;
  /** Exposure to reserve after the entry charge. Per spec: max − entry. */
  reservationCredits: number;
  abandonmentTimeoutSeconds: number;
}

/** Class for an action, or null if the action is neither a CreditAction nor a system key. */
export function getActivityClass(action: string): ActivityClass | null {
  if (Object.prototype.hasOwnProperty.call(ACTIVITY_CLASS_MAP, action)) {
    return ACTIVITY_CLASS_MAP[action as CreditAction];
  }
  if (SYSTEM_PRICING_KEYS.has(action)) return 'SYSTEM';
  return null;
}

/**
 * Resolve the full economy envelope for an activity. Pure, synchronous,
 * DB-free. Read by nothing in a charging path during Phase 8A.
 *
 * reservationCredits = maximumCredits − entryConsumption (the exposure held
 * after the non-refundable entry charge).
 *
 * Throws on an unknown action so a typo can never silently resolve to "free".
 */
export function resolveActivityEconomics(action: string): ResolvedActivityEconomics {
  const activityClass = getActivityClass(action);
  if (!activityClass) {
    throw new Error(`[activityEconomyCatalog] No activity class mapped for '${action}'`);
  }
  const econ = ACTIVITY_CLASS_ECONOMICS[activityClass];
  return {
    activity: action,
    activityClass,
    entryConsumption: econ.entryConsumptionCredits,
    minimumCredits: econ.minimumCredits,
    maximumCredits: econ.maximumCredits,
    reservationCredits: econ.maximumCredits - econ.entryConsumptionCredits,
    abandonmentTimeoutSeconds: econ.abandonmentTimeoutSeconds,
  };
}
