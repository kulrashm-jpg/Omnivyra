/**
 * WAVE-2-001 — Canonical Grounding activation (public barrel).
 *
 * Enforces the existing grounding infrastructure per AI-CONTRACT-000 §C4:
 * grounding floor + freshness enforcement + evidence provenance + observability.
 * Additive; no new retrieval framework, no vector-storage change, no architecture
 * or contract change. Consumes the canonical `transparency` rollup.
 */
export {
  evaluateGrounding, enforceFreshness, freshnessFromDays,
  FRESHNESS_MULTIPLIER, GROUNDING_FLOOR_THRESHOLD,
  type FreshnessStatus, type GroundingDecision, type GroundingTransparencyInput,
} from './groundingPolicy';
export { recordGroundingDecision, type GroundingTraceCtx } from './groundingObservability';
