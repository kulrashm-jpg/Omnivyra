/**
 * agentContracts.ts — canonical AI-agent contracts (AIA-001 §3/§5/§6/§7).
 *
 * ONE request/plan/step/result/memory/checkpoint/approval vocabulary for every
 * agent. Agents ORCHESTRATE capabilities (AIC-001) — they never run inference,
 * assemble prompts, or read Company Knowledge directly. Pure types + deterministic
 * helpers only.
 */

import type { CapabilityId, CapabilityResult } from '../aiCapability/capabilityContracts';

/** Known first-class agents (extensible — any string is accepted). */
export type AgentId =
  | 'CAMPAIGN_AGENT'
  | 'CONTENT_AGENT'
  | 'WEBSITE_INTELLIGENCE_AGENT'
  | 'GROWTH_AGENT'
  | (string & {});

/** Deterministic agent lifecycle states (§3). */
export type AgentState =
  | 'CREATED'
  | 'PLANNING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'RESUMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'BLOCKED';

/** How a step's capability is orchestrated relative to siblings (§4). */
export type StepMode = 'single' | 'parallel' | 'sequential' | 'conditional' | 'fallback';

/** One planned unit of agent work — always executed through AIC-001. */
export interface AgentStep {
  id: string;
  capability: CapabilityId;
  mode: StepMode;
  /** Step ids that must complete before this runs (dependency ordering). */
  dependsOn: string[];
  /** Approval gate required before this step executes (§7). */
  requiresApproval: boolean;
  /** Named predicate (resolved against an injected predicate registry) for conditional steps. */
  when?: string;
  /** Capability to fall back to if this step's capability fails (§4/§8). */
  fallbackCapability?: CapabilityId;
  /** Static input merged into the capability request for this step. */
  input?: Record<string, unknown>;
}

export interface AgentPlan {
  steps: AgentStep[];
}

/** Approval outcomes (§7). */
export type ApprovalDecision = 'approved' | 'rejected' | 'timeout' | 'resubmit';

export interface ApprovalRecord {
  stepId: string;
  decision: ApprovalDecision;
  at: string;
  by?: string | null;
  note?: string | null;
}

/** Canonical agent memory (§5) — versioned, resumable. */
export interface AgentMemory {
  version: number;
  /** Immutable execution context (request-derived). */
  executionContext: Record<string, unknown>;
  /** Mutable working memory across steps. */
  workingMemory: Record<string, unknown>;
  /** Optional conversation state (multi-turn agents). */
  conversationState: Array<{ role: string; content: string }>;
  /** Per-step capability results (intermediate results). */
  intermediateResults: Record<string, CapabilityResult>;
  /** Ordered decision log (step → outcome). */
  decisionHistory: Array<{ at: string; step: string; outcome: string; reason?: string | null }>;
}

/** Deterministic checkpoint (§6) — every execution is resumable from one. */
export interface AgentCheckpoint {
  runId: string;
  agentId: AgentId;
  companyId: string;
  state: AgentState;
  /** Index into the plan of the current step. */
  currentStep: number;
  completedCapabilities: string[];
  pendingCapabilities: string[];
  approvals: ApprovalRecord[];
  memory: AgentMemory;
  executionMetadata: {
    createdAt: string;
    updatedAt: string;
    attempts: Record<string, number>;
    checkpointCount: number;
    resumeCount: number;
  };
}

export interface AgentRequest {
  agent: AgentId;
  companyId: string;
  userId?: string | null;
  /** Agent-level input (passed into each capability request). */
  input?: Record<string, unknown>;
  /** Deterministic run identity (resume uses the same id). Provided by caller. */
  runId: string;
  /** Approval decisions supplied on resume (stepId → decision). */
  approvals?: ApprovalRecord[];
  now?: string;
  correlationId?: string;
}

export type AgentStatus = 'completed' | 'waiting' | 'failed' | 'cancelled' | 'blocked' | 'partial';

export interface PendingApproval {
  stepId: string;
  capability: CapabilityId;
  requestedAt: string;
}

/** THE canonical agent result. */
export interface AgentResult {
  status: AgentStatus;
  agent: AgentId;
  runId: string;
  state: AgentState;
  /** Per-step capability results (completed steps). */
  results: Record<string, CapabilityResult>;
  /** Set when status === 'waiting' — the gate blocking progress. */
  pendingApproval?: PendingApproval | null;
  checkpoint: AgentCheckpoint;
  error?: string | null;
  execution: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    completedSteps: number;
    totalSteps: number;
    resumed: boolean;
  };
}

/** Deterministic empty memory for a fresh run. */
export function emptyMemory(executionContext: Record<string, unknown>): AgentMemory {
  return {
    version: 1,
    executionContext,
    workingMemory: {},
    conversationState: [],
    intermediateResults: {},
    decisionHistory: [],
  };
}
