/**
 * The source-neutral core of the signal → canonical prospect bridge.
 *
 *   gate (existing PI gate) → person (W1) → prospect (WS-1) → source record (LI-2)
 *   → contribution (provenance writer)
 *
 * It REUSES the existing services and restates none of their rules. What it owns
 * is the order, the prospect-selection rule below, and the error posture.
 *
 * ─── PROSPECT SELECTION ("never a second canonical lead for one identity") ──
 *   1. A prospect keyed by THIS event's externalRef exists → use it. This source
 *      event created it (possibly on an earlier, interrupted attempt), so it is
 *      the originator: `leadCreated = true`. A retry therefore converges on the
 *      same lead AND the same originating contribution (the writer answers
 *      `duplicate`).
 *   2. Otherwise, exactly ONE prospect in this tenant is already anchored to the
 *      resolved person → contribute to it (`leadCreated = false`). No new lead.
 *   3. More than one → refuse (`skipped: ambiguous_person_prospects`). Picking one
 *      would be an arbitrary merge decision; creating another would add a third.
 *   4. None → `resolveOrCreateProspect` with the namespaced key. Created here, so
 *      `leadCreated = true`.
 *
 * ─── NO IDENTITY, NO PROSPECT ────────────────────────────────────────────
 * An event without (platform, platform user id) is skipped. A prospect keyed by a
 * single post with no person would be a lead nobody can join to anything, and
 * every later post by the same author would mint another.
 *
 * ─── ERROR POSTURE ───────────────────────────────────────────────────────
 * NEVER throws. Every outcome — bridged, skipped, failed — is returned AND
 * observed (counted; failures logged + metered). Callers are live feed and
 * engagement paths that must not break because provenance could not be written.
 */
import { namespacedExternalRef } from '../../../../lib/prospectProvenance/contract';
import { observeBridgeOutcome } from './observability';
import type { BridgeDeps, BridgeOutcome, BridgeSourceEvent, GateDecisionLike } from './types';

/** Bumped when the bridge's rules change; stamped on rows it creates. */
export const PROVENANCE_BRIDGE_VERSION = 'a4.bridge.1';

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** The identity keys handed to W1 — the SAME shape Lead Intelligence adoption builds (`<platform>:user`). */
export function personExternalKeys(platform: string, platformUserId: string): Record<string, unknown> {
  return { [`${platform}:user`]: platformUserId };
}

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

    // ── PERSON (W1) ───────────────────────────────────────────────────────
    let personId: string;
    try {
      const person = await deps.resolvePerson({ companyId: org, externalKeys: personExternalKeys(platform, platformUserId) });
      personId = person.unifiedPersonId;
    } catch (e) {
      return done({ status: 'failed', reason: `identity_failed:${(e as Error).message}` });
    }

    // ── PROSPECT (WS-1) ───────────────────────────────────────────────────
    const at = deps.now();
    let prospectId: string | null;
    let leadCreated: boolean;
    let prospectPath: NonNullable<BridgeOutcome['prospectPath']>;
    try {
      prospectId = await deps.findProspectByKey(org, externalRef, event.prospectSource);
      if (prospectId) {
        leadCreated = true;
        prospectPath = 'own_key';
      } else {
        const anchored = await deps.findProspectsForPerson(org, personId);
        if (anchored.length > 1) {
          return done({ status: 'skipped', reason: 'ambiguous_person_prospects', personId });
        }
        if (anchored.length === 1) {
          prospectId = anchored[0];
          leadCreated = false;
          prospectPath = 'existing_person';
        } else {
          const created = await deps.resolveOrCreateProspect(org, {
            externalLeadKey: externalRef,
            source: event.prospectSource,
            personId,
            metadata: {
              provenanceBridge: PROVENANCE_BRIDGE_VERSION,
              sourceCategory: event.sourceCategory,
              externalRef,
            },
          }, at);
          if (!created.prospectId) {
            return done({ status: 'failed', reason: `prospect_unresolved:${created.outcome}`, personId });
          }
          prospectId = created.prospectId;
          leadCreated = true; // keyed by this event's externalRef either way
          prospectPath = created.outcome === 'created' ? 'created' : 'matched_on_create';
        }
      }
    } catch (e) {
      return done({ status: 'failed', reason: `prospect_failed:${(e as Error).message}`, personId });
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
      return done({ status: 'failed', reason: `source_record_failed:${(e as Error).message}`, personId, prospectId, leadCreated, prospectPath });
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
      evidence: { ...event.evidence, observedAtBasis: event.observedAtBasis, bridge: PROVENANCE_BRIDGE_VERSION },
      sourceMetadata: event.sourceMetadata,
    });
    const common = { personId, prospectId, sourceRecordId, leadCreated, prospectPath };
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
