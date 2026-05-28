/**
 * autonomousPromotionCoordinator.ts
 *
 * Phase 9.5 — Auto-applies safe promotions / demotions on the
 * enforcement ladder without operator intervention.
 *
 * Safety rules:
 *   - production: staged rollout only (small mode steps, conservative
 *     cooldown), promotion percentage cap, auto-demotion ALWAYS allowed
 *   - non-prod: more aggressive promotion permitted
 *   - rollback freezes BLOCK promotion (demotion still flows)
 *   - global cooldown BLOCKS promotion
 *   - per-type cooldown BLOCKS that type's promotion
 *
 * Two operating modes:
 *   - GLOBAL  : promotes/demotes the global env mode
 *   - PER_TYPE: independently promotes/demotes each content type
 *
 * Per-request emits LONGFORM_AUTONOMOUS_PROMOTION audit telemetry.
 */

import {
  evaluatePromotionEngine,
  applyPromotionResult,
  type PromotionExecutionResult,
} from './enforcementPromotionEngine';
import { isPromotionFrozen } from './enforcementRollbackGuard';
import {
  promoteContentType,
  demoteContentType,
  resolvePerContentTypeMode,
  TRACKED_CONTENT_TYPES,
  type TrackedContentType,
  type TransitionResult,
} from './contentTypeEnforcementManager';
import { resolveEnforcementMode, evaluateEnforcementPromotion } from './plannedEngineEnforcementMode';
import { persistEnforcementTransition, persistPromotionState } from './operationalStatePersistence';

// ── Public types ─────────────────────────────────────────────────────────────

export type AutonomousMode = 'GLOBAL' | 'PER_TYPE';

export type AutonomousResolution =
  | 'request_override'
  | 'env_set'
  | 'env_disabled'
  | 'default_disabled';

export interface AutonomousResolutionResult {
  enabled: boolean;
  mode: AutonomousMode;
  productionStaged: boolean;
  reason: AutonomousResolution;
}

export interface AutonomousPromotionAuditEntry {
  timestamp: string;
  scope: 'global' | 'per_type';
  content_type: string | null;
  fromMode: string;
  toMode: string;
  direction: 'promote' | 'hold' | 'demote';
  applied: boolean;
  blocked_reason: string | null;
  confidence: 'low' | 'moderate' | 'high';
  reasoning: string[];
}

// ── Env resolution ──────────────────────────────────────────────────────────

export function resolveAutonomousMode(perRequest?: boolean): AutonomousResolutionResult {
  if (typeof perRequest === 'boolean') {
    return {
      enabled: perRequest,
      mode: 'GLOBAL',
      productionStaged: process.env.NODE_ENV === 'production',
      reason: 'request_override',
    };
  }
  const env = (process.env.AUTONOMOUS_PROMOTION_MODE ?? '').toUpperCase().trim();
  if (env === 'GLOBAL' || env === 'PER_TYPE') {
    return {
      enabled: true,
      mode: env === 'PER_TYPE' ? 'PER_TYPE' : 'GLOBAL',
      productionStaged: process.env.NODE_ENV === 'production',
      reason: 'env_set',
    };
  }
  if (env === 'OFF' || env === '') {
    return {
      enabled: false,
      mode: 'GLOBAL',
      productionStaged: process.env.NODE_ENV === 'production',
      reason: env === 'OFF' ? 'env_disabled' : 'default_disabled',
    };
  }
  return {
    enabled: false,
    mode: 'GLOBAL',
    productionStaged: process.env.NODE_ENV === 'production',
    reason: 'default_disabled',
  };
}

// ── Audit log ───────────────────────────────────────────────────────────────

const auditLog: AutonomousPromotionAuditEntry[] = [];
const AUDIT_CAP = 200;

function emitAndAppendAudit(entry: AutonomousPromotionAuditEntry): void {
  console.log(`[longform-autonomous-promotion] ${JSON.stringify({
    event: 'LONGFORM_AUTONOMOUS_PROMOTION',
    ...entry,
  })}`);
  auditLog.push(entry);
  while (auditLog.length > AUDIT_CAP) auditLog.shift();
}

// ── Global mode coordinator ─────────────────────────────────────────────────

function runGlobalCoordinator(productionStaged: boolean): AutonomousPromotionAuditEntry {
  const decision = evaluatePromotionEngine();

  // ── Safety blocks ────────────────────────────────────────────────────
  // Rollback freeze blocks promotion (but never demotion).
  if (decision.report.decision === 'promote' && isPromotionFrozen()) {
    const entry: AutonomousPromotionAuditEntry = {
      timestamp: new Date().toISOString(),
      scope: 'global',
      content_type: null,
      fromMode: decision.report.fromMode,
      toMode: decision.report.fromMode,
      direction: 'hold',
      applied: false,
      blocked_reason: 'rollback_freeze_active',
      confidence: decision.report.confidence,
      reasoning: ['Promotion blocked by rollback freeze.'],
    };
    emitAndAppendAudit(entry);
    return entry;
  }

  // Production staging: only allow ONE step at a time + require high confidence.
  if (productionStaged && decision.report.decision === 'promote' && decision.report.confidence !== 'high') {
    const entry: AutonomousPromotionAuditEntry = {
      timestamp: new Date().toISOString(),
      scope: 'global',
      content_type: null,
      fromMode: decision.report.fromMode,
      toMode: decision.report.fromMode,
      direction: 'hold',
      applied: false,
      blocked_reason: `production_staging_requires_high_confidence_got_${decision.report.confidence}`,
      confidence: decision.report.confidence,
      reasoning: ['Production staging: high confidence required for promotion.'],
    };
    emitAndAppendAudit(entry);
    return entry;
  }

  // ── Apply ────────────────────────────────────────────────────────────
  if (decision.shouldApply) {
    applyPromotionResult(decision);
    persistPromotionState({
      current_mode: decision.report.toMode,
      cooldown_until: decision.cooldownUntilTimestamp ?? null,
      recent_history: [{
        timestamp: decision.appliedAtTimestamp ?? new Date().toISOString(),
        fromMode: decision.report.fromMode,
        toMode: decision.report.toMode,
        direction: decision.report.decision,
        confidence: decision.report.confidence,
      }],
    });
    persistEnforcementTransition({
      fromMode: decision.report.fromMode,
      toMode: decision.report.toMode,
      direction: decision.report.decision,
      confidence: decision.report.confidence,
      applied_by: 'autonomous',
      rationale: decision.report.reasoning.join(' '),
    });
    const entry: AutonomousPromotionAuditEntry = {
      timestamp: new Date().toISOString(),
      scope: 'global',
      content_type: null,
      fromMode: decision.report.fromMode,
      toMode: decision.report.toMode,
      direction: decision.report.decision,
      applied: true,
      blocked_reason: null,
      confidence: decision.report.confidence,
      reasoning: decision.report.reasoning,
    };
    emitAndAppendAudit(entry);
    return entry;
  }
  // shouldApply=false → hold
  const entry: AutonomousPromotionAuditEntry = {
    timestamp: new Date().toISOString(),
    scope: 'global',
    content_type: null,
    fromMode: decision.report.fromMode,
    toMode: decision.report.toMode,
    direction: 'hold',
    applied: false,
    blocked_reason: decision.report.blockers[0] ?? 'no_promotion_recommended',
    confidence: decision.report.confidence,
    reasoning: decision.report.reasoning,
  };
  emitAndAppendAudit(entry);
  return entry;
}

// ── Per-type mode coordinator ───────────────────────────────────────────────

function runPerTypeCoordinator(productionStaged: boolean): AutonomousPromotionAuditEntry[] {
  const entries: AutonomousPromotionAuditEntry[] = [];

  for (const contentType of TRACKED_CONTENT_TYPES) {
    const perTypeRes = resolvePerContentTypeMode(contentType);
    const baseDecision = evaluateEnforcementPromotion({ currentMode: perTypeRes.perTypeMode });

    // Same safety checks as global coordinator.
    if (baseDecision.direction === 'promote' && isPromotionFrozen()) {
      entries.push(holdEntry(contentType, perTypeRes.perTypeMode, 'rollback_freeze_active', baseDecision.confidence));
      continue;
    }
    if (productionStaged && baseDecision.direction === 'promote' && baseDecision.confidence !== 'high') {
      entries.push(holdEntry(contentType, perTypeRes.perTypeMode, `production_staging_requires_high_confidence_got_${baseDecision.confidence}`, baseDecision.confidence));
      continue;
    }

    if (baseDecision.direction === 'promote') {
      const result = promoteContentType({ contentType, confidence: baseDecision.confidence });
      entries.push(applyTransitionAudit(contentType, result, baseDecision.confidence, baseDecision.reasoning));
      if (result.applied) {
        persistEnforcementTransition({
          fromMode: result.fromMode,
          toMode: result.toMode,
          direction: 'promote',
          confidence: baseDecision.confidence,
          applied_by: 'autonomous',
          rationale: `per-type promotion for ${contentType}: ${baseDecision.reasoning.join(' ')}`,
        });
      }
    } else if (baseDecision.direction === 'demote') {
      // Demotion ALWAYS allowed.
      const result = demoteContentType({ contentType, confidence: baseDecision.confidence });
      entries.push(applyTransitionAudit(contentType, result, baseDecision.confidence, baseDecision.reasoning));
      if (result.applied) {
        persistEnforcementTransition({
          fromMode: result.fromMode,
          toMode: result.toMode,
          direction: 'demote',
          confidence: baseDecision.confidence,
          applied_by: 'autonomous',
          rationale: `per-type demotion for ${contentType}: ${baseDecision.reasoning.join(' ')}`,
        });
      }
    } else {
      entries.push(holdEntry(contentType, perTypeRes.perTypeMode, 'no_promotion_recommended', baseDecision.confidence));
    }
  }
  for (const e of entries) emitAndAppendAudit(e);
  return entries;
}

function holdEntry(
  contentType: TrackedContentType,
  mode: string,
  reason: string,
  confidence: 'low' | 'moderate' | 'high',
): AutonomousPromotionAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    scope: 'per_type',
    content_type: contentType,
    fromMode: mode,
    toMode: mode,
    direction: 'hold',
    applied: false,
    blocked_reason: reason,
    confidence,
    reasoning: [reason],
  };
}

function applyTransitionAudit(
  contentType: TrackedContentType,
  result: TransitionResult,
  confidence: 'low' | 'moderate' | 'high',
  reasoning: string[],
): AutonomousPromotionAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    scope: 'per_type',
    content_type: contentType,
    fromMode: result.fromMode,
    toMode: result.toMode,
    direction: result.direction,
    applied: result.applied,
    blocked_reason: result.blocked === 'cooldown' ? 'per_type_cooldown' : null,
    confidence,
    reasoning,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RunAutonomousPromotionInput {
  /** Override the env-resolved mode. */
  perRequestEnabled?: boolean;
  /** Force PER_TYPE mode (otherwise reads env). */
  scope?: AutonomousMode;
}

export interface RunAutonomousPromotionResult {
  resolution: AutonomousResolutionResult;
  globalEntry: AutonomousPromotionAuditEntry | null;
  perTypeEntries: AutonomousPromotionAuditEntry[];
}

export function runAutonomousPromotionCycle(input: RunAutonomousPromotionInput = {}): RunAutonomousPromotionResult {
  const resolution = resolveAutonomousMode(input.perRequestEnabled);
  if (!resolution.enabled) {
    return { resolution, globalEntry: null, perTypeEntries: [] };
  }
  const scope = input.scope ?? resolution.mode;
  if (scope === 'GLOBAL') {
    return { resolution, globalEntry: runGlobalCoordinator(resolution.productionStaged), perTypeEntries: [] };
  }
  return { resolution, globalEntry: null, perTypeEntries: runPerTypeCoordinator(resolution.productionStaged) };
}

// ── Audit / state ─────────────────────────────────────────────────────────

export interface AutonomousPromotionAudit {
  total_audits: number;
  applied_count: number;
  blocked_count: number;
  by_block_reason: Array<{ reason: string; count: number }>;
  recent: AutonomousPromotionAuditEntry[];
}

export function getAutonomousPromotionAudit(): AutonomousPromotionAudit {
  const blockCounts = new Map<string, number>();
  let applied = 0;
  let blocked = 0;
  for (const e of auditLog) {
    if (e.applied) applied += 1;
    else if (e.blocked_reason) {
      blocked += 1;
      blockCounts.set(e.blocked_reason, (blockCounts.get(e.blocked_reason) ?? 0) + 1);
    }
  }
  return {
    total_audits: auditLog.length,
    applied_count: applied,
    blocked_count: blocked,
    by_block_reason: Array.from(blockCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => ({ reason, count })),
    recent: auditLog.slice(-25),
  };
}

export function __resetAutonomousPromotionForTests(): void {
  auditLog.length = 0;
}
