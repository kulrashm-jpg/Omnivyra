/**
 * INT-001 Phase 2 — Intelligence Summary builder.
 *
 * Orchestrates the engines in their contract order —
 *   Intent → Persona → Qualification → Segments → Recommendations → Timeline —
 * and consolidates the results into one LeadIntelligenceSummary. The behaviour
 * analysis is computed once and shared so every engine agrees on the same
 * derived facts. Deterministic: generatedAt === snapshot.now.
 */

import type { LeadCaptureSnapshot, LeadIntelligenceSummary } from './types';
import { resolveEngineConfig, type LeadIntelligenceEngineConfig } from './engineConfig';
import { analyzeBehavior } from './behaviorAnalysis';
import { computeIntentIntelligence } from './intentEngine';
import { classifyPersona } from './personaEngine';
import { buildQualification } from './qualificationEngine';
import { assignSegments } from './segmentationEngine';
import { buildRecommendations } from './recommendationEngine';
import { buildLeadTimeline } from './timelineEngine';
import { buildEvolutionIntelligence } from './evolutionEngine';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function buildLeadIntelligenceSummary(
  snapshot: LeadCaptureSnapshot,
  configOverride?: Partial<LeadIntelligenceEngineConfig>,
): LeadIntelligenceSummary {
  const config = resolveEngineConfig(configOverride);
  const behavior = analyzeBehavior(snapshot, config);

  const intent = computeIntentIntelligence(snapshot, config, behavior);
  const persona = classifyPersona(snapshot, config, behavior);
  // WS-2 M3: evolution is replayed ONCE here and shared with qualification,
  // recommendations and the timeline, exactly as `behavior` already is — so no
  // consumer recomputes it and all four agree on one history.
  const evolution = buildEvolutionIntelligence(snapshot, config, behavior);
  const qualification = buildQualification({ snapshot, intent, persona, evolution }, config, behavior);
  const segments = assignSegments({ snapshot, intent, persona, qualification }, config, behavior);
  const recommendations = buildRecommendations({ snapshot, intent, persona, qualification, segments, evolution }, config, behavior);
  const timeline = buildLeadTimeline(snapshot, { qualifiedAt: snapshot.now, recommendationGeneratedAt: snapshot.now, evolution }, config);

  // Overall confidence = data completeness. Each captured dimension raises trust
  // in the intelligence object; persona certainty contributes a bounded share.
  const completeness =
    (snapshot.lead.email ? 0.15 : 0) +
    (snapshot.lead.jobTitle ? 0.1 : 0) +
    (snapshot.lead.companyName ? 0.05 : 0) +
    (behavior.totalEvents > 0 ? 0.2 : 0) +
    (behavior.totalEvents >= 5 ? 0.1 : 0) +
    (behavior.sessionCount > 1 ? 0.1 : 0) +
    (snapshot.sessions.length > 0 ? 0.05 : 0) +
    persona.confidence * 0.25;
  const confidence = round2(Math.min(0.95, Math.max(0, completeness)));

  return {
    leadId: snapshot.lead.id,
    intent,
    persona,
    qualification,
    segments,
    recommendations,
    timeline,
    evolution,
    confidence,
    generatedAt: snapshot.now,
  };
}
