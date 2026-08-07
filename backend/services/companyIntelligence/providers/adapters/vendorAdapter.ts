/**
 * WS-4 Phase-2 — the shared vendor-adapter skeleton.
 *
 * Every enrichment vendor has the same shape: a credential, a host, a
 * company-keyed lookup, and a response that must be mapped into evidence-bearing
 * fields. Six near-identical adapters written six times is six places for the
 * "never fabricate" rule to be forgotten, so the rule lives here once and each
 * vendor supplies only what is genuinely vendor-specific: its host, its request,
 * and its response mapping.
 *
 * ─── WHAT THIS GUARANTEES FOR EVERY VENDOR ─────────────────────────────────
 *  • No credential ⇒ NO NETWORK CALL and `unavailable('no_credential')`. The
 *    adapter does not "try anyway" — a 401 costs a request, pollutes the
 *    vendor's logs, and tells us nothing we did not already know.
 *  • All egress goes through `safeFetch` with the vendor host pinned via
 *    `allowedHosts`, so an adapter cannot be redirected somewhere else. This is
 *    the HARDEN-005 seam; `check:ssrf` stays green because nothing here calls
 *    `fetch` directly.
 *  • 404 is `no_coverage`, 429 is `rate_limited`, anything else non-2xx is
 *    `provider_error`. These are different operator facts and are never
 *    collapsed.
 *  • A mapper that produces nothing degrades to `no_coverage` rather than
 *    reporting a measured result with no data.
 *  • Nothing throws. Ever. The orchestrator's aggregate must survive one bad
 *    vendor.
 */

import { safeFetch } from '../../../../../lib/security/safeFetch';
import {
  measured,
  unavailable,
  type CompanyEnrichmentProvider,
  type EnrichmentCapability,
  type EnrichmentField,
  type EnrichmentRequest,
  type ProviderResult,
} from '../contract';

export interface VendorSpec {
  id: string;
  /** Env var holding the credential. Absent or empty ⇒ the adapter is dark. */
  credentialEnv: string;
  /** The single host this adapter may reach. Pinned into safeFetch. */
  host: string;
  capabilities: readonly EnrichmentCapability[];
  precedence: number;
  /** Milliseconds. Enrichment is not on a user's critical path; be patient but bounded. */
  timeoutMs?: number;
  /** Build the request for one capability. Return null when the input is insufficient. */
  buildRequest(
    request: EnrichmentRequest,
    capability: EnrichmentCapability,
    credential: string,
  ): { url: string; init: RequestInit } | null;
  /**
   * Map a parsed vendor payload into fields. MUST return only what the payload
   * actually contained — a missing value is an omitted field, never a default.
   */
  mapResponse(
    payload: unknown,
    request: EnrichmentRequest,
    capability: EnrichmentCapability,
  ): EnrichmentField[];
}

export function createVendorAdapter(spec: VendorSpec): CompanyEnrichmentProvider {
  return {
    id: spec.id,
    capabilities: spec.capabilities,
    precedence: spec.precedence,

    isConfigured(): boolean {
      return credentialOf(spec) !== null;
    },

    async fetch(request: EnrichmentRequest, capability: EnrichmentCapability): Promise<ProviderResult> {
      if (!spec.capabilities.includes(capability)) {
        return unavailable(spec.id, capability, 'not_capable', `${spec.id} does not serve ${capability}`);
      }

      const credential = credentialOf(spec);
      if (!credential) {
        return unavailable(spec.id, capability, 'no_credential', `${spec.credentialEnv} is not set`);
      }

      const built = spec.buildRequest(request, capability, credential);
      if (!built) {
        return unavailable(spec.id, capability, 'insufficient_input', 'no domain or company name to key on');
      }

      let response: Response;
      try {
        response = await safeFetch(built.url, built.init, {
          allowedHosts: [spec.host],
          timeoutMs: spec.timeoutMs ?? 10_000,
        });
      } catch (error) {
        return unavailable(spec.id, capability, 'provider_error', truncate(error));
      }

      if (response.status === 404) {
        return unavailable(spec.id, capability, 'no_coverage', 'vendor has no record for this company');
      }
      if (response.status === 429) {
        return unavailable(spec.id, capability, 'rate_limited', 'vendor rate limit reached');
      }
      if (!response.ok) {
        return unavailable(spec.id, capability, 'provider_error', `HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        return unavailable(spec.id, capability, 'provider_error', `unparseable response: ${truncate(error)}`);
      }

      let fields: EnrichmentField[];
      try {
        fields = spec.mapResponse(payload, request, capability);
      } catch (error) {
        return unavailable(spec.id, capability, 'provider_error', `mapping failed: ${truncate(error)}`);
      }

      // `measured` degrades to no_coverage on an empty field list — see contract.ts.
      return measured(spec.id, capability, fields);
    },
  };
}

function credentialOf(spec: VendorSpec): string | null {
  const raw = process.env[spec.credentialEnv];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

const truncate = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 200);

// ── mapping helpers — shared so "never fabricate" is implemented once ────────

/** Emit a field ONLY when the value is genuinely present. */
export function field(
  key: string,
  value: unknown,
  confidence: number,
  observedAt: string,
): EnrichmentField | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'number' ? String(value) : String(value).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
  return { key, value: s, confidence, observedAt };
}

/** Collect the non-null results of `field` calls. */
export function fields(...maybe: Array<EnrichmentField | null>): EnrichmentField[] {
  return maybe.filter((f): f is EnrichmentField => f !== null);
}

/** Safe nested read: `pick(payload, 'a', 'b')` → payload.a.b, or undefined. */
export function pick(source: unknown, ...path: string[]): unknown {
  let cursor: unknown = source;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Join an array of primitives; undefined when absent or empty. */
export function joinList(value: unknown, limit = 40): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parts = value
    .map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : pick(v, 'name')))
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .slice(0, limit);
  return parts.length ? parts.join('; ') : undefined;
}
