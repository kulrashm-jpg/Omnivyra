/**
 * J-B201 (persistence) — Canonical Journey persistence contract (pure shape builder; NO writer wired
 * in Phase B). A compat adapter maps the canonical understanding to a legacy journey-field shape so
 * consumers can be served the projection during adoption — Journey is the sole owner; consumers
 * reference it.
 */

import type { JourneyUnderstanding, JourneyProjection, JourneyUnderstandingShadowRecord } from './types';

export function toShadowRecord(u: JourneyUnderstanding, projection: JourneyProjection, parity: number | null): JourneyUnderstandingShadowRecord {
  return { company_id: u.key.companyId, journey_id: u.key.journeyId, version: u.version, understanding: u, projection, parity, built_at: u.builtAt };
}

export interface LegacyJourneyFields {
  company_id: string; journey_id: string;
  actor_ref: string | null; actor_type: string | null; status: string | null;
  current_stage: string | null; touchpoint_count: number | null; span_days: number | null; confidence: number;
}
export function toLegacyFields(u: JourneyUnderstanding): LegacyJourneyFields {
  const id = u.facets.identity.value;
  return {
    company_id: u.key.companyId,
    journey_id: u.key.journeyId,
    actor_ref: id?.actorRef ?? null,
    actor_type: id?.actorType ?? null,
    status: u.facets.state.value?.status ?? null,
    current_stage: u.facets.stages.value?.current ?? null,
    touchpoint_count: u.facets.touchpoints.value?.count ?? null,
    span_days: u.facets.continuity.value?.spanDays ?? null,
    confidence: u.score.confidence,
  };
}
