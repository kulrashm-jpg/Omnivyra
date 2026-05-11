/**
 * Capability Log Event Contract
 * ──────────────────────────────────────────────────────────────────────────
 * Single source of truth for capability-related log event names and payload
 * shape. Both backend (publishNowService, platformAdapter) and frontend
 * (ShortformResultPage, multi-platform-scheduler) emit through this contract.
 *
 * Goal (Round-4 Phase 3): future frontend telemetry can plug into the same
 * event taxonomy without touching call sites. The backend uses the existing
 * `backend/services/logger.ts`; the frontend currently emits structured JSON
 * via `console.info`. Both paths share the event names and the payload type
 * defined here.
 *
 * No telemetry transport is implemented here — this module deliberately ships
 * only types and string constants.
 */

import type { ContentCapability } from './platformCapabilities';

/** Canonical event names. New events MUST be added to this object — string
 *  literals at call sites are forbidden by the centralization CI guard. */
export const CAPABILITY_LOG_EVENTS = {
  /** UI assembly: a surface filtered connected platforms by capability. */
  FILTERED: 'platform.capability.filtered',
  /** A publish was rejected because the platform doesn't support the
   *  requested capability or requires media that's missing. */
  REJECTED: 'platform.capability.rejected',
  /** A publish was rejected because the content capability could not be
   *  determined (CAPABILITY_UNRESOLVED). */
  UNRESOLVED: 'platform.capability.unresolved',
} as const;

export type CapabilityLogEvent =
  (typeof CAPABILITY_LOG_EVENTS)[keyof typeof CAPABILITY_LOG_EVENTS];

/** Reason map for the `hidden` / `unregistered` platform sets. Keys are
 *  canonical platform identifiers. */
export type CapabilityHiddenReasonMap = Record<string, string>;

/** The structured payload accompanying every capability log event. Optional
 *  fields are populated by the surface that emits the event. */
export interface CapabilityLogPayload {
  [key: string]: unknown;
  /** Where the event originated: a route, queue worker, or component name. */
  surface: string;
  /** Higher-level invocation source (e.g. 'shortform-result', 'queue',
   *  'multi-platform-scheduler', 'api'). */
  publishSource?: string;
  /** Resolved capability — null when the source signals couldn't be mapped. */
  resolvedCapability: ContentCapability | null;
  /** All connected platforms the surface considered (UI-assembly events). */
  connectedPlatforms?: string[];
  /** Subset that can publish the resolved capability. */
  supportedPlatforms?: string[];
  /** Registered but capability-incompatible. */
  hiddenPlatforms?: string[];
  /** Platforms not present in the canonical registry — must never render. */
  unregisteredPlatforms?: string[];
  /** Reason map for hidden platforms. */
  hiddenReasons?: CapabilityHiddenReasonMap;
  /** Reason map for unregistered platforms. */
  unregisteredReasons?: CapabilityHiddenReasonMap;
  /** Single-platform publish-validation events. */
  platform?: string;
  contentType?: string;
  /** Structured rejection code from the validator. */
  code?: string;
  scheduledPostId?: string;
}

/** Minimal logger interface a surface implements to emit capability events.
 *  Backend uses the project's structured logger; frontend uses console-JSON.
 *  Future telemetry plumbing can drop in here without changing call sites. */
export interface CapabilityLogger {
  emit(event: CapabilityLogEvent, payload: CapabilityLogPayload): void;
}
