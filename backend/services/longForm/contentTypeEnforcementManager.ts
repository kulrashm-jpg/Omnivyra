/**
 * contentTypeEnforcementManager.ts
 *
 * Phase 9.4 — Per-content-type enforcement ladder.
 *
 * The global enforcement mode is too coarse. Different content types
 * stabilize at different rates: blog might be ready for
 * PLANNED_REQUIRED_ALL while whitepaper is still in OBSERVE_ONLY.
 *
 * This module gives each content type an independent ladder position
 * with its own promotion / rollback / cooldown / readiness tracking.
 *
 * Resolution order:
 *   1. Per-content-type override (in this module's state)
 *   2. Global enforcement mode (from plannedEngineEnforcementMode)
 *
 * When the fallback path runs it consults `resolvePerContentTypeMode()`
 * which picks the more-restrictive of (per-type, global).
 */

import type { PlannedEngineEnforcementMode } from './plannedEngineEnforcementMode';
import { resolveEnforcementMode, applyEnforcementToFallback } from './plannedEngineEnforcementMode';

// ── Public types ─────────────────────────────────────────────────────────────

export const TRACKED_CONTENT_TYPES = [
  'blog',
  'article',
  'whitepaper',
  'newsletter',
  'guide',
  'story',
  'case-study',
] as const;

export type TrackedContentType = typeof TRACKED_CONTENT_TYPES[number];

export interface ContentTypeEnforcementState {
  content_type: string;
  mode: PlannedEngineEnforcementMode;
  cooldown_until: string | null;
  last_transition_at: string | null;
  last_transition_direction: 'promote' | 'hold' | 'demote' | null;
  recent_history: Array<{
    timestamp: string;
    fromMode: PlannedEngineEnforcementMode;
    toMode: PlannedEngineEnforcementMode;
    direction: 'promote' | 'hold' | 'demote';
    confidence: 'low' | 'moderate' | 'high';
  }>;
}

// ── Per-type state ──────────────────────────────────────────────────────────

interface State {
  perType: Map<string, ContentTypeEnforcementState>;
}

const state: State = {
  perType: new Map(),
};

function initStateFor(contentType: string): ContentTypeEnforcementState {
  return {
    content_type: contentType,
    mode: 'OBSERVE_ONLY',
    cooldown_until: null,
    last_transition_at: null,
    last_transition_direction: null,
    recent_history: [],
  };
}

function getOrInit(contentType: string): ContentTypeEnforcementState {
  let s = state.perType.get(contentType);
  if (!s) {
    s = initStateFor(contentType);
    state.perType.set(contentType, s);
  }
  return s;
}

// ── Mode resolution ─────────────────────────────────────────────────────────

const LADDER_ORDER: PlannedEngineEnforcementMode[] = [
  'OBSERVE_ONLY',
  'PREFER_PLANNED',
  'PLANNED_REQUIRED_NON_CRITICAL',
  'PLANNED_REQUIRED_ALL',
  'NO_COMPATIBILITY_CORE',
];

function moreRestrictive(a: PlannedEngineEnforcementMode, b: PlannedEngineEnforcementMode): PlannedEngineEnforcementMode {
  return LADDER_ORDER.indexOf(a) >= LADDER_ORDER.indexOf(b) ? a : b;
}

export interface ResolvePerContentTypeModeResult {
  effectiveMode: PlannedEngineEnforcementMode;
  perTypeMode: PlannedEngineEnforcementMode;
  globalMode: PlannedEngineEnforcementMode;
  resolution: 'per_type_override' | 'global' | 'consensus';
}

export function resolvePerContentTypeMode(contentType: string): ResolvePerContentTypeModeResult {
  const perTypeState = state.perType.get(contentType);
  const globalRes = resolveEnforcementMode();
  const perTypeMode = perTypeState?.mode ?? globalRes.mode;
  const effective = moreRestrictive(perTypeMode, globalRes.mode);
  return {
    effectiveMode: effective,
    perTypeMode,
    globalMode: globalRes.mode,
    resolution: perTypeMode === globalRes.mode
      ? 'consensus'
      : effective === perTypeMode ? 'per_type_override' : 'global',
  };
}

/** Convenience: returns the fallback decision honoring per-type overrides. */
export function applyPerContentTypeEnforcement(input: {
  contentType: string;
}) {
  const res = resolvePerContentTypeMode(input.contentType);
  const decision = applyEnforcementToFallback({ mode: res.effectiveMode, contentType: input.contentType });
  return { ...decision, resolution: res };
}

// ── Promotion / demotion / cooldown ─────────────────────────────────────────

const COOLDOWN_MS_AFTER_PROMOTE = 24 * 60 * 60 * 1000;
const COOLDOWN_MS_AFTER_DEMOTE  = 6  * 60 * 60 * 1000;

function ladderStep(mode: PlannedEngineEnforcementMode, delta: number): PlannedEngineEnforcementMode {
  const idx = LADDER_ORDER.indexOf(mode);
  const next = Math.max(0, Math.min(LADDER_ORDER.length - 1, idx + delta));
  return LADDER_ORDER[next];
}

export interface TransitionResult {
  applied: boolean;
  contentType: string;
  fromMode: PlannedEngineEnforcementMode;
  toMode: PlannedEngineEnforcementMode;
  direction: 'promote' | 'hold' | 'demote';
  blocked: 'cooldown' | null;
  cooldown_until: string | null;
}

export function promoteContentType(input: {
  contentType: string;
  confidence?: 'low' | 'moderate' | 'high';
  force?: boolean;
}): TransitionResult {
  const s = getOrInit(input.contentType);
  if (!input.force && s.cooldown_until && Date.now() < Date.parse(s.cooldown_until)) {
    return {
      applied: false,
      contentType: input.contentType,
      fromMode: s.mode,
      toMode: s.mode,
      direction: 'hold',
      blocked: 'cooldown',
      cooldown_until: s.cooldown_until,
    };
  }
  const fromMode = s.mode;
  const toMode = ladderStep(fromMode, 1);
  if (fromMode === toMode) {
    return {
      applied: false,
      contentType: input.contentType,
      fromMode,
      toMode,
      direction: 'hold',
      blocked: null,
      cooldown_until: s.cooldown_until,
    };
  }
  s.mode = toMode;
  s.cooldown_until = new Date(Date.now() + COOLDOWN_MS_AFTER_PROMOTE).toISOString();
  s.last_transition_at = new Date().toISOString();
  s.last_transition_direction = 'promote';
  s.recent_history.push({
    timestamp: s.last_transition_at,
    fromMode,
    toMode,
    direction: 'promote',
    confidence: input.confidence ?? 'moderate',
  });
  while (s.recent_history.length > 50) s.recent_history.shift();
  return {
    applied: true,
    contentType: input.contentType,
    fromMode,
    toMode,
    direction: 'promote',
    blocked: null,
    cooldown_until: s.cooldown_until,
  };
}

export function demoteContentType(input: {
  contentType: string;
  confidence?: 'low' | 'moderate' | 'high';
  force?: boolean;
}): TransitionResult {
  const s = getOrInit(input.contentType);
  // Demotion is ALWAYS allowed (safety preserved).
  const fromMode = s.mode;
  const toMode = ladderStep(fromMode, -1);
  if (fromMode === toMode) {
    return {
      applied: false,
      contentType: input.contentType,
      fromMode,
      toMode,
      direction: 'hold',
      blocked: null,
      cooldown_until: s.cooldown_until,
    };
  }
  s.mode = toMode;
  s.cooldown_until = new Date(Date.now() + COOLDOWN_MS_AFTER_DEMOTE).toISOString();
  s.last_transition_at = new Date().toISOString();
  s.last_transition_direction = 'demote';
  s.recent_history.push({
    timestamp: s.last_transition_at,
    fromMode,
    toMode,
    direction: 'demote',
    confidence: input.confidence ?? 'moderate',
  });
  while (s.recent_history.length > 50) s.recent_history.shift();
  return {
    applied: true,
    contentType: input.contentType,
    fromMode,
    toMode,
    direction: 'demote',
    blocked: null,
    cooldown_until: s.cooldown_until,
  };
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface PerContentTypeEnforcementSnapshot {
  global_mode: PlannedEngineEnforcementMode;
  global_reason: string;
  per_content_type: ContentTypeEnforcementState[];
  effective_per_content_type: Array<{
    content_type: string;
    effective_mode: PlannedEngineEnforcementMode;
    per_type_mode: PlannedEngineEnforcementMode;
    global_mode: PlannedEngineEnforcementMode;
    resolution: 'per_type_override' | 'global' | 'consensus';
  }>;
}

export function getPerContentTypeEnforcementSnapshot(): PerContentTypeEnforcementSnapshot {
  const globalRes = resolveEnforcementMode();
  const perTypeList = TRACKED_CONTENT_TYPES.map((ct) => getOrInit(ct));
  return {
    global_mode: globalRes.mode,
    global_reason: globalRes.reason,
    per_content_type: perTypeList,
    effective_per_content_type: TRACKED_CONTENT_TYPES.map((ct) => {
      const r = resolvePerContentTypeMode(ct);
      return { content_type: ct, effective_mode: r.effectiveMode, per_type_mode: r.perTypeMode, global_mode: r.globalMode, resolution: r.resolution };
    }),
  };
}

// ── Boot rehydration ───────────────────────────────────────────────────────

export function seedPerContentTypeStateFromHistory(history: Array<{
  content_type: string;
  mode: PlannedEngineEnforcementMode;
  cooldown_until: string | null;
  last_transition_at: string | null;
}>): void {
  for (const h of history) {
    const s = getOrInit(h.content_type);
    s.mode = h.mode;
    s.cooldown_until = h.cooldown_until;
    s.last_transition_at = h.last_transition_at;
  }
}

export function __resetPerContentTypeEnforcementForTests(): void {
  state.perType.clear();
}
