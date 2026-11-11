/**
 * L3-1 — the minimal, auditable social-platform "do not engage" writer
 * (owner decision, 2026-11-03).
 *
 * No new store. This is a thin adapter over PI's canonical writer
 * (prospectIdentity/contactGovernanceWriter.recordContactGovernance), which
 * owns contact_governance_records, its vocabulary, idempotency and tenant
 * guard. The L-3 recheck (communityRecipientRecheck) reads the same records
 * through evaluateCanonicalGovernance.
 *
 * Mapping (each required field → where it lives):
 *   tenant                      → organization_id
 *   person (when known)         → person_id (composite FK: same tenant only)
 *   platform                    → channel ('linkedin' | 'x' | 'facebook' | 'instagram')
 *   platform recipient id       → target_raw (exact) + target_normalized
 *   restriction type / scope    → governance_type 'dnc_channel', unscoped
 *                                 (= every purpose on that platform channel)
 *   source / evidence           → source 'operator:do_not_engage', evidence summary
 *   timestamp                   → effective_from (default now()) + created_at
 *   actor                       → evidence.actor_user_id (required here)
 *
 * Contract gaps, returned to PI rather than worked around:
 *   G1  no actor column: the actor lives in the evidence summary, which the
 *       writer's contract sanctions ("matched phrase, confidence, detector
 *       version, actor") but which is not indexed or FK-checked;
 *   G2  a non-email/phone/WhatsApp target is casefolded for matching, while
 *       LinkedIn identifiers are case-sensitive: two different members could
 *       collide. This over-blocks (fails safe); target_raw keeps the exact id;
 *   G3  purpose_scope accepts only 'outreach' | 'account' on
 *       unsubscribe/consent_withdrawn/complaint, so a channel DNC cannot be
 *       narrowed to community engagement: it blocks every purpose on that
 *       platform (stricter, fails safe).
 *
 * Exact identifiers only: no names, handles-as-names, URLs or partial values.
 */
import { normalizePlatform } from '../constants/platforms';
import {
  recordContactGovernance,
  GovernanceWriteError,
  type RecordGovernanceResult,
} from './prospectIdentity/contactGovernanceWriter';

export const SOCIAL_DO_NOT_ENGAGE_PLATFORMS = ['linkedin', 'x', 'facebook', 'instagram'] as const;
export const SOCIAL_DO_NOT_ENGAGE_SOURCE = 'operator:do_not_engage';

export interface SocialDoNotEngageInput {
  organizationId: string;
  platform: string;
  /** The platform's own, exact identifier for the recipient (e.g. engagement_authors.platform_user_id). */
  platformUserId: string;
  personId?: string | null;
  /** The Omnivyra user recording the restriction. Required: an unattributed restriction is unauditable. */
  actorUserId: string;
  /** Short machine-readable reason, e.g. 'requested_no_contact', 'operator_judgement'. */
  reasonCode: string;
  /** Where the instruction came from, when it came from a stored record (LI-2 source record). */
  sourceRecordId?: string | null;
  effectiveFrom?: string;
}

export class SocialDoNotEngageError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SocialDoNotEngageError';
  }
}

const REASON_CODE = /^[a-z][a-z0-9_]{1,63}$/;

export async function recordSocialDoNotEngage(input: SocialDoNotEngageInput): Promise<RecordGovernanceResult> {
  const platform = normalizePlatform(String(input.platform || '')) || '';
  if (!(SOCIAL_DO_NOT_ENGAGE_PLATFORMS as readonly string[]).includes(platform)) {
    throw new SocialDoNotEngageError(`unsupported platform '${input.platform}'`, 'platform_unsupported');
  }
  const id = typeof input.platformUserId === 'string' ? input.platformUserId.trim() : '';
  // An exact platform identifier: no whitespace (rules out display names), no
  // scheme (rules out profile URLs, which are not stable identifiers).
  if (!id || /\s/.test(id) || /^[a-z]+:\/\//i.test(id)) {
    throw new SocialDoNotEngageError('platformUserId must be the platform\'s exact recipient identifier', 'recipient_identifier_invalid');
  }
  const actor = typeof input.actorUserId === 'string' ? input.actorUserId.trim() : '';
  if (!actor) {
    throw new SocialDoNotEngageError('actorUserId is required — a restriction must be attributable', 'actor_required');
  }
  if (!REASON_CODE.test(String(input.reasonCode || ''))) {
    throw new SocialDoNotEngageError('reasonCode must be a short snake_case code', 'reason_code_invalid');
  }

  try {
    return await recordContactGovernance({
      organizationId: input.organizationId,
      governanceType: 'dnc_channel',
      channel: platform,
      personId: input.personId ?? null,
      target: id,
      source: SOCIAL_DO_NOT_ENGAGE_SOURCE,
      sourceRecordId: input.sourceRecordId ?? null,
      evidence: {
        actor_user_id: actor,
        reason_code: input.reasonCode,
        recipient_identifier_kind: 'platform_user_id',
        writer: 'communitySocialDoNotEngage@1',
      },
      effectiveFrom: input.effectiveFrom,
    });
  } catch (e) {
    if (e instanceof GovernanceWriteError) throw new SocialDoNotEngageError(e.message, e.code);
    throw e;
  }
}
