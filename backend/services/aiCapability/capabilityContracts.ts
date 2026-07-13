/**
 * capabilityContracts.ts — canonical AI-capability contracts (AIC-001 §4/§7).
 *
 * ONE request shape and ONE result shape for every AI capability in Omnivyra.
 * No capability defines its own response format. Pure types + deterministic
 * helpers only. This layer ORCHESTRATES the existing platform (CKC-001 knowledge,
 * the current LLM gateway, existing tools, AUTH events, HARDEN observability); it
 * introduces no new AI runtime and duplicates none.
 */

import type { KnowledgeContextMode, KnowledgeVersionSelector } from '../knowledgeConsumption/knowledgeContextContracts';
import type { KnowledgeDomainId } from '../knowledge/companyKnowledgeModel';

/** Known first-class capabilities (extensible — any string is accepted). */
export type CapabilityId =
  | 'CONTENT_WRITER'
  | 'CONTENT_CREATOR'
  | 'CAMPAIGN_PLANNER'
  | 'STRATEGIC_MIX'
  | 'SEO_INTELLIGENCE'
  | 'GROWTH_INTELLIGENCE'
  | 'RECOMMENDATION_ENGINE'
  | 'COMPETITOR_INTELLIGENCE'
  | 'WEBSITE_INTELLIGENCE'
  | (string & {});

/** The single fixed pipeline every capability runs (§4). */
export type PipelineStage =
  | 'knowledge'
  | 'planning'
  | 'prompt_assembly'
  | 'tool_selection'
  | 'tool_execution'
  | 'grounding'
  | 'validation'
  | 'confidence'
  | 'output_assembly';

export const PIPELINE_STAGES: ReadonlyArray<PipelineStage> = [
  'knowledge', 'planning', 'prompt_assembly', 'tool_selection', 'tool_execution',
  'grounding', 'validation', 'confidence', 'output_assembly',
];

/** A consumer request to run a capability. */
export interface CapabilityRequest {
  capability: CapabilityId;
  companyId: string;
  userId?: string | null;
  /** Capability-specific input (topic, brief, slot id, …). */
  input?: Record<string, unknown>;
  /** Per-request knowledge overrides (merged over the capability defaults). */
  knowledge?: {
    domains?: KnowledgeDomainId[];
    minConfidence?: number;
    maxAgeMs?: number;
    language?: string;
    mode?: KnowledgeContextMode;
    version?: KnowledgeVersionSelector;
  };
  /** Model override (must be in the capability's supportedModels, else ignored). */
  model?: string;
  /** Bound on recovery attempts (default from capability config). */
  maxRetries?: number;
  /** Injected clock for determinism. Defaults to now at the boundary. */
  now?: string;
  correlationId?: string;
}

export interface CapabilitySource {
  kind: 'knowledge' | 'tool';
  ref: string;
  domain?: KnowledgeDomainId;
  tool?: string;
  confidence?: number;
}

export interface ToolCallSummary {
  tool: string;
  ok: boolean;
  ms: number;
  attempts: number;
  fallbackUsed: boolean;
  error?: string | null;
}

export interface ToolSummary {
  calls: ToolCallSummary[];
  totalMs: number;
  okCount: number;
  failedCount: number;
}

export type ValidationKind = 'schema' | 'business' | 'grounding' | 'hallucination' | 'confidence' | 'policy';

export interface ValidationCheck {
  name: string;
  kind: ValidationKind;
  ok: boolean;
  message?: string | null;
}

export interface ValidationSummary {
  ok: boolean;
  checks: ValidationCheck[];
  failures: number;
}

export interface ExecutionMetadata {
  capability: CapabilityId;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  model: string | null;
  attempts: number;
  resumed: boolean;
  stagesCompleted: PipelineStage[];
  knowledgeVersion: number | null;
  tokens: { input: number; output: number };
  cacheUsed: boolean;
}

export type CapabilityStatus = 'completed' | 'partial' | 'failed' | 'blocked';

/** THE canonical result every capability returns (§7). No custom formats. */
export interface CapabilityResult<T = unknown> {
  status: CapabilityStatus;
  capability: CapabilityId;
  result: T | null;
  confidence: number;
  sources: CapabilitySource[];
  knowledgeVersion: number | null;
  execution: ExecutionMetadata;
  tools: ToolSummary;
  validation: ValidationSummary;
  error?: string | null;
  recovered?: boolean;
}

/** Deterministic token estimate (~4 chars/token). Pure. */
export function estimateTokens(value: unknown): number {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return Math.ceil((s ? s.length : 0) / 4);
}

/** Clamp a confidence into 0–100. */
export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
