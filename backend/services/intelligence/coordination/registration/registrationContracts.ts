/**
 * Canonical Communication Registration — contracts (WS-2B, Zone A2).
 *
 * The registration PIPELINE, not any producer integration. Every future producer
 * (Writer, Campaigns, Creator, Engagement, Analytics, MarketPulse) performs
 * exactly ONE operation — `registerCommunication(...)` — and everything else
 * (Semantic Root ensure → registry write → graph membership → observability →
 * future duplicate detection) happens automatically behind it.
 *
 * No module-specific DTOs: the request carries only the canonical coordination
 * metadata (Semantic Root, artifact type, parent, platform, campaign, audience,
 * communication intent). Types only — logic lives in the pipeline.
 */
import type { CommunicationIntent } from '../../../../platform/intelligence';
import type {
  ArtifactType,
  GenerationStage,
  CommunicationRecord,
  CoordinationRef,
  CoordinationResult,
  CoordinationSourceModule,
  SemanticEmbeddingRef,
} from '../coordinationContracts';

// ── Lifecycle (WS-2B) ────────────────────────────────────────────────────────

/**
 * The canonical communication lifecycle, in monotonic order. A communication
 * advances forward through these states (archived is reachable from anywhere).
 * Persisted via `CommunicationRecord.publicationStatus` (a superset).
 */
export type CommunicationLifecycleState =
  | 'planned'    // intent registered
  | 'generated'  // content produced
  | 'adapted'    // adapted to a platform/surface
  | 'published'  // live
  | 'engaged'    // engagement received/answered
  | 'measured'   // performance captured
  | 'archived';  // closed out

/** Canonical order — index gives monotonic progression. */
export const COMMUNICATION_LIFECYCLE: readonly CommunicationLifecycleState[] = [
  'planned', 'generated', 'adapted', 'published', 'engaged', 'measured', 'archived',
] as const;

/** Order index of a lifecycle state (−1 if unknown). */
export function lifecycleOrder(state: string): number {
  return COMMUNICATION_LIFECYCLE.indexOf(state as CommunicationLifecycleState);
}

/**
 * Derive the monotonic lifecycle progression for a state — the single canonical
 * implementation shared by lifecycle-history and the query profiles (so neither
 * re-derives it). `completed` = states at/below current; `pending` = states ahead.
 */
export function deriveLifecycleProgression(state: string): {
  completed: CommunicationLifecycleState[];
  pending: CommunicationLifecycleState[];
  canonical: boolean;
} {
  const order = lifecycleOrder(state);
  if (order < 0) return { completed: [], pending: [...COMMUNICATION_LIFECYCLE], canonical: false };
  return {
    completed: COMMUNICATION_LIFECYCLE.slice(0, order + 1),
    pending: COMMUNICATION_LIFECYCLE.slice(order + 1),
    canonical: true,
  };
}

// ── Registration request (the ONE canonical input) ──────────────────────────

/** Optional Semantic Root details to ensure/register alongside the communication. */
export interface SemanticRootSeed {
  businessObjective: string;
  positioning: string;
  targetAudience: string;
  campaignObjective?: string | null;
}

/**
 * The single canonical registration input. Module-agnostic — no producer DTO.
 * The pipeline normalizes the intent, derives the Semantic Root id and the
 * idempotency key when not supplied, and ensures replay safety.
 */
export interface RegisterCommunicationRequest {
  companyId: string;
  communicationIntent: CommunicationIntent | string;   // normalized to the platform vocabulary
  /**
   * The subject seed. Optional: a derived artifact (e.g. a Creator visual/adapted
   * asset) that INHERITS its parent's `semanticRootId` has no topic of its own —
   * supply `semanticRootId` instead. Provide one of `topic` or `semanticRootId`.
   */
  topic?: string;

  // Lineage / classification (all optional — a plain event needs none).
  artifactType?: ArtifactType;
  parentArtifactId?: string | null;
  derivedFrom?: string[];
  generationStage?: GenerationStage;

  // Coordination metadata.
  platform?: string | null;
  campaignId?: string | null;
  audience?: string | null;
  sourceModule?: CoordinationSourceModule;

  // Identity — supplied by a producer, else derived deterministically.
  semanticRootId?: string;
  idempotencyKey?: string;

  // Lifecycle — defaults to 'planned'.
  lifecycleState?: CommunicationLifecycleState;

  // Soft references + optional pre-computed embedding.
  contentRef?: CoordinationRef | null;
  performanceRef?: CoordinationRef | null;
  embedding?: SemanticEmbeddingRef | null;

  // Optionally ensure a Semantic Root record exists for this seed.
  root?: SemanticRootSeed;

  metadata?: Record<string, unknown>;
  correlationId?: string;
  /** Event time (ISO). Defaults to now — set for historical/replayed events (e.g. analytics 'measured'). */
  observedAt?: string;
}

/** Outcome of a registration attempt. */
export interface RegistrationOutcome {
  record: CommunicationRecord | null;   // null only when skipped (pipeline disabled)
  /** false ⇒ a replay/duplicate collapsed onto an existing row (idempotent). */
  created: boolean;
  /** true ⇒ the pipeline was OFF and performed no write (id still derived). */
  skipped: boolean;
  semanticRootId: string;
  idempotencyKey: string;
  /** true ⇒ a Semantic Root was ensured/registered as part of this call. */
  rootEnsured: boolean;
}

// ── Pipeline interface (consumers depend ONLY on this) ───────────────────────

export interface CommunicationRegistrationPipeline {
  /** The one canonical operation. Idempotent, replay-safe, fail-safe. */
  registerCommunication(request: RegisterCommunicationRequest): Promise<CoordinationResult<RegistrationOutcome>>;
  /**
   * Advance a registered communication forward through the lifecycle (monotonic;
   * never moves backward except to 'archived'). Idempotent: setting the same or
   * an earlier state is a no-op.
   */
  advanceLifecycle(
    companyId: string,
    communicationId: string,
    toState: CommunicationLifecycleState,
  ): Promise<CoordinationResult<{ changed: boolean; state: CommunicationLifecycleState }>>;
}
