/**
 * operationalStatePersistence.ts
 *
 * Phase 9.2 — Durable persistence for in-process governance state that
 * MUST survive process restarts:
 *
 *   - promotion cooldowns      (so a restart doesn't bypass the 24h window)
 *   - rollback freeze windows  (so we don't re-promote during a freeze)
 *   - self-healing actions     (so transient stabilizers don't reset)
 *   - trend history            (so the analyzer has historical samples)
 *   - convergence history      (so convergenceRate is meaningful after restart)
 *   - enforcement transitions  (so the audit log is durable)
 *   - active stabilization overrides
 *
 * Provider interface mirrors the Phase 6.5 BenchmarkPersistenceProvider
 * pattern: a default in-memory implementation (good enough for tests) +
 * a swappable real backend (Supabase, KV store, file-system, etc.)
 * registered at boot via `setOperationalStatePersistenceProvider()`.
 *
 * On boot, a single call to `restoreOperationalStateOnBoot()` rehydrates
 * every subsystem.
 */

import type { PlannedEngineEnforcementMode } from './plannedEngineEnforcementMode';

// ── Public record schemas ────────────────────────────────────────────────────

export interface PromotionStateRecord {
  record_id: string;
  recorded_at: string;
  current_mode: PlannedEngineEnforcementMode | null;
  cooldown_until: string | null;
  recent_history: Array<{
    timestamp: string;
    fromMode: PlannedEngineEnforcementMode;
    toMode: PlannedEngineEnforcementMode;
    direction: 'promote' | 'hold' | 'demote';
    confidence: 'low' | 'moderate' | 'high';
  }>;
}

export interface RollbackFreezeRecord {
  record_id: string;
  recorded_at: string;
  freeze_until: string | null;
  baseline_mode: PlannedEngineEnforcementMode | null;
  baseline_snapshot_at: string | null;
  recent_rollbacks: Array<{
    triggered_at: string;
    fromMode: PlannedEngineEnforcementMode;
    toMode: PlannedEngineEnforcementMode;
    triggers: string[];
  }>;
}

export interface SelfHealingStateRecord {
  record_id: string;
  recorded_at: string;
  active_actions: Array<{
    action_id: string;
    trigger: string;
    correctiveAction: string;
    targetContentTypes: string[];
    activatedAt: string;
    expiresAt: string;
    triggerDetail: string;
    rollbackCondition: string;
  }>;
}

export interface ConvergenceTrendRecord {
  record_id: string;
  recorded_at: string;
  samples: Array<{
    recorded_at: string;
    content_type: string;
    topic: string;
    company_id: string | null;
    convergenceScore: number;
    shipRecommendation: string;
  }>;
}

export interface EnforcementTransitionRecord {
  record_id: string;
  recorded_at: string;
  fromMode: PlannedEngineEnforcementMode;
  toMode: PlannedEngineEnforcementMode;
  direction: 'promote' | 'hold' | 'demote';
  confidence: 'low' | 'moderate' | 'high';
  applied_by: 'autonomous' | 'manual' | 'rollback';
  rationale: string;
}

// ── Provider interface ───────────────────────────────────────────────────────

export interface OperationalStatePersistenceProvider {
  savePromotionState(record: PromotionStateRecord): Promise<void>;
  saveRollbackFreeze(record: RollbackFreezeRecord): Promise<void>;
  saveSelfHealingState(record: SelfHealingStateRecord): Promise<void>;
  saveConvergenceTrend(record: ConvergenceTrendRecord): Promise<void>;
  saveEnforcementTransition(record: EnforcementTransitionRecord): Promise<void>;

  loadLatestPromotionState(): Promise<PromotionStateRecord | null>;
  loadLatestRollbackFreeze(): Promise<RollbackFreezeRecord | null>;
  loadLatestSelfHealingState(): Promise<SelfHealingStateRecord | null>;
  loadLatestConvergenceTrend(): Promise<ConvergenceTrendRecord | null>;
  loadRecentEnforcementTransitions(limit?: number): Promise<EnforcementTransitionRecord[]>;
}

// ── In-memory default implementation ─────────────────────────────────────────

class InMemoryOperationalStatePersistence implements OperationalStatePersistenceProvider {
  private latestPromotion: PromotionStateRecord | null = null;
  private latestRollback: RollbackFreezeRecord | null = null;
  private latestHealing: SelfHealingStateRecord | null = null;
  private latestTrend: ConvergenceTrendRecord | null = null;
  private transitions: EnforcementTransitionRecord[] = [];

  async savePromotionState(record: PromotionStateRecord): Promise<void>            { this.latestPromotion = record; }
  async saveRollbackFreeze(record: RollbackFreezeRecord): Promise<void>            { this.latestRollback = record; }
  async saveSelfHealingState(record: SelfHealingStateRecord): Promise<void>        { this.latestHealing = record; }
  async saveConvergenceTrend(record: ConvergenceTrendRecord): Promise<void>        { this.latestTrend = record; }
  async saveEnforcementTransition(record: EnforcementTransitionRecord): Promise<void> {
    this.transitions.push(record);
    while (this.transitions.length > 200) this.transitions.shift();
  }

  async loadLatestPromotionState(): Promise<PromotionStateRecord | null>            { return this.latestPromotion; }
  async loadLatestRollbackFreeze(): Promise<RollbackFreezeRecord | null>            { return this.latestRollback; }
  async loadLatestSelfHealingState(): Promise<SelfHealingStateRecord | null>        { return this.latestHealing; }
  async loadLatestConvergenceTrend(): Promise<ConvergenceTrendRecord | null>        { return this.latestTrend; }
  async loadRecentEnforcementTransitions(limit = 50): Promise<EnforcementTransitionRecord[]> {
    return this.transitions.slice(-limit);
  }

  __resetForTests(): void {
    this.latestPromotion = null;
    this.latestRollback = null;
    this.latestHealing = null;
    this.latestTrend = null;
    this.transitions = [];
  }
}

// ── Provider registry ───────────────────────────────────────────────────────

let activeProvider: OperationalStatePersistenceProvider = new InMemoryOperationalStatePersistence();

export function setOperationalStatePersistenceProvider(provider: OperationalStatePersistenceProvider): void {
  activeProvider = provider;
}

export function getOperationalStatePersistenceProvider(): OperationalStatePersistenceProvider {
  return activeProvider;
}

// ── Fire-and-forget save helpers ────────────────────────────────────────────

function stableId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emitFailure(surface: string, err: unknown): void {
  console.warn(`[longform-state-persist-failure] ${JSON.stringify({
    event: 'LONGFORM_STATE_PERSIST_FAILURE',
    surface,
    error_message: err instanceof Error ? err.message : String(err),
    timestamp: new Date().toISOString(),
  })}`);
}

export function persistPromotionState(input: Omit<PromotionStateRecord, 'record_id' | 'recorded_at'>): void {
  const record: PromotionStateRecord = { record_id: stableId('promo'), recorded_at: new Date().toISOString(), ...input };
  activeProvider.savePromotionState(record).catch((err) => emitFailure('promotion_state', err));
}

export function persistRollbackFreeze(input: Omit<RollbackFreezeRecord, 'record_id' | 'recorded_at'>): void {
  const record: RollbackFreezeRecord = { record_id: stableId('rollback'), recorded_at: new Date().toISOString(), ...input };
  activeProvider.saveRollbackFreeze(record).catch((err) => emitFailure('rollback_freeze', err));
}

export function persistSelfHealingState(input: Omit<SelfHealingStateRecord, 'record_id' | 'recorded_at'>): void {
  const record: SelfHealingStateRecord = { record_id: stableId('heal'), recorded_at: new Date().toISOString(), ...input };
  activeProvider.saveSelfHealingState(record).catch((err) => emitFailure('self_healing_state', err));
}

export function persistConvergenceTrend(input: Omit<ConvergenceTrendRecord, 'record_id' | 'recorded_at'>): void {
  const record: ConvergenceTrendRecord = { record_id: stableId('conv'), recorded_at: new Date().toISOString(), ...input };
  activeProvider.saveConvergenceTrend(record).catch((err) => emitFailure('convergence_trend', err));
}

export function persistEnforcementTransition(input: Omit<EnforcementTransitionRecord, 'record_id' | 'recorded_at'>): void {
  const record: EnforcementTransitionRecord = { record_id: stableId('trans'), recorded_at: new Date().toISOString(), ...input };
  activeProvider.saveEnforcementTransition(record).catch((err) => emitFailure('enforcement_transition', err));
}

// ── Boot restoration ────────────────────────────────────────────────────────

export interface RestoreOperationalStateResult {
  promotion_state: PromotionStateRecord | null;
  rollback_freeze: RollbackFreezeRecord | null;
  self_healing_state: SelfHealingStateRecord | null;
  convergence_trend: ConvergenceTrendRecord | null;
  recent_transitions: EnforcementTransitionRecord[];
  restored_at: string;
  /** True if any record was loaded — operator can act on it. */
  any_state_restored: boolean;
}

/**
 * Call this once at boot. Subsystems read from the returned object and
 * seed their own in-process state (cooldowns, freeze windows, trend
 * samples, …) WITHOUT the persistence module having to know about each
 * subsystem's API.
 */
export async function restoreOperationalStateOnBoot(): Promise<RestoreOperationalStateResult> {
  const [promotion, rollback, healing, trend, transitions] = await Promise.all([
    safeCall(() => activeProvider.loadLatestPromotionState(),       'promotion_state'),
    safeCall(() => activeProvider.loadLatestRollbackFreeze(),       'rollback_freeze'),
    safeCall(() => activeProvider.loadLatestSelfHealingState(),     'self_healing_state'),
    safeCall(() => activeProvider.loadLatestConvergenceTrend(),     'convergence_trend'),
    safeCall(() => activeProvider.loadRecentEnforcementTransitions(50), 'enforcement_transitions'),
  ]);
  const any = Boolean(promotion || rollback || healing || trend || (transitions && transitions.length > 0));
  return {
    promotion_state: promotion ?? null,
    rollback_freeze: rollback ?? null,
    self_healing_state: healing ?? null,
    convergence_trend: trend ?? null,
    recent_transitions: transitions ?? [],
    restored_at: new Date().toISOString(),
    any_state_restored: any,
  };
}

async function safeCall<T>(fn: () => Promise<T>, surface: string): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    emitFailure(surface, err);
    return null;
  }
}

// Test-only helpers.
export function __resetOperationalStatePersistenceForTests(): void {
  if (activeProvider instanceof InMemoryOperationalStatePersistence) {
    (activeProvider as InMemoryOperationalStatePersistence).__resetForTests();
  }
}
