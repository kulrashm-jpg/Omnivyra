/**
 * CPG-005 — grounding persistence (§7, §8, §13, §14).
 *
 * Consumes the EXISTING CPG-001/002/003 objects. It creates no second resolver,
 * no second source registry and no second conflict engine — it stores what those
 * produced, and nothing more.
 *
 * ─── THE IDEMPOTENCY RULE (§8) ─────────────────────────────────────────────
 * A claim's natural key is (companyId, field, normalizedValue, sourceUrl).
 *
 *   • SAME claim, same document, observed again → the SAME row, with
 *     `observationCount` incremented and `lastSeenAt` advanced. Re-running
 *     acquisition daily must not grow the table without bound.
 *   • CHANGED value from the same document → a DIFFERENT natural key, so a NEW
 *     row. The old row survives, and a `value_changed` history entry records the
 *     transition. This is the opposite of a destructive upsert.
 *   • CONFLICTING value from another document → a new row; the resolver, not the
 *     store, decides what that means.
 *   • USER CORRECTION → never touches claims at all; it is a history entry plus
 *     a field-state update.
 *
 * ─── WHAT THE STORE MUST NEVER DO ──────────────────────────────────────────
 *   • overwrite a user-locked effective value (§12);
 *   • resolve a conflict (that is the resolver's job, already done);
 *   • invent a value because a column is NOT NULL (§14) — an unavailable source
 *     is persisted AS an unavailable source, never as an unverified fact;
 *   • delete history.
 *
 * The `GroundingStorePort` is injectable so every one of these behaviours is
 * provable deterministically without a database. The Supabase adapter is a thin
 * translation of the same port.
 */

import type {
  AdjudicationCandidate, AdjudicationOutcome, DiscoveryRef, EvidenceState, GroundedField, EvidenceClaim,
  ExtractionProvenance, GroundingHistoryEntry, IdentityClass, IdentityEvidence, IdentitySignal, SourceKind,
} from '../types';
import type { SourceOutcome } from '../acquisition/orchestrator';
import { classifySource, hostOf } from '../sourceAuthority';
import { authorityForField, countIndependentFamilies, providerFamily, registrySourceIdFor } from '../acquisition/sourceRegistry';
import { comparisonKey } from '../claimResolution';
import { normalizeRegistryId } from '../registryIdentity';
import { normalizeValue } from '../acquisition/evidenceSource';

// ── persisted shapes ─────────────────────────────────────────────────────────

export interface PersistedClaim {
  companyId: string;
  field: string;
  value: string;
  normalizedValue: string;
  claimKind: GroundedField['kind'];
  sourceType: string;
  sourceName: string;
  sourceUrl: string | null;
  providerFamily: string;
  sourcePublishedAt: string | null;
  sourceAccessedAt: string;
  sourceTier: number;
  fieldAuthority: string;
  excerpt: string | null;
  verificationMethod: string;
  entityMatchStatus: string;
  entityMatchScore: number;
  freshness: string;
  observationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdBy: string;
  /** CPG-007 — present only for values read from an explicit document statement. */
  extraction: ExtractionProvenance | null;
  /** CPG-007 §19 — present only for documents surfaced by public-web discovery. */
  discovery: DiscoveryRef | null;
  /**
   * CPG-009 — why THIS document was attributed to the company: its own
   * identity decision (not the field's best match), plus the document-side
   * provenance it was made from.
   */
  identity: {
    identityClass: IdentityClass;
    reason: string;
    signals: IdentitySignal[];
    sourceHost: string | null;
    publisher: string | null;
    /** What the document itself states (immutable provenance). */
    evidence: IdentityEvidence[];
  } | null;
  /** CPG-010 — the CPG-003 source the claim was attributed to (host binding, established aliases). */
  sourceRegistryId: string;
  /** CPG-010 §3 — what kind of document it is. Description, not authority. */
  sourceKind: SourceKind;
  /**
   * CPG-010 §15 — the registry identity the DOCUMENT declares (a registry record's
   * own CIK / legal name) and how that identity was tied to the company. Null for
   * documents that declare none.
   */
  registry: {
    /** Provider id from the provider registry — an open string (CPG-011), never a fixed list. */
    provider: string | null;
    /** CPG-011 — country-qualified jurisdiction ("US-DE", "FR"). */
    jurisdiction: string | null;
    /** CPG-011 — identifier scheme ("CIK", "SIREN", "LEI", …). */
    scheme: string | null;
    registryId: string | null;
    legalEntity: string | null;
    /** CPG-011 — as the registry states it (active / inactive), or null. */
    status: string | null;
    /** CPG-011 — subject | site_publisher | related_entity. */
    role: string | null;
    /** establishedBy + registryVerified + the provenance chain. */
    association: { establishedBy: string; registryVerified: boolean; chain: { step: string; sourceUrl: string | null; detail: string }[] } | null;
  } | null;
  /** CPG-010 §8 — the explicit domain association the document's host / entity rests on. */
  domainAssociation: { domain: string; reason: string; source: string } | null;
}

export interface PersistedField {
  companyId: string;
  field: string;
  claimKind: string;
  status: GroundedField['status'];
  effectiveValue: string | null;
  effectiveValueSource: GroundedField['effectiveValueSource'];
  userValue: string | null;
  userAssertedAt: string | null;
  confidenceScore: number;
  confidenceBand: string;
  confidenceComponents: Record<string, number>;
  freshness: string;
  entityMatchStatus: string;
  independentFamilies: number;
  isMaterialConflict: boolean;
  confirmationStatus: string;
  /** §14 — how acquisition actually went, including failures. */
  acquisitionOutcome: { sources: SourceOutcome[] };
  lastVerifiedAt: string | null;
  updatedAt: string;
  // ── CPG-008 — why the field has, or does not have, an effective value ──
  /** Null only for rows written before CPG-008. */
  evidenceState: EvidenceState | null;
  adjudicationOutcome: AdjudicationOutcome | null;
  adjudicationReason: string | null;
  requiresReview: boolean;
  /** Every competing / observed value with its provenance summary. */
  adjudicationCandidates: AdjudicationCandidate[];
  /**
   * CPG-009 — independent families whose documents DECISIVELY establish the
   * company's identity AND support the effective value. PUBLICLY_VERIFIED
   * requires ≥1 (DB CHECK).
   */
  identityFamilies: number;
}

/** The natural key that makes re-observation idempotent. */
export function claimNaturalKey(c: { companyId: string; field: string; normalizedValue: string; sourceUrl: string | null }): string {
  return `${c.companyId}|${c.field}|${c.normalizedValue}|${c.sourceUrl ?? ''}`;
}

/** Storage port. Supabase is one implementation; the in-memory store is another. */
export interface GroundingStorePort {
  getClaim(key: string): Promise<PersistedClaim | null>;
  upsertClaim(key: string, claim: PersistedClaim): Promise<void>;
  listClaims(companyId: string, field?: string): Promise<PersistedClaim[]>;
  getField(companyId: string, field: string): Promise<PersistedField | null>;
  putField(f: PersistedField): Promise<void>;
  listFields(companyId: string): Promise<PersistedField[]>;
  /** Append-only. An implementation MUST NOT expose update or delete. */
  appendHistory(companyId: string, entry: GroundingHistoryEntry & { field: string }): Promise<void>;
  listHistory(companyId: string, field?: string): Promise<(GroundingHistoryEntry & { field: string })[]>;
}

// ── in-memory implementation (tests + non-production harness) ────────────────

export function createInMemoryStore(): GroundingStorePort & { _dump(): { claims: number; fields: number; history: number } } {
  const claims = new Map<string, PersistedClaim>();
  const fields = new Map<string, PersistedField>();
  const history: (GroundingHistoryEntry & { field: string; companyId: string })[] = [];

  return {
    async getClaim(key) { return claims.get(key) ?? null; },
    async upsertClaim(key, claim) { claims.set(key, claim); },
    async listClaims(companyId, field) {
      return [...claims.values()]
        .filter((c) => c.companyId === companyId && (!field || c.field === field))
        .sort((a, b) => (a.field + a.value).localeCompare(b.field + b.value));
    },
    async getField(companyId, field) { return fields.get(`${companyId}|${field}`) ?? null; },
    async putField(f) { fields.set(`${f.companyId}|${f.field}`, f); },
    async listFields(companyId) {
      return [...fields.values()].filter((f) => f.companyId === companyId).sort((a, b) => a.field.localeCompare(b.field));
    },
    async appendHistory(companyId, entry) { history.push({ ...entry, companyId }); },
    async listHistory(companyId, field) {
      return history.filter((h) => h.companyId === companyId && (!field || h.field === field));
    },
    _dump: () => ({ claims: claims.size, fields: fields.size, history: history.length }),
  };
}

// ── persistence ──────────────────────────────────────────────────────────────

export interface PersistInput {
  companyId: string;
  companyDomain: string | null;
  fields: readonly GroundedField[];
  sourceOutcomes: readonly SourceOutcome[];
  actor: string;
  asOf: string;
}

export interface PersistResult {
  claimsInserted: number;
  claimsReobserved: number;
  claimsChanged: number;
  fieldsWritten: number;
  historyAppended: number;
  userLockedPreserved: string[];
  /** §14 — sources that could not answer, recorded rather than hidden. */
  unavailableSources: { sourceId: string; state: string; reason?: string }[];
}

function toPersistedClaim(
  e: EvidenceClaim, g: GroundedField, companyDomain: string | null, actor: string, asOf: string,
): PersistedClaim {
  // CPG-010: the resolver's own attribution (it saw the established aliases);
  // re-derived only for fields resolved before CPG-010.
  const a = g.sourceAttribution?.[e.claimId];
  const cls = classifySource(e.sourceUrl, e.sourceType, companyDomain);
  const host = hostOf(e.sourceUrl);
  const srcId = a?.sourceId ?? registrySourceIdFor(host, e.sourceName, companyDomain, !!e.discovery);
  const declared = e.entitySignals.registryIdentities?.[0] ?? null;
  return {
    companyId: g.companyId, field: e.field, value: e.value, normalizedValue: e.normalizedValue,
    claimKind: g.kind,
    sourceType: e.sourceType, sourceName: e.sourceName, sourceUrl: e.sourceUrl,
    providerFamily: a?.family ?? providerFamily(srcId, host),
    sourcePublishedAt: e.sourcePublishedAt, sourceAccessedAt: e.sourceAccessedAt,
    sourceTier: a?.tier ?? cls.tier,
    fieldAuthority: a?.authority ?? authorityForField(srcId, e.field),
    excerpt: e.excerpt, verificationMethod: e.verificationMethod,
    // ⚠️ CPG-009 FIX — the claim's OWN match. Every row used to carry the
    // field's best match, so a name-only article looked as well identified as
    // the company's own site stored beside it.
    entityMatchStatus: (g.entityMatches?.[e.claimId] ?? g.entityMatch).status,
    entityMatchScore: (g.entityMatches?.[e.claimId] ?? g.entityMatch).score,
    freshness: g.freshness,
    observationCount: 1, firstSeenAt: asOf, lastSeenAt: asOf, createdBy: actor,
    extraction: e.extraction ?? null,
    discovery: e.discovery ?? null,
    identity: (() => {
      const m = g.entityMatches?.[e.claimId];
      if (!m?.identity) return null;
      return {
        identityClass: m.identity, reason: m.reason ?? '', signals: m.signals ?? [],
        sourceHost: e.entitySignals.sourceHost ?? null, publisher: e.entitySignals.publisher ?? null,
        evidence: e.entitySignals.identityEvidence ?? [],
      };
    })(),
    sourceRegistryId: srcId,
    sourceKind: a?.sourceKind ?? cls.sourceKind,
    registry: e.entitySignals.registryId || declared || e.entitySignals.legalEntity ? {
      provider: declared?.provider ?? null,
      jurisdiction: declared?.jurisdiction ?? null,
      // Normalised and scheme-qualified ("SIREN:542051180"); the DB accepts qualified ids only.
      ...(() => { const n = normalizeRegistryId(e.entitySignals.registryId ?? declared?.registryId ?? null);
        return { registryId: n?.registryId ?? null, scheme: n ? n.scheme : null }; })(),
      legalEntity: e.entitySignals.legalEntity ?? declared?.legalName ?? null,
      status: declared?.status ?? null,
      role: declared ? declared.role ?? 'subject' : null,
      association: declared ? { establishedBy: declared.establishedBy, registryVerified: declared.registryVerified, chain: declared.chain } : null,
    } : null,
    domainAssociation: a?.domainAssociation ?? null,
  };
}

/**
 * CPG-008 — the stored evidence state, reconciled with what persistence
 * actually keeps. When the user-lock rule retains a prior user value over the
 * resolver's output, the field IS effective (the user's value), whatever the
 * public adjudication said.
 */
function persistedAdjudication(
  g: GroundedField, effectiveValue: string | null, effectiveValueSource: GroundedField['effectiveValueSource'],
): Pick<PersistedField, 'evidenceState' | 'adjudicationOutcome' | 'adjudicationReason' | 'requiresReview' | 'adjudicationCandidates'> {
  const a = g.adjudication;
  if (!a) {
    return { evidenceState: null, adjudicationOutcome: null, adjudicationReason: null, requiresReview: false, adjudicationCandidates: [] };
  }
  const lockedByUser = effectiveValue !== g.effectiveValue
    && (effectiveValueSource === 'user' || effectiveValueSource === 'user_correction');
  if (lockedByUser) {
    return {
      evidenceState: 'EFFECTIVE', adjudicationOutcome: 'USER_VALUE',
      adjudicationReason: `user-locked value retained over this acquisition (public evidence: ${a.outcome} — ${a.reason})`,
      requiresReview: false, adjudicationCandidates: a.candidates,
    };
  }
  return {
    evidenceState: a.evidenceState, adjudicationOutcome: a.outcome, adjudicationReason: a.reason,
    requiresReview: a.requiresReview, adjudicationCandidates: a.candidates,
  };
}

/**
 * Persist one orchestration result. Deterministic and idempotent.
 * Never mutates its inputs; never resolves a conflict; never fabricates a value.
 */
export async function persistGrounding(store: GroundingStorePort, input: PersistInput): Promise<PersistResult> {
  const res: PersistResult = {
    claimsInserted: 0, claimsReobserved: 0, claimsChanged: 0, fieldsWritten: 0,
    historyAppended: 0, userLockedPreserved: [],
    unavailableSources: input.sourceOutcomes
      .filter((o) => o.state !== 'retrieved')
      .map((o) => ({ sourceId: o.sourceId, state: o.state, reason: o.reason })),
  };

  for (const g of input.fields) {
    // ── claims ──────────────────────────────────────────────────────────────
    // CPG-007: one document can state the same value twice ("raised a total of
    // $332M over 7 funding rounds" … "raised a total of $332M over 7 rounds").
    // Within ONE persistence call that is one observation, not two — counting
    // it twice would read as corroboration it is not.
    const seenThisRun = new Set<string>();
    for (const e of g.evidence) {
      const candidate = toPersistedClaim(e, g, input.companyDomain, input.actor, input.asOf);
      const key = claimNaturalKey(candidate);
      if (seenThisRun.has(key)) continue;
      seenThisRun.add(key);
      const existing = await store.getClaim(key);
      if (existing) {
        // Same claim, same document, seen again — bookkeeping only.
        await store.upsertClaim(key, {
          ...existing,
          observationCount: existing.observationCount + 1,
          lastSeenAt: input.asOf,
          freshness: candidate.freshness,
          entityMatchStatus: candidate.entityMatchStatus,
          entityMatchScore: candidate.entityMatchScore,
          // CPG-009: the identity DECISION is re-evaluated; the document's own
          // statements (provenance) are kept exactly as first observed.
          identity: candidate.identity && existing.identity
            ? { ...existing.identity, identityClass: candidate.identity.identityClass, reason: candidate.identity.reason, signals: candidate.identity.signals }
            : existing.identity ?? candidate.identity,
          // CPG-010: attribution / association are decisions (re-evaluated); the
          // registry identity the document declares is provenance (kept).
          sourceRegistryId: candidate.sourceRegistryId, sourceKind: candidate.sourceKind,
          providerFamily: candidate.providerFamily, sourceTier: candidate.sourceTier, fieldAuthority: candidate.fieldAuthority,
          domainAssociation: candidate.domainAssociation,
          registry: existing.registry
            ? { ...existing.registry, association: candidate.registry?.association ?? existing.registry.association,
                // CPG-011: status and role are re-evaluated; provider, scheme, id, jurisdiction and legal entity are provenance.
                status: candidate.registry?.status ?? existing.registry.status, role: candidate.registry?.role ?? existing.registry.role }
            : candidate.registry,
        });
        res.claimsReobserved++;
      } else {
        await store.upsertClaim(key, candidate);
        res.claimsInserted++;
      }
    }

    // ── field state ─────────────────────────────────────────────────────────
    const prior = await store.getField(g.companyId, g.field);

    // §12 — a user-locked effective value can never be replaced by a mere
    // ACQUISITION. But it MUST be replaceable by an explicit USER DECISION.
    //
    // CPG-005A found this the hard way: the first version blocked
    // `accept_public` too, because that decision leaves effectiveValueSource as
    // 'public_evidence' and the guard saw only "incoming is not user-sourced".
    // The in-memory test missed it — it started from an empty store, so no
    // prior existed to guard against. Persisting the conflict first, as the
    // database run did, exposed it.
    //
    // The distinguishing signal is the confirmation status: these values are set
    // ONLY by `applyUserDecision`, so their presence means a person acted.
    const USER_DECIDED = new Set([
      'USER_CONFIRMED_OWN_VALUE', 'USER_ACCEPTED_PUBLIC_VALUE', 'USER_CONFIRMED_CORRECTION',
      'PUBLIC_SOURCE_MARKED_STALE', 'USER_SUPPLIED_ALTERNATIVE_SOURCE',
    ]);
    const userLocked = prior?.effectiveValueSource === 'user' || prior?.effectiveValueSource === 'user_correction';
    const incomingIsUser = g.effectiveValueSource === 'user' || g.effectiveValueSource === 'user_correction';
    const incomingIsUserDecision = USER_DECIDED.has(g.confirmationStatus);
    let effectiveValue = g.effectiveValue;
    let effectiveValueSource = g.effectiveValueSource;
    if (userLocked && !incomingIsUser && !incomingIsUserDecision) {
      effectiveValue = prior!.effectiveValue;
      effectiveValueSource = prior!.effectiveValueSource;
      res.userLockedPreserved.push(g.field);
    }

    // §13 — a genuine change of the effective value is recorded, never erased.
    if (prior && prior.effectiveValue !== effectiveValue) {
      await store.appendHistory(g.companyId, {
        field: g.field, at: input.asOf, actor: input.actor, action: 'value_changed',
        fromValue: prior.effectiveValue, toValue: effectiveValue,
        note: `Effective value changed during acquisition (status ${prior.status} → ${g.status}).`,
        evidenceIds: g.evidence.map((e) => e.claimId),
      });
      res.historyAppended++;
      res.claimsChanged++;
    }

    // ⚠️ CPG-007 FIX — independent families SUPPORTING the effective value.
    // This counted the families of ALL evidence, so Stripe revenue — sources
    // stating $6.9B net and $19.4B — was persisted as "3 independent families",
    // which reads as corroboration. Evidence that disagrees, was entity-
    // rejected, or is `neverFor` this field (CPG-003) supports nothing.
    const effNorm = effectiveValueSource === 'user' || effectiveValueSource === 'user_correction'
      ? g.userClaim?.normalizedValue ?? null
      : g.evidence.find((e) => e.value === effectiveValue)?.normalizedValue ?? null;
    const effKey = effectiveValue === null ? null
      : comparisonKey(g.field, effectiveValue, effNorm ?? normalizeValue(effectiveValue));
    const notSupporting = new Set(g.conflictingEvidence.map((e) => e.claimId));
    const familyEntries = g.evidence
      .map((e) => {
        const host = hostOf(e.sourceUrl);
        const at = g.sourceAttribution?.[e.claimId];
        return { e, host, sourceId: at?.sourceId ?? registrySourceIdFor(host, e.sourceName, input.companyDomain, !!e.discovery), authority: at?.authority ?? null };
      })
      .filter(({ e, sourceId, authority }) => effKey !== null && !notSupporting.has(e.claimId)
        && (authority ?? authorityForField(sourceId, g.field)) !== 'never'
        && comparisonKey(g.field, e.value, e.normalizedValue) === effKey)
      .map(({ sourceId, host }) => ({ sourceId, host }));

    // CPG-009: when the user-lock rule keeps a prior user value, the stored
    // status must describe THAT value — not the status the resolver gave the
    // public evidence (which could read PUBLICLY_VERIFIED for a value that is
    // not the one stored).
    const lockRetained = effectiveValue !== g.effectiveValue
      && (effectiveValueSource === 'user' || effectiveValueSource === 'user_correction');
    await store.putField({
      companyId: g.companyId, field: g.field, claimKind: g.kind,
      status: lockRetained && g.status !== 'CONFLICTING' ? 'USER_PROVIDED' : g.status,
      effectiveValue, effectiveValueSource,
      userValue: g.userClaim?.value ?? prior?.userValue ?? null,
      userAssertedAt: g.userClaim?.assertedAt ?? prior?.userAssertedAt ?? null,
      confidenceScore: g.confidence.score, confidenceBand: g.confidence.band,
      confidenceComponents: g.confidence.components as unknown as Record<string, number>,
      freshness: g.freshness, entityMatchStatus: g.entityMatch.status,
      // CPG-008: when the resolver's own effective value is what gets stored,
      // its adjudicated supporting families are authoritative (self-
      // contradicting publishers already removed). A user-locked value that
      // overrode it falls back to the CPG-007 count above.
      independentFamilies: g.adjudication && effectiveValue === g.effectiveValue
        ? g.adjudication.supportingFamilies.length
        : countIndependentFamilies(familyEntries),
      isMaterialConflict: g.isMaterialConflict, confirmationStatus: g.confirmationStatus,
      acquisitionOutcome: { sources: [...input.sourceOutcomes] },
      lastVerifiedAt: g.lastVerifiedAt, updatedAt: input.asOf,
      ...persistedAdjudication(g, effectiveValue, effectiveValueSource),
      identityFamilies: g.adjudication && effectiveValue === g.effectiveValue
        ? (g.adjudication.verifiedIdentityFamilies ?? []).length : 0,
    });
    res.fieldsWritten++;

    // Carry the resolver's own history forward, append-only.
    for (const h of g.history) {
      await store.appendHistory(g.companyId, { ...h, field: g.field });
      res.historyAppended++;
    }
  }

  // §14 — a failed source is recorded as a failure, not as an unverified fact.
  for (const o of res.unavailableSources) {
    await store.appendHistory(input.companyId, {
      field: '*', at: input.asOf, actor: input.actor, action: 'acquisition_failed',
      fromValue: null, toValue: null,
      note: `Source ${o.sourceId} did not answer: ${o.state}${o.reason ? ` (${o.reason})` : ''}. No value was inferred from this outcome.`,
      evidenceIds: [],
    });
    res.historyAppended++;
  }

  return res;
}
