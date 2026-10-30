/**
 * The source-neutral core of the signal -> canonical prospect bridge.
 *
 *   gate (existing PI gate) -> identity VERIFICATION (read-only) -> prospect (WS-1)
 *   -> [attach verified person] -> source record (LI-2) -> contribution (provenance writer)
 *
 * It REUSES the existing services and restates none of their rules. What it owns
 * is the order, the prospect-selection rule below, and the error posture.
 *
 * --- NO PERSON FROM A BARE HANDLE (owner decision 2, 2026-10-30) ---------
 * The bridge NEVER creates a `unified_persons` row or an `identity_claims` row.
 * It asks `resolveVerifiedPerson` (verifiedIdentity.ts: one linked, active
 * `identity_claims` external_id row in this tenant) whether the author is a
 * KNOWN person. Unverified => the prospect exists WITHOUT a person; the
 * platform, handle and contact id are kept in the contribution evidence and in
 * `source_records.raw_payload`, and the prospect is anchored to the normalised
 * social identity in `lead_metadata.sourceIdentity` so later events from the
 * same author find it again.
 *
 * --- PROSPECT SELECTION ("never a second canonical lead for one identity") ---
 *   1. A prospect keyed by THIS event's externalRef exists -> use it. This source
 *      event created it (possibly on an earlier, interrupted attempt), so it is
 *      the originator: `leadCreated = true`.
 *   2. Verified person -> exactly ONE prospect in this tenant anchored to that
 *      person -> contribute to it (`leadCreated = false`). More than one -> refuse
 *      (`ambiguous_person_prospects`).
 *   3. Exactly ONE prospect in this tenant anchored to the same normalised
 *      social identity (created earlier while the author was unverified) ->
 *      contribute to it. More than one -> refuse (`ambiguous_handle_prospects`).
 *   4. None -> create ONLY when `event.newProspect.allowed` (discovery sources;
 *      engagement only via the explicit qualification rule). Otherwise skipped
 *      (`not_qualified_for_new_prospect`) with NO write of any kind.
 *   After 1-4: a VERIFIED person is attached to the chosen prospect when the
 *   prospect has none (`attachPersonToProspect`, never re-anchors). That is how a
 *   later verification links the person to the existing handle-only prospect
 *   without creating a second one.
 *
 * --- NO IDENTITY, NO PROSPECT --------------------------------------------
 * An event without (platform, platform user id) is skipped: without even a
 * handle a prospect could never be joined to anything, and every later post by
 * the same author would mint another.
 *
 * --- ERROR POSTURE -------------------------------------------------------
 * NEVER throws. Every outcome - bridged, skipped, failed - is returned AND
 * observed (counted; failures logged + metered). Callers are live feed and
 * engagement paths that must not break because provenance could not be written.
 */
import { namespacedExternalRef } from '../../../../lib/prospectProvenance/contract';
import { observeBridgeOutcome } from './observability';
import type { BridgeDeps, BridgeOutcome, BridgeSourceEvent, GateDecisionLike } from './types';
import { normalizedSocialIdentity, VERIFIED_IDENTITY_RULE_VERSION, type SocialIdentityVerdict } from './verifiedIdentity';

/** Bumped when the bridge's rules change; stamped on rows it creates. */
export const PROVENANCE_BRIDGE_VERSION = 'rb.bridge.2';

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export async function bridgeSourceEvent(
  event: BridgeSourceEvent,
  deps: BridgeDeps,
  options: { gateDecision?: GateDecisionLike } = {},
): Promise<BridgeOutcome> {
  const org = str(event.organizationId);
  let externalRef: string | null = null;
  const base = (): Pick<BridgeOutcome, 'kind' | 'organizationId' | 'externalRef'> =>
    ({ kind: event.kind, organizationId: org, externalRef });
  const done = (o: Omit<BridgeOutcome, 'kind' | 'organizationId' | 'externalRef'>): BridgeOutcome =>
    observeBridgeOutcome({ ...base(), ...o });

  try {
    if (!org) return done({ status: 'skipped', reason: 'organization_required' });
    try {
      externalRef = namespacedExternalRef(event.provider, event.sourceRecordKey);
    } catch (e) {
      return done({ status: 'failed', reason: `invalid_external_ref:${(e as Error).message}` });
    }

    const gate = options.gateDecision ?? await deps.gate(org);
    if (!gate.allowed) return done({ status: 'skipped', reason: `gate_closed:${gate.reason}` });

    const platform = str(event.identity.platform);
    const platformUserId = str(event.identity.platformUserId);
    if (!platform || !platformUserId) return done({ status: 'skipped', reason: 'no_resolvable_identity' });

    const handle = normalizedSocialIdentity(platform, platformUserId);
    if (!handle) return done({ status: 'skipped', reason: 'no_resolvable_identity' });

    // -- IDENTITY VERIFICATION (read-only; never creates a person) ---------
    let verdict: SocialIdentityVerdict;
    try {
      verdict = await deps.resolveVerifiedPerson(org, platform, platformUserId);
    } catch (e) {
      return done({ status: 'failed', reason: `identity_failed:${(e as Error).message}` });
    }
    const personId: string | null = verdict.status === 'verified' ? verdict.personId : null;
    const identityStatus: 'verified' | 'unverified' = personId ? 'verified' : 'unverified';

    // -- PROSPECT (WS-1) ---------------------------------------------------
    const at = deps.now();
    let prospectId: string | null;
    let leadCreated: boolean;
    let prospectPath: NonNullable<BridgeOutcome['prospectPath']>;
    const idFields = { personId, identityStatus };
    try {
      prospectId = await deps.findProspectByKey(org, externalRef, event.prospectSource);
      if (prospectId) {
        leadCreated = true;
        prospectPath = 'own_key';
      } else {
        let anchored: string[] = [];
        if (personId) {
          anchored = await deps.findProspectsForPerson(org, personId);
          if (anchored.length > 1) {
            return done({ status: 'skipped', reason: 'ambiguous_person_prospects', ...idFields });
          }
        }
        if (anchored.length === 1) {
          prospectId = anchored[0];
          leadCreated = false;
          prospectPath = 'existing_person';
        } else {
          const byHandle = await deps.findProspectsForHandle(org, handle.platform, handle.platformUserId);
          if (byHandle.length > 1) {
            return done({ status: 'skipped', reason: 'ambiguous_handle_prospects', ...idFields });
          }
          if (byHandle.length === 1) {
            prospectId = byHandle[0];
            leadCreated = false;
            prospectPath = 'existing_handle';
          } else if (!event.newProspect.allowed) {
            // Enrich-only event with nothing to enrich: no write of any kind.
            return done({ status: 'skipped', reason: `not_qualified_for_new_prospect:${event.newProspect.reason}`, ...idFields });
          } else {
            const created = await deps.resolveOrCreateProspect(org, {
              externalLeadKey: externalRef,
              source: event.prospectSource,
              personId,
              metadata: {
                provenanceBridge: PROVENANCE_BRIDGE_VERSION,
                sourceCategory: event.sourceCategory,
                externalRef,
                // The anchor for a prospect with no person (normalised exactly as
                // identity_claims are). Found again by findProspectsForHandle.
                sourceIdentity: handle,
                identityStatus,
                newProspectRule: event.newProspect.rule,
              },
            }, at);
            if (!created.prospectId) {
              return done({ status: 'failed', reason: `prospect_unresolved:${created.outcome}`, ...idFields });
            }
            prospectId = created.prospectId;
            leadCreated = true; // keyed by this event's externalRef either way
            prospectPath = created.outcome === 'created' ? 'created' : 'matched_on_create';
          }
        }
      }
    } catch (e) {
      return done({ status: 'failed', reason: `prospect_failed:${(e as Error).message}`, ...idFields });
    }

    // -- LINK A VERIFIED PERSON (never re-anchors; never creates) ----------
    let personAttached = false;
    if (personId && prospectPath !== 'existing_person') {
      try {
        personAttached = (await deps.attachPersonToProspect(org, prospectId, personId)).attached;
      } catch (e) {
        return done({ status: 'failed', reason: `person_attach_failed:${(e as Error).message}`, ...idFields, prospectId, leadCreated, prospectPath });
      }
    }

    // ── SOURCE RECORD (LI-2) ──────────────────────────────────────────────
    let sourceRecordId: string;
    try {
      const sr = await deps.ingestSourceRecord({
        organizationId: org,
        provider: event.provider,
        entityType: 'person',
        sourceRecordId: event.sourceRecordKey,
        rawPayload: event.rawPayload,
        personId,
        observedAt: event.observedAt,
        ingestionRunId: event.ingestionRunId,
        sourceCategory: event.sourceCategory,
        platform: event.platform,
        sourceUrl: event.sourceUrl,
      }, at);
      sourceRecordId = sr.sourceRecordId;
    } catch (e) {
      return done({ status: 'failed', reason: `source_record_failed:${(e as Error).message}`, ...idFields, personAttached, prospectId, leadCreated, prospectPath });
    }

    // ── CONTRIBUTION (provenance writer) ──────────────────────────────────
    const result = await deps.recordContribution({
      organizationId: org,
      canonicalLeadId: prospectId,
      leadCreated,
      sourceCategory: event.sourceCategory,
      externalRef,
      sourceRecordId,
      platform: event.platform,
      sourceUrl: event.sourceUrl,
      observedAt: event.observedAt,
      ingestionRunId: event.ingestionRunId,
      leadSignalId: event.refs.leadSignalId ?? null,
      opportunityFeedItemId: event.refs.opportunityFeedItemId ?? null,
      engagementMessageId: event.refs.engagementMessageId ?? null,
      contactId: event.refs.contactId ?? null,
      evidence: {
        ...event.evidence,
        observedAtBasis: event.observedAtBasis,
        bridge: PROVENANCE_BRIDGE_VERSION,
        // Source evidence of WHO, kept whether or not the identity is verified.
        sourceIdentity: {
          platform: event.platform,
          platformUserId,
          authorHandle: str(event.identity.authorHandle ?? null),
          normalized: handle,
        },
        identityVerification: {
          status: identityStatus,
          reason: verdict.reason,
          rule: VERIFIED_IDENTITY_RULE_VERSION,
        },
        newProspectRule: { rule: event.newProspect.rule, allowed: event.newProspect.allowed, reason: event.newProspect.reason },
      },
      sourceMetadata: event.sourceMetadata,
    });
    const common = { ...idFields, personAttached, prospectId, sourceRecordId, leadCreated, prospectPath };
    if (result.status === 'error') {
      return done({ status: 'failed', reason: `contribution_failed:${result.code ?? 'unknown'}`, ...common, contribution: 'error' });
    }
    return done({
      status: 'bridged',
      reason: result.status === 'duplicate' ? 'already_recorded' : 'recorded',
      ...common,
      contribution: result.status,
      contributionRole: result.role,
      roleDowngraded: result.status === 'inserted' ? result.roleDowngraded : false,
    });
  } catch (e) {
    return done({ status: 'failed', reason: `unexpected:${e instanceof Error ? e.message : String(e)}` });
  }
}
