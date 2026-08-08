/**
 * Canonical Contact Projection — the SINGLE projection owner. Pure derived reshape: it reads decided
 * facet/score values and never recomputes a semantic. Deterministic (`projectedAt` passed in).
 */

import type {
  ContactUnderstanding, ContactProjection, ContactFacetName, ContactScoreDimension,
  ContactIdentityValue, ContactProfileValue, ContactChannelType,
} from './types';
import { CONTACT_FACET_NAMES, CONTACT_SCORE_DIMENSIONS } from './types';

export function projectContact(u: ContactUnderstanding, projectedAt: string): ContactProjection {
  const scores = {} as Record<ContactScoreDimension, number | null>;
  for (const d of CONTACT_SCORE_DIMENSIONS) scores[d] = u.score.dimensions[d].value;

  const facetConfidence = {} as Record<ContactFacetName, number>;
  for (const name of CONTACT_FACET_NAMES) facetConfidence[name] = u.facets[name].confidence;

  const topContradictions = [...u.contradictions].sort((a, b) => Number(a.resolved) - Number(b.resolved)).slice(0, 5);

  const identity = u.facets.identity.value as ContactIdentityValue | null;
  const channelEntries = u.facets.channels.value?.channels ?? [];
  const reach = u.facets.reachability.value;

  return {
    key: u.key,
    version: u.version,
    identity,
    profile: u.facets.profile.value as ContactProfileValue | null,
    // Upward reference to the Canonical Person. `undefined` (facet abstained) and an explicit `null`
    // both mean "not resolved"; the projection normalises them to `null` so consumers need one check.
    unifiedPersonId: identity?.unifiedPersonId ?? null,
    // Prefer the decided reachability facet. Absent it, a contact with at least one known channel is
    // reachable — derived from the channels facet, not invented.
    reachable: reach?.reachable ?? channelEntries.length > 0,
    channels: channelEntries.map((c) => c.channel) as ContactChannelType[],
    scores,
    overallScore: u.score.overall,
    confidence: u.score.confidence,
    facetConfidence,
    topContradictions,
    projectedAt,
  };
}
