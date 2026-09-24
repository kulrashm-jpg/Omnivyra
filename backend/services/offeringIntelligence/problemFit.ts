/**
 * PI WS-D — the Problem Fit SEAM. It prepares a seam; it does not add a dimension.
 *
 * Problem Fit is a relation between two halves: the problems a tenant's offering SOLVES, and the
 * problem a prospect HAS. This module publishes the first half and refuses to imply the second.
 *
 * ─── THE SELL SIDE IS DERIVED AT READ TIME ────────────────────────────────
 * `readTenantOfferingUnderstanding` builds the tenant's offering context from its own
 * `company_profiles` row, runs the canonical `assembleOfferingUnderstanding` — the module's sole
 * owner of build, score and projection — and reshapes the decided facets. It owns nothing, scores
 * nothing and stores nothing. No table, no writer, no migration: the same read-time pattern
 * `leadUnderstanding` already uses.
 *
 * ─── THE BUY SIDE IS ABSENT, AND SAYS SO ──────────────────────────────────
 * Nothing in intake, enrichment or engagement captures a PROSPECT's problem. `lead_signals` carries
 * `content_text` that is never projected into the scoring context, and the ICP criterion surface
 * already names `problem_relevance` and `product_service_alignment` as UNREPRESENTABLE — see
 * `prospectIcp/generator/prompt.ts`. So `assessProblemFitReadiness` reports `scorable: false` with
 * the reason, and `problem_fit` stays out of any frozen dimension list. A seam that quietly returned
 * a number here would be the fabricated zero the read surface exists to prevent.
 */

import { assembleOfferingUnderstanding } from './engines/assembly';
import {
  buildTenantOfferingContext,
  defaultTenantOfferingContextPorts,
  type TenantOfferingContextInput,
  type TenantOfferingContextPorts,
  type TenantOfferingGap,
  type TenantProblemProvenance,
} from './tenantOfferingContext';
import type { OfferingFacetName } from './types';

/**
 * Bumped when this seam's shape changes, so a consumer can pin what it parsed.
 * wsd.2 — `problemProvenance` added. Additive: every field wsd.1 published is unchanged in
 * shape, order and value; the new field states which profile column each problem was read from.
 */
export const OFFERING_SELL_SIDE_VERSION = 'wsd.2';

/** One offering, as the canonical assembly decided it. Every field abstains rather than defaulting. */
export interface SellSideOffering {
  readonly offeringId: string;
  readonly name: string | null;
  /** Declared `product` | `service` | … — null here, because the profile column does not say. */
  readonly offeringType: string | null;
  readonly category: string | null;
  readonly positioning: string | null;
  readonly valueProposition: string | null;
  readonly customerProblems: readonly string[];
  readonly outcomes: readonly string[];
  readonly differentiators: readonly string[];
  readonly industries: readonly string[];
  readonly personas: readonly string[];
  /** The assembly's own confidence. Facets it abstained on are named, not zeroed. */
  readonly confidence: number;
  readonly abstainedFacets: readonly OfferingFacetName[];
}

export interface TenantSellSide {
  readonly version: string;
  readonly organizationId: string;
  readonly asOf: string;
  readonly offerings: readonly SellSideOffering[];
  /**
   * The union of every problem the tenant's offerings claim to solve. This is the half Problem Fit
   * needs from the sell side — and, because `company_profiles` is one row per tenant, it is in
   * practice the tenant's problem statement rather than any one offering's.
   */
  readonly portfolioProblems: readonly string[];
  /**
   * The same problems, each with the profile column it was read from — a stated
   * `core_problem_statement` or one of the `pain_symptoms`.
   *
   * `portfolioProblems` is the half Problem Fit needs; this is how a caller tells a problem from a
   * symptom without re-reading the profile. It is a LOOKUP, not a parallel array: `portfolioProblems`
   * is deduplicated case-insensitively across offerings, so match on the value rather than by index.
   * Additive — `portfolioProblems` and every offering's `customerProblems` are unchanged.
   */
  readonly problemProvenance: readonly TenantProblemProvenance[];
  readonly sources: { readonly profile: boolean; readonly curatedOfferingList: boolean };
  readonly gaps: readonly TenantOfferingGap[];
}

/**
 * Read the tenant's derived offering understanding.
 *
 * Returns null when the tenant has no profile row — "we could not look", which a caller must be able
 * to tell from "we looked and the tenant names no offering" (an empty `offerings` array).
 */
export async function readTenantOfferingUnderstanding(
  input: TenantOfferingContextInput,
  ports: TenantOfferingContextPorts = defaultTenantOfferingContextPorts,
): Promise<TenantSellSide | null> {
  const built = await buildTenantOfferingContext(input, ports);
  if (!built) return null;

  const offerings: SellSideOffering[] = built.contexts.map((ctx) => {
    const { understanding } = assembleOfferingUnderstanding(ctx);
    const f = understanding.facets;
    const abstained = (Object.keys(f) as OfferingFacetName[]).filter((n) => f[n].value === null);
    return {
      offeringId: understanding.key.offeringId,
      name: f.identity.value?.name ?? null,
      offeringType: (f.offeringType.value as string | null) ?? null,
      category: f.category.value?.category ?? null,
      positioning: f.positioning.value?.statement ?? null,
      valueProposition: f.valueProposition.value?.statement ?? null,
      customerProblems: f.customerProblems.value?.problems ?? [],
      outcomes: f.outcomes.value?.outcomes ?? [],
      differentiators: f.differentiators.value?.differentiators ?? [],
      industries: f.industries.value?.industries ?? [],
      personas: f.personas.value?.personas ?? [],
      confidence: understanding.score.confidence,
      abstainedFacets: abstained,
    };
  });

  const seen = new Set<string>();
  const portfolioProblems: string[] = [];
  for (const o of offerings) {
    for (const p of o.customerProblems) {
      const k = p.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      portfolioProblems.push(p);
    }
  }

  return {
    version: OFFERING_SELL_SIDE_VERSION,
    organizationId: built.organizationId,
    asOf: input.asOf,
    offerings,
    portfolioProblems,
    problemProvenance: built.problemProvenance,
    sources: built.sources,
    gaps: built.gaps,
  };
}

/** The evidence Problem Fit still needs, which no part of the platform currently captures. */
export const PROBLEM_FIT_MISSING_BUY_SIDE: readonly string[] = [
  'a prospect-stated problem — nothing in intake, enrichment or engagement captures one',
  'lead_signals.content_text is never projected into the scoring context',
  'problem_relevance and product_service_alignment are UNREPRESENTABLE on the ratified ICP criterion surface',
  'a defined representation and weight for a problem_fit score — an open product decision',
];

export interface ProblemFitReadiness {
  /** Whether the tenant's own offerings could be read, and whether they said anything. */
  readonly sellSide: 'available' | 'empty' | 'unreadable';
  /** Always absent. Named so a caller reports a reason instead of a zero. */
  readonly buySide: 'not_implemented';
  /** Always false. This seam supplies one half of a relation; it never scores it. */
  readonly scorable: false;
  readonly reason: string;
  readonly missing: readonly string[];
}

/**
 * State the readiness of Problem Fit, honestly. `scorable` is a literal `false`: this is a seam, and
 * a dimension is a frozen product decision made elsewhere.
 */
export function assessProblemFitReadiness(sell: TenantSellSide | null): ProblemFitReadiness {
  const sellSide = !sell ? 'unreadable' : sell.portfolioProblems.length ? 'available' : 'empty';
  const reason = sellSide === 'available'
    ? 'the sell side is derivable from the tenant profile; the prospect side of the relation is not represented anywhere'
    : sellSide === 'empty'
      ? 'the tenant profile states no customer problem, and the prospect side of the relation is not represented anywhere'
      : 'the tenant has no company_profiles row, so neither side of the relation can be read';
  return { sellSide, buySide: 'not_implemented', scorable: false, reason, missing: PROBLEM_FIT_MISSING_BUY_SIDE };
}
