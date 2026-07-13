/**
 * canonicalAdoptionMetrics.ts — CONTENT-INTELLIGENCE-003 observability.
 *
 * Tracks migration of AI grounding consumers onto the Canonical Context Engine:
 * a static inventory (migrated vs remaining) + a runtime counter of actual
 * canonical-backed reads. No I/O; safe to import anywhere.
 */

/** Consumers migrated to canonical grounding in Wave 1 (CONTENT-INTELLIGENCE-003). */
export const WAVE1_MIGRATED_CONSUMERS: readonly string[] = [
  // Writer
  'lib/content/buildContentContext.ts',
  'backend/services/unifiedContentGenerationEngine.ts',
  'backend/services/contentGeneration/platformVariantGenerator.ts',
  'backend/services/contentGeneration/blueprintGenerator.ts',
  'pages/api/content/generate-from-card.ts',
  'pages/api/content/generate-day.ts',
  // Campaign
  'backend/services/campaignPromptBuilder.ts',
  'backend/services/campaignAiOrchestrator/prepareRuntimePlanningContext.ts',
  'backend/services/CampaignPrePlanningService.ts',
  // BOLT
  'backend/services/boltPipelineServiceRunPlan.ts',
  'backend/services/boltContentGenerationForSchedule.ts',
  'pages/api/bolt/campaign-chat.ts',
  // Creator
  'backend/services/creator/creatorCopyContextResolver.ts',
  'backend/services/creator/generateRoute/generatePrep.ts',
  'backend/services/creator/governanceItemEnricher.ts',
];

/**
 * Total AI grounding consumers (getProfile / company_profiles reads) identified
 * by the CONTENT-INTELLIGENCE-002 audit. Baseline for adoption percentage.
 * Update as later waves land.
 */
export const TOTAL_GROUNDING_CONSUMERS = 110;

export interface AdoptionStats {
  migrated: number;
  total: number;
  remaining: number;
  adoptionPercent: number;
  migratedConsumers: string[];
}

export function getCanonicalAdoptionStats(): AdoptionStats {
  const migrated = WAVE1_MIGRATED_CONSUMERS.length;
  const total = TOTAL_GROUNDING_CONSUMERS;
  return {
    migrated,
    total,
    remaining: Math.max(0, total - migrated),
    adoptionPercent: Math.round((migrated / total) * 1000) / 10,
    migratedConsumers: [...WAVE1_MIGRATED_CONSUMERS],
  };
}

// ── Runtime observability (bounded, fail-safe) ─────────────────────────────────
const reads = new Map<string, number>();
const canonicalBacked = { yes: 0, no: 0 };

/** Called by the adapter each time a consumer reads grounding. */
export function recordCanonicalRead(consumerId: string, canonical: boolean): void {
  try {
    if (reads.size < 500) reads.set(consumerId, (reads.get(consumerId) ?? 0) + 1);
    if (canonical) canonicalBacked.yes += 1; else canonicalBacked.no += 1;
  } catch { /* never throw from a metric */ }
}

export function getCanonicalReadCounts(): { byConsumer: Record<string, number>; canonicalBacked: { yes: number; no: number } } {
  return { byConsumer: Object.fromEntries(reads), canonicalBacked: { ...canonicalBacked } };
}
