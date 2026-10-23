/**
 * A4J (B2) — the production duplicate-suppression read.
 *
 * `findRecentObservation` is the executor's ONLY defence against paying a
 * provider for something already on file. Its three sibling ports each shipped
 * with a production default — `persistObservation` in `persistence.ts`,
 * `resolveCredential` in `credentials.ts`, `authorizeCost` in `cost.ts` — and
 * this one did not. Every implementation in the repository was a test stub, and
 * thirteen of them returned `async () => null`, which disables the gate
 * entirely. A caller wiring ports today would have had to write this read or
 * silently ship without suppression.
 *
 * ─── WHY `source_assertions` AND NOT `source_records` ─────────────────────
 * The port is asked about ATTRIBUTES. `source_records` is one row per provider
 * record and carries no attribute column, so it can answer "has this provider
 * ever told us anything about this entity" but not "do we already hold
 * employee_count". `source_assertions` is the attribute layer of the same LI-2
 * evidence model — same migration, joined by `source_record_id` — and is the
 * only place the question is answerable. This adds no store and no table.
 *
 * ─── EVIDENCE, NOT CANONICAL VALUES ───────────────────────────────────────
 * It deliberately does NOT read `unified_persons` / `prospect_accounts`. A
 * canonical value may have come from another provider, from manual entry, or
 * from an inference; suppression asks whether THIS provider was already
 * observed, which is a provenance question. Reading the canonical column would
 * suppress a provider that has never been consulted.
 *
 * ─── SUPPRESS ONLY WHEN EVERY REQUESTED ATTRIBUTE IS COVERED ──────────────
 * A3 defines equivalence as "(tenant, entity, provider, attribute SET)". So a
 * request for five attributes is not satisfied by evidence for one: suppressing
 * there would permanently block acquiring the other four. Every requested
 * attribute must have evidence, and the timestamp returned is the OLDEST of
 * them — the weakest link — so the executor's freshness window is applied
 * conservatively and never suppresses while something needs refreshing.
 *
 * ─── IT FAILS CLOSED ──────────────────────────────────────────────────────
 * An unreadable evidence table means we cannot show the answer is already
 * held. Returning null would mean "proceed", which spends the tenant's provider
 * quota on a question we could not check — so a read failure throws instead.
 * That is the opposite of `loadIntegrations`, where reporting none is the safe
 * direction, and the difference is that here the unsafe outcome costs money.
 *
 * READ-ONLY. It creates no source record, mutates no assertion, touches no
 * canonical attribute and fabricates no provider evidence.
 */

import { ownedDbTable } from '../../../db/writeOwner';
import type { ExecuteEnrichmentPorts } from './execute';
import type { EnrichmentSubject } from './contract';

/** The evidence columns this read needs. Nothing else is selected. */
export interface AssertionObservationRow {
  readonly attribute: string;
  /** The SOURCE's own observation time, when it supplied one. */
  readonly observed_at: string | null;
  /** When we recorded it. Never null — the column is NOT NULL. */
  readonly recorded_at: string;
}

export interface FindRecentObservationInput {
  readonly organizationId: string;
  /**
   * O-3 — WHICH subject this lookup is about. Never inferred from the id: an
   * id alone does not say which table it came from, and a person assertion
   * carries the account leg as well as its own.
   */
  readonly subject: EnrichmentSubject;
  readonly entityId: string;
  readonly providerId: string;
  readonly attributes: readonly string[];
}

export type AssertionReader =
  (input: FindRecentObservationInput) => Promise<readonly AssertionObservationRow[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asMs = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.NaN;
};

/**
 * Decide, from evidence rows, whether an equivalent observation is on file.
 *
 * Pure and total, so the whole matrix is testable without a database. Returns
 * the OLDEST per-attribute newest-evidence timestamp, or null when any
 * requested attribute has no evidence at all.
 */
export function pickRecentObservation(
  rows: readonly AssertionObservationRow[],
  attributes: readonly string[],
): { observedAt: string } | null {
  const wanted = [...new Set(attributes.filter((a) => typeof a === 'string' && a.trim() !== ''))];
  // Nothing was asked for, so nothing can already be held. The executor refuses
  // an empty attribute list before it reaches here; this is belt and braces.
  if (wanted.length === 0) return null;

  // Newest usable evidence per attribute. `observed_at` is the provider's own
  // timestamp and is preferred; `recorded_at` is when WE received it and is the
  // fallback, because a provider that supplies no timestamp still gave us
  // evidence at a knowable moment.
  const newest = new Map<string, string>();
  for (const row of rows) {
    if (!row || typeof row.attribute !== 'string') continue;
    const stamp = row.observed_at ?? row.recorded_at;
    if (typeof stamp !== 'string' || Number.isNaN(asMs(stamp))) continue;
    const held = newest.get(row.attribute);
    if (!held || asMs(stamp) > asMs(held)) newest.set(row.attribute, stamp);
  }

  // Every requested attribute must be covered — see the header.
  const stamps: string[] = [];
  for (const attribute of wanted) {
    const stamp = newest.get(attribute);
    if (!stamp) return null;
    stamps.push(stamp);
  }

  // The weakest link, so the executor's window is applied to the oldest.
  let oldest = stamps[0];
  for (const stamp of stamps) if (asMs(stamp) < asMs(oldest)) oldest = stamp;
  return { observedAt: oldest };
}

/**
 * The real read. Tenant-scoped in the WHERE clause, never after the fact.
 *
 * O-3 — SUBJECT-AWARE. This used to match the entity against EITHER canonical
 * leg, because the port carried no subject. That was not a safe default: a
 * person assertion can carry BOTH legs — the lead orchestrator recorded them
 * that way until O-5 gated the writer — so an employee's own `city`, `region`
 * or `country_code` could answer an ACCOUNT request and suppress company
 * enrichment that had never happened. NEW person assertions now store
 * `account_id = NULL`, but HISTORICAL rows still carry both and no schema
 * constraint forbids it, so this filter remains the defence. The subject comes
 * from the request — the sibling `persistObservation` port already carried it —
 * and `entity_type` declares which leg is the subject, so the two directions
 * stay isolated: a person's dual-leg row still suppresses PERSON enrichment,
 * which is correct, and never account enrichment.
 *
 * It must stay SUBJECT-AWARE. A blanket account-only predicate would strip
 * person suppression and buy a provider call on every person enrichment.
 *
 * The subject is validated BEFORE any query and there is no fallback. An
 * unrecognised subject fails CLOSED, like a read error, because the unsafe
 * outcome here is a query that answers for the wrong subject.
 *
 * `entityId` is still validated as a UUID. That guard was load-bearing while
 * the id was interpolated into a PostgREST `or` expression; the interpolation
 * is gone, so it is now plain input validation and kept as such.
 */
const readAssertions: AssertionReader = async (input) => {
  if (input.subject !== 'person' && input.subject !== 'account') {
    throw new Error(
      'findRecentObservation: subject must be \'person\' or \'account\' — suppression is '
      + `never subject-blind (got ${JSON.stringify(input.subject ?? null)})`,
    );
  }
  if (!UUID.test(input.entityId)) {
    throw new Error('findRecentObservation: entityId must be a canonical uuid');
  }
  const { data, error } = await ownedDbTable('source_assertions')
    .select('attribute, observed_at, recorded_at')
    .eq('organization_id', input.organizationId)      // tenant boundary — never optional
    .eq('provider', input.providerId)
    .in('attribute', [...input.attributes])
    .is('superseded_at', null)
    // BOTH legs of the confinement, as D2 and Change 1a already do it:
    // `entity_type` declares which leg is the subject, and the subject column
    // pins the id. The subject column alone would not be enough — a person row
    // carries `account_id` too.
    .eq('entity_type', input.subject)
    .eq(input.subject === 'person' ? 'person_id' : 'account_id', input.entityId);

  // Fail CLOSED. See the header: proceeding would spend the tenant's quota on a
  // question we could not answer.
  if (error) throw new Error(`source_assertions read failed: ${error.message}`);
  return (data ?? []) as AssertionObservationRow[];
};

/** Build the port. The reader is injectable so the seam is testable. */
export function makeFindRecentObservation(
  read: AssertionReader = readAssertions,
): ExecuteEnrichmentPorts['findRecentObservation'] {
  return async (input) => {
    const organizationId = String(input.organizationId ?? '').trim();
    if (!organizationId) {
      throw new Error('findRecentObservation: organizationId is required');
    }
    if (!input.attributes?.length) return null;
    const rows = await read({
      organizationId,
      // Passed through verbatim, NOT normalised: a subject is one of two
      // literals, so anything else must be rejected rather than coerced.
      subject: input.subject,
      entityId: String(input.entityId ?? '').trim(),
      providerId: String(input.providerId ?? '').trim(),
      attributes: input.attributes,
    });
    return pickRecentObservation(rows, input.attributes);
  };
}

/** The production port. This is what a real caller wires. */
export const defaultFindRecentObservation = makeFindRecentObservation();
