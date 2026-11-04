/**
 * Prospect import — client data layer.
 *
 * Follows the repository's `*Client.ts` convention
 * (components/lead-intelligence/leadIntelligenceClient.ts): thin `apiFetch`
 * wrappers, no state, no caching policy of its own. The import flow is a
 * sequence of explicit user-initiated actions, so unlike the lead list there
 * is no SWR key here — nothing should background-revalidate an import.
 */

import { apiFetch } from '@/lib/apiFetch';
import type { MappingProposalResponse } from '@/lib/prospects/import/types';

/** A refusal the UI needs to distinguish, not just display. */
export class ImportApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ImportApiError';
  }

  /** The gate's own answer: this company does not have importing switched on. */
  get isGateClosed(): boolean {
    return this.code === 'LEAD_INGESTION_DISABLED';
  }

  /** Saving a mapping for REUSE is unavailable; this import is unaffected. */
  get isProfileStoreUnavailable(): boolean {
    return this.code === 'MAPPING_PROFILE_STORE_UNAVAILABLE';
  }
}

async function readError(res: Response): Promise<ImportApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return new ImportApiError(
    body.error || `The request failed (HTTP ${res.status}).`,
    body.code ?? null,
    res.status,
  );
}

/**
 * Asks the server what the columns mean.
 *
 * Sends headings and a few representative values per column — never the rows.
 * Call it again with the same headings to re-propose after a correction; that
 * is a cheap recomputation on retained state, not a new upload.
 */
export async function requestMappingProposal(args: {
  companyId: string;
  source: string;
  headers: readonly string[];
  samples: Readonly<Record<string, readonly string[]>>;
  fieldDescriptions?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}): Promise<MappingProposalResponse> {
  const res = await apiFetch(
    `/api/lead-ingestion/mapping-proposal?company_id=${encodeURIComponent(args.companyId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: args.source,
        headers: args.headers,
        samples: args.samples,
        ...(args.fieldDescriptions ? { fieldDescriptions: args.fieldDescriptions } : {}),
      }),
      signal: args.signal,
    },
  );
  if (!res.ok) throw await readError(res);
  return res.json();
}

/**
 * Asks the server to remember this mapping for next time.
 *
 * Expected to fail with `MAPPING_PROFILE_STORE_UNAVAILABLE` until the profile
 * store lands. The caller treats that as "not available yet", never as an
 * import failure — the mapping still applies to the import in progress.
 */
export async function approveMappingProfile(args: {
  companyId: string;
  source: string;
  schemaFingerprint: string;
  headers: readonly string[];
  entries: ReadonlyArray<{
    sourceField: string;
    target: string | null;
    transformation: string;
    decision: 'approved' | 'rejected' | 'ignored';
    mappingMethod:
      | 'approved_profile_match'
      | 'high_confidence_suggestion'
      | 'tenant_confirmed'
      | 'tenant_override';
  }>;
  idempotencyKey: string;
}): Promise<{ profileId: string; version: number }> {
  const res = await apiFetch(
    `/api/lead-ingestion/mapping-approval?company_id=${encodeURIComponent(args.companyId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': args.idempotencyKey,
      },
      body: JSON.stringify({
        source: args.source,
        schemaFingerprint: args.schemaFingerprint,
        headers: args.headers,
        entries: args.entries,
      }),
    },
  );
  if (!res.ok) throw await readError(res);
  return res.json();
}

/**
 * A run id for one import.
 *
 * `crypto.randomUUID` is available in every browser this app supports; the
 * fallback exists so a jsdom test without it does not have to stub the global.
 */
export function newRunId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * The idempotency key for a mapping approval.
 *
 * ─── WHY THE DECISIONS ARE PART OF THE KEY ────────────────────────────────
 * The obvious key is `company:fingerprint`, and it is wrong. `withIdempotency`
 * hashes the request body and answers 409 IDEMPOTENCY_CONFLICT when a key is
 * reused with a different payload. So a tenant who approves a mapping, later
 * changes their mind about one column, and approves again for the SAME file
 * layout would be refused — which is exactly the case a versioned profile
 * table exists to support (`source_mapping_profiles` has a `version` column
 * and a `superseded_at`, so a second decision is expected, not an error).
 *
 * Including a digest of the decisions makes the key identify the DECISION
 * rather than the schema. A genuine retry of the same decision replays; a
 * changed decision is a new unit of work and becomes the next version.
 */
export function mappingApprovalKey(
  companyId: string,
  schemaFingerprint: string,
  entries: ReadonlyArray<{ sourceField: string; target: string | null; transformation: string; decision: string }>,
): string {
  // Sorted so the key does not depend on column order, and compact so it stays
  // well inside a header value.
  const canonical = [...entries]
    .map((e) => `${e.sourceField}>${e.target ?? 'null'}:${e.transformation}:${e.decision}`)
    .sort()
    .join('|');

  // A small non-cryptographic digest: this identifies a request, it does not
  // protect anything, and `crypto.subtle` is async which would make every
  // caller async for no benefit.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i += 1) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + ch + i, 0x85ebca6b) >>> 0;
  }
  const digest = `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;

  return `mapping-approval:${companyId}:${schemaFingerprint.slice(0, 16)}:${digest}`;
}
