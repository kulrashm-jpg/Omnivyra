/**
 * Durable sink — persists the canonical lead + a provenance timeline event.
 *
 * ─── RECONCILED FIX (two branches fixed the same P0 differently) ───────────
 * Both branches independently found that this sink hid a failed write:
 *
 *   * `origin/main` made it THROW (`upsert returned no row`), so that
 *     `adoptLeadAsync` could log and count the dropped lead instead of dropping
 *     it in silence. That fixed observability for the ADOPTION path.
 *   * The PI-LDB sprint made it RETURN A VERDICT, so the import route could stop
 *     reporting `emitted: true` for a record that wrote nothing, and could tell
 *     an operator WHICH failure it was.
 *
 * Neither alone is enough, and whichever landed second would have silently
 * undone the other: pasting the verdict version over main's kills the
 * `lead_adoption:failed` counter, and keeping main's throw leaves the import
 * route unable to distinguish an unapplied migration from a rejected row.
 *
 * So the contract is: `emit` RETURNS the verdict only for `persisted`, and
 * THROWS a typed `LeadProjectionFailure` carrying the verdict for every other
 * outcome — `pending_reconciliation` included. Main's `adoptLeadAsync` catch
 * then fires exactly as written, with a better message, so
 * `lead_adoption:failed` still counts the dropped lead; the orchestrator
 * unwraps `.result` to get the reason. Returning a non-row outcome instead
 * would resolve normally and retire a counter main already had — see the guard
 * below. `ingestCanonicalLead`, the facade and the runtime stay untouched;
 * main's `piProvIngestionAdoption` suite keeps its message pin and gained a
 * verdict assertion beside it.
 */

import type { CanonicalLead, LeadIntelligenceSink, LeadProjectionResult } from '../../../lib/leadIntelligence';
import { upsertCanonicalLeadWithOutcome, appendLeadEvent } from './leadIntelligenceRepository';

/**
 * Thrown for a projection that did not produce a confirmed row — whether that is
 * a known failure or a genuinely unconfirmed write. Carries the verdict, so the
 * caller can tell those two apart without the sink having to resolve.
 */
export class LeadProjectionFailure extends Error {
  readonly result: LeadProjectionResult;

  constructor(result: LeadProjectionResult) {
    super(result.error ?? `lead_intelligence projection failed (${result.reason ?? 'unknown'})`);
    this.name = 'LeadProjectionFailure';
    this.result = result;
  }
}

export const durableLeadIntelligenceSink: LeadIntelligenceSink = {
  async emit(lead: CanonicalLead): Promise<LeadProjectionResult> {
    const outcome = await upsertCanonicalLeadWithOutcome(lead);

    // ANYTHING that is not a confirmed row throws, carrying its verdict.
    //
    // Both branches matter and the reason is main's telemetry. Main's sink threw
    // on `!res`, which covered every non-row outcome INCLUDING a dropped
    // connection, so `adoptLeadAsync` counted all of them as
    // `lead_adoption:failed`. Once the classifier learned to call a dropped
    // connection `pending_reconciliation`, returning it here would have made the
    // sink resolve normally and main's counter would have stopped seeing it —
    // removing observability main already had, which is the one thing this
    // reconciliation must not do.
    //
    // Throwing loses nothing, because the verdict rides on the error: the import
    // path unwraps it and still reports `failed` and `pending_reconciliation`
    // distinctly. Only a verified row resolves.
    if (outcome.status !== 'persisted' || !outcome.leadId) {
      throw new LeadProjectionFailure(outcome);
    }

    // A verdict the repository established by READING the row back, not by the
    // write returning an id. The row is there, so this resolves and
    // `lead_adoption:succeeded` is counted — which is the truth. What it must
    // NOT do is append a timeline event.
    //
    // `lead_intelligence_events` has no unique constraint (only the non-unique
    // `idx_lead_intelligence_events_lead`), so an append here would duplicate
    // provenance in exactly the case where the earlier attempt had in fact
    // committed both the row and its event. A timeline that is short one entry
    // is already a warning that does not downgrade a lead — the sink has said
    // so since this file was written — while a duplicated provenance event is a
    // falsified history. The warning the repository attached says which.
    //
    // This is placed AFTER the guard above on purpose: it cannot reach any
    // non-persisted outcome, so the throw and `lead_adoption:failed` are
    // untouched.
    if (outcome.reconciled) return outcome;

    const timelineRecorded = await appendLeadEvent(lead.organizationId, outcome.leadId, {
      origin: lead.sourceRef?.table ?? 'ingest',
      source: lead.source,
      entityId: lead.sourceRef?.id ?? null,
      eventType: `lead.${lead.source}.ingested`,
      occurredAt: lead.occurredAt ?? lead.ingestedAt,
      metadata: { identityMatchedBy: lead.identityMatchedBy ?? null },
    });

    // A missing timeline event does NOT downgrade `persisted`. The lead row is
    // there and the Lead Database will list it; only its history is short an
    // entry. Saying otherwise sends an operator hunting for a lead that exists.
    if (timelineRecorded) return outcome;
    return { ...outcome, warnings: [...outcome.warnings, 'lead_intelligence_events: timeline event was not recorded'] };
  },
};
