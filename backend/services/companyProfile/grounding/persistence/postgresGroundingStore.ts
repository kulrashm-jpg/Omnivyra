/**
 * CPG-005A — PostgreSQL implementation of `GroundingStorePort`.
 *
 * A thin translation of the SAME port the in-memory store implements. It adds no
 * logic: idempotency, user-lock protection, conflict handling and history
 * semantics all live in `persistGrounding`, which is storage-agnostic. That is
 * deliberate — the guarantees are proven once, against both implementations.
 *
 * ─── WHAT THE DATABASE ENFORCES THAT THE PORT CANNOT ───────────────────────
 *   • `uq_cgc_natural_key` makes duplicate claims impossible even if a caller
 *     bypasses `persistGrounding`;
 *   • CHECK constraints make a synthesis-with-a-source-URL unstorable;
 *   • the append-only TRIGGER refuses UPDATE/DELETE on history even for a
 *     service-role connection, which RLS alone would not stop;
 *   • FKs stop grounding outliving its tenant.
 *
 * ─── TENANT SAFETY ─────────────────────────────────────────────────────────
 * Every statement is company-scoped. This adapter NEVER derives a company id
 * from caller-supplied data — the id arrives already authorized by TenantGuard.
 * RLS is a fail-closed backstop beneath that (see the CPG-005A report §M).
 *
 * The `pg` client is injected, so nothing here opens a connection on import and
 * no connection string is read, logged or embedded.
 */

import type { GroundingHistoryEntry } from '../types';
import type { GroundingStorePort, PersistedClaim, PersistedField } from './groundingStore';

/** Minimal query surface — satisfied by `pg.Client`, `pg.Pool`, or a fake. */
export interface SqlExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const CLAIM_COLS = `company_id, field, value, normalized_value, claim_kind, source_type, source_name,
  source_url, provider_family, source_published_at, source_accessed_at, source_tier, field_authority,
  excerpt, verification_method, entity_match_status, entity_match_score, freshness,
  observation_count, first_seen_at, last_seen_at, last_verified_at, created_by,
  extraction_statement, temporal_type, period_label, period_year, currency, approximation,
  money_kind, extraction_method, accepted_because,
  discovery_provider, discovery_query, discovery_rank, measure_qualifier,
  source_host, publisher, identity_evidence, identity_class, identity_reason, identity_signals,
  source_registry_id, source_kind, registry_provider, registry_id, legal_entity_name,
  identity_association, domain_association_reason, domain_association,
  registry_jurisdiction, registry_scheme, registry_status, registry_role`;

/** CPG-007 — rebuild extraction provenance; null for every non-extracted claim. */
function rowToExtraction(r: Record<string, unknown>): PersistedClaim['extraction'] {
  if (r.extraction_method == null) return null;
  return {
    sourceStatement: r.extraction_statement as string,
    temporalType: r.temporal_type as NonNullable<PersistedClaim['extraction']>['temporalType'],
    period: (r.period_label as string) ?? null,
    year: r.period_year == null ? null : Number(r.period_year),
    currency: (r.currency as string) ?? null,
    approximation: Boolean(r.approximation),
    moneyKind: (r.money_kind as string) ?? null,
    method: r.extraction_method as 'json_ld' | 'explicit_statement',
    acceptedBecause: r.accepted_because as string,
    qualifier: (r.measure_qualifier as string) ?? null,
  };
}

function rowToClaim(r: Record<string, unknown>): PersistedClaim {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string));
  return {
    companyId: r.company_id as string, field: r.field as string, value: r.value as string,
    normalizedValue: r.normalized_value as string, claimKind: r.claim_kind as PersistedClaim['claimKind'],
    sourceType: r.source_type as string, sourceName: r.source_name as string,
    sourceUrl: (r.source_url as string) ?? null, providerFamily: r.provider_family as string,
    sourcePublishedAt: r.source_published_at ? iso(r.source_published_at) : null,
    sourceAccessedAt: iso(r.source_accessed_at), sourceTier: Number(r.source_tier),
    fieldAuthority: r.field_authority as string, excerpt: (r.excerpt as string) ?? null,
    verificationMethod: r.verification_method as string,
    entityMatchStatus: r.entity_match_status as string, entityMatchScore: Number(r.entity_match_score),
    freshness: r.freshness as string, observationCount: Number(r.observation_count),
    firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at),
    createdBy: r.created_by as string,
    extraction: rowToExtraction(r),
    discovery: r.discovery_provider == null ? null : {
      provider: r.discovery_provider as string,
      query: r.discovery_query as string,
      rank: Number(r.discovery_rank),
    },
    identity: r.identity_class == null ? null : {
      identityClass: r.identity_class as NonNullable<PersistedClaim['identity']>['identityClass'],
      reason: (r.identity_reason as string) ?? '',
      signals: (r.identity_signals ?? []) as NonNullable<PersistedClaim['identity']>['signals'],
      sourceHost: (r.source_host as string) ?? null,
      publisher: (r.publisher as string) ?? null,
      evidence: (r.identity_evidence ?? []) as NonNullable<PersistedClaim['identity']>['evidence'],
    },
    // CPG-010 — null for rows written before CPG-010 (never back-filled by guess).
    sourceRegistryId: (r.source_registry_id as string) ?? '',
    sourceKind: ((r.source_kind as string) ?? 'other') as PersistedClaim['sourceKind'],
    registry: r.registry_id == null && r.legal_entity_name == null ? null : {
      provider: (r.registry_provider as string) ?? null,
      jurisdiction: (r.registry_jurisdiction as string) ?? null,
      scheme: (r.registry_scheme as string) ?? null,
      registryId: (r.registry_id as string) ?? null,
      legalEntity: (r.legal_entity_name as string) ?? null,
      status: (r.registry_status as string) ?? null,
      role: (r.registry_role as string) ?? null,
      association: (r.identity_association ?? null) as NonNullable<PersistedClaim['registry']>['association'],
    },
    domainAssociation: r.domain_association == null ? null : {
      ...(r.domain_association as { domain: string; source: string }),
      reason: r.domain_association_reason as string,
    },
  };
}

function rowToField(r: Record<string, unknown>): PersistedField {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string));
  return {
    companyId: r.company_id as string, field: r.field as string, claimKind: r.claim_kind as string,
    status: r.status as PersistedField['status'],
    effectiveValue: (r.effective_value as string) ?? null,
    effectiveValueSource: r.effective_value_source as PersistedField['effectiveValueSource'],
    userValue: (r.user_value as string) ?? null,
    userAssertedAt: r.user_asserted_at ? iso(r.user_asserted_at) : null,
    confidenceScore: Number(r.confidence_score), confidenceBand: r.confidence_band as string,
    confidenceComponents: (r.confidence_components ?? {}) as Record<string, number>,
    freshness: r.freshness as string, entityMatchStatus: r.entity_match_status as string,
    independentFamilies: Number(r.independent_families),
    isMaterialConflict: Boolean(r.is_material_conflict),
    confirmationStatus: r.confirmation_status as string,
    acquisitionOutcome: (r.acquisition_outcome ?? { sources: [] }) as PersistedField['acquisitionOutcome'],
    lastVerifiedAt: r.last_verified_at ? iso(r.last_verified_at) : null,
    updatedAt: iso(r.updated_at),
    evidenceState: (r.evidence_state as PersistedField['evidenceState']) ?? null,
    adjudicationOutcome: (r.adjudication_outcome as PersistedField['adjudicationOutcome']) ?? null,
    adjudicationReason: (r.adjudication_reason as string) ?? null,
    requiresReview: Boolean(r.requires_review),
    adjudicationCandidates: (r.adjudication_candidates ?? []) as PersistedField['adjudicationCandidates'],
    identityFamilies: Number(r.identity_families ?? 0),
  };
}

/** The natural key is (company_id, field, normalized_value, coalesce(source_url,'')). */
function keyParts(key: string): { companyId: string; field: string; normalizedValue: string; sourceUrl: string } {
  const [companyId, field, normalizedValue, sourceUrl] = key.split('|');
  return { companyId, field, normalizedValue, sourceUrl: sourceUrl ?? '' };
}

export function createPostgresGroundingStore(sql: SqlExecutor): GroundingStorePort {
  return {
    async getClaim(key) {
      const k = keyParts(key);
      const { rows } = await sql.query(
        `select ${CLAIM_COLS} from public.company_grounding_claims
         where company_id = $1 and field = $2 and normalized_value = $3 and coalesce(source_url,'') = $4`,
        [k.companyId, k.field, k.normalizedValue, k.sourceUrl],
      );
      return rows[0] ? rowToClaim(rows[0]) : null;
    },

    async upsertClaim(_key, c) {
      // ON CONFLICT on the natural key: re-observation updates bookkeeping only.
      // It NEVER rewrites `value` or `first_seen_at`, so history cannot be lost.
      await sql.query(
        `insert into public.company_grounding_claims (${CLAIM_COLS})
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
                 $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,
                 $43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54)
         on conflict (company_id, field, normalized_value, coalesce(source_url,''))
         do update set
           observation_count = public.company_grounding_claims.observation_count + 1,
           last_seen_at      = excluded.last_seen_at,
           freshness         = excluded.freshness,
           entity_match_status = excluded.entity_match_status,
           entity_match_score  = excluded.entity_match_score,
           last_verified_at    = excluded.last_verified_at,
           -- CPG-009: the identity DECISION may improve as the company's
           -- identity is established (e.g. an alias); the document's own
           -- statements (identity_evidence, source_host, publisher) never change.
           identity_class      = excluded.identity_class,
           identity_reason     = excluded.identity_reason,
           identity_signals    = excluded.identity_signals,
           -- CPG-010: attribution and association are DECISIONS (an alias or a
           -- registry identity established later changes them); the registry
           -- identity the document declares is provenance — filled once, never
           -- rewritten (trigger).
           source_registry_id  = excluded.source_registry_id,
           provider_family     = excluded.provider_family,
           source_tier         = excluded.source_tier,
           field_authority     = excluded.field_authority,
           source_kind         = excluded.source_kind,
           identity_association = excluded.identity_association,
           domain_association_reason = excluded.domain_association_reason,
           domain_association  = excluded.domain_association,
           registry_provider   = coalesce(public.company_grounding_claims.registry_provider, excluded.registry_provider),
           registry_id         = coalesce(public.company_grounding_claims.registry_id, excluded.registry_id),
           legal_entity_name   = coalesce(public.company_grounding_claims.legal_entity_name, excluded.legal_entity_name),
           registry_scheme     = coalesce(public.company_grounding_claims.registry_scheme, excluded.registry_scheme),
           registry_jurisdiction = coalesce(public.company_grounding_claims.registry_jurisdiction, excluded.registry_jurisdiction),
           registry_status     = excluded.registry_status,
           registry_role       = excluded.registry_role`,
        [
          c.companyId, c.field, c.value, c.normalizedValue, c.claimKind, c.sourceType, c.sourceName,
          c.sourceUrl, c.providerFamily, c.sourcePublishedAt, c.sourceAccessedAt, c.sourceTier,
          c.fieldAuthority, c.excerpt, c.verificationMethod, c.entityMatchStatus, c.entityMatchScore,
          c.freshness, c.observationCount, c.firstSeenAt, c.lastSeenAt, null, c.createdBy,
          // CPG-007 — written on first insert only; ON CONFLICT never touches
          // them and a trigger forbids rewriting them.
          c.extraction?.sourceStatement ?? null, c.extraction?.temporalType ?? null,
          c.extraction?.period ?? null, c.extraction?.year ?? null, c.extraction?.currency ?? null,
          c.extraction ? c.extraction.approximation : null, c.extraction?.moneyKind ?? null,
          c.extraction?.method ?? null, c.extraction?.acceptedBecause ?? null,
          c.discovery?.provider ?? null, c.discovery?.query ?? null, c.discovery?.rank ?? null,
          c.extraction ? c.extraction.qualifier ?? null : null,
          // CPG-009 — document provenance (immutable) + this claim's identity decision.
          c.identity?.sourceHost ?? null, c.identity?.publisher ?? null,
          JSON.stringify(c.identity?.evidence ?? []),
          c.identity?.identityClass ?? null, c.identity ? c.identity.reason || null : null,
          JSON.stringify(c.identity?.signals ?? []),
          // CPG-010
          c.sourceRegistryId || null, c.sourceKind ?? null,
          c.registry?.provider ?? null, c.registry?.registryId ?? null, c.registry?.legalEntity ?? null,
          c.registry?.association ? JSON.stringify(c.registry.association) : null,
          c.domainAssociation?.reason ?? null,
          c.domainAssociation ? JSON.stringify({ domain: c.domainAssociation.domain, source: c.domainAssociation.source }) : null,
          // CPG-011
          c.registry?.jurisdiction ?? null, c.registry?.scheme && c.registry.registryId ? c.registry.scheme : null,
          c.registry?.status === 'active' || c.registry?.status === 'inactive' ? c.registry.status : null,
          c.registry?.role ?? null,
        ],
      );
    },

    async listClaims(companyId, field) {
      const { rows } = field
        ? await sql.query(`select ${CLAIM_COLS} from public.company_grounding_claims where company_id=$1 and field=$2 order by field, value`, [companyId, field])
        : await sql.query(`select ${CLAIM_COLS} from public.company_grounding_claims where company_id=$1 order by field, value`, [companyId]);
      return rows.map(rowToClaim);
    },

    async getField(companyId, field) {
      const { rows } = await sql.query(
        `select * from public.company_grounding_fields where company_id=$1 and field=$2`, [companyId, field],
      );
      return rows[0] ? rowToField(rows[0]) : null;
    },

    async putField(f) {
      await sql.query(
        `insert into public.company_grounding_fields
           (company_id, field, claim_kind, status, effective_value, effective_value_source, user_value,
            user_asserted_at, confidence_score, confidence_band, confidence_components, freshness,
            entity_match_status, independent_families, is_material_conflict, confirmation_status,
            acquisition_outcome, last_verified_at, updated_at,
            evidence_state, adjudication_outcome, adjudication_reason, requires_review, adjudication_candidates,
            identity_families)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         on conflict (company_id, field) do update set
           claim_kind=excluded.claim_kind, status=excluded.status,
           effective_value=excluded.effective_value, effective_value_source=excluded.effective_value_source,
           user_value=coalesce(excluded.user_value, public.company_grounding_fields.user_value),
           user_asserted_at=coalesce(excluded.user_asserted_at, public.company_grounding_fields.user_asserted_at),
           confidence_score=excluded.confidence_score, confidence_band=excluded.confidence_band,
           confidence_components=excluded.confidence_components, freshness=excluded.freshness,
           entity_match_status=excluded.entity_match_status, independent_families=excluded.independent_families,
           is_material_conflict=excluded.is_material_conflict, confirmation_status=excluded.confirmation_status,
           acquisition_outcome=excluded.acquisition_outcome, last_verified_at=excluded.last_verified_at,
           updated_at=excluded.updated_at,
           evidence_state=excluded.evidence_state, adjudication_outcome=excluded.adjudication_outcome,
           adjudication_reason=excluded.adjudication_reason, requires_review=excluded.requires_review,
           adjudication_candidates=excluded.adjudication_candidates,
           identity_families=excluded.identity_families`,
        [
          f.companyId, f.field, f.claimKind, f.status, f.effectiveValue, f.effectiveValueSource,
          f.userValue, f.userAssertedAt, f.confidenceScore, f.confidenceBand,
          JSON.stringify(f.confidenceComponents), f.freshness, f.entityMatchStatus,
          f.independentFamilies, f.isMaterialConflict, f.confirmationStatus,
          JSON.stringify(f.acquisitionOutcome), f.lastVerifiedAt, f.updatedAt,
          f.evidenceState, f.adjudicationOutcome, f.adjudicationReason, f.requiresReview,
          JSON.stringify(f.adjudicationCandidates), f.identityFamilies,
        ],
      );
    },

    async listFields(companyId) {
      const { rows } = await sql.query(
        `select * from public.company_grounding_fields where company_id=$1 order by field`, [companyId],
      );
      return rows.map(rowToField);
    },

    async appendHistory(companyId, entry) {
      // INSERT ONLY. There is deliberately no update/delete method on this port,
      // and the database trigger refuses them regardless of caller.
      await sql.query(
        `insert into public.company_grounding_history
           (company_id, field, occurred_at, actor, action, from_value, to_value, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, entry.field, entry.at, entry.actor, entry.action, entry.fromValue, entry.toValue, entry.note],
      );
    },

    async listHistory(companyId, field) {
      const { rows } = field
        ? await sql.query(`select * from public.company_grounding_history where company_id=$1 and field=$2 order by occurred_at`, [companyId, field])
        : await sql.query(`select * from public.company_grounding_history where company_id=$1 order by occurred_at`, [companyId]);
      return rows.map((r) => ({
        field: r.field as string,
        at: (r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at) as string,
        actor: r.actor as string,
        action: r.action as GroundingHistoryEntry['action'],
        fromValue: (r.from_value as string) ?? null,
        toValue: (r.to_value as string) ?? null,
        note: (r.note as string) ?? '',
        evidenceIds: [],
      }));
    },
  };
}
