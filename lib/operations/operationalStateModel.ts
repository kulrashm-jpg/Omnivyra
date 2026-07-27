/**
 * LC-201 (W2) — Operational State Model (pure, configurable, entity-agnostic).
 *
 * The canonical operational lifecycle every lead-like entity moves through. It is a
 * CONFIG, not hardcoded business logic: callers may pass a custom `StateModelConfig`
 * (states + transitions + terminal set) and the engine validates against it. The
 * default models a generic GTM lifecycle; nothing here is CRM- or tenant-specific.
 *
 * Reused by the operational core service (validation), the mutation API, and any
 * future wave (Audience/Campaign/Autonomous GTM) that needs lifecycle validation.
 */

export type OperationalState =
  | 'new'
  | 'qualified'
  | 'working'
  | 'meeting_scheduled'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'archived';

export interface StateModelConfig {
  states: readonly string[];
  /** from → allowed next states. A state absent from the map is treated as terminal. */
  transitions: Record<string, readonly string[]>;
  initial: string;
  terminal: readonly string[];
}

export const DEFAULT_STATE_MODEL: StateModelConfig = {
  states: ['new', 'qualified', 'working', 'meeting_scheduled', 'proposal', 'won', 'lost', 'archived'],
  initial: 'new',
  terminal: ['won', 'lost', 'archived'],
  transitions: {
    new: ['qualified', 'working', 'lost', 'archived'],
    qualified: ['working', 'meeting_scheduled', 'lost', 'archived'],
    working: ['meeting_scheduled', 'proposal', 'qualified', 'lost', 'archived'],
    meeting_scheduled: ['proposal', 'working', 'won', 'lost', 'archived'],
    proposal: ['won', 'lost', 'working', 'archived'],
    // Terminal states may still be re-opened to 'working' or moved to 'archived'.
    won: ['archived'],
    lost: ['working', 'archived'],
    archived: ['working'],
  },
};

/** Campaign lifecycle (draft → active → paused → completed/archived). */
export const CAMPAIGN_STATE_MODEL: StateModelConfig = {
  states: ['draft', 'active', 'paused', 'completed', 'archived'],
  initial: 'draft',
  terminal: ['completed', 'archived'],
  transitions: {
    draft: ['active', 'archived'],
    active: ['paused', 'completed', 'archived'],
    paused: ['active', 'completed', 'archived'],
    completed: ['archived'],
    archived: ['active'],
  },
};

/** Audience lifecycle (lighter). */
export const AUDIENCE_STATE_MODEL: StateModelConfig = {
  states: ['draft', 'active', 'paused', 'archived'],
  initial: 'draft',
  terminal: ['archived'],
  transitions: { draft: ['active', 'archived'], active: ['paused', 'archived'], paused: ['active', 'archived'], archived: ['active'] },
};

/** Select the state model for an entity type. The operational core stays ONE engine;
 *  only the transition config differs per entity — no duplicate state machine. */
export function modelForEntity(entityType: string): StateModelConfig {
  if (entityType === 'gtm_campaign') return CAMPAIGN_STATE_MODEL;
  if (entityType === 'audience') return AUDIENCE_STATE_MODEL;
  return DEFAULT_STATE_MODEL; // canonical_lead / opportunity / default
}

export function isKnownState(state: string, config: StateModelConfig = DEFAULT_STATE_MODEL): boolean {
  return config.states.includes(state);
}

export function isTerminalState(state: string, config: StateModelConfig = DEFAULT_STATE_MODEL): boolean {
  return config.terminal.includes(state);
}

export function allowedTransitions(from: string, config: StateModelConfig = DEFAULT_STATE_MODEL): readonly string[] {
  return config.transitions[from] ?? [];
}

export interface TransitionCheck {
  ok: boolean;
  reason?: 'unknown_from' | 'unknown_to' | 'not_allowed' | 'same_state';
}

/** Validate a status transition against the (default or custom) state model. Pure. */
export function validateTransition(from: string | null | undefined, to: string, config: StateModelConfig = DEFAULT_STATE_MODEL): TransitionCheck {
  if (!isKnownState(to, config)) return { ok: false, reason: 'unknown_to' };
  // No prior state (first assignment of a status) → any known state is allowed.
  if (from == null || from === '') return { ok: true };
  if (!isKnownState(from, config)) return { ok: false, reason: 'unknown_from' };
  if (from === to) return { ok: false, reason: 'same_state' };
  if (!allowedTransitions(from, config).includes(to)) return { ok: false, reason: 'not_allowed' };
  return { ok: true };
}
