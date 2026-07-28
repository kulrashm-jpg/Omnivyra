/**
 * V-A108 — Visitor Explainability. Thin wrapper over the shared canonical `explainUnderstanding` —
 * every Visitor conclusion answers Why / Why now / evidence / signals / assumptions / contradictions /
 * what-changed / confidence / uncertainty. No opaque conclusions; reuses shared explainability.
 */

import type { VisitorUnderstanding } from './types';
import { explainUnderstanding, explainAll, type Explanation } from '../intelligence/canonical';

export function explainVisitor(u: VisitorUnderstanding, claim: string, prior?: VisitorUnderstanding): Explanation {
  return explainUnderstanding(u, claim, prior);
}
export function explainVisitorAll(u: VisitorUnderstanding, prior?: VisitorUnderstanding): Explanation[] {
  return explainAll(u, prior);
}
export type { Explanation };
