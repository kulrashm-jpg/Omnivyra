/**
 * CI-B208 (shadow runtime) — Contact shadow runtime (pure). Builds the canonical Understanding from
 * observed evidence and measures FIELD parity vs the raw input it was built from — ZERO production
 * behaviour change, authoritative OFF, consumed by nothing.
 *
 * `computeContactUnderstandingShadow` returns null when the flag is OFF (the default): the guard is
 * the FIRST statement, so a dark runtime does no work and has no side effects rather than computing an
 * answer and discarding it.
 *
 * WHY PARITY IS MEASURED AGAINST THE INPUT. Contact has no legacy field-set of its own to diverge
 * from — the `contacts` row IS the input. So parity here answers a narrower and more useful question:
 * did the canonical pipeline carry every raw field through to the projection without losing or
 * inventing one? A divergence is therefore a pipeline defect, not a disagreement between two systems.
 *
 * COMPOSITION IS NOT DUPLICATED. This delegates to `assembleContactUnderstanding` rather than
 * re-composing fromEvidence → builder → projection inline. The sibling runtimes predate their own
 * assembly seam and repeat the composition; repeating it here would create two places where the shadow
 * and the assembled understanding could silently drift apart. The exported shapes are unchanged.
 *
 * Deterministic and clock-independent: every timestamp comes from `input.asOf`. Writes nothing.
 */

import type { ContactUnderstanding, ContactProjection } from './types';
import type { ContactEvidenceInput } from './fromEvidence';
import { assembleContactUnderstanding } from './assembly';
import { isContactUnderstandingEnabled } from './flags';
import { toLegacyFields } from './persistence';

export interface ContactFieldDivergence { field: string; canonical: unknown; legacy: unknown; agree: boolean; }
export interface ContactShadowComparison {
  contactId: string;
  divergences: ContactFieldDivergence[];
  facetCount: number;
  evidenceCount: number;
  contradictionCount: number;
  parity: number;
}

const norm = (v: unknown): string => (Array.isArray(v) ? [...v].map(String).sort().join('|') : v == null ? '' : String(v));

/** Field-parity of the canonical understanding vs the raw observations it was built from. */
export function compareToRaw(u: ContactUnderstanding, raw: ContactEvidenceInput): ContactShadowComparison {
  const c = toLegacyFields(u);
  const pairs: Array<[string, unknown, unknown]> = [
    ['platform', c.platform, raw.identity?.platform ?? null],
    ['platform_user_id', c.platform_user_id, raw.identity?.platformUserId ?? null],
    ['contact_key', c.contact_key, raw.identity?.contactKey ?? null],
    ['display_name', c.display_name, raw.profile?.displayName ?? null],
    ['profile_url', c.profile_url, raw.profile?.profileUrl ?? null],
    ['unified_person_id', c.unified_person_id, raw.unifiedPersonId ?? null],
    // Reachability is DERIVED downstream, so comparing it to "were any channels supplied" is what
    // catches a pipeline that drops the channel observations somewhere between input and facet.
    ['reachable', c.reachable, (raw.channels ?? []).length > 0],
  ];
  const divergences: ContactFieldDivergence[] = pairs.map(([field, cv, lv]) => ({ field, canonical: cv, legacy: lv, agree: norm(cv) === norm(lv) }));
  const facetCount = Object.values(u.facets).filter((f) => f.value !== null).length;
  const evidenceCount = new Set(Object.values(u.facets).flatMap((f) => f.evidence.map((e) => e.id))).size;
  const agree = divergences.filter((d) => d.agree).length;
  return {
    contactId: u.key.contactId,
    divergences,
    facetCount,
    evidenceCount,
    contradictionCount: u.contradictions.length,
    parity: divergences.length ? Number((agree / divergences.length).toFixed(4)) : 1,
  };
}

export interface ContactShadowBundle { understanding: ContactUnderstanding; projection: ContactProjection; comparison: ContactShadowComparison; }

/** Flag-gated shadow entry point. Returns null when OFF (default) — no work, no side effects. */
export function computeContactUnderstandingShadow(input: ContactEvidenceInput): ContactShadowBundle | null {
  if (!isContactUnderstandingEnabled()) return null;
  const { understanding, projection } = assembleContactUnderstanding(input);
  const comparison = compareToRaw(understanding, input);
  return { understanding, projection, comparison };
}
