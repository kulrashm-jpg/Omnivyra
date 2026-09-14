/**
 * CPG-008 — deterministic adjudication of PUBLIC evidence (closes B-16, B-17).
 *
 * THIS IS NOT A SECOND RESOLVER. `resolve()` in claimResolution.ts is its only
 * caller and remains the single resolution engine. This module answers one
 * question on its behalf: given the usable public evidence for a field, is
 * there a value the evidence actually supports — or only observations, or a
 * genuine disagreement?
 *
 * ─── WHAT IT MAY CONSIDER ──────────────────────────────────────────────────
 *   CPG-003 field authority (authoritativeFor / weakFor), CPG-003 provider
 *   families, source tier, freshness, entity match, comparability (measure +
 *   period), and the EXISTING CONFIDENCE_FORMULA score — all passed in by the
 *   resolver, so there is one scoring model.
 *
 * ─── WHAT IT NEVER CONSIDERS ───────────────────────────────────────────────
 *   Search rank, discovery order, page popularity, repeated statements on one
 *   page, or observation counts. Two pages of one publisher are ONE family.
 *
 * ─── THE SUFFICIENCY RULE (derived, not invented) ──────────────────────────
 * A value may become effective only if it has, from non-self-contradicting
 * sources, at least one of:
 *   S1  ≥2 independent provider families        (existing PUBLICLY_VERIFIED leg 1)
 *   S2  a tier-1 source                          (existing PUBLICLY_VERIFIED leg 2;
 *       CPG-010: one that CPG-003 does not mark `weak` for this field)
 *   S3  a source CPG-003 marks `authoritativeFor` this field
 * These are the criteria the repository already used to call a value
 * "verified" and to call a source authoritative; CPG-008 makes them GATE the
 * effective value instead of merely labelling it. They remain ENGINEERING
 * DEFAULTS — no calibration study exists. A strength score is never a
 * probability of truth.
 */

import type {
  Adjudication, AdjudicationCandidate, AdjudicationOutcome, EntityMatchStatus, EvidenceClaim,
  EvidenceFreshness, EvidenceState, IdentityClass, SourceTier,
} from './types';

const IDENTITY_ORDER: Readonly<Record<IdentityClass, number>> = { DECISIVE: 4, SUPPORTING: 3, WEAK: 2, UNKNOWN: 1, MISMATCH: 0 };

/** Everything the resolver lends this module. */
export interface AdjudicationContext {
  field: string;
  /** CPG-003 provider family of a claim. */
  familyOf(e: EvidenceClaim): string;
  /** CPG-003 field authority of a claim. */
  authorityOf(e: EvidenceClaim): 'authoritative' | 'weak' | 'unrated' | 'never';
  tierOf(e: EvidenceClaim): SourceTier;
  freshnessOf(e: EvidenceClaim): EvidenceFreshness;
  entityOf(e: EvidenceClaim): EntityMatchStatus;
  /** CPG-009 — the claim's own identity class (from the entity-resolution stage). */
  identityOf(e: EvidenceClaim): IdentityClass;
  /** The resolver's comparison key — ONE definition of "agrees". */
  keyOf(e: EvidenceClaim): string;
  /** The resolver's CPG-001 materiality test. */
  isMaterial(a: string, b: string): boolean;
  /** The existing CONFIDENCE_FORMULA, for one candidate. */
  strengthOf(input: { tier: SourceTier; families: number; freshness: EvidenceFreshness; entity: EntityMatchStatus }): number;
  revenueFields: ReadonlySet<string>;
  /**
   * CPG-010 — set (to the reason) for a field whose claims are POINTERS to
   * evidence, never values: a document's description of a field
   * (`<field>_source_statement`). Such a field is observed, never effective.
   */
  observationOnly?: string | null;
}

const TIER_ORDER: Readonly<Record<SourceTier, number>> = { 1: 4, 2: 3, 3: 2, 4: 1 };
const FRESH_ORDER: Readonly<Record<EvidenceFreshness, number>> = { fresh: 3, aging: 2, stale: 1, unknown: 0 };
const ENTITY_ORDER: Readonly<Record<EntityMatchStatus, number>> = { exact: 4, strong: 3, weak: 2, unresolved: 1, mismatch: 0 };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── comparability ────────────────────────────────────────────────────────────

/**
 * Which claims are statements about THE SAME fact, and whether two different
 * values within that class contradict each other.
 *
 *   revenue   → fiscal year + measure ("2025|revenue", "2025|net"). FY2024 and
 *               FY2025 are two facts; net and gross are two facts. Undated
 *               revenue cannot contradict anything (its period is unknown).
 *   funding   → measure: "total raised" and "largest round" are single facts
 *               per company; a named round ("round:Series I") too. "latest
 *               round" and unqualified raises are EVENTS that legitimately
 *               differ over time — they corroborate, but never contradict.
 *   ceo       → current claims only (former titles never reach evidence).
 *   other     → one class; materiality decided by CPG-001's isMaterialConflict.
 */
export function comparabilityClass(field: string, e: EvidenceClaim, revenueFields: ReadonlySet<string>):
  { cls: string; contradictable: boolean } {
  const x = e.extraction;
  // ⚠️ CPG-009 LIVE FIX — non-extracted evidence (Wikidata, first-party
  // metadata) was class "default" while extracted claims of the SAME field
  // were "current", so Wikidata's founding year could never corroborate — or
  // contradict — a document's. For non-money fields they are the same fact.
  if (!x) {
    return revenueFields.has(field) || field === 'funding'
      ? { cls: 'default', contradictable: true }
      : { cls: 'current', contradictable: true };
  }
  if (revenueFields.has(field)) {
    const measure = x.qualifier ?? 'revenue';
    return x.year === null
      ? { cls: `undated|${measure}`, contradictable: false }
      : { cls: `${x.year}|${measure}`, contradictable: true };
  }
  if (field === 'funding') {
    const q = x.qualifier ?? null;
    if (q === 'total raised' || q === 'largest round') return { cls: q, contradictable: true };
    if (q === 'latest round') return { cls: `latest round|${x.year ?? 'undated'}`, contradictable: false };
    if (x.period) return { cls: `round:${x.period}`, contradictable: true };
    return { cls: `event|${x.year ?? 'undated'}`, contradictable: false };
  }
  if (x.temporalType === 'FORECAST' || x.temporalType === 'TARGET') return { cls: `t:${x.temporalType}`, contradictable: false };
  return { cls: 'current', contradictable: true };
}

/**
 * CPG-010 §10 — the MEASURE a claim states, for measure-scoped field authority
 * (sourceRegistry `measureScoped`). Derived from the same comparability class,
 * so there is one definition of "measure". Funding: 'total raised' | 'largest
 * round' | 'latest round' | 'round' | 'event'; revenue: the qualifier; a claim
 * with no extraction provenance states no measure (null).
 */
export function measureOf(field: string, e: EvidenceClaim, revenueFields: ReadonlySet<string>): string | null {
  if (!e.extraction) return null;
  const { cls } = comparabilityClass(field, e, revenueFields);
  if (field === 'funding') {
    if (cls === 'total raised' || cls === 'largest round') return cls;
    if (cls.startsWith('latest round')) return 'latest round';
    if (cls.startsWith('round:')) return 'round';
    return 'event';
  }
  if (revenueFields.has(field)) return cls.split('|')[1] ?? null;
  return null;
}

/** Preference among classes for the field's own value (documented defaults). */
function classPreference(field: string, cls: string, revenueFields: ReadonlySet<string>): number {
  if (revenueFields.has(field)) {
    const [yr, measure] = cls.split('|');
    // Latest dated year first; within a year the UNQUALIFIED measure — the
    // profile field is "revenue", not "net revenue". Undated last.
    const year = yr === 'undated' ? 0 : Number(yr);
    return year * 10 + (measure === 'revenue' ? 1 : 0);
  }
  if (field === 'funding') {
    if (cls === 'total raised') return 5;
    if (cls === 'largest round') return 4;
    if (cls.startsWith('latest round')) return 3;
    if (cls.startsWith('round:')) return 2;
    return 1;
  }
  return cls === 'current' || cls === 'default' ? 1 : 0;
}

// ── adjudication ─────────────────────────────────────────────────────────────

interface Group { cls: string; contradictable: boolean; key: string; claims: EvidenceClaim[] }

export interface PublicAdjudication {
  adjudication: Adjudication;
  /** The claim that represents the effective value, or null. */
  effective: EvidenceClaim | null;
  /** Claims in the primary class that compete with / dissent from the outcome. */
  competing: EvidenceClaim[];
}

export function adjudicatePublic(usable: readonly EvidenceClaim[], ctx: AdjudicationContext): PublicAdjudication {
  if (usable.length === 0) {
    return {
      adjudication: {
        evidenceState: 'UNRESOLVED', outcome: 'NO_EVIDENCE', reason: 'no usable public evidence for this field',
        requiresReview: false, primaryClass: null, supportingFamilies: [], candidates: [],
      },
      effective: null, competing: [],
    };
  }

  // 1. group by comparability class, then by comparison key
  const groups: Group[] = [];
  for (const e of usable) {
    const { cls, contradictable } = comparabilityClass(ctx.field, e, ctx.revenueFields);
    const key = ctx.keyOf(e);
    let g = groups.find((x) => x.cls === cls && x.key === key);
    if (!g) { g = { cls, contradictable, key, claims: [] }; groups.push(g); }
    g.claims.push(e);
  }

  // 2. self-contradicting families: one publisher asserting two materially
  //    different values of the same fact is independent support for NEITHER.
  const selfContradicting = new Map<string, Set<string>>(); // cls -> families
  for (const cls of new Set(groups.map((g) => g.cls))) {
    const inCls = groups.filter((g) => g.cls === cls && g.contradictable);
    const seen = new Map<string, string[]>(); // family -> keys
    for (const g of inCls) for (const e of g.claims) {
      const f = ctx.familyOf(e);
      const keys = seen.get(f) ?? [];
      if (!keys.includes(g.key)) keys.push(g.key);
      seen.set(f, keys);
    }
    const bad = new Set<string>();
    for (const [f, keys] of seen) {
      if (keys.length < 2) continue;
      const vals = keys.map((k) => inCls.find((g) => g.key === k)!.claims[0].value);
      if (vals.some((a, i) => vals.some((b, j) => j > i && ctx.isMaterial(a, b)))) bad.add(f);
    }
    selfContradicting.set(cls, bad);
  }

  // 3. score each candidate with the EXISTING formula
  const tierOneFor = (e: EvidenceClaim) => ctx.tierOf(e) === 1 && ctx.authorityOf(e) !== 'weak';
  const candidates: (AdjudicationCandidate & { _group: Group; _authoritativeFresh: boolean })[] = groups.map((g) => {
    const bad = selfContradicting.get(g.cls) ?? new Set<string>();
    const independent = g.claims.filter((e) => !bad.has(ctx.familyOf(e)));
    const families = [...new Set(independent.map((e) => ctx.familyOf(e)))].sort();
    const best = <T>(xs: T[], order: (x: T) => number, dflt: T) => xs.reduce((a, b) => (order(b) > order(a) ? b : a), dflt);
    const tier = best(independent.map((e) => ctx.tierOf(e)), (t) => TIER_ORDER[t], 4 as SourceTier);
    const freshness = best(independent.map((e) => ctx.freshnessOf(e)), (f) => FRESH_ORDER[f], 'unknown' as EvidenceFreshness);
    const entity = best(g.claims.map((e) => ctx.entityOf(e)), (s) => ENTITY_ORDER[s], 'unresolved' as EntityMatchStatus);
    const auths = independent.map((e) => ctx.authorityOf(e));
    const bestAuthority = auths.includes('authoritative') ? 'authoritative' : auths.includes('weak') ? 'weak' : 'unrated';
    const authoritativeFresh = independent.some((e) => ctx.authorityOf(e) === 'authoritative'
      && ctx.freshnessOf(e) !== 'stale' && ctx.freshnessOf(e) !== 'unknown');

    const why: string[] = [];
    if (families.length >= 2) why.push(`S1: ${families.length} independent families (${families.join(', ')})`);
    // ⚠️ CPG-010 §13 — S2 is a tier-1 source that is NOT weak for this field.
    // A tier is a general policy; authority is field-specific (CPG-003). The IR
    // site is tier 1 and WEAK for revenue: company-published results alone must
    // not make revenue effective, however decisive the IR host's identity.
    if (independent.some((e) => tierOneFor(e))) why.push('S2: a tier-1 source not weak for this field');
    if (bestAuthority === 'authoritative') why.push(`S3: a source CPG-003 marks authoritative for "${ctx.field}"`);

    // ── CPG-009: identity, evaluated as a SEPARATE gate on the same evidence ──
    // The value is VERIFIED only if the sufficiency rule still holds when the
    // supporters are restricted to documents that DECISIVELY establish the
    // company's identity. Agreement between name-only documents is value
    // corroboration, never identity corroboration.
    const identity = best(g.claims.map((e) => ctx.identityOf(e)), (c) => IDENTITY_ORDER[c], 'UNKNOWN' as IdentityClass);
    const decisive = independent.filter((e) => ctx.identityOf(e) === 'DECISIVE');
    const identityFamilies = [...new Set(decisive.map((e) => ctx.familyOf(e)))].sort();
    const vWhy: string[] = [];
    if (identityFamilies.length >= 2) vWhy.push(`S1: ${identityFamilies.length} independent families with DECISIVE identity (${identityFamilies.join(', ')})`);
    if (decisive.some((e) => tierOneFor(e))) vWhy.push('S2: a tier-1 source, not weak for this field, with DECISIVE identity');
    if (decisive.some((e) => ctx.authorityOf(e) === 'authoritative')) vWhy.push(`S3: a CPG-003-authoritative source for "${ctx.field}" with DECISIVE identity`);

    const rep = [...g.claims].sort(byTierThenId)[0];
    return {
      value: rep.value, normalizedValue: rep.normalizedValue, comparabilityClass: g.cls,
      // ⚠️ CPG-010 FIX — sorted: these lists kept EVIDENCE order, so the same
      // evidence in a different order persisted different adjudication JSON.
      claimIds: g.claims.map((e) => e.claimId).sort(cmp),
      sourceUrls: [...new Set(g.claims.map((e) => e.sourceUrl).filter((u): u is string => !!u))].sort(cmp),
      families, bestAuthority, bestTier: tier, freshness, entityMatch: entity,
      strength: ctx.strengthOf({ tier, families: families.length, freshness, entity }),
      sufficient: why.length > 0, sufficientBecause: why.length ? why.join('; ') : null,
      role: 'OBSERVED' as const,
      identity, identityFamilies,
      verified: why.length > 0 && vWhy.length > 0,
      verifiedBecause: vWhy.length ? vWhy.join('; ') : null,
      _group: g, _authoritativeFresh: authoritativeFresh,
    };
  });

  // ⚠️ CPG-010 LIVE FIX — a pointer field can never be sufficient. Live, the
  // Cloudflare IR press release's page description (revenue_source_statement)
  // became PUBLICLY_VERIFIED once the IR host was tier 1 — and any .gov page's
  // description could have, before, when every .gov host was tier 1.
  if (ctx.observationOnly) {
    for (const c of candidates) { c.sufficient = false; c.sufficientBecause = null; c.verified = false; c.verifiedBecause = null; }
  }

  // Stable order for everything below (reasons, roles, output): evidence and
  // discovery order must never change the result.
  candidates.sort((x, y) => cmp(x.comparabilityClass, y.comparabilityClass) || cmp(x.normalizedValue, y.normalizedValue));

  // 4. the primary class decides the field's value
  const classes = [...new Set(candidates.map((c) => c.comparabilityClass))];
  classes.sort((a, b) => classPreference(ctx.field, b, ctx.revenueFields) - classPreference(ctx.field, a, ctx.revenueFields)
    || (a < b ? -1 : a > b ? 1 : 0));
  const primary = classes[0];
  const inPrimary = candidates.filter((c) => c.comparabilityClass === primary);
  for (const c of candidates) if (c.comparabilityClass !== primary) c.role = 'OTHER_MEASURE';

  // Revenue: no unqualified figure for the latest year, only several qualified ones.
  if (ctx.revenueFields.has(ctx.field) && primary.endsWith('|revenue') === false && !primary.startsWith('undated')) {
    const year = primary.split('|')[0];
    const qualifiedSameYear = new Set(candidates.filter((c) => c.comparabilityClass.startsWith(`${year}|`)).map((c) => c.comparabilityClass));
    if (qualifiedSameYear.size > 1) {
      return finish('UNRESOLVED', 'AMBIGUOUS_MEASURE',
        `only differently-qualified revenue measures were observed for ${year} (${[...qualifiedSameYear].map((c) => c.split('|')[1]).join(', ')}) — the unqualified revenue is not stated, and measures are never equated`,
        false, null, []);
    }
  }

  const sufficient = inPrimary.filter((c) => c.sufficient);
  const contradictable = inPrimary[0]._group.contradictable;
  const disagree = contradictable && inPrimary.length > 1
    && inPrimary.some((a, i) => inPrimary.some((b, j) => j > i && ctx.isMaterial(a.value, b.value)));

  if (!disagree) {
    // One value (or values that are not mutually exclusive, e.g. separate events).
    const winner = [...sufficient].sort(byStrength)[0];
    if (winner) {
      winner.role = 'EFFECTIVE';
      for (const c of inPrimary) if (c !== winner) c.role = 'OBSERVED';
      const reason = inPrimary.length === 1
        ? `sufficiently supported — ${winner.sufficientBecause}`
        : `values in "${primary}" are separate events, not contradictions; the strongest sufficiently supported one is used — ${winner.sufficientBecause}`;
      return finish('EFFECTIVE', 'SUFFICIENT_SINGLE_VALUE', reason, false, winner, []);
    }
    const strongest = [...inPrimary].sort(byStrength)[0];
    return finish('OBSERVED_ONLY', 'INSUFFICIENT_EVIDENCE',
      ctx.observationOnly ? `observed only — ${ctx.observationOnly}`
        : `observed but not sufficiently supported: ${describe(strongest)} — needs ≥2 independent families, a tier-1 source, or a CPG-003-authoritative source`,
      false, null, []);
  }

  // Material disagreement inside the primary class.
  for (const c of inPrimary) c.role = 'COMPETING';
  if (sufficient.length === 1) {
    const w = sufficient[0];
    w.role = 'EFFECTIVE';
    for (const c of inPrimary) if (c !== w) c.role = 'DISSENT';
    return finish('EFFECTIVE', 'WINNER_BY_EVIDENCE',
      `public sources disagree; only "${w.value}" is sufficiently supported (${w.sufficientBecause}); dissenting values retained: ${inPrimary.filter((c) => c !== w).map(describe).join(' | ')}`,
      false, w, inPrimary.filter((c) => c !== w));
  }
  if (sufficient.length > 1) {
    const auth = sufficient.filter((c) => c._authoritativeFresh);
    if (auth.length === 1) {
      const w = auth[0];
      w.role = 'EFFECTIVE';
      for (const c of inPrimary) if (c !== w) c.role = 'DISSENT';
      return finish('EFFECTIVE', 'WINNER_BY_AUTHORITY',
        `several values are sufficiently supported, but only "${w.value}" has fresh support from a source CPG-003 marks authoritative for "${ctx.field}"; others retained as dissent`,
        false, w, inPrimary.filter((c) => c !== w));
    }
  }
  return finish('CONFLICTING', 'PUBLIC_CONFLICT_UNRESOLVED',
    `public sources disagree on "${ctx.field}" and no value has a defensible advantage: ${inPrimary.map(describe).join(' vs ')}`,
    true, null, inPrimary);

  // ── helpers ──
  function byTierThenId(a: EvidenceClaim, b: EvidenceClaim): number {
    return TIER_ORDER[ctx.tierOf(b)] - TIER_ORDER[ctx.tierOf(a)] || cmp(a.claimId, b.claimId);
  }
  function byStrength(a: typeof candidates[number], b: typeof candidates[number]): number {
    return b.strength - a.strength || b.families.length - a.families.length
      || (a.normalizedValue < b.normalizedValue ? -1 : a.normalizedValue > b.normalizedValue ? 1 : 0);
  }
  function describe(c: typeof candidates[number]): string {
    return `"${c.value}" (${c.families.length} famil${c.families.length === 1 ? 'y' : 'ies'}${c.families.length ? `: ${c.families.join(', ')}` : ''}, best tier ${c.bestTier}, ${c.bestAuthority}, strength ${c.strength})`;
  }
  function finish(state: EvidenceState, outcome: AdjudicationOutcome, reason: string, review: boolean,
    winner: typeof candidates[number] | null, competing: typeof candidates[number][]): PublicAdjudication {
    const effective = winner
      ? [...winner._group.claims].sort(byTierThenId)[0]
      : null;
    return {
      adjudication: {
        evidenceState: state, outcome, reason, requiresReview: review, primaryClass: primary,
        supportingFamilies: winner ? winner.families : [],
        verifiedIdentityFamilies: winner ? winner.identityFamilies ?? [] : [],
        // Stable order: output never depends on evidence/discovery order.
        candidates: candidates.map(({ _group, _authoritativeFresh, ...c }) => c)
          .sort((a, b) => cmp(a.comparabilityClass, b.comparabilityClass) || cmp(a.normalizedValue, b.normalizedValue)),
      },
      effective,
      competing: competing.flatMap((c) => c._group.claims).sort((a, b) => cmp(a.claimId, b.claimId)),
    };
  }
}
