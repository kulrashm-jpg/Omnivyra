/**
 * CI-D406 — Company Explainability Framework. Thin wrapper over the shared canonical
 * `explainUnderstanding` — every Company conclusion answers Why / Why now / evidence / signals /
 * assumptions / contradictions / what-changed / confidence / uncertainty. No opaque conclusions.
 */

import type { CompanyUnderstanding } from '../types';
import { explainUnderstanding, explainAll, type Explanation } from '../../intelligence/canonical';

export function explainCompany(u: CompanyUnderstanding, claim: string, prior?: CompanyUnderstanding): Explanation {
  return explainUnderstanding(u, claim, prior);
}
export function explainCompanyAll(u: CompanyUnderstanding, prior?: CompanyUnderstanding): Explanation[] {
  return explainAll(u, prior);
}
export type { Explanation };
