/**
 * Types for the signal → canonical prospect bridge (Agent 4).
 *
 * A `BridgeSourceEvent` is ONE observed source event (a community feed item, an
 * engagement lead signal, a scheduled-detection lead signal) already translated
 * into the provenance vocabulary. The core (`bridgeCore.ts`) knows nothing about
 * where it came from; the per-source builders in `../communityBridge.ts` decide
 * category, keys, URL, observed time and evidence EXPLICITLY.
 */
import type { SignalRefs, SourceCategory, SourceContributionInput, SourceContributionResult } from '../../../../lib/prospectProvenance/contract';

/** Which producer handed the event to the bridge. Stable strings, safe to log. */
export type BridgeKind = 'community_feed' | 'engagement_signal' | 'scheduled_detection';

/** How `observedAt` was chosen. Recorded in evidence so the basis is never guessed later. */
export type ObservedAtBasis =
  | 'posted_at'
  | 'message_created_at'
  | 'source_trace_detected_at'
  | 'signal_detected_at'
  | 'feed_created_at';

export interface BridgeSourceEvent {
  kind: BridgeKind;
  /** TENANT (= companies.id). Always taken from the source row, never from a caller. */
  organizationId: string;
  sourceCategory: SourceCategory;
  /** Namespace of `externalRef` and `source_records.provider`. */
  provider: string;
  /** Provider-local id. `externalRef` = `<provider>:<sourceRecordKey>`. */
  sourceRecordKey: string;
  /** Persisted on `canonical_leads.source` when this event CREATES the prospect. */
  prospectSource: string;
  identity: {
    /** Exactly the platform string the Lead Intelligence adoption uses, so both resolve one person. */
    platform: string | null;
    platformUserId: string | null;
  };
  platform: string | null;
  sourceUrl: string | null;
  observedAt: string;
  observedAtBasis: ObservedAtBasis;
  ingestionRunId: string | null;
  refs: SignalRefs;
  evidence: Record<string, unknown>;
  sourceMetadata: Record<string, unknown>;
  /** Verbatim-ish source payload for `source_records.raw_payload` (redacted by LI-2). */
  rawPayload: Record<string, unknown>;
}

export type BridgeStatus = 'bridged' | 'skipped' | 'failed';

export interface BridgeOutcome {
  kind: BridgeKind;
  status: BridgeStatus;
  /** Machine-readable; stable; safe to log (no identifiers, handles or content). */
  reason: string;
  organizationId: string | null;
  externalRef: string | null;
  prospectId?: string | null;
  personId?: string | null;
  sourceRecordId?: string | null;
  /** True when the prospect is keyed by THIS event's externalRef (this source originated it). */
  leadCreated?: boolean;
  /** How the prospect was found: own key, an existing prospect of the same person, or created now. */
  prospectPath?: 'own_key' | 'existing_person' | 'created' | 'matched_on_create';
  contribution?: SourceContributionResult['status'];
  contributionRole?: string | null;
  roleDowngraded?: boolean;
}

export interface GateDecisionLike { allowed: boolean; reason: string }

/** Injected I/O. Defaults (lazy-loaded) are the EXISTING PI services; tests inject fakes. */
export interface BridgeDeps {
  gate: (organizationId: string) => Promise<GateDecisionLike>;
  resolvePerson: (input: { companyId: string; externalKeys: Record<string, unknown> }) => Promise<{ unifiedPersonId: string }>;
  /** `prospectResolution.resolveProspectShadow` — read-only lookup by key. */
  findProspectByKey: (organizationId: string, externalLeadKey: string, source: string) => Promise<string | null>;
  /** Tenant-scoped read of canonical_leads anchored to a person (≤ 2 ids). */
  findProspectsForPerson: (organizationId: string, personId: string) => Promise<string[]>;
  resolveOrCreateProspect: (
    organizationId: string,
    candidate: { externalLeadKey: string; source: string; personId: string; metadata?: Record<string, unknown> },
    at: string,
  ) => Promise<{ prospectId: string | null; outcome: string }>;
  ingestSourceRecord: (input: {
    organizationId: string;
    provider: string;
    entityType: 'person';
    sourceRecordId: string;
    rawPayload: Record<string, unknown>;
    personId: string;
    observedAt: string;
    ingestionRunId: string | null;
  }, at: string) => Promise<{ sourceRecordId: string }>;
  recordContribution: (input: SourceContributionInput) => Promise<SourceContributionResult>;
  /** Tenant-scoped read of one lead_signals row. */
  loadLeadSignal: (organizationId: string, leadSignalId: string) => Promise<Record<string, unknown> | null>;
  now: () => string;
}
