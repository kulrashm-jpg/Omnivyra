/**
 * Creator Rendering — Phase-3/4 provider abstraction (PURE TYPES).
 * ──────────────────────────────────────────────────────────────────────────
 * R0 foundation only. NO provider implementations, NO network. This is
 * the single interface every future provider adapter (OpenAI / Runway /
 * Pika / Stability / …) implements — the rendering analogue of the
 * Step-3/5 CreatorBlueprintAdapter contract.
 */

import type { RenderSpec, RenderModality } from './renderTypes';

export type RenderProviderKey =
  | 'openai'
  | 'runway'
  | 'pika'
  | 'stability'
  // open set — string allows future providers without a type change.
  | (string & {});

/** PHASE-4 capability matrix. Pure data a provider declares; the queue
 *  routes a RenderSpec to the first healthy provider whose matrix
 *  `supports()` it. */
export interface RenderCapabilityMatrix {
  modalities: ReadonlyArray<RenderModality>;   // 'image' | 'video'
  /** Video only; seconds. 0/absent ⇒ image-only provider. */
  max_duration_sec: number;
  resolutions: ReadonlyArray<{ w: number; h: number }>;
  aspect_ratios: ReadonlyArray<string>;        // '1:1' | '9:16' | '16:9' | …
  supports_seed: boolean;                      // deterministic seed input
  supports_audio: boolean;
  supports_overlay_text: boolean;
  supports_batch: boolean;
  /** Hard ceiling the queue uses for concurrency shaping. */
  max_concurrent: number;
}

export type RenderProviderHealthState =
  | 'healthy'
  | 'degraded'
  | 'circuit_open'   // breaker tripped — failover only, no new submits
  | 'maintenance';

export interface RenderProviderHealth {
  provider: RenderProviderKey;
  state: RenderProviderHealthState;
  consecutive_failures: number;
  /** Opaque, audit-only; never crosses into workspace/scheduler. */
  last_signal?: string;
}

export interface CreditEstimate {
  /** HOLD ceiling fed into the EXISTING billing_operations HOLD. */
  estimated_credits: number;
  currency: 'CREDITS';
  /** Provider-side cost basis for reconciliation (not user-facing). */
  provider_cost_basis?: string;
}

/** Opaque provider job handle (provider-defined; never persisted into
 *  the scheduler row — lives only on creator_render_attempt). */
export interface ProviderHandle {
  provider: RenderProviderKey;
  external_job_id: string;
  provider_metadata?: Readonly<Record<string, unknown>>;
}

export type ProviderStatusState =
  | 'submitted'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ProviderStatus {
  handle: ProviderHandle;
  state: ProviderStatusState;
  /** 0..1 best-effort; advisory only. */
  progress?: number;
  error_code?: string;
}

/**
 * The PURE provider contract. Effectful methods are typed as Promise but
 * NONE are implemented in R0. Implementations arrive in R3+ behind a
 * feature flag, each idempotent on `idempotencyKey` and billed via the
 * existing ledger — never bypassing job_execution_registry.
 */
export interface RenderProvider {
  readonly key: RenderProviderKey;

  /** Static capability declaration (pure). */
  capabilities(): RenderCapabilityMatrix;

  /** Pure: can this provider satisfy the spec? (no side effects) */
  supports(spec: RenderSpec): boolean;

  /** Pure-ish: cost estimate → billing HOLD ceiling. */
  estimateCost(spec: RenderSpec): CreditEstimate;

  /** Effectful (future). Idempotent on idempotencyKey. */
  submit(spec: RenderSpec, idempotencyKey: string): Promise<ProviderHandle>;
  poll(handle: ProviderHandle): Promise<ProviderStatus>;
  fetchOutput(handle: ProviderHandle): Promise<import('./renderTypes').RenderOutputRef>;
  cancel(handle: ProviderHandle): Promise<void>;
}

/** Provider registry contract (declared; instance built in R3+). */
export interface RenderProviderRegistry {
  get(key: RenderProviderKey): RenderProvider | undefined;
  /** Health-aware, capability-filtered preference order for a spec. */
  resolveProviderChain(spec: RenderSpec): ReadonlyArray<RenderProviderKey>;
  list(): ReadonlyArray<RenderProvider>;
}
