/**
 * LegacyExecutionConfiguration.ts — the gateway-facing execution configuration shape
 * (AI-ORCH 2A-2.3).
 *
 * The complete execution configuration the legacy gateway consumes, expressed in the
 * gateway's own field names. The LegacyExecutionAdapter maps a canonical
 * ResolvedExecutionPlan onto THIS shape 1:1 — proving the resolver can fully describe
 * the legacy execution configuration. It is a data contract only (no logic).
 *
 * `configFingerprint` is DIAGNOSTIC ONLY — carried for traceability, never consumed
 * to drive execution.
 */
export interface LegacyExecutionConfiguration {
  provider?: string | null;
  model?: string | null;
  modelVersion?: string | null;
  deploymentId?: string | null;
  temperature?: number | null;
  topP?: number | null;
  presencePenalty?: number | null;
  frequencyPenalty?: number | null;
  maxOutputTokens?: number | null;
  streaming?: boolean | null;
  structuredOutput?: boolean | null;
  vision?: boolean | null;
  reasoning?: string | null;
  responseFormat?: string | null;
  toolCalling?: boolean | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  retryPolicy?: string | null;
  routingPolicy?: string | null;
  safety?: Record<string, unknown> | null;
  cachePolicy?: Record<string, unknown> | null;
  seedPolicy?: string | null;
  costLimit?: number | null;
  tokenLimit?: number | null;
  /** DIAGNOSTIC ONLY — never consumed for execution. */
  configFingerprint?: string | null;
}
