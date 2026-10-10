/**
 * SLICE 3F — BUDGET + LEARNING FLOOR.
 *
 * Downstream of 3E. Adds budget and learning-floor information to a decision that already
 * carries a pilot, and changes nothing else.
 *
 * THE RULE THAT MATTERS: no currency amount is ever invented. Not a default, not a benchmark,
 * not an assumed CPC/CPM/CPA, not a figure inferred from company size, revenue band, industry,
 * pricing, competitor spend or public ad presence. Advertising presence is not advertising
 * performance, and a number produced to make the section look finished is worse than an
 * explicit absence.
 *
 * WHAT THE PRODUCT CURRENTLY SUPPLIES: nothing. There is no declared marketing budget, spend
 * tolerance or acceptable acquisition cost anywhere in `company_profiles` or `report_settings`.
 * `avg_deal_size` exists but is free text (e.g. "$5k") and parsing it would mean guessing both
 * amount and currency. So in practice every real tenant resolves to `unavailable` today. The
 * derivation paths below exist because the inputs are declarable later, not because anything
 * supplies them now — and they are reachable only from explicitly declared numeric inputs.
 *
 * NO SCHEMA CHANGE. The unavailable state plus its unlock is the correct answer while the
 * declarations do not exist; adding a column would be building a field before the decision to
 * collect it has been made.
 */
import type {
  AcquisitionBudget,
  AcquisitionDecision,
  BudgetPosture,
  LearningFloor,
} from './acquisitionContract';

/**
 * Tenant-DECLARED numeric inputs. Each must arrive as an explicit number with an explicit
 * currency: nothing here is parsed out of free text, and nothing is inferred from locale.
 */
export type DeclaredBudgetInputs = {
  /** A declared spend tolerance for one review period. */
  declaredAmount?: number | null;
  /** ISO currency for `declaredAmount`. Absent currency is a hard stop, never a guess. */
  declaredCurrency?: string | null;
  /** A declared acceptable cost per primary conversion. */
  declaredAcceptableCostPerConversion?: number | null;
  /** ISO currency for the acceptable cost. Must match `declaredCurrency` to combine them. */
  declaredAcceptableCostCurrency?: string | null;
};

const UNLOCK_NO_DECLARATION =
  'Declare what you could spend for one review period without strain, and the currency. A responsible starting budget cannot be calculated from public evidence alone — nothing observable about a website establishes what a company can afford.';

const UNLOCK_NO_CURRENCY =
  'A spend amount was supplied without a currency. State the currency explicitly: it is not inferred from location, domain or market.';

const UNLOCK_NO_LEARNING_INPUTS =
  'Declare an acceptable cost per enquiry or sale, in the same currency as your budget, so the number of conversions a test could produce can be estimated.';

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function currency(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Budget posture.
 *
 * Always `low_risk_test` from this slice. `scale_ready` is governed solely by 3C's reviewed-
 * pilot rule, so no budget — however large — may produce it. `moderate_test` has no defensible
 * trigger in the current evidence, and inventing one would be inventing a risk taxonomy.
 *
 * Note what this deliberately does NOT do: an unavailable budget is not escalated to a higher
 * risk posture. Budget unknown is not the same as spend risk high.
 */
function budgetPosture(): BudgetPosture {
  return 'low_risk_test';
}

/**
 * Derive the budget state from declared inputs alone.
 *
 * Deterministic and traceable: the only route to a number is a tenant stating one. An amount
 * without a currency abstains rather than guessing — a figure whose unit is unknown is not a
 * budget.
 */
export function deriveAcquisitionBudget(
  inputs: DeclaredBudgetInputs,
  learningFloor: LearningFloor,
): AcquisitionBudget {
  const amount = positiveNumber(inputs.declaredAmount);
  const code = currency(inputs.declaredCurrency);

  if (amount === null) {
    return { state: 'unavailable', posture: budgetPosture(), unlock: UNLOCK_NO_DECLARATION };
  }
  if (code === null) {
    return { state: 'unavailable', posture: budgetPosture(), unlock: UNLOCK_NO_CURRENCY };
  }

  return {
    state: 'declared',
    posture: budgetPosture(),
    amount,
    currency: code,
    // Whether the declared budget clears the floor is only answerable once the floor exists.
    // Judging sufficiency is 3G's; this records the comparison, nothing more.
    meetsLearningFloor: learningFloor.state === 'derived'
      ? learningFloor.expectedConversionEvents > 0
      : null,
  };
}

/**
 * Derive the learning floor.
 *
 * The contract stores EXPECTED primary conversion events, and that is all this computes:
 * declared budget divided by declared acceptable cost per conversion. Deterministic, with both
 * inputs named in the basis, no safety multiplier, no rounding of a guess, no hidden constant.
 *
 * Whether that count is ENOUGH to interpret a result is a separate judgement with a
 * statistical basis this slice does not have and must not invent. 3G owns it.
 *
 * Both currencies must match. Dividing across currencies would silently assume a conversion
 * rate between them.
 */
export function deriveLearningFloor(inputs: DeclaredBudgetInputs): LearningFloor {
  const amount = positiveNumber(inputs.declaredAmount);
  const amountCurrency = currency(inputs.declaredCurrency);
  const costPerConversion = positiveNumber(inputs.declaredAcceptableCostPerConversion);
  const costCurrency = currency(inputs.declaredAcceptableCostCurrency);

  if (amount === null || amountCurrency === null || costPerConversion === null || costCurrency === null) {
    return { state: 'unavailable', unlock: UNLOCK_NO_LEARNING_INPUTS };
  }
  if (amountCurrency !== costCurrency) {
    return {
      state: 'unavailable',
      unlock: `The declared budget is in ${amountCurrency} and the acceptable cost per conversion in ${costCurrency}. State both in the same currency: no exchange rate is assumed.`,
    };
  }

  return {
    state: 'derived',
    expectedConversionEvents: Math.floor(amount / costPerConversion),
    basis: `Declared budget of ${amount} ${amountCurrency} divided by a declared acceptable cost per conversion of ${costPerConversion} ${costCurrency}. Both figures are company declarations, not observed performance.`,
  };
}

/**
 * Attach budget and learning floor to a decision.
 *
 * Only a decision that already carries a pilot receives them: with no experiment to fund,
 * a budget block would be answering a question nobody asked. Every other field is passed
 * through untouched — posture, need, organic, paid, dependencies and the pilot itself.
 */
export function attachBudgetAndLearningFloor(
  decision: AcquisitionDecision,
  inputs: DeclaredBudgetInputs,
): AcquisitionDecision {
  if (decision.pilot === null) {
    return { ...decision, budget: null, learningFloor: null };
  }

  const learningFloor = deriveLearningFloor(inputs);
  const budget = deriveAcquisitionBudget(inputs, learningFloor);

  return { ...decision, budget, learningFloor };
}
