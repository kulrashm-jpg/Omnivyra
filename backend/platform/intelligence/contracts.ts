/**
 * Product Intelligence Platform (PIP) — canonical service contracts.
 *
 * Implements the interfaces specified in PROD-SPEC-001. TYPES + INTERFACES ONLY —
 * no business logic, no module migration. Every product module will eventually
 * depend ONLY on these interfaces; concrete platform implementations and legacy
 * adapters live behind them (see platform.ts). Foundation only (PROD-IMPL-001).
 */

// ── Universal envelope (all services inherit this) ───────────────────────────
export const PIP_VERSION = 1;

export type PIPService =
  | 'memory' | 'context' | 'signal' | 'learning'
  | 'recommendation' | 'ranking' | 'decision' | 'insight';

/** Every request is tenant-scoped (companyId) — the RLS boundary. */
export interface PIPRequest {
  companyId: string;
  v?: number;
  correlationId?: string;
  flags?: Record<string, boolean>;
}

/** score/decision contributions — score = Σ contribution (explainable-by-construction). */
export interface Explanation {
  factor: string;
  contribution: number;
  note?: string;
}

export interface PIPResponse<T> {
  v: number;
  data: T;
  degraded: boolean;
  source: 'platform' | 'legacy-adapter';
  correlationId: string;
  explanation?: Explanation[];
}

// ── Shared value types ───────────────────────────────────────────────────────
export interface EntityRef { kind: string; id: string }
export interface EvidenceRef { service: PIPService; ref: string }
export type Unsubscribe = () => void;

// ── Memory (Phase 1) ─────────────────────────────────────────────────────────
export type MemoryContext = 'company' | 'brand' | 'content' | 'learning' | 'customer' | 'campaign';
export interface MemoryQuery { contentType?: string; campaignId?: string; limit?: number; [k: string]: unknown }
export interface MemoryRecord { context: MemoryContext; key: string; payload: Record<string, unknown>; observedAt?: string }
export interface MemoryService {
  read(req: PIPRequest & { context: MemoryContext; query: MemoryQuery }): Promise<PIPResponse<MemoryRecord[]>>;
  subscribe(req: PIPRequest & { context: MemoryContext; onChange: (r: MemoryRecord) => void }): Unsubscribe;
}

// ── Context (Phase 2) ────────────────────────────────────────────────────────
export interface GroundedContext {
  company: Record<string, unknown>;
  brand?: Record<string, unknown>;
  objective?: string;
  audience?: string;
  campaign?: Record<string, unknown>;
  history?: MemoryRecord[];
  platformProfile?: Record<string, unknown>;
}
export interface ContextService {
  resolve(req: PIPRequest & {
    intent: { contentType?: string; objective?: string; platform?: string; campaignId?: string };
    audience?: string;
  }): Promise<PIPResponse<GroundedContext>>;
}

// ── Signal (Phase 3) ─────────────────────────────────────────────────────────
export type SignalKind = string;
export interface Signal {
  kind: SignalKind;
  entityRef: EntityRef;
  value: Record<string, number>;
  observedAt: string;
  confidence: number;   // 0..1
  provenance: string;
  dedupKey: string;
}
export interface SignalService {
  ingest(req: PIPRequest & { signal: Signal }): Promise<PIPResponse<{ accepted: boolean }>>;
  stream(req: PIPRequest & { kind: SignalKind; since?: string }): AsyncIterable<Signal>;
}

// ── Learning (Phase 4) ───────────────────────────────────────────────────────
export interface Outcome { dimension: string; entityRef: EntityRef; signals: Record<string, number>; result: number }
export interface LearnedPattern {
  key: string; dimension: string; strength: number; sampleSize: number; confidence: number;
  explanation: Explanation[]; lifecycle: 'candidate' | 'promoted' | 'retired';
}
export interface LearningService {
  recordOutcome(req: PIPRequest & { outcome: Outcome }): Promise<PIPResponse<void>>;
  patterns(req: PIPRequest & { dimension: string; scope?: EntityRef }): Promise<PIPResponse<LearnedPattern[]>>;
}

// ── Recommendation (Phase 5) — the single canonical API ──────────────────────
export interface Action { type: string; params: Record<string, unknown> }
export interface Recommendation {
  id: string; nextBestAction: Action; score: number; rank: number;
  reasoning: Explanation[]; confidence: number;
}
export interface RecommendationService {
  recommend(req: PIPRequest & { surface: string; entityRef?: EntityRef; limit?: number }): Promise<PIPResponse<Recommendation[]>>;
}

// ── Ranking (Phase 4 svc) ────────────────────────────────────────────────────
export interface Rankable { id: string; features: Record<string, number> }
export interface Ranked { id: string; score: number; rank: number; reasoning: Explanation[] }
export interface RankingService {
  rank(req: PIPRequest & { items: Rankable[]; policy?: string }): Promise<PIPResponse<Ranked[]>>;
}

// ── Decision (Phase 6) ───────────────────────────────────────────────────────
export interface SafetyCheck { name: string; passed: boolean; note?: string }
export interface Decision {
  decisionId: string; verdict: 'allow' | 'hold' | 'reject'; policy: string;
  safety: SafetyCheck[]; requiresApproval: boolean; explanation: Explanation[];
}
export interface ExecutionResult { executed: boolean; note?: string }
export interface DecisionService {
  evaluate(req: PIPRequest & { candidate: Action; context?: EntityRef }): Promise<PIPResponse<Decision>>;
  execute(req: PIPRequest & { decisionId: string; approvedBy?: string }): Promise<PIPResponse<ExecutionResult>>;
}

// ── Insight (Phase 7) ────────────────────────────────────────────────────────
export interface Insight {
  headline: string; explanation: string; evidence: EvidenceRef[]; traceId: string;
  drilldown?: { service: PIPService; query: unknown };
}
export interface InsightService {
  render(req: PIPRequest & { scope: EntityRef; audience: 'dashboard' | 'report' }): Promise<PIPResponse<Insight[]>>;
}
