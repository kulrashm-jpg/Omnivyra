/**
 * A3B — the cost gate for provider enrichment.
 *
 * Binds the enrichment executor to the platform's existing credit system, and
 * refuses at every step where the answer is not a definite yes.
 *
 * ─── WHY THIS REFUSES TODAY, AND WHAT WOULD CHANGE THAT ───────────────────
 * `executeWithCredits` reserves before it runs, which is the property a paid
 * external call needs. But it asserts a CANONICAL CREDIT ACTION, and no
 * prospect-enrichment action is registered:
 *
 *   • `CREDIT_ACTIONS` does not contain one, so `resolveMonetizationFeature`
 *     answers `null`;
 *   • adding one requires an `ACTIVITY_CLASS_MAP` entry, and every activity
 *     class fixes `entryConsumptionCredits` / `minimumCredits` /
 *     `maximumCredits` — choosing a class IS choosing a price;
 *   • the price in turn requires an `action_pricing_config` row, and
 *     `pricingService` THROWS when that row is absent.
 *
 * The price cannot be chosen because no provider is selected, so there is no
 * per-call cost to price against. That is a product decision, not an
 * engineering one, and inventing a number here would put a fabricated price in
 * front of real credit deductions.
 *
 * `internal.profile_enrichment` is deliberately NOT reused: it is
 * company-profile enrichment, metered-internal with `requires_credit_hold:
 * false`. It holds nothing, so it could not pre-authorise a paid call even if
 * borrowing it were honest — and charging prospect work to it would
 * mis-attribute the spend.
 *
 * ─── WHAT THIS FILE ACTUALLY BUYS ─────────────────────────────────────────
 * The wiring, so that registering the action is the ONLY remaining step. Every
 * refusal below is derived from the live registry rather than hardcoded, so the
 * day an action is registered and priced, this authorises without a code
 * change — and until then it fails closed for a stated, verifiable reason.
 */

import { resolveMonetizationFeature } from '../../../../shared/monetization/featureRegistry';
import type { CostDecision, ExecuteEnrichmentPorts } from './execute';

/**
 * The action prospect enrichment WOULD use. Deliberately not yet a member of
 * `CREDIT_ACTIONS` — see the header. Named here so the registry lookup, the
 * refusal message and any future registration all reference one string.
 */
export const PROSPECT_ENRICHMENT_ACTION = 'prospect_enrichment';

/** The action that must NOT be borrowed, and why. */
export const FORBIDDEN_BORROWED_ACTION = 'profile_enrichment';

export interface CreditCostPortOptions {
  /** Canonical credit action. Refused unless the registry knows it. */
  readonly action?: string;
  /** Reserves budget. Throws when pricing is absent — which is a refusal. */
  readonly reserve?: (input: {
    organizationId: string;
    action: string;
    providerId: string;
    attributes: readonly string[];
    correlationId: string;
  }) => Promise<{ holdId: string | null }>;
  /** Registry lookup. Injectable so tests need no monetization fixtures. */
  readonly resolveFeature?: typeof resolveMonetizationFeature;
}

/**
 * Build a cost port backed by the canonical credit registry.
 *
 * Order of refusal, each one before any provider is contacted:
 *   1. the action is not registered            → no price can exist
 *   2. the action resolves to no pricing key   → nothing to charge against
 *   3. the action is the borrowed internal one → wrong cost centre
 *   4. no reservation function was supplied    → nothing can hold credits
 *   5. the reservation throws                  → usually a missing price row
 */
export function makeCreditCostPort(
  options: CreditCostPortOptions = {},
): Pick<ExecuteEnrichmentPorts, 'authorizeCost' | 'releaseCost'> {
  const action = options.action ?? PROSPECT_ENRICHMENT_ACTION;
  const resolveFeature = options.resolveFeature ?? resolveMonetizationFeature;

  return {
    async authorizeCost(input): Promise<CostDecision> {
      if (action === FORBIDDEN_BORROWED_ACTION) {
        return {
          authorized: false,
          reason:
            `refusing to charge prospect enrichment to '${FORBIDDEN_BORROWED_ACTION}' — that is the `
            + 'company-profile credit action and holds no credits; a distinct credit action is required',
        };
      }

      const feature = resolveFeature({ action_key: action });
      if (!feature) {
        return {
          authorized: false,
          reason:
            `no credit action '${action}' is registered, so provider spend cannot be reserved; `
            + 'refusing before any external call',
        };
      }

      // ─── THE RESOLVED ACTION MUST BE THE ONE WE ASKED FOR ─────────────────
      // `resolveMonetizationFeature` does NOT answer null for an unknown action.
      // Its last fallback is `resolveFeatureFromReport`, which with no report
      // inputs still resolves — today to `reports.snapshot` / `website_audit`,
      // a 50-credit customer-facing action that holds credits. So an
      // unregistered key does not fail; it silently becomes a website audit.
      //
      // That makes an identity check mandatory rather than defensive: without
      // it, a typo'd or not-yet-registered enrichment action would authorise
      // and bill a tenant for the wrong thing.
      if (feature.action_key !== action) {
        return {
          authorized: false,
          reason:
            `credit action '${action}' is not registered — the registry resolved it to `
            + `'${feature.action_key}' (${feature.feature_key}) by fallback, which is a different `
            + 'cost centre; refusing before any external call',
        };
      }
      if (!feature.pricing_key) {
        return {
          authorized: false,
          reason: `credit action '${action}' resolves to no pricing key; refusing before any external call`,
        };
      }
      if (!options.reserve) {
        return {
          authorized: false,
          reason: `no credit reservation is wired for '${action}'; refusing before any external call`,
        };
      }

      try {
        const { holdId } = await options.reserve({
          organizationId: input.organizationId,
          action,
          providerId: input.providerId,
          attributes: input.attributes,
          correlationId: input.correlationId,
        });
        // A reservation that produced no hold is not an authorisation.
        if (!holdId) {
          return { authorized: false, reason: `reservation for '${action}' returned no hold` };
        }
        return { authorized: true, holdId, cost: { kind: 'unknown' } };
      } catch (err) {
        // `pricingService` throws "Missing action_pricing_config row" when the
        // action has no price. A throw is a refusal, never a fallthrough.
        return {
          authorized: false,
          reason: `credit reservation failed for '${action}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async releaseCost() {
      // Nothing is reserved while the action is unregistered. A real release is
      // wired alongside a real `reserve`, so the two always arrive together.
    },
  };
}

/**
 * The port the executor uses by default.
 *
 * Refuses today, for a reason read from the live registry rather than asserted
 * here: `prospect_enrichment` is not a registered credit action.
 */
export const creditCostPort = makeCreditCostPort();
