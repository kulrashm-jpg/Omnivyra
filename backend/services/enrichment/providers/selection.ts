/**
 * A3C — deterministic acquisition-source selection.
 *
 * Answers one question: which source should serve this request, and why?
 *
 * ─── DETERMINISTIC, AND EXPLAINABLE ───────────────────────────────────────
 * No ranking model, no quality score, no AI. Eligibility is a fixed sequence of
 * checks and `auto` takes the lowest-priority-number source that passes all of
 * them. Every answer carries the reason it was reached, because a user who
 * cannot tell why a source was chosen cannot tell when it was chosen wrongly.
 *
 * ─── AN EXPLICIT CHOICE IS NEVER SUBSTITUTED ──────────────────────────────
 * If the user asks for Apollo and Apollo is not connected, the answer is
 * "Apollo is not connected" — not silently a different vendor. Substitution
 * would spend a tenant's credits with a source they did not choose and attach
 * its evidence under a provider they never authorised.
 */

import type { EnrichmentSubject } from './contract';
import {
  getSource, supportsRequest, USABLE_STATES,
  type AcquisitionSourceDescriptor, type ConnectionState, type SourceStatus,
} from './sources';

/** `auto` means "pick for me"; anything else names a source explicitly. */
export const AUTO_SELECTION = 'auto' as const;
export type SelectionMode = typeof AUTO_SELECTION | string;

/** Why a source was not eligible. Each maps to a different user message. */
export const INELIGIBILITY_REASONS = [
  'unknown_source',
  'not_connected',
  'manual_not_automatable',
  'entity_unsupported',
  'attributes_unsupported',
  /** OMNIVYRA-funded, but no credit action exists to authorise the spend. */
  'unpriced',
  /** The declared economics are absent or self-contradictory. Fails closed. */
  'unknown_economics',
  'no_eligible_source',
] as const;
export type IneligibilityReason = typeof INELIGIBILITY_REASONS[number];

/**
 * A3Z — the economics gate.
 *
 * Answers one question: is it settled who pays for this call?
 *
 * ─── WHY THIS IS NOT SIMPLY `!creditAction` ANY MORE ──────────────────────
 * It used to be. That was right while every provider call was Omnivyra-funded:
 * no credit action meant no way to authorise the spend, so `unpriced` refused
 * it. A3X then settled the tenant-funded model — the tenant holds the vendor
 * subscription and the vendor invoices them — and correctly removed every
 * credit action, because pricing someone else's invoice would be a fabricated
 * charge. `selection.ts` was not reconciled, so the absence of a credit action
 * came to mean two incompatible things at once and EVERY source, including a
 * fully connected one with a tenant credential, was refused as "unpriced".
 *
 * The check is therefore not deleted, it is RE-ANCHORED: it now asks the
 * declared `fundingModel` who pays, and only then whether the artefact that
 * funding model requires is present. Omnivyra-funded without a credit action
 * still refuses, exactly as before — the safety property is preserved, it is
 * simply no longer applied to sources nobody expected Omnivyra to pay for.
 *
 * ─── EVERY CONTRADICTION FAILS CLOSED ─────────────────────────────────────
 * A tenant-funded source that ALSO carries an Omnivyra credit action, an
 * external API that claims nothing is paid, or a funding model outside the
 * vocabulary are all refused as `unknown_economics`. Each would mean the
 * question "who is billed for this call?" has no single answer, and guessing
 * one is how a tenant silently gets charged for something they did not buy.
 */
export function evaluateEconomics(
  source: AcquisitionSourceDescriptor,
): { ok: true } | { ok: false; ineligibility: IneligibilityReason; reason: string } {
  const model = source.fundingModel;

  if (model === 'tenant_provider_subscription') {
    // The tenant is invoiced by the vendor. Omnivyra must charge nothing, so a
    // credit action here is a contradiction, not a bonus.
    if (source.creditAction) {
      return {
        ok: false, ineligibility: 'unknown_economics',
        reason: `${source.displayName} declares tenant funding AND an Omnivyra credit action `
          + `('${source.creditAction}') — it cannot be billed twice, so it is refused`,
      };
    }
    return { ok: true };
  }

  if (model === 'omnivyra_funded') {
    // Unchanged from A3C: Omnivyra pays, so the spend must be authorisable.
    if (!source.creditAction) {
      return {
        ok: false, ineligibility: 'unpriced',
        reason: `${source.displayName} has no credit action, so its calls cannot be authorised`,
      };
    }
    return { ok: true };
  }

  if (model === 'none') {
    // Nothing is paid — true only for operator entry and the user's own
    // session. An API we call over the network always costs somebody something.
    if (source.sourceType === 'external_api' || source.sourceType === 'gateway_api') {
      return {
        ok: false, ineligibility: 'unknown_economics',
        reason: `${source.displayName} is a ${source.sourceType} that claims nobody is billed — `
          + 'an external call always costs someone, so its economics are unresolved',
      };
    }
    if (source.creditAction) {
      return {
        ok: false, ineligibility: 'unknown_economics',
        reason: `${source.displayName} claims nobody is billed yet carries the credit action `
          + `'${source.creditAction}'`,
      };
    }
    return { ok: true };
  }

  // Outside the vocabulary — including absent, which TypeScript cannot prevent
  // for a descriptor arriving from a cast or a test fixture. Never assumed.
  return {
    ok: false, ineligibility: 'unknown_economics',
    reason: `${source.displayName} declares no recognised funding model `
      + `(${String(model ?? 'absent')}) — who pays for this call is unknown`,
  };
}

export interface SelectionCandidate {
  readonly sourceId: string;
  readonly eligible: boolean;
  readonly connectionState: ConnectionState;
  readonly reason: string;
  readonly ineligibility?: IneligibilityReason;
}

export type SelectionOutcome =
  | { readonly selected: true; readonly sourceId: string; readonly reason: string; readonly considered: readonly SelectionCandidate[] }
  | { readonly selected: false; readonly ineligibility: IneligibilityReason; readonly reason: string; readonly considered: readonly SelectionCandidate[] };

export interface SelectionRequest {
  readonly subject: EnrichmentSubject;
  readonly attributes: readonly string[];
  /** `auto`, or a specific source id. */
  readonly mode: SelectionMode;
}

/**
 * Evaluate one source against a request. The checks run in a fixed order so the
 * FIRST failure is the reason reported — connection before capability, because
 * "Apollo is not connected" is more useful than "Apollo does not support
 * job_title", which is only true because nothing is known about it yet.
 */
export function evaluateSource(
  source: AcquisitionSourceDescriptor,
  state: ConnectionState,
  stateReason: string,
  request: SelectionRequest,
): SelectionCandidate {
  const base = { sourceId: source.id, connectionState: state };

  if (!USABLE_STATES.includes(state)) {
    return { ...base, eligible: false, ineligibility: 'not_connected', reason: `${source.displayName}: ${stateReason}` };
  }
  // Manual entry is modelled for completeness of the source map, but it cannot
  // FULFIL an enrichment request: enrichment means obtaining what we do not
  // have without asking the operator. Auto-selecting it would answer "we will
  // enrich this" with "someone should type it in".
  if (source.sourceType === 'manual') {
    return {
      ...base, eligible: false, ineligibility: 'manual_not_automatable',
      reason: `${source.displayName} requires an operator — it cannot fulfil an automated enrichment request`,
    };
  }
  if (!source.capabilities.entities.includes(request.subject)) {
    return {
      ...base, eligible: false, ineligibility: 'entity_unsupported',
      reason: `${source.displayName} does not supply ${request.subject} data`,
    };
  }
  if (!supportsRequest(source, request.subject, request.attributes)) {
    return {
      ...base, eligible: false, ineligibility: 'attributes_unsupported',
      reason: `${source.displayName} supplies none of: ${request.attributes.join(', ')}`,
    };
  }
  // A source whose economics are unresolved cannot pass the authorization gate,
  // so offering it would produce a refusal one layer later with a less useful
  // explanation. A3Z: the question is who PAYS, not whether Omnivyra priced it.
  const economics = evaluateEconomics(source);
  if ('reason' in economics) {
    // `'reason' in economics`, not `!economics.ok`: the root tsconfig sets
    // `strict: false`, which disables union narrowing on a negated discriminant.
    return { ...base, eligible: false, ineligibility: economics.ineligibility, reason: economics.reason };
  }
  return { ...base, eligible: true, reason: `${source.displayName} is connected and supplies the requested attributes` };
}

/**
 * Choose a source.
 *
 * @param statuses live source states, from `listSourceStatus`.
 */
export function selectAcquisitionSource(
  request: SelectionRequest,
  statuses: readonly SourceStatus[],
): SelectionOutcome {
  // ── explicit ─────────────────────────────────────────────────────────────
  if (request.mode !== AUTO_SELECTION) {
    // The STATUS is evaluated, not the static descriptor: a SourceStatus IS a
    // descriptor plus its live state, and using the stale descriptor would let
    // explicit selection ignore a capability the source has actually gained.
    const status = statuses.find((s) => s.id === request.mode) ?? null;
    if (!getSource(request.mode) || !status) {
      return {
        selected: false,
        ineligibility: 'unknown_source',
        reason: `'${request.mode}' is not a known acquisition source`,
        considered: [],
      };
    }
    const candidate = evaluateSource(status, status.connectionState, status.stateReason, request);
    return candidate.eligible
      ? { selected: true, sourceId: status.id, reason: candidate.reason, considered: [candidate] }
      : {
        selected: false,
        // The specific reason, never a generic "unavailable" — and never a
        // substitute source.
        ineligibility: candidate.ineligibility ?? 'not_connected',
        reason: candidate.reason,
        considered: [candidate],
      };
  }

  // ── auto ─────────────────────────────────────────────────────────────────
  // `statuses` arrives priority-sorted; the first eligible source wins. Ties
  // cannot occur because priorities are distinct integers.
  const considered = statuses.map((s) => evaluateSource(s, s.connectionState, s.stateReason, request));
  const winner = considered.find((c) => c.eligible);

  return winner
    ? { selected: true, sourceId: winner.sourceId, reason: `auto: ${winner.reason}`, considered }
    : {
      selected: false,
      ineligibility: 'no_eligible_source',
      reason: considered.length
        ? `no connected source supplies ${request.attributes.join(', ')} for a ${request.subject}`
        : 'no acquisition sources are registered',
      considered,
    };
}
