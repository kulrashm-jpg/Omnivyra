/**
 * J-B207 — Journey Explainability. Thin wrapper over the shared canonical `explainUnderstanding` —
 * every Journey conclusion answers Why / Why now / evidence / chronology / assumptions / contradictions
 * / what-changed / confidence / uncertainty. No opaque conclusions; reuses shared explainability (no
 * journey-specific explainer).
 */

import type { JourneyUnderstanding } from './types';
import { explainUnderstanding, explainAll, type Explanation } from '../intelligence/canonical';

export function explainJourney(u: JourneyUnderstanding, claim: string, prior?: JourneyUnderstanding): Explanation {
  return explainUnderstanding(u, claim, prior);
}
export function explainJourneyAll(u: JourneyUnderstanding, prior?: JourneyUnderstanding): Explanation[] {
  return explainAll(u, prior);
}
export type { Explanation };
