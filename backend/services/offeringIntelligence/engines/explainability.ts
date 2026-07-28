/**
 * OI-D403 — Offering Explainability Framework. Thin wrapper over the shared canonical
 * `explainUnderstanding` — every Offering conclusion answers Why / Why now / evidence / signals /
 * assumptions / contradictions / what-changed / confidence / uncertainty. No opaque conclusions.
 */

import type { OfferingUnderstanding } from '../types';
import { explainUnderstanding, explainAll, type Explanation } from '../../intelligence/canonical';

export function explainOffering(u: OfferingUnderstanding, claim: string, prior?: OfferingUnderstanding): Explanation {
  return explainUnderstanding(u, claim, prior);
}
export function explainOfferingAll(u: OfferingUnderstanding, prior?: OfferingUnderstanding): Explanation[] {
  return explainAll(u, prior);
}
export type { Explanation };
