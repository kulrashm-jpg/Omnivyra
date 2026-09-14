/**
 * CPG-005 — READ-ONLY grounded-evidence API (§10, §11).
 *
 * GET /api/company-grounding/:companyId
 *
 * Returns the persisted grounding state so a client can answer, for every field:
 * "why does Omnivyra believe this, and where can I read the source myself?"
 *
 * ─── DELIBERATELY READ-ONLY ────────────────────────────────────────────────
 * Any method other than GET is rejected. There is NO mutation endpoint, NO
 * confirmation endpoint and NO acquisition trigger here — those are later work,
 * and shipping a read surface first means a client can inspect evidence before
 * anything can change it.
 *
 * ─── SECURITY ──────────────────────────────────────────────────────────────
 * `withTenantGuard` authorizes BEFORE the handler runs, and hands back the
 * VERIFIED companyId. The path parameter is only a lookup hint — the guard
 * decides whether the caller may see it, so a client cannot assert its own
 * tenant identity. A caller with no membership gets the guard's 401/403; it
 * never learns whether another tenant's company exists.
 *
 * ─── WHAT IS NOT EXPOSED ───────────────────────────────────────────────────
 * No credentials, no internal ids, no raw provider payloads, no database
 * metadata. Only the evidence a user is entitled to inspect.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withTenantGuard } from '../../../backend/security/withTenantGuard';
import {
  createInMemoryStore, type GroundingStorePort, type PersistedField, type PersistedClaim,
} from '../../../backend/services/companyProfile/grounding/persistence/groundingStore';

/**
 * Store resolution seam.
 *
 * CPG-005A binds a REAL PostgreSQL store — but ONLY when `GROUNDING_STORE_DSN`
 * is present. That variable is deliberately absent in production, so production
 * keeps the empty in-memory store and this endpoint stays inert there. The
 * grounding migration has been applied to a local throwaway database only.
 *
 * Opt-in by an env var that production does not set is the smallest safe way to
 * enable a non-production runtime without adding a feature flag or touching any
 * production configuration.
 */
function defaultStoreFactory(): GroundingStorePort {
  const dsn = process.env.GROUNDING_STORE_DSN;
  if (!dsn) return createInMemoryStore();
  // Lazy require: production never reaches this line, so `pg` is never loaded
  // and no connection is opened on module import.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { Pool } = require('pg') as typeof import('pg');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { createPostgresGroundingStore } = require(
    '../../../backend/services/companyProfile/grounding/persistence/postgresGroundingStore',
  ) as typeof import('../../../backend/services/companyProfile/grounding/persistence/postgresGroundingStore');
  return createPostgresGroundingStore(new Pool({ connectionString: dsn }));
}

let storeFactory: () => GroundingStorePort = defaultStoreFactory;

export function __setGroundingStoreForTests(factory: () => GroundingStorePort): void {
  storeFactory = factory;
}
export function __resetGroundingStoreForTests(): void {
  storeFactory = defaultStoreFactory;
}

export interface GroundingFieldView {
  field: string;
  effectiveValue: string | null;
  effectiveValueSource: string;
  status: string;
  claimKind: string;
  evidenceStrength: { score: number; band: string; meaning: string };
  freshness: string;
  entityMatch: string;
  independentFamilies: number;
  conflict: { isMaterial: boolean; confirmationStatus: string };
  /**
   * CPG-008 — EFFECTIVE | OBSERVED_ONLY | CONFLICTING | UNRESOLVED (null for
   * rows written before CPG-008). OBSERVED_ONLY means public claims exist but
   * none is sufficiently supported, so `effectiveValue` is deliberately null.
   */
  evidenceState: string | null;
  /**
   * CPG-009 — identity behind the effective value. `verified` is true only when
   * the field is PUBLICLY_VERIFIED: enough evidence for the value AND at least
   * one independent family that decisively establishes the company's identity.
   */
  identity: {
    verified: boolean;
    /** Strongest identity class among the effective value's supporting documents. */
    state: string | null;
    identityFamilies: number;
  };
  adjudication: {
    outcome: string | null;
    reason: string | null;
    requiresReview: boolean;
    /** Every observed / competing value; `strength` is evidence strength, NOT probability. */
    values: {
      value: string;
      normalizedValue: string;
      comparabilityClass: string;
      role: string;
      sufficient: boolean;
      sufficientBecause: string | null;
      families: string[];
      strength: number;
      sourceUrls: string[];
    }[];
  };
  lastVerifiedAt: string | null;
  sources: {
    sourceName: string;
    sourceUrl: string | null;
    providerFamily: string;
    authorityTier: number;
    fieldAuthority: string;
    retrievedAt: string;
    publishedAt: string | null;
    observationCount: number;
    value: string;
    /** CPG-007 — the comparison form (e.g. "INR 78000000"). */
    normalizedValue: string;
    /**
     * CPG-007 §20 — ONLY the fields that section permits (document date is
     * `publishedAt` above). Null for claims not read from an explicit statement.
     * The period/currency are visible in `value` ("INR 78,000,000 (FY2024)").
     */
    extraction: {
      sourceStatement: string;
      temporalType: string;
      approximation: boolean;
    } | null;
    /**
     * CPG-009 — is THIS document about this company? Identity strength, kept
     * apart from field-evidence strength. null for rows written before CPG-009.
     */
    identity: {
      state: string;
      /** 0..1 identity-evidence strength. NOT a probability. */
      strength: number;
      reason: string;
      signals: { signal: string; outcome: string; detail: string }[];
      publisher: string | null;
      /**
       * CPG-011 §22 — the registry identity the document declares, GENERIC for
       * every provider (no provider-specific fields). Null when it declares none.
       */
      registry: {
        provider: string | null;
        jurisdiction: string | null;
        scheme: string | null;
        identifier: string | null;
        legalEntity: string | null;
        status: string | null;
        /** subject (the company) | site_publisher | related_entity. */
        role: string | null;
        /** True only when the registry's own record was read and matched. */
        verified: boolean;
        /** How it was tied to the company: method + the chain of source URLs. */
        evidence: { establishedBy: string; chain: { step: string; sourceUrl: string | null; detail: string }[] } | null;
      } | null;
      /** CPG-010 §8 — the explicit domain association the attribution rests on. */
      domainAssociation: { domain: string; reason: string; source: string } | null;
    } | null;
    /** CPG-010 §3 — what kind of document this is (description, NOT authority; see fieldAuthority). */
    sourceKind: string | null;
    /** CPG-010 — the CPG-003 source descriptor the claim was attributed to. */
    sourceRegistryId: string | null;
  }[];
}

const EVIDENCE_MEANING =
  'Strength of evidence, not probability of truth. A score of 80 does NOT mean 80% likely correct.';

function toView(f: PersistedField, claims: PersistedClaim[]): GroundingFieldView {
  return {
    field: f.field,
    effectiveValue: f.effectiveValue,
    effectiveValueSource: f.effectiveValueSource,
    status: f.status,
    claimKind: f.claimKind,
    evidenceStrength: { score: f.confidenceScore, band: f.confidenceBand, meaning: EVIDENCE_MEANING },
    freshness: f.freshness,
    entityMatch: f.entityMatchStatus,
    independentFamilies: f.independentFamilies,
    conflict: { isMaterial: f.isMaterialConflict, confirmationStatus: f.confirmationStatus },
    evidenceState: f.evidenceState,
    identity: {
      verified: f.status === 'PUBLICLY_VERIFIED',
      state: (f.adjudicationCandidates ?? []).find((c) => c.role === 'EFFECTIVE')?.identity ?? null,
      identityFamilies: f.identityFamilies ?? 0,
    },
    adjudication: {
      outcome: f.adjudicationOutcome,
      reason: f.adjudicationReason,
      requiresReview: f.requiresReview,
      values: (f.adjudicationCandidates ?? []).map((c) => ({
        value: c.value, normalizedValue: c.normalizedValue, comparabilityClass: c.comparabilityClass,
        role: c.role, sufficient: c.sufficient, sufficientBecause: c.sufficientBecause,
        families: c.families, strength: c.strength, sourceUrls: c.sourceUrls,
      })),
    },
    lastVerifiedAt: f.lastVerifiedAt,
    sources: claims
      .filter((c) => c.field === f.field)
      .map((c) => ({
        sourceName: c.sourceName,
        sourceUrl: c.sourceUrl,
        providerFamily: c.providerFamily,
        authorityTier: c.sourceTier,
        fieldAuthority: c.fieldAuthority,
        retrievedAt: c.sourceAccessedAt,
        publishedAt: c.sourcePublishedAt,
        observationCount: c.observationCount,
        value: c.value,
        normalizedValue: c.normalizedValue,
        extraction: c.extraction ? {
          sourceStatement: c.extraction.sourceStatement,
          temporalType: c.extraction.temporalType,
          approximation: c.extraction.approximation,
        } : null,
        identity: c.identity ? {
          state: c.identity.identityClass,
          strength: c.entityMatchScore,
          reason: c.identity.reason,
          signals: c.identity.signals.map((s) => ({ signal: s.signal, outcome: s.outcome, detail: s.detail })),
          publisher: c.identity.publisher,
          registry: c.registry ? {
            provider: c.registry.provider, jurisdiction: c.registry.jurisdiction, scheme: c.registry.scheme,
            identifier: c.registry.registryId, legalEntity: c.registry.legalEntity, status: c.registry.status,
            role: c.registry.role, verified: c.registry.association?.registryVerified ?? false,
            evidence: c.registry.association ? { establishedBy: c.registry.association.establishedBy, chain: c.registry.association.chain } : null,
          } : null,
          domainAssociation: c.domainAssociation ?? null,
        } : null,
        sourceKind: c.sourceKind ?? null,
        sourceRegistryId: c.sourceRegistryId || null,
      })),
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: { companyId: string },
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed', message: 'This endpoint is read-only.' });
    return;
  }

  // The GUARD's companyId is authoritative — never the raw path parameter.
  const companyId = ctx.companyId;

  try {
    const store = storeFactory();
    const fields = await store.listFields(companyId);
    const claims = await store.listClaims(companyId);

    res.status(200).json({
      companyId,
      fieldCount: fields.length,
      fields: fields.map((f) => toView(f, claims)),
      // Honest disclosure travels with the payload, so a client cannot mistake
      // an empty result for "this company has no evidence to find".
      disclosure:
        fields.length === 0
          ? 'No grounding state is persisted for this company. The grounding migration has not been applied in this environment, and no acquisition run has been stored.'
          : 'Every externally sourced value below carries the URL Omnivyra retrieved it from. Synthesis is labelled and never presented as an external fact.',
    });
  } catch {
    // Never leak internals on failure.
    res.status(500).json({ error: 'grounding_read_failed' });
  }
}

export default withTenantGuard(handler, {
  resolveCompanyId: (req) => {
    const q = req.query as Record<string, unknown>;
    const v = q.companyId;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  },
});
