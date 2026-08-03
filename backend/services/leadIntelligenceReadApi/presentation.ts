/**
 * INT-001 Phase 6 — read-only presentation helpers.
 *
 * Every helper SELECTS already-persisted values from the normalized view.
 * Nothing here recalculates, rescores, re-ranks with new math, or infers
 * missing data — ties are broken deterministically (lexicographic / fixed
 * DTO order) so identical input always yields identical output.
 */

import type {
  FreshnessPresentationDTO,
  IntelligenceAggregationDTO,
  IntelligenceFreshness,
  LeadIntelligenceViewDTO,
  PersonaDTO,
  RecommendationItemDTO,
  SegmentDTO,
  TimelineEntryDTO,
} from './dto';

export const overallScoreOf = (view: LeadIntelligenceViewDTO): number | null =>
  view.qualification?.totalScore ?? null;

export const qualificationBandOf = (view: LeadIntelligenceViewDTO): string | null =>
  view.qualification?.band ?? null;

export const primaryPersonaOf = (view: LeadIntelligenceViewDTO): PersonaDTO | null => view.persona;

/** Highest-confidence segment; ties resolve lexicographically by name. */
export function primarySegmentOf(view: LeadIntelligenceViewDTO): SegmentDTO | null {
  let best: SegmentDTO | null = null;
  for (const segment of view.segments) {
    if (
      best === null ||
      segment.confidence > best.confidence ||
      (segment.confidence === best.confidence && segment.segment.localeCompare(best.segment) < 0)
    ) {
      best = segment;
    }
  }
  return best;
}

const itemByKey = (view: LeadIntelligenceViewDTO, key: string): RecommendationItemDTO | null =>
  view.recommendations.find((r) => r.key === key) ?? null;

/** The persisted best-channel recommendation (selection, not re-ranking). */
export const highestConfidenceChannelOf = (view: LeadIntelligenceViewDTO): RecommendationItemDTO | null =>
  itemByKey(view, 'bestChannel');

/** The persisted next-best-action recommendation. */
export const topActionOf = (view: LeadIntelligenceViewDTO): RecommendationItemDTO | null =>
  itemByKey(view, 'nextBestAction');

/** Highest-confidence recommendation; ties resolve by stable DTO order. */
export function topRecommendationOf(view: LeadIntelligenceViewDTO): RecommendationItemDTO | null {
  let best: RecommendationItemDTO | null = null;
  for (const item of view.recommendations) {
    if (best === null || item.confidence > best.confidence) best = item;
  }
  return best;
}

/** Top-N recommendations by persisted confidence (desc), stable DTO-order tiebreak. */
export function recommendationPreviewOf(view: LeadIntelligenceViewDTO, limit = 3): RecommendationItemDTO[] {
  const indexed = view.recommendations.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => (b.item.confidence - a.item.confidence) || (a.index - b.index));
  return indexed.slice(0, Math.max(0, limit)).map((x) => x.item);
}

/** The most recent N timeline entries, preserving persisted chronological order. */
export function timelinePreviewOf(view: LeadIntelligenceViewDTO, limit = 5): TimelineEntryDTO[] {
  if (limit <= 0) return [];
  return view.timeline.slice(-limit);
}

/** Confidence values, selected — never recomputed. */
export function confidenceSummaryOf(view: LeadIntelligenceViewDTO): {
  overall: number | null;
  persona: number | null;
  intentBand: string | null;
  qualificationBand: string | null;
} {
  return {
    overall: view.overallConfidence,
    persona: view.persona?.confidence ?? null,
    intentBand: view.intent?.band ?? null,
    qualificationBand: view.qualification?.band ?? null,
  };
}

const FRESHNESS_PRESENTATION: Record<IntelligenceFreshness, Omit<FreshnessPresentationDTO, 'state'>> = {
  fresh: { label: 'Up to date', tone: 'positive', description: 'Intelligence reflects the latest captured data.' },
  stale: { label: 'Out of date', tone: 'warning', description: 'Captured data or the engine changed since this was generated.' },
  pending_regeneration: { label: 'Refresh queued', tone: 'info', description: 'A rebuild has been requested and has not run yet.' },
  never_generated: { label: 'Not generated', tone: 'neutral', description: 'Intelligence has not been generated for this lead.' },
};

/** Label a stored freshness state for UI. Pure lookup — no inference. */
export function describeFreshness(state: IntelligenceFreshness): FreshnessPresentationDTO {
  return { state, ...FRESHNESS_PRESENTATION[state] };
}

/** Read-only aggregation across views: counts + mean of persisted scores. */
export function aggregateIntelligenceViews(views: LeadIntelligenceViewDTO[]): IntelligenceAggregationDTO {
  const byFreshness: Record<IntelligenceFreshness, number> = {
    fresh: 0,
    stale: 0,
    pending_regeneration: 0,
    never_generated: 0,
  };
  const byBand: Record<string, number> = {};
  let available = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const view of views) {
    byFreshness[view.freshness] += 1;
    if (view.status === 'available') available += 1;
    const band = view.qualification?.band;
    if (band) byBand[band] = (byBand[band] ?? 0) + 1;
    const score = view.qualification?.totalScore;
    if (typeof score === 'number') {
      scoreSum += score;
      scoreCount += 1;
    }
  }

  return {
    total: views.length,
    available,
    byFreshness,
    byBand,
    averageScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
  };
}
