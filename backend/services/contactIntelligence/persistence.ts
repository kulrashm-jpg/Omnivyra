/**
 * CI-B201 (persistence) — Canonical Contact persistence contract (pure shape builder; NO writer wired
 * in Phase 1, and no migration accompanies it). A compat adapter maps the canonical understanding onto
 * a legacy platform-person field shape so consumers can be served the projection during adoption —
 * Contact is the sole owner; consumers reference it.
 *
 * The legacy shape mirrors the columns `contacts` already stores (platform, platform_user_id,
 * contact_key, display_name, profile_url) so an adopter can compare canonical output against the row
 * it already has, without this module knowing anything about the table.
 */

import type { ContactUnderstanding, ContactProjection, ContactUnderstandingShadowRecord } from './types';

export function toShadowRecord(
  u: ContactUnderstanding,
  projection: ContactProjection,
  parity: number | null,
): ContactUnderstandingShadowRecord {
  return {
    company_id: u.key.companyId,
    contact_id: u.key.contactId,
    version: u.version,
    understanding: u,
    projection,
    parity,
    built_at: u.builtAt,
  };
}

export interface LegacyContactFields {
  company_id: string; contact_id: string;
  platform: string | null; platform_user_id: string | null; contact_key: string | null;
  display_name: string | null; profile_url: string | null;
  unified_person_id: string | null;
  reachable: boolean;
}

export function toLegacyFields(u: ContactUnderstanding): LegacyContactFields {
  const id = u.facets.identity.value;
  const profile = u.facets.profile.value;
  const channels = u.facets.channels.value?.channels ?? [];
  return {
    company_id: u.key.companyId,
    contact_id: u.key.contactId,
    platform: id?.platform ?? null,
    platform_user_id: id?.platformUserId ?? null,
    contact_key: id?.contactKey ?? null,
    display_name: profile?.displayName ?? null,
    profile_url: profile?.profileUrl ?? null,
    unified_person_id: id?.unifiedPersonId ?? null,
    reachable: u.facets.reachability.value?.reachable ?? channels.length > 0,
  };
}
