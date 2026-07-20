/**
 * Communication Lifecycle Intelligence — contracts (WS-2C, Zone A2).
 *
 * READ-SIDE only. These services answer questions ABOUT registered communications
 * — history, timeline, lineage, graph traversal, lifecycle, intent reuse, duplicate
 * history, semantic clusters, and gaps. They perform NO writes and consume ONLY the
 * canonical coordination API (the registry, the semantic-root registry, and the
 * pure graph projector). Types only.
 */
import type { CommunicationIntent } from '../../../../platform/intelligence';
import type {
  CommunicationRecord,
  CoordinationResult,
  DuplicateIntentVerdict,
  PublicationStatus,
} from '../coordinationContracts';
import type { SemanticRoot, CommunicationGraph } from '../semanticContinuityContracts';
import type { CommunicationLifecycleState } from '../registration/registrationContracts';

// ── History / timeline ───────────────────────────────────────────────────────

export interface CommunicationHistoryQuery {
  /** Look back N days (default 90). Ignored when `since` is set. */
  sinceDays?: number;
  since?: string;                       // ISO override
  campaignId?: string | null;
  platform?: string | null;
  communicationIntent?: CommunicationIntent;
  semanticRootId?: string;
  limit?: number;
}

export interface CommunicationTimeline {
  companyId: string;
  from: string;                         // ISO window start
  to: string;                           // ISO window end
  entries: CommunicationRecord[];       // newest-first
  total: number;
}

// ── Lineage / graph ──────────────────────────────────────────────────────────

export interface LineageView {
  semanticRootId: string;
  root: SemanticRoot | null;
  artifacts: CommunicationRecord[];     // everything derived from the root
  graph: CommunicationGraph;            // scoped projection
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export interface LifecycleHistory {
  communicationId: string;
  current: PublicationStatus;
  /** States completed so far — implied by the monotonic lifecycle (≤ current). */
  completed: CommunicationLifecycleState[];
  /** States still ahead (> current). */
  pending: CommunicationLifecycleState[];
  observedAt: string;                   // registration time
  /** Per-transition timestamps are not persisted; progression is derived. */
  note: string;
}

// ── Intent reuse across campaigns ────────────────────────────────────────────

export interface IntentReuse {
  communicationIntent: CommunicationIntent;
  campaignIds: string[];                // distinct campaigns that used this intent
  communicationCount: number;
  semanticRootIds: string[];
}

// ── Semantic clusters ────────────────────────────────────────────────────────

export interface SemanticCluster {
  semanticRootId: string;
  size: number;
  intents: CommunicationIntent[];
  platforms: string[];
  campaignIds: string[];
  lifecycleStates: PublicationStatus[];
  firstObserved: string;
  lastObserved: string;
}

// ── Duplicate / repeated-intent history ──────────────────────────────────────

export interface RepeatedIntent {
  semanticRootId: string;
  communicationIntent: CommunicationIntent;
  count: number;                        // > 1 ⇒ the same intent seed was communicated repeatedly
  records: CommunicationRecord[];
}

// ── Gaps / continuity report ─────────────────────────────────────────────────

export type CommunicationGapKind =
  | 'unpublished'      // a root was planned/generated but never published
  | 'stale'            // no activity within the freshness window
  | 'single_platform'; // a root communicated on exactly one platform (coverage gap)

export interface CommunicationGap {
  kind: CommunicationGapKind;
  semanticRootId: string;
  detail: string;
}

export interface ContinuityReport {
  companyId: string;
  totalCommunications: number;
  clusterCount: number;
  clusters: SemanticCluster[];
  repeatedIntents: RepeatedIntent[];
  gaps: CommunicationGap[];
}

// ── The reusable read-side service (consumers depend ONLY on this) ──────────

export interface CommunicationIntelligence {
  /** "What has this company communicated over the last N (default 90) days?" */
  getTimeline(companyId: string, query?: CommunicationHistoryQuery): Promise<CoordinationResult<CommunicationTimeline>>;
  /** Filtered communication history (no windowing default). */
  getHistory(companyId: string, query?: CommunicationHistoryQuery): Promise<CoordinationResult<CommunicationRecord[]>>;
  /** "Show every artifact derived from this Semantic Root." */
  getLineage(companyId: string, semanticRootId: string): Promise<CoordinationResult<LineageView>>;
  /** Communication graph (optionally scoped to one root) for traversal. */
  getGraph(companyId: string, semanticRootId?: string): Promise<CoordinationResult<CommunicationGraph>>;
  /** "Which published assets originated from this Semantic Root?" */
  getPublishedFromRoot(companyId: string, semanticRootId: string): Promise<CoordinationResult<CommunicationRecord[]>>;
  /** "What is the lifecycle history of a communication?" */
  getLifecycleHistory(companyId: string, communicationId: string): Promise<CoordinationResult<LifecycleHistory>>;
  /** "Which campaigns reused the same communication intent?" */
  getIntentReuse(companyId: string, communicationIntent?: CommunicationIntent): Promise<CoordinationResult<IntentReuse[]>>;
  /** "What semantic clusters exist?" (one per semantic root) */
  getSemanticClusters(companyId: string): Promise<CoordinationResult<SemanticCluster[]>>;
  /** Repeated communication intents (duplicate-intent history). */
  getRepeatedIntents(companyId: string): Promise<CoordinationResult<RepeatedIntent[]>>;
  /** Assess whether a candidate intent duplicates prior communications (delegates to the registry). */
  findRelatedCommunications(companyId: string, input: { communicationIntent: CommunicationIntent; topic: string; campaignId?: string | null; platform?: string | null }): Promise<CoordinationResult<DuplicateIntentVerdict>>;
  /** "What communication gaps exist?" */
  getGaps(companyId: string, opts?: { staleDays?: number }): Promise<CoordinationResult<CommunicationGap[]>>;
  /** Semantic continuity report — clusters + repeated intents + gaps in one pass. */
  getContinuityReport(companyId: string): Promise<CoordinationResult<ContinuityReport>>;
}
