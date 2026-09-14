/**
 * CPG-001 — the claim-resolution engine (§4, §6, §7, §9, §10).
 *
 * Takes a user claim plus whatever external evidence exists for ONE field and
 * produces the grounded state: status, effective value, conflicts, freshness,
 * confidence, and whether the discrepancy is material enough to ask the user.
 *
 * THE INVARIANT THAT MATTERS MOST (§6):
 *   `resolve()` NEVER returns an effective value taken from public evidence when
 *   a user claim exists and disagrees with it. Disagreement produces
 *   status=CONFLICTING, effectiveValue = the USER's value, and a confirmation
 *   request. Only an explicit user decision (see `confirmation.ts`) can move the
 *   effective value off the user's claim. There is no code path that overwrites
 *   silently, and a test asserts this for every field type.
 *
 * REVENUE (§14): revenue-shaped values are compared only after `revenueKind`
 * classification. A TARGET, RUN-RATE or ORDER BOOK is NEVER treated as
 * comparable to an actual revenue figure, so a "₹10 Cr+ actual" vs "₹20 Cr
 * target" pair is not reported as a contradiction — they are different
 * measures, and conflating them is the exact error the Raina-12 freeze exposed.
 *
 * CPG-008 — PUBLIC-ONLY FIELDS: when the user supplied nothing, the effective
 * value is no longer "the highest-tier item". Public evidence is adjudicated
 * (`claimAdjudication.ts`, called only from here): a value becomes effective
 * only if it meets the sufficiency rule; disagreement between comparable
 * public claims is surfaced as CONFLICTING instead of settled by list order;
 * weak isolated claims stay OBSERVED, never effective.
 *
 * Pure and deterministic: `asOf` is injected; no clock, no RNG, no I/O.
 */

import type {
  Adjudication, ClaimKind, ClaimStatus, ConfirmationRequest, EntityMatch, EntitySignals, EvidenceClaim,
  EvidenceFreshness, FieldConfidence, GroundedField, GroundingHistoryEntry, SourceAttribution, UserClaim,
} from './types';
import { classifySource, hostOf, TIER_WEIGHT } from './sourceAuthority';
import { authorityForField, decisiveAliasFor, providerFamily, registrySourceIdFor } from './acquisition/sourceRegistry';
import { adjudicatePublic, measureOf, type AdjudicationContext } from './claimAdjudication';
import { ENTITY_MATCH_WEIGHT, resolveEntity } from './entityResolution';
import { canonicalMoneyKey } from './extraction/valueTypes';

import {
  computeConfidence, evidenceFreshness, FRESHNESS_WEIGHT, isMaterialConflict, REVENUE_FIELDS,
} from './claimMeasures';

// §9 / §10 / §14 per-value measures live in ./claimMeasures; re-exported so importers are unchanged.
export {
  CONFIDENCE_FORMULA, computeConfidence, evidenceFreshness, isMaterialConflict, isTriviallyDifferent, MATERIAL_FIELDS, revenueComparable, revenueKind, type RevenueKind,
} from './claimMeasures';

// ── the resolver ─────────────────────────────────────────────────────────────

/**
 * What two values are compared by — the ONE definition of "agrees", shared by
 * the resolver and persistence (CPG-007). Money: currency + amount; everything
 * else: the stored normalised text.
 */
export function comparisonKey(field: string, value: string, normalizedValue: string): string {
  return canonicalMoneyKey(field, value) ?? normalizedValue;
}

export interface ResolveInput {
  companyId: string;
  field: string;
  kind: ClaimKind;
  userClaim: UserClaim | null;
  evidence: readonly EvidenceClaim[];
  knownEntity: EntitySignals;
  companyDomain: string | null;
  asOf: string;
  /** Existing history to append to. Never truncated. */
  priorHistory?: readonly GroundingHistoryEntry[];
}

/**
 * The CPG-003 provider family of a claim.
 *
 * ⚠️ CPG-008 FIX — independence was counted by raw HOST here, separately from
 * CPG-003's families: blog.x.com and www.x.com were "two sources", and so were
 * two subdomains of one publisher. It now uses the one CPG-003 definition.
 */
function pathOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return null; }
}

/**
 * CPG-010 — THE source attribution of one claim: the CPG-003 source id (host
 * binding, established DECISIVE aliases, discovery), its kind, tier, family and
 * field authority for the claim's measure. Computed once per claim here and
 * persisted as computed, so persistence cannot re-derive it differently.
 */
export function attributeSource(e: EvidenceClaim, field: string, input: Pick<ResolveInput, 'companyDomain' | 'knownEntity'>): SourceAttribution {
  const host = hostOf(e.sourceUrl);
  const aliases = input.knownEntity.domainAliases;
  const sourceId = registrySourceIdFor(host, e.sourceName, input.companyDomain, !!e.discovery, { domainAliases: aliases, path: pathOf(e.sourceUrl) });
  const cls = classifySource(e.sourceUrl, e.sourceType, input.companyDomain, aliases);
  const measure = measureOf(field, e, REVENUE_FIELDS);
  const alias = decisiveAliasFor(host, aliases);
  const assoc = e.entitySignals.registryIdentities?.[0]?.domainAssociations?.[0] ?? null;
  return {
    sourceId, sourceKind: cls.sourceKind, tier: cls.tier,
    family: providerFamily(sourceId, host ?? e.sourceName),
    authority: authorityForField(sourceId, field, measure),
    measure,
    domainAssociation: alias ? { domain: alias.domain, reason: alias.evidence, source: alias.sourceUrl }
      : assoc ? { domain: assoc.domain, reason: assoc.associationReason, source: assoc.associationSource } : null,
  };
}

export function resolve(input: ResolveInput): GroundedField {
  const { companyId, field, kind, userClaim, asOf } = input;
  const history: GroundingHistoryEntry[] = [...(input.priorHistory ?? [])];

  // SYNTHESIS and RECOMMENDATION are never externally verified (§8).
  if (kind === 'SYNTHESIS' || kind === 'RECOMMENDATION') {
    return {
      companyId, field, kind, status: 'SYNTHESIZED',
      effectiveValue: userClaim?.value ?? null,
      effectiveValueSource: userClaim ? 'user' : 'none',
      userClaim, evidence: [], conflictingEvidence: [],
      entityMatch: { status: 'unresolved', score: 0, matchedOn: [], conflictingOn: [] },
      freshness: 'unknown',
      confidence: computeConfidence({ bestTierWeight: 0, independentSources: 0, freshness: 'unknown', entityMatchWeight: 0, conflicting: false }),
      isMaterialConflict: false, confirmationStatus: 'NOT_REQUIRED',
      history, firstSeenAt: userClaim?.assertedAt ?? asOf, lastVerifiedAt: null, staleAfter: null,
    };
  }

  // Entity resolution gates ALL external evidence. A mismatched source is
  // retained for audit but can never support or contradict a value.
  const usable: EvidenceClaim[] = [];
  const rejected: EvidenceClaim[] = [];
  let bestMatch = resolveEntity(input.knownEntity, {
    companyName: null, domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null,
  });

  // Retained for audit; can neither support nor contradict the field.
  const authorityExcluded: EvidenceClaim[] = [];
  // Per-claim identity (CPG-008 adjudication; CPG-009 verification gate and
  // persistence — every claim keeps ITS OWN identity decision).
  const entityByClaim = new Map<string, EntityMatch>();
  // CPG-010 — one source attribution per claim (see attributeSource).
  const attribution = new Map<string, SourceAttribution>();
  const at = (e: EvidenceClaim): SourceAttribution => {
    let a = attribution.get(e.claimId);
    if (!a) { a = attributeSource(e, field, input); attribution.set(e.claimId, a); }
    return a;
  };

  for (const e of input.evidence) {
    const m = resolveEntity(input.knownEntity, e.entitySignals);
    entityByClaim.set(e.claimId, m);
    // §14 (CPG-007) — field authority is OWNED by CPG-003 and is now applied at
    // resolution too, not only as a discovery pre-fetch gate. A perfectly
    // parsed value from a source marked `neverFor` this field (a company's own
    // marketing site for revenue) is excluded here whatever path brought it in.
    if (at(e).authority === 'never') { authorityExcluded.push(e); continue; }
    if (m.status === 'mismatch') { rejected.push(e); continue; }
    usable.push(e);
    if (m.score > bestMatch.score || bestMatch.status === 'unresolved') bestMatch = m;
  }

  // Money compares by currency + amount (CPG-007); everything else by the
  // stored normalised text, exactly as before.
  const keyOf = (value: string, stored: string) => comparisonKey(field, value, stored);
  const userNorm = userClaim ? keyOf(userClaim.value, userClaim.normalizedValue) : null;
  const agreeing = usable.filter((e) => userNorm !== null && keyOf(e.value, e.normalizedValue) === userNorm);
  const disagreeing = usable.filter((e) => userNorm !== null && keyOf(e.value, e.normalizedValue) !== userNorm);

  // §6 (CPG-007) — revenue is period-scoped. When the evidence states several
  // fiscal years, a figure for an OLDER year is history, not a contradiction:
  // FY2023 ₹6 Cr and FY2024 ₹7.8 Cr are both true, and a user stating ₹7.8 Cr
  // is not contradicted by FY2023. Only the latest stated period is compared.
  // (A lone old figure is still compared — the question shows its period.)
  const statedYears = REVENUE_FIELDS.has(field)
    ? usable.map((e) => e.extraction?.year).filter((y): y is number => typeof y === 'number') : [];
  const latestYear = statedYears.length > 0 ? Math.max(...statedYears) : null;
  const supersededPeriod = (e: EvidenceClaim) =>
    latestYear !== null && typeof e.extraction?.year === 'number' && e.extraction.year < latestYear;

  // Revenue: a different MEASURE is not a disagreement (§14).
  const trueConflicts = disagreeing.filter((e) =>
    !supersededPeriod(e) && (userClaim ? isMaterialConflict(field, userClaim.value, e.value) : false));
  const nonConflicting = disagreeing.filter((e) => !trueConflicts.includes(e));

  const bestTier = usable.reduce((best, e) => Math.max(best, TIER_WEIGHT[at(e).tier]), 0);

  const freshness = usable.length === 0 ? 'unknown'
    : usable.map((e) => evidenceFreshness(e.sourcePublishedAt, e.sourceAccessedAt, asOf))
        .reduce((best: EvidenceFreshness, f) =>
          FRESHNESS_WEIGHT[f] > FRESHNESS_WEIGHT[best] ? f : best, 'unknown' as EvidenceFreshness);

  const hasConflict = trueConflicts.length > 0;

  // ── CPG-008: adjudicate the PUBLIC evidence ───────────────────────────────
  // Always computed (so disagreement is visible even beside a user value), but
  // it DECIDES the effective value only when the user supplied none.
  const actx: AdjudicationContext = {
    field,
    familyOf: (e) => at(e).family,
    authorityOf: (e) => at(e).authority,
    tierOf: (e) => at(e).tier,
    freshnessOf: (e) => evidenceFreshness(e.sourcePublishedAt, e.sourceAccessedAt, asOf),
    entityOf: (e) => entityByClaim.get(e.claimId)?.status ?? 'unresolved',
    identityOf: (e) => entityByClaim.get(e.claimId)?.identity ?? 'UNKNOWN',
    keyOf: (e) => keyOf(e.value, e.normalizedValue),
    isMaterial: (a, b) => isMaterialConflict(field, a, b),
    strengthOf: ({ tier, families, freshness: f, entity }) => computeConfidence({
      bestTierWeight: TIER_WEIGHT[tier], independentSources: families, freshness: f,
      entityMatchWeight: ENTITY_MATCH_WEIGHT[entity], conflicting: false,
    }).score,
    revenueFields: REVENUE_FIELDS,
    observationOnly: field.endsWith('_source_statement')
      ? "a document's description of the field is a pointer to evidence, never a value for it" : null,
  };
  const pub = adjudicatePublic(usable, actx);

  let status: ClaimStatus;
  let effectiveValue: string | null;
  let effectiveValueSource: GroundedField['effectiveValueSource'];
  let adjudication: Adjudication;
  let material: boolean;
  let confidence: FieldConfidence;
  let lastVerified: string | null;
  let conflictingOut: EvidenceClaim[];

  if (userClaim) {
    // ── CPG-001 path, unchanged: the user's value is effective ──────────────
    if (usable.length === 0) {
      status = 'USER_PROVIDED';
    } else if (hasConflict) {
      status = 'CONFLICTING';
    } else if (bestMatch.status === 'weak' || bestMatch.status === 'unresolved') {
      status = 'PUBLICLY_REPORTED';
    } else {
      // ⚠️ CPG-009 — VERIFIED needs sufficient agreeing evidence FROM
      // DOCUMENTS WHOSE IDENTITY IS DECISIVE. Before, the best match across ALL
      // usable evidence was checked, and "strong" included leadership + name —
      // so name-level documents could verify the user's value.
      const decisiveAgreeing = agreeing.filter((e) => entityByClaim.get(e.claimId)?.identity === 'DECISIVE');
      const corroborated = new Set(decisiveAgreeing.map((e) => at(e).family)).size;
      // CPG-010 §13 — as in adjudication: a tier-1 source WEAK for this field is not S2.
      const tier1 = decisiveAgreeing.some((e) => at(e).tier === 1 && at(e).authority !== 'weak');
      const authoritative = decisiveAgreeing.some((e) => actx.authorityOf(e) === 'authoritative');
      status = (corroborated >= 2 || (tier1 && corroborated >= 1) || authoritative) ? 'PUBLICLY_VERIFIED'
        : agreeing.length > 0 ? 'PUBLICLY_REPORTED' : 'USER_PROVIDED';
    }
    // THE NO-SILENT-OVERWRITE GUARANTEE (§6): a user claim always wins by default.
    effectiveValue = userClaim.value;
    effectiveValueSource = 'user';
    material = hasConflict;
    const agreeingFamilies = [...new Set(agreeing.map((e) => at(e).family))].sort();
    adjudication = {
      ...pub.adjudication,
      evidenceState: hasConflict ? 'CONFLICTING' : 'EFFECTIVE',
      outcome: 'USER_VALUE',
      reason: hasConflict
        ? "the user's value is retained; public evidence materially disagrees and needs the user's confirmation"
        : "the user's value is effective",
      requiresReview: hasConflict,
      supportingFamilies: agreeingFamilies,
      verifiedIdentityFamilies: [...new Set(agreeing
        .filter((e) => entityByClaim.get(e.claimId)?.identity === 'DECISIVE')
        .map((e) => at(e).family))].sort(),
      candidates: pub.adjudication.candidates.map((c) => ({
        ...c, role: keyOf(c.value, c.normalizedValue) === userNorm ? 'EFFECTIVE' as const : 'DISSENT' as const,
      })),
    };
    confidence = computeConfidence({
      bestTierWeight: bestTier,
      independentSources: new Set(agreeing.map((e) => at(e).family)).size,
      freshness,
      entityMatchWeight: ENTITY_MATCH_WEIGHT[bestMatch.status],
      conflicting: hasConflict,
    });
    lastVerified = agreeing.length > 0 ? agreeing.map((e) => e.sourceAccessedAt).sort().slice(-1)[0] : null;
    conflictingOut = [...trueConflicts, ...nonConflicting, ...rejected];
  } else {
    // ── CPG-008 path: public evidence only ──────────────────────────────────
    // Evidence strength GATES the effective value: a parsed claim is not
    // automatically a fact about the company (B-17), and disagreement is
    // surfaced instead of being settled by list order (B-16).
    adjudication = pub.adjudication;
    const winner = adjudication.candidates.find((c) => c.role === 'EFFECTIVE') ?? null;
    effectiveValue = pub.effective?.value ?? null;
    effectiveValueSource = pub.effective ? 'public_evidence' : 'none';
    material = adjudication.evidenceState === 'CONFLICTING';

    if (usable.length === 0) status = 'UNVERIFIED';
    else if (adjudication.evidenceState === 'CONFLICTING') status = 'CONFLICTING';
    // ⚠️ CPG-009 — two separate gates: the value met the sufficiency rule
    // (it is effective) AND it still meets it on DECISIVE-identity documents
    // alone (`verified`). Strong evidence with weak identity is REPORTED;
    // strong identity with insufficient evidence is not even effective.
    else if (winner?.verified) status = 'PUBLICLY_VERIFIED';
    else status = 'PUBLICLY_REPORTED';

    const basis = winner ?? [...adjudication.candidates].sort((a, b) => b.strength - a.strength)[0] ?? null;
    confidence = computeConfidence(basis ? {
      bestTierWeight: TIER_WEIGHT[basis.bestTier], independentSources: basis.families.length,
      freshness: basis.freshness, entityMatchWeight: ENTITY_MATCH_WEIGHT[basis.entityMatch],
      conflicting: material,
    } : { bestTierWeight: 0, independentSources: 0, freshness: 'unknown', entityMatchWeight: 0, conflicting: false });

    const winnerClaims = winner ? usable.filter((e) => winner.claimIds.includes(e.claimId)) : [];
    lastVerified = winnerClaims.length > 0 ? winnerClaims.map((e) => e.sourceAccessedAt).sort().slice(-1)[0] : null;
    conflictingOut = [...pub.competing, ...rejected];

    if (material) {
      history.push({
        at: asOf, actor: 'system', action: 'conflict_detected',
        fromValue: null, toValue: pub.competing[0]?.value ?? null,
        note: `Public sources disagree on "${field}"; no effective value selected. ${adjudication.reason}`,
        evidenceIds: pub.competing.map((e) => e.claimId),
      });
    }
  }

  if (userClaim && material) {
    history.push({
      at: asOf, actor: 'system', action: 'conflict_detected',
      fromValue: userClaim.value, toValue: trueConflicts[0].value,
      note: `Material conflict on "${field}": user value retained pending confirmation.`,
      evidenceIds: trueConflicts.map((e) => e.claimId),
    });
  }

  return {
    companyId, field, kind, status, effectiveValue, effectiveValueSource,
    userClaim,
    evidence: [...usable, ...rejected, ...authorityExcluded],
    // Retained, never discarded, including entity-rejected and non-conflicting
    // disagreements, so the audit trail survives (§7).
    conflictingEvidence: conflictingOut,
    entityMatch: bestMatch,
    freshness,
    confidence,
    isMaterialConflict: material,
    confirmationStatus: material ? 'PENDING_USER_CONFIRMATION' : 'NOT_REQUIRED',
    history,
    firstSeenAt: userClaim?.assertedAt ?? (usable[0]?.sourceAccessedAt ?? asOf),
    lastVerifiedAt: lastVerified,
    staleAfter: null,
    adjudication,
    entityMatches: Object.fromEntries(entityByClaim),
    sourceAttribution: Object.fromEntries(attribution),
  };
}

/** Build the question the API/UI asks when a material conflict exists (§6). */
export function buildConfirmationRequest(
  g: GroundedField, companyDomain: string | null,
): ConfirmationRequest | null {
  if (!g.isMaterialConflict) return null;

  // CPG-008 — PUBLIC sources disagree and the user supplied nothing. There is
  // no "own value" to confirm; the user picks a public value, corrects it, or
  // supplies a better source.
  if (!g.userClaim && g.adjudication?.outcome === 'PUBLIC_CONFLICT_UNRESOLVED') {
    const competing = g.adjudication.candidates.filter((c) => c.role === 'COMPETING');
    const shown = competing.map((c) => `"${c.value}"`).join(' vs ');
    return {
      companyId: g.companyId,
      field: g.field,
      question: `Public sources disagree on ${g.field}: ${shown}. Which is correct for your company?`,
      userValue: null,
      publicValue: null,
      publicSources: g.conflictingEvidence.map((e) => {
        const c = classifySource(e.sourceUrl, e.sourceType, companyDomain);
        return { name: c.name, url: e.sourceUrl, accessedAt: e.sourceAccessedAt, tier: g.sourceAttribution?.[e.claimId]?.tier ?? c.tier };
      }),
      options: [
        'USER_ACCEPTED_PUBLIC_VALUE', 'USER_CONFIRMED_CORRECTION',
        'PUBLIC_SOURCE_MARKED_STALE', 'USER_SUPPLIED_ALTERNATIVE_SOURCE', 'DEFERRED',
      ],
      competingValues: competing.map((c) => ({ value: c.value, sourceUrls: c.sourceUrls, families: c.families })),
    };
  }

  const conflicts = g.conflictingEvidence.filter((e) =>
    g.userClaim ? isMaterialConflict(g.field, g.userClaim.value, e.value) : false);
  if (conflicts.length === 0) return null;

  const publicValue = conflicts[0].value;
  return {
    companyId: g.companyId,
    field: g.field,
    question:
      `Your profile states ${g.field} = "${g.userClaim?.value}". ` +
      `Public sources currently report "${publicValue}". Which information should we retain?`,
    userValue: g.userClaim?.value ?? null,
    publicValue,
    publicSources: conflicts.map((e) => {
      const c = classifySource(e.sourceUrl, e.sourceType, companyDomain);
      return { name: c.name, url: e.sourceUrl, accessedAt: e.sourceAccessedAt, tier: g.sourceAttribution?.[e.claimId]?.tier ?? c.tier };
    }),
    options: [
      'USER_CONFIRMED_OWN_VALUE', 'USER_ACCEPTED_PUBLIC_VALUE', 'USER_CONFIRMED_CORRECTION',
      'PUBLIC_SOURCE_MARKED_STALE', 'USER_SUPPLIED_ALTERNATIVE_SOURCE', 'DEFERRED',
    ],
  };
}
