/**
 * PIP service skeletons + legacy-adapter framework + registry (PROD-IMPL-001,
 * Phases 1/4/8).
 *
 * Each service implements its PROD-SPEC-001 interface and composes the universal
 * runtime: flag OFF (default) → legacy adapter; flag ON → platform impl (not
 * migrated in the foundation → fail-open degrade). Legacy adapters are injected
 * (DI) — the Null* adapters are the safe defaults; migration waves inject
 * concrete adapters that wrap existing services (e.g. contentMemoryService,
 * campaignMemoryService, recommendationRuntime) WITHOUT modules calling the
 * platform directly. No business logic is migrated here.
 */
import type {
  MemoryService, MemoryContext, MemoryQuery, MemoryRecord, Unsubscribe,
  ContextService, GroundedContext,
  SignalService, Signal, SignalKind,
  LearningService, Outcome, LearnedPattern,
  RecommendationService, Recommendation,
  RankingService, Rankable, Ranked,
  DecisionService, Action, Decision, ExecutionResult, EntityRef,
  InsightService, Insight,
  PIPRequest, PIPResponse, PIPService,
} from './contracts';
import { runPIP, ok, isPIPEnabled } from './runtime';

const NOT_MIGRATED = () => { throw new Error('PIP platform implementation not present (foundation only — migrate the module)'); };

// ── Legacy adapter interfaces (plain data — the service wraps the envelope) ──
export interface MemoryLegacyAdapter {
  read(companyId: string, context: MemoryContext, query: MemoryQuery): Promise<MemoryRecord[]>;
  subscribe(companyId: string, context: MemoryContext, onChange: (r: MemoryRecord) => void): Unsubscribe;
}
export interface ContextLegacyAdapter { resolve(companyId: string, intent: Record<string, unknown>, audience?: string): Promise<GroundedContext>; }
export interface SignalLegacyAdapter {
  ingest(companyId: string, signal: Signal): Promise<boolean>;
  stream(companyId: string, kind: SignalKind, since?: string): AsyncIterable<Signal>;
}
export interface LearningLegacyAdapter {
  recordOutcome(companyId: string, outcome: Outcome): Promise<void>;
  patterns(companyId: string, dimension: string, scope?: EntityRef): Promise<LearnedPattern[]>;
}
export interface RecommendationLegacyAdapter { recommend(companyId: string, surface: string, entityRef?: EntityRef, limit?: number): Promise<Recommendation[]>; }
export interface RankingLegacyAdapter { rank(companyId: string, items: Rankable[], policy?: string): Promise<Ranked[]>; }
export interface DecisionLegacyAdapter {
  evaluate(companyId: string, candidate: Action, context?: EntityRef): Promise<Decision>;
  execute(companyId: string, decisionId: string, approvedBy?: string): Promise<ExecutionResult>;
}
export interface InsightLegacyAdapter { render(companyId: string, scope: EntityRef, audience: 'dashboard' | 'report'): Promise<Insight[]>; }

// ── Null adapters — safe, deterministic empties (the default until migration) ─
const EMPTY_STREAM: AsyncIterable<Signal> = { async *[Symbol.asyncIterator]() { /* empty */ } };
export const NullMemoryAdapter: MemoryLegacyAdapter = { async read() { return []; }, subscribe() { return () => {}; } };
export const NullContextAdapter: ContextLegacyAdapter = { async resolve() { return { company: {} }; } };
export const NullSignalAdapter: SignalLegacyAdapter = { async ingest() { return false; }, stream() { return EMPTY_STREAM; } };
export const NullLearningAdapter: LearningLegacyAdapter = { async recordOutcome() { /* no-op */ }, async patterns() { return []; } };
export const NullRecommendationAdapter: RecommendationLegacyAdapter = { async recommend() { return []; } };
export const NullRankingAdapter: RankingLegacyAdapter = { async rank() { return []; } };
export const NullDecisionAdapter: DecisionLegacyAdapter = {
  async evaluate() { return { decisionId: '', verdict: 'hold', policy: 'none', safety: [], requiresApproval: true, explanation: [] }; },
  async execute() { return { executed: false }; },
};
export const NullInsightAdapter: InsightLegacyAdapter = { async render() { return []; } };

// ── Service skeletons ────────────────────────────────────────────────────────
export class PIPMemoryService implements MemoryService {
  constructor(private adapter: MemoryLegacyAdapter = NullMemoryAdapter) {}
  read(req: PIPRequest & { context: MemoryContext; query: MemoryQuery }): Promise<PIPResponse<MemoryRecord[]>> {
    return runPIP('memory', 'read', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.read(req.companyId, req.context, req.query), 'legacy-adapter') }, []);
  }
  subscribe(req: PIPRequest & { context: MemoryContext; onChange: (r: MemoryRecord) => void }): Unsubscribe {
    if (!req.companyId || isPIPEnabled('memory')) return () => {};
    try { return this.adapter.subscribe(req.companyId, req.context, req.onChange); } catch { return () => {}; }
  }
}

export class PIPContextService implements ContextService {
  constructor(private adapter: ContextLegacyAdapter = NullContextAdapter) {}
  resolve(req: PIPRequest & { intent: Record<string, unknown>; audience?: string }): Promise<PIPResponse<GroundedContext>> {
    return runPIP('context', 'resolve', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.resolve(req.companyId, req.intent, req.audience), 'legacy-adapter') }, { company: {} });
  }
}

export class PIPSignalService implements SignalService {
  constructor(private adapter: SignalLegacyAdapter = NullSignalAdapter) {}
  ingest(req: PIPRequest & { signal: Signal }): Promise<PIPResponse<{ accepted: boolean }>> {
    return runPIP('signal', 'ingest', req,
      { platform: NOT_MIGRATED, legacy: async () => ok({ accepted: await this.adapter.ingest(req.companyId, req.signal) }, 'legacy-adapter') }, { accepted: false });
  }
  async *stream(req: PIPRequest & { kind: SignalKind; since?: string }): AsyncIterable<Signal> {
    if (!req.companyId || isPIPEnabled('signal')) return;
    try { yield* this.adapter.stream(req.companyId, req.kind, req.since); } catch { /* fail-open */ }
  }
}

export class PIPLearningService implements LearningService {
  constructor(private adapter: LearningLegacyAdapter = NullLearningAdapter) {}
  recordOutcome(req: PIPRequest & { outcome: Outcome }): Promise<PIPResponse<void>> {
    return runPIP('learning', 'recordOutcome', req,
      { platform: NOT_MIGRATED, legacy: async () => { await this.adapter.recordOutcome(req.companyId, req.outcome); return ok(undefined as void, 'legacy-adapter'); } }, undefined as void);
  }
  patterns(req: PIPRequest & { dimension: string; scope?: EntityRef }): Promise<PIPResponse<LearnedPattern[]>> {
    return runPIP('learning', 'patterns', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.patterns(req.companyId, req.dimension, req.scope), 'legacy-adapter') }, []);
  }
}

export class PIPRecommendationService implements RecommendationService {
  constructor(private adapter: RecommendationLegacyAdapter = NullRecommendationAdapter) {}
  recommend(req: PIPRequest & { surface: string; entityRef?: EntityRef; limit?: number }): Promise<PIPResponse<Recommendation[]>> {
    return runPIP('recommendation', 'recommend', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.recommend(req.companyId, req.surface, req.entityRef, req.limit), 'legacy-adapter') }, []);
  }
}

export class PIPRankingService implements RankingService {
  constructor(private adapter: RankingLegacyAdapter = NullRankingAdapter) {}
  rank(req: PIPRequest & { items: Rankable[]; policy?: string }): Promise<PIPResponse<Ranked[]>> {
    return runPIP('ranking', 'rank', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.rank(req.companyId, req.items, req.policy), 'legacy-adapter') }, []);
  }
}

export class PIPDecisionService implements DecisionService {
  constructor(private adapter: DecisionLegacyAdapter = NullDecisionAdapter) {}
  evaluate(req: PIPRequest & { candidate: Action; context?: EntityRef }): Promise<PIPResponse<Decision>> {
    return runPIP('decision', 'evaluate', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.evaluate(req.companyId, req.candidate, req.context), 'legacy-adapter') },
      { decisionId: '', verdict: 'hold', policy: 'none', safety: [], requiresApproval: true, explanation: [] });
  }
  execute(req: PIPRequest & { decisionId: string; approvedBy?: string }): Promise<PIPResponse<ExecutionResult>> {
    return runPIP('decision', 'execute', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.execute(req.companyId, req.decisionId, req.approvedBy), 'legacy-adapter') }, { executed: false });
  }
}

export class PIPInsightService implements InsightService {
  constructor(private adapter: InsightLegacyAdapter = NullInsightAdapter) {}
  render(req: PIPRequest & { scope: EntityRef; audience: 'dashboard' | 'report' }): Promise<PIPResponse<Insight[]>> {
    return runPIP('insight', 'render', req,
      { platform: NOT_MIGRATED, legacy: async () => ok(await this.adapter.render(req.companyId, req.scope, req.audience), 'legacy-adapter') }, []);
  }
}

// ── Registry / DI (Phase 8) — resolve a service by name; register real
//    adapters during migration waves. Defaults to Null adapters (inert). ──────
export interface PIPRegistry {
  memory: MemoryService; context: ContextService; signal: SignalService; learning: LearningService;
  recommendation: RecommendationService; ranking: RankingService; decision: DecisionService; insight: InsightService;
}
export function createPIPRegistry(adapters: Partial<{
  memory: MemoryLegacyAdapter; context: ContextLegacyAdapter; signal: SignalLegacyAdapter; learning: LearningLegacyAdapter;
  recommendation: RecommendationLegacyAdapter; ranking: RankingLegacyAdapter; decision: DecisionLegacyAdapter; insight: InsightLegacyAdapter;
}> = {}): PIPRegistry {
  return {
    memory: new PIPMemoryService(adapters.memory),
    context: new PIPContextService(adapters.context),
    signal: new PIPSignalService(adapters.signal),
    learning: new PIPLearningService(adapters.learning),
    recommendation: new PIPRecommendationService(adapters.recommendation),
    ranking: new PIPRankingService(adapters.ranking),
    decision: new PIPDecisionService(adapters.decision),
    insight: new PIPInsightService(adapters.insight),
  };
}

/** The default registry — all Null adapters, all flags OFF ⇒ completely inert. */
export const pip: PIPRegistry = createPIPRegistry();

export const PIP_SERVICES: readonly PIPService[] = ['memory', 'context', 'signal', 'learning', 'recommendation', 'ranking', 'decision', 'insight'];
