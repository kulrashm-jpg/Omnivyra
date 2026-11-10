/**
 * Sales Navigator saved-lead capture — the PI side of the capture contract.
 *
 * ─── WHO OWNS WHAT (agreed with Outreach, 2026-11-10) ─────────────────────
 * Outreach owns the extension, the route `POST /api/extension/capture/leads`,
 * and ALL caller verification: signature/timestamp/nonce, minimum extension
 * version, that `command_id` is a live `li.salesnav.capture_saved_leads`
 * command issued to this session, the session → social account → acting member
 * binding, the batch cap and rate limiting. It then calls
 * `ingestCapturedSavedLeads` with a verified context. Outreach writes no
 * prospect table.
 *
 * PI owns this contract, the provider interface (extension now, LinkedIn SNAP
 * later), translation into the vendor-neutral ingestion contract, and storage
 * through `ingestLeadBatch`. No route, transport or auth code lives here.
 *
 * ─── ONE SOURCE, TWO TRANSPORTS ───────────────────────────────────────────
 * The extension and SNAP are two TRANSPORTS for one SOURCE,
 * `linkedin_sales_navigator` — the key `sourcePrecedence.ts` already treats as
 * Sales Navigator. Both produce `CapturedSavedLead`; one adapter translates it.
 * A lead later seen through SNAP therefore lands on the SAME source record as
 * one captured by the extension, instead of becoming a second "source".
 */

/** The PI source key. Becomes `source_records.provider`. */
export const SALESNAV_SOURCE = 'linkedin_sales_navigator';

/** Capture payload contract version agreed with Outreach. */
export const CAPTURE_CONTRACT_VERSION = 1;

/** Leads per capture batch (agreed). Far below the orchestrator's own limit. */
export const MAX_CAPTURE_BATCH = 25;

export const SAVED_LEADS_PROVIDER_IDS = ['linkedin_salesnav_extension', 'linkedin_snap'] as const;
export type SavedLeadsProviderId = typeof SAVED_LEADS_PROVIDER_IDS[number];

export type SavedLeadsTransport = 'extension' | 'snap';

export const CAPTURE_LIST_KINDS = ['saved_leads', 'lead_list', 'search'] as const;
export type CaptureListKind = typeof CAPTURE_LIST_KINDS[number];

/**
 * The context Outreach's route has ALREADY verified.
 *
 * Structural on purpose: Outreach's branded `VerifiedCaptureContext`
 * (`lib/extension/captureContext.ts`, constructible only by its verifier) is
 * assignable to this, and PI imports nothing from the route side. Every field
 * is treated as authoritative — none is re-derived from the payload.
 */
export interface CaptureCallerContext {
  readonly orgId: string;
  readonly userId: string;
  /** Null until Outreach links social_accounts (C-PI-1). PI never reads it. */
  readonly socialAccountId: string | null;
  readonly actingMemberUrn: string;
  readonly commandId: string;
  readonly extensionVersion: string;
}

/** One lead as the EXTENSION sends it (wire shape, snake_case, agreed v1). */
export interface CapturedLeadWire {
  /** Member-scoped Sales Navigator id (first element of the fs_salesProfile tuple). PROVISIONAL. */
  lead_key: string;
  /** The full lead URN, as evidence. Used for a consistency check only; never persisted. */
  raw_urn?: string | null;
  public_profile_url?: string | null;
  full_name?: string | null;
  headline?: string | null;
  title?: string | null;
  company_name?: string | null;
  company_salesnav_urn?: string | null;
  company_linkedin_url?: string | null;
  location?: string | null;
  /** Describes the VIEWER's network, not the lead. Accepted, never persisted. */
  connection_degree?: string | number | null;
  /** Per-list, per-seat. Accepted, never persisted (v1 has no membership model). */
  saved_at?: string | null;
}

/** The capture batch payload (wire shape, agreed v1). */
export interface CaptureBatchPayload {
  provider: string;
  contract_version: number;
  org_id?: string;
  captured_at: string;
  source: {
    surface: string;
    list_kind: string;
    list_name?: string | null;
    page_index?: number | null;
  };
  leads: CapturedLeadWire[];
}

/**
 * The transport-neutral lead. Both providers produce this; the adapter consumes
 * only this. Fields are what is VISIBLE on Sales Navigator — never an email or
 * a phone, which are not on the page (owner decision P-3).
 *
 * EVERY EVIDENCE FIELD IS AS CAPTURED, NEVER NORMALISED (review F1). These
 * values become `source_records.raw_payload`, and LI-2 hashes that payload to
 * decide whether the SOURCE changed. A normalised value inside it would make a
 * normaliser change look like a source change: every re-capture would report
 * `changed`, overwrite `observed_at` and start a new assertion generation for a
 * profile that never moved. Normalisation therefore happens at READ time
 * (`normalizeLinkedinUrl`, `salesNavCompanyId`), over stored evidence. Only
 * `leadKey` is validated here, because it is the identity, not evidence.
 */
export interface CapturedSavedLead {
  leadKey: string;
  /** As captured. Normalised only when read (`normalizeLinkedinUrl(…, '/in/')`). */
  profileUrl: string | null;
  fullName: string | null;
  headline: string | null;
  title: string | null;
  company: {
    name: string | null;
    /** As captured (e.g. `urn:li:fs_salesCompany:123`). The id is derived when read. */
    salesNavUrn: string | null;
    /** As captured. Never a website or domain. */
    linkedinUrl: string | null;
  } | null;
  location: string | null;
  /** When the transport observed the lead. Becomes `observedAt`. */
  capturedAt: string;
  transport: SavedLeadsTransport;
}

/** Per-lead result returned to the caller. No ids, no PII — agreed v1. */
export type CaptureLeadStatus = 'created' | 'updated' | 'unchanged' | 'rejected';

export interface CaptureLeadOutcome {
  /** The `lead_key` as sent (or `null` when absent), so the extension can match rows. */
  key: string | null;
  status: CaptureLeadStatus;
  /** Machine-readable code only, never a message that could carry data. */
  reason?: string;
}

/** Why a whole batch was refused before any lead was looked at. */
export type CaptureBatchRefusal =
  | 'capture_disabled'
  | 'organization_mismatch'
  | 'ingestion_not_enabled'
  | 'capture_not_enabled_for_tenant'
  | 'provider_unavailable'
  | 'unsupported_provider'
  | 'unsupported_contract_version'
  | 'unsupported_surface'
  | 'invalid_payload'
  | 'batch_too_large';

export interface CaptureBatchResult {
  ok: boolean;
  refusal?: CaptureBatchRefusal;
  /** Stable, log-safe reason detail (e.g. the tenant gate's reason). */
  detail?: string;
  /** Always present: neither side may forget that `lead_key` is unverified. */
  leadKeyProvisional: boolean;
  outcomes: CaptureLeadOutcome[];
  /** Counts only (no ids, no PII), present on a successful batch: the usage ledger's input. */
  totals?: { received: number; accepted: number; created: number; updated: number; unchanged: number; duplicatesParked: number };
}

/**
 * The provider interface. One per transport.
 *
 * PUSH providers (the extension) implement `acceptBatch`: the caller hands
 * over what it captured. PULL providers (SNAP) implement `fetchSavedLeads`:
 * PI asks the partner API. A provider implements exactly the half its
 * transport supports.
 */
export interface SavedLeadsProvider {
  readonly id: SavedLeadsProviderId;
  readonly transport: SavedLeadsTransport;
  readonly label: string;
  /** Whether this provider can be used at all right now. Never throws. */
  availability(organizationId: string): Promise<{ available: boolean; reason: string }>;
  acceptBatch?(payload: CaptureBatchPayload): AcceptedBatch;
  fetchSavedLeads?(organizationId: string, cursor: string | null): Promise<{ leads: CapturedSavedLead[]; next: string | null }>;
}

export interface AcceptedBatch {
  /** In input order; `lead` is null when the row was rejected. */
  rows: Array<{ key: string | null; lead: CapturedSavedLead | null; reason?: string }>;
}
