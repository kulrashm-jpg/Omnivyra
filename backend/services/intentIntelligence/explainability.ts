/**
 * I-B207 — Intent Explainability. Thin wrapper over the shared canonical `explainUnderstanding` —
 * every Intent conclusion answers Why / Why now / evidence / chronology / assumptions / contradictions
 * / what-changed / confidence / uncertainty / abstention reason. No opaque conclusions; reuses shared
 * explainability (no intent-specific explainer).
 */

import type { IntentUnderstanding } from './types';
import { explainUnderstanding, explainAll, type Explanation } from '../intelligence/canonical';

export function explainIntent(u: IntentUnderstanding, claim: string, prior?: IntentUnderstanding): Explanation {
  return explainUnderstanding(u, claim, prior);
}
export function explainIntentAll(u: IntentUnderstanding, prior?: IntentUnderstanding): Explanation[] {
  return explainAll(u, prior);
}
export type { Explanation };
