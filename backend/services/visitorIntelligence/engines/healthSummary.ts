/**
 * V-B207 — Visitor Health Summary (deterministic; descriptive). Classifies a canonical visitor summary
 * from the understanding's facets + recency: highly_active / occasionally_active / inactive /
 * re_engaging / anonymous / identified. Descriptive only — no prediction, no scoring system of its own
 * (it reads the decided facets/score). Abstains to 'anonymous'/'unknown' when evidence is thin.
 */

import type { VisitorUnderstanding } from '../types';
import { decayFactor, clamp01 } from '../../intelligence/canonical';

export type VisitorHealthStatus = 'highly_active' | 'occasionally_active' | 'inactive' | 're_engaging' | 'anonymous' | 'identified' | 'unknown';

export interface VisitorHealthSummary {
  status: VisitorHealthStatus;
  identityStatus: string | null;
  lifecycle: string | null;
  recency: number | null;        // 0..1 (freshness of last activity)
  signals: string[];
  confidence: number;
}

export function visitorHealthSummary(u: VisitorUnderstanding, asOf: string): VisitorHealthSummary {
  const identity = u.facets.identity.value;
  const lifecycle = u.facets.lifecycle.value?.state ?? null;
  const lastSeen = u.facets.session.value?.lastSeenAt ?? null;
  const recency = lastSeen ? clamp01(decayFactor(lastSeen, asOf, 30)) : null;
  const sessionCount = u.facets.session.value?.sessionCount ?? 0;
  const engagement = u.score.dimensions.engagement.value;

  const signals: string[] = [];
  if (identity?.status) signals.push(`identity:${identity.status}`);
  if (lifecycle) signals.push(`lifecycle:${lifecycle}`);
  if (recency != null) signals.push(`recency:${recency}`);

  // Descriptive classification (deterministic thresholds over decided values).
  let status: VisitorHealthStatus = 'unknown';
  if (lifecycle === 're_engaged') status = 're_engaging';
  else if (recency != null && recency >= 0.6 && (sessionCount >= 3 || (engagement ?? 0) >= 0.6)) status = 'highly_active';
  else if (recency != null && recency >= 0.3) status = 'occasionally_active';
  else if (recency != null && recency < 0.3) status = 'inactive';
  else if (identity?.status === 'identified' || identity?.status === 'known') status = 'identified';
  else if (identity?.status === 'anonymous') status = 'anonymous';

  return { status, identityStatus: identity?.status ?? null, lifecycle, recency, signals, confidence: u.score.confidence };
}
