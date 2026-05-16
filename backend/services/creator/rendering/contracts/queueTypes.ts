/**
 * Creator Rendering — Phase-7 queue contracts (PURE TYPES).
 * ──────────────────────────────────────────────────────────────────────────
 * R0 foundation only. NO queue runtime, NO BullMQ wiring. These types
 * describe how a future render queue layer rides the EXISTING
 * job_execution_registry exactly-once substrate (Step-14 Phase-7) —
 * they do not create a parallel queue.
 */

/** Interactive workspace renders preempt batch campaign renders. */
export type RenderQueuePriority = 'interactive' | 'standard' | 'batch';

/** Distinct from retry — failover changes provider, retry does not. */
export type RenderRecoveryKind = 'retry' | 'failover';

export interface RenderBackoffPolicy {
  /** Hard cap on attempts across retry (NOT failover). */
  max_attempts: number;
  base_delay_ms: number;
  /** Multiplicative growth per attempt. */
  factor: number;
  max_delay_ms: number;
  /** Deterministic jitter is applied by the runtime from a stable seed
   *  — declared here as a flag only (no RNG in contracts). */
  jitter: boolean;
}

/**
 * A logical queue item. The exactly-once key is the render input hash
 * bound to a variant — redelivery reuses the deployed
 * job_execution_registry claim (no double submit / double bill).
 */
export interface RenderQueueItem {
  queue_item_id: string;
  render_job_id: string;
  render_variant_id: string;
  /** sha256(RenderSpec) ⊕ variant — the exactly-once execution hash. */
  execution_hash: string;
  priority: RenderQueuePriority;
  /** Per-org concurrency lane key (quota enforcement, Step-14 Phase-11). */
  concurrency_key: string;
  backoff: RenderBackoffPolicy;
  /** Provider SLA window; breach → orphan reaper releases the billing
   *  HOLD and marks failed_timeout. */
  timeout_ms: number;
  enqueued_intent_hash: string;   // immutable; no timestamps in contract
}

/** Outcome shape a queue worker reports back (pure type only). */
export interface RenderQueueDispatchResult {
  queue_item_id: string;
  accepted: boolean;
  /** When rejected: why (quota / duplicate / no-capable-provider / …). */
  rejection_reason?: string;
  recovery?: RenderRecoveryKind;
}
