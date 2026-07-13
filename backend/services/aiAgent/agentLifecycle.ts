/**
 * agentLifecycle.ts — deterministic agent lifecycle (AIA-001 §3).
 *
 * ONE state machine for every agent. Illegal transitions are impossible; the
 * machine is deterministic and replayable (no clock/randomness). Mirrors the
 * proven CKRE lifecycle pattern (frozen transition table + guard assertions).
 *
 *   CREATED → PLANNING → READY → RUNNING → WAITING → RESUMING → COMPLETED
 *   with terminal FAILED / CANCELLED and recoverable BLOCKED.
 */

import type { AgentState } from './agentContracts';

export const AGENT_STATES: ReadonlyArray<AgentState> = [
  'CREATED', 'PLANNING', 'READY', 'RUNNING', 'WAITING', 'RESUMING',
  'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED',
];

const TRANSITIONS: Readonly<Record<AgentState, ReadonlyArray<AgentState>>> = {
  CREATED:   ['PLANNING', 'CANCELLED'],
  PLANNING:  ['READY', 'FAILED', 'BLOCKED', 'CANCELLED'],
  READY:     ['RUNNING', 'CANCELLED'],
  RUNNING:   ['WAITING', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'],
  WAITING:   ['RESUMING', 'CANCELLED', 'FAILED'],
  RESUMING:  ['RUNNING', 'FAILED', 'CANCELLED'],
  BLOCKED:   ['RESUMING', 'RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED:    [],
  CANCELLED: [],
};

export function canAgentTransition(from: AgentState, to: AgentState): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertAgentTransition(from: AgentState, to: AgentState): void {
  if (!canAgentTransition(from, to)) {
    throw new Error(`ILLEGAL_AGENT_TRANSITION:${from}->${to}`);
  }
}

export function isTerminal(state: AgentState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
}

/** Next states legal from a given state (for the operational model / tests). */
export function nextStates(from: AgentState): ReadonlyArray<AgentState> {
  return TRANSITIONS[from] ?? [];
}
