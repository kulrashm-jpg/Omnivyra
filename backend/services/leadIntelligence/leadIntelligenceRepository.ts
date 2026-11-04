/**
 * Durable Lead Intelligence repository — the canonical store + unified read model.
 *
 * Writes the canonical lead idempotently (upsert on company_id+dedupe_key) and
 * appends provenance to the events timeline. Reads return the unified
 * `CanonicalLeadView` regardless of origin — consumers never touch fragmented
 * source tables. Best-effort / fail-open: if the additive table is not yet applied
 * (prod↔ledger desync), writes/reads degrade to null/[] and never throw, exactly
 * like the existing collection/design-system services. Tenant isolation: every
 * query is company_id-scoped (+ RLS at the DB).
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  computeLeadDedupeKey,
  buildCampaignIntelligence,
  buildTimeline,
  materializeCanonicalScores,
  CANONICAL_LEAD_SOURCE_LABELS,
  type CanonicalLead,
  type CanonicalLeadView,
  type CanonicalLeadSource,
  type CanonicalAttribution,
  type TimelineEvent,
  type LeadProjectionResult,
  classifyWriteError,
  classifyWriteOutcome,
  failed,
  pendingReconciliation,
  persisted,
  persistedByReconciliation,
} from '../../../lib/leadIntelligence';

const TABLE = 'lead_intelligence';
const EVENTS = 'lead_intelligence_events';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function toRow(lead: CanonicalLead): Record<string, unknown> {
  return {
    company_id: lead.organizationId,
    dedupe_key: computeLeadDedupeKey(lead),
    source: lead.source,
    unified_person_id: lead.unifiedPersonId ?? null,
    status: lead.status ?? null,
    // G3 (LC-102): materialize canonical scores via the ONE scorer
    // (buildBuyingIntentProfile) so website/capture leads persist a real intent
    // instead of null. No-op for source-scored leads (System-B) and when disabled.
    scores: materializeCanonicalScores(lead),
    identity: lead.identity,
    attribution: lead.attribution,
    campaign: buildCampaignIntelligence(lead),
    content: {},
    metadata: lead.attribution.sourceMetadata,
    // PI-LDB-4. Deliberately its own column rather than a key inside
    // `metadata`: that column holds the provider's raw fields verbatim, and
    // mixing our own synthesised labels in would leave a later reader unable to
    // tell which keys the provider actually sent. Until now this was dropped
    // entirely, so a durable lead had no name on any surface.
    display: lead.display ?? null,
    source_table: lead.sourceRef?.table ?? null,
    source_id: lead.sourceRef?.id ?? null,
    occurred_at: lead.occurredAt ?? null,
    ingested_at: lead.ingestedAt,
    updated_at: new Date().toISOString(),
  };
}

function rowToView(row: Record<string, unknown>): CanonicalLeadView {
  const source = String(row.source) as CanonicalLeadSource;
  const attribution = obj(row.attribution) as unknown as CanonicalAttribution;
  return {
    organizationId: String(row.company_id),
    source,
    sourceLabel: CANONICAL_LEAD_SOURCE_LABELS[source] ?? String(row.source),
    unifiedPersonId: (row.unified_person_id as string | null) ?? null,
    identity: obj(row.identity),
    scores: obj(row.scores),
    status: (row.status as string | null) ?? null,
    campaign: attribution?.campaign ?? null,
    content: attribution?.content ?? null,
    referrer: attribution?.referrer ?? null,
    utm: attribution?.utm ?? { source: null, medium: null, campaign: null, content: null, term: null },
    occurredAt: (row.occurred_at as string | null) ?? null,
    sourceRef: row.source_table ? { table: String(row.source_table), id: (row.source_id as string | null) ?? null } : null,
    attribution: attribution ?? ({ originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} }),
    // Left `undefined` rather than `{}` when the column is NULL. A lead stored
    // before PI-LDB-4, or projected from a source with no name column, has an
    // UNKNOWN label — and `{ name: null }` would assert we looked and found
    // nothing, which is a different claim.
    display: row.display ? (obj(row.display) as CanonicalLeadView['display']) : undefined,
  };
}

function rowToEvent(row: Record<string, unknown>): TimelineEvent {
  return {
    origin: String(row.origin ?? 'unknown'),
    source: String(row.source ?? 'other') as CanonicalLeadSource,
    entityId: (row.entity_id as string | null) ?? null,
    eventType: String(row.event_type ?? 'event'),
    occurredAt: (row.occurred_at as string | null) ?? null,
    metadata: obj(row.metadata),
  };
}

/**
 * Idempotent canonical upsert (company_id + dedupe_key), reporting what the
 * database actually said.
 *
 * PI-LDB P0: this is the ONLY function on the projection path that learns
 * whether the row landed — it asks for the id back with `.select('id')` — so it
 * is the only one that can tell the truth about it. It used to flatten every
 * outcome to `null`, which made a missing table, an RLS refusal and a rejected
 * payload indistinguishable from each other and from success one hop up.
 */
export async function upsertCanonicalLeadWithOutcome(lead: CanonicalLead): Promise<LeadProjectionResult> {
  if (!lead.organizationId) return failed('no_organization', 'lead.organizationId is required');
  let response: { data?: unknown; error?: unknown; status?: unknown };
  try {
    response = await ownedDbTable(TABLE)
      .upsert(toRow(lead), { onConflict: 'company_id,dedupe_key' })
      .select('id')
      .maybeSingle();
  } catch (e) {
    // A THROW out of the await.
    //
    // With `shouldThrowOnError` false — the default, and nothing on this path
    // calls `.throwOnError()` — @supabase/postgrest-js NEVER rejects: it
    // catches the fetch and resolves with `{ status: 0, error }`. So the only
    // things that can land here run BEFORE the request exists: `ownedDbTable`
    // itself (the admin client throws `SUPABASE_URL is missing…` and
    // `requireSupabaseSecretKey()` throws), `toRow`/`computeLeadDedupeKey`, or
    // `JSON.stringify` of the body. All of those are provably pre-send, so a
    // definitive `failed` is the honest verdict and NOT a guess.
    //
    // The code-carrying branch is kept: a doubled seam (and a future direct-pg
    // path) can still reject with a SQLSTATE, and `08006` thrown must stay
    // `pending_reconciliation` — a tracked test pins exactly that.
    const code = (e as { code?: string | null } | null)?.code ?? null;
    const message = e instanceof Error ? e.message : String(e);
    if (!code) return failed('write_failed', message);
    const verdict = classifyWriteError(code, message);
    return verdict.status === 'pending_reconciliation' ? reconcile(lead, verdict) : verdict;
  }

  const { data, error } = response as { data: unknown; error: unknown };
  if (error) {
    const e = error as { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };
    // `status` is read, not discarded. It is the ONLY structured field that
    // separates "no HTTP response happened" (0) from "a server answered", and
    // the previous `const { data, error } = await …` threw it away — which is
    // why a PostgREST timeout, a reset socket and an aborted fetch all arrived
    // with `code === ''` and were flattened to `failed('write_failed')`.
    const verdict = classifyWriteOutcome({
      code: e.code ?? null,
      message: e.message ?? null,
      status: typeof response.status === 'number' ? response.status : null,
      details: e.details ?? null,
      hint: e.hint ?? null,
    });
    return verdict.status === 'pending_reconciliation' ? reconcile(lead, verdict) : verdict;
  }
  // Accepted, with no row handed back. The row may well exist, so claiming
  // either success or failure would be a guess. The upsert is keyed on
  // (company_id, dedupe_key), which is what makes retrying this safe.
  if (!data) return reconcile(lead, pendingReconciliation('no_row_returned'));
  return persisted(String((data as Record<string, unknown>).id));
}

/**
 * Resolve an unconfirmed write by LOOKING, never by writing again.
 *
 * This is the whole point of `pending_reconciliation`: "the row may exist and
 * nobody has established otherwise". Establishing it is a single keyed read.
 *
 * It cannot create a second identity, and the reason is structural rather than
 * careful:
 *
 *   * the key is `computeLeadDedupeKey(lead)` — the SAME pure function that
 *     produced the `dedupe_key` column in `toRow`, on the same input, so the
 *     two cannot differ;
 *   * `lead_intelligence_dedupe_unique UNIQUE (company_id, dedupe_key)`
 *     (migration 20260629000000) means that pair selects at most one row, so
 *     the read cannot attach a second id even in principle;
 *   * nothing is re-sent. The possibly-committed upsert is never replayed
 *     here. When a caller DOES retry, it retries the same upsert, which
 *     carries `on_conflict=company_id,dedupe_key` with
 *     `resolution=merge-duplicates` — it updates that one row.
 *
 * No timeline event is appended on this path, deliberately.
 * `lead_intelligence_events` has NO unique constraint — only the non-unique
 * `idx_lead_intelligence_events_lead` — so re-appending is the one action that
 * WOULD duplicate provenance, and it would do so precisely when the first
 * attempt had succeeded. The existing contract already treats a missing
 * timeline event as a warning that does not downgrade a lead, so "never
 * duplicate, possibly short one event" is the consistent choice and the
 * warning says so.
 *
 * Reconciliation can PROVE PRESENCE AND CANNOT PROVE ABSENCE, and the
 * asymmetry is physical rather than cautious. The write whose answer was lost
 * may still be EXECUTING: the socket died, but PostgREST holds its own
 * connection to Postgres and the statement runs to completion on the server
 * regardless of who is still listening. A read issued immediately afterwards
 * can therefore miss a row that lands a moment later. So `found` upgrades the
 * verdict and a read that found nothing does NOT downgrade it — it stays
 * `pending_reconciliation`, with a warning recording that we looked.
 *
 * (An earlier draft of this resolved "looked, nothing there" to `failed`. That
 * was wrong for the reason above, and wrong in the dangerous direction: it
 * would tell an operator a lead is definitely missing on the strength of a
 * read that raced the very commit it was checking for.)
 *
 * The two non-found outcomes are still kept apart in the warning, because
 * "looked, not there yet" and "could not look" are different facts about our
 * own evidence, and an operator chasing an unconfirmed lead needs to know
 * which one they have.
 */
async function reconcile(lead: CanonicalLead, verdict: LeadProjectionResult): Promise<LeadProjectionResult> {
  const found = await findCanonicalLeadIdByDedupeKey(lead.organizationId, computeLeadDedupeKey(lead));
  if (found.outcome === 'found') {
    return persistedByReconciliation(found.leadId, [
      ...verdict.warnings,
      `lead_intelligence: the write was unconfirmed (${verdict.reason ?? 'unknown'}); the row was found by its dedupe key, so no timeline event was appended`,
    ]);
  }
  // NOT a downgrade to `failed`. See the asymmetry above: the lost write may
  // still be executing server-side, so "no row right now" is not "no row".
  return {
    ...verdict,
    warnings: [
      ...verdict.warnings,
      found.outcome === 'absent'
        ? 'lead_intelligence: reconciliation looked for this row by its dedupe key and did not find it yet'
        : 'lead_intelligence: reconciliation could not read this row back, so the outcome is still unestablished',
    ],
  };
}

/**
 * Read one canonical lead's id by its idempotency key.
 *
 * Three-valued ON PURPOSE. `null` would conflate "the row is not there" with
 * "the lookup failed", and that conflation is the original defect in miniature:
 * `reconcile` would turn a failed READ into a definite projection failure.
 */
export async function findCanonicalLeadIdByDedupeKey(
  companyId: string,
  dedupeKey: string,
): Promise<{ outcome: 'found'; leadId: string } | { outcome: 'absent' } | { outcome: 'unknown' }> {
  if (!companyId || !dedupeKey) return { outcome: 'unknown' };
  try {
    const res = await ownedDbTable(TABLE)
      .select('id')
      .eq('company_id', companyId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    const { data, error } = res as { data: unknown; error: unknown };
    if (error) return { outcome: 'unknown' };
    const id = (data as Record<string, unknown> | null)?.id;
    return id ? { outcome: 'found', leadId: String(id) } : { outcome: 'absent' };
  } catch {
    return { outcome: 'unknown' };
  }
}

/**
 * Idempotent canonical upsert. Returns the row id, or null (fail-open).
 *
 * Contract deliberately unchanged: a thin reading of the function above, so the
 * consumers that only ever wanted the id — and the tests that pin this
 * fail-open shape — stay exactly as they were.
 */
export async function upsertCanonicalLead(lead: CanonicalLead): Promise<{ id: string } | null> {
  const outcome = await upsertCanonicalLeadWithOutcome(lead);
  return outcome.leadId ? { id: outcome.leadId } : null;
}

/**
 * Append a provenance event to the timeline. Still fail-open — the lead row
 * exists whether or not its timeline event does — but it now reports which,
 * so the sink can carry it as a warning instead of discarding it.
 */
export async function appendLeadEvent(companyId: string, leadId: string, event: TimelineEvent): Promise<boolean> {
  try {
    const res = await ownedDbTable(EVENTS).insert({
      company_id: companyId,
      lead_id: leadId,
      origin: event.origin,
      source: event.source,
      entity_id: event.entityId,
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      metadata: event.metadata,
    });
    return !(res && (res as { error?: unknown }).error);
  } catch {
    return false;
  }
}

export async function getCanonicalLead(companyId: string, id: string): Promise<CanonicalLeadView | null> {
  try {
    const { data, error } = await ownedDbTable(TABLE).select('*').eq('company_id', companyId).eq('id', id).maybeSingle();
    if (error || !data) return null;
    return rowToView(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listCanonicalLeads(input: {
  companyId: string;
  source?: CanonicalLeadSource;
  unifiedPersonId?: string;
  limit?: number;
}): Promise<CanonicalLeadView[]> {
  if (!input.companyId) return [];
  try {
    let query = ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', input.companyId)
      .order('occurred_at', { ascending: false })
      .limit(Math.max(1, Math.min(input.limit ?? 200, 1000)));
    if (input.source) query = query.eq('source', input.source);
    if (input.unifiedPersonId) query = query.eq('unified_person_id', input.unifiedPersonId);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map(rowToView);
  } catch {
    return [];
  }
}

export async function getLeadTimeline(companyId: string, leadId: string): Promise<TimelineEvent[]> {
  try {
    const { data, error } = await ownedDbTable(EVENTS).select('*').eq('company_id', companyId).eq('lead_id', leadId).limit(1000);
    if (error || !Array.isArray(data)) return [];
    return buildTimeline((data as Record<string, unknown>[]).map(rowToEvent));
  } catch {
    return [];
  }
}
