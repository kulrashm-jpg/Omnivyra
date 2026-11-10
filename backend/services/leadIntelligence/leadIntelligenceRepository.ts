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
// Declared in the provenance contract, which is the authoritative vocabulary
// (lib/leadIntelligence re-exports neither the type nor the guard).
import type { SourceCategory } from '../../../lib/prospectProvenance/contract';
import {
  computeLeadDedupeKey,
  buildCampaignIntelligence,
  buildTimeline,
  materializeCanonicalScores,
  isScoreMaterializationEnabled,
  hasRealScores,
  resolveScoreWrite,
  LEAD_SCORE_MODEL_VERSION,
  CANONICAL_LEAD_SOURCE_LABELS,
  type CanonicalLead,
  type CanonicalLeadView,
  type CanonicalLeadSource,
  type CanonicalLeadScores,
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

function toRow(lead: CanonicalLead, scores: CanonicalLeadScores): Record<string, unknown> {
  return {
    company_id: lead.organizationId,
    dedupe_key: computeLeadDedupeKey(lead),
    source: lead.source,
    unified_person_id: lead.unifiedPersonId ?? null,
    status: lead.status ?? null,
    // G3 (LC-102): the canonical scores, materialized via the ONE scorer
    // (buildBuyingIntentProfile) so website/capture leads persist a real
    // intent instead of null. No-op for source-scored leads (System-B) and
    // when disabled.
    //
    // PASSED IN rather than computed here (Prompt 2B). Deciding what to
    // persist needs to know what is already stored, which is a query, and
    // `toRow` is pure and synchronous. `scoresToPersist` below owns that
    // decision; this function just writes down the answer.
    scores,
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
    // D2/D3: THE AUTHORITATIVE ORIGIN, and only when it is asserted.
    //
    // An adapter hint reaches this as NULL, which the table's trigger reads
    // as "this write has nothing to say about origin" and leaves whatever is
    // stored alone. So a website or reconciliation write can neither
    // manufacture a classification nor erase one.
    //
    // Both keys are ALWAYS present in the body, never omitted. Omitting a key
    // from a merge-duplicates upsert to mean "do not touch" is the
    // unverifiable PostgREST behaviour this repository refuses to rely on
    // (see `issueCanonicalWrite`): if the SET list were built from the
    // table's columns rather than the body's keys, an absent key would assign
    // the default and WIPE the value. Sending NULL and letting the trigger
    // decide needs no such assumption.
    origin_category: lead.origin?.provenance === 'asserted' ? (lead.origin.category ?? null) : null,
    origin_observed_at: lead.origin?.provenance === 'asserted' ? (lead.origin.observedAt ?? null) : null,
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
    // D2: the origin comes back from the DURABLE row, so scoring and journey
    // wording no longer depend on a provenance read succeeding. Three read
    // surfaces never attach provenance at all (`getCompanyIntelligence`, the
    // default `listAllLeads`, and any row whose `source_table` is not
    // `canonical_leads`), and those are precisely where the +15
    // `lead_captured` contribution used to vanish.
    //
    // Set only when a category is actually stored. `undefined` rather than an
    // object full of nulls, for the same reason `display` does it: an origin
    // of `{ category: null }` asserts we looked and found nothing recorded,
    // which is a different claim from never having looked - and
    // `hasLeadFormEvidence` is fail-closed on both, so neither earns points.
    //
    // `platform` is NOT persisted: D2/D3 named two fields and this is not one
    // of them. It is display-only (the "· Apollo" half of a provenance
    // label), so `originFrom` may still take it from the originating
    // contribution. It may NOT take the category or the observation from
    // there: D3 (owner ruling, 2026-11-07) INVERTED that precedence, and this
    // row is now the authority.
    //
    // `provenance: 'asserted'` ROUND-TRIPS the marker, and that is what makes
    // the inversion implementable at all. The write boundary above only ever
    // sends this column when `origin.provenance === 'asserted'`, so a stored
    // value is asserted BY CONSTRUCTION. Without re-attaching the marker here
    // the read path cannot tell a stored classification from a read-time
    // display hint, and those two must not carry the same authority.
    ...(row.origin_category
      ? {
        origin: {
          category: String(row.origin_category) as SourceCategory,
          platform: null,
          observedAt: (row.origin_observed_at as string | null) ?? null,
          provenance: 'asserted' as const,
        },
      }
      : {}),
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
 * How the canonical write must be issued, decided by what we learned about the
 * stored score (Prompt 2C).
 *
 *   merge            - the ordinary idempotent upsert. We either know what is
 *                      stored, or know that nothing is, so a full-row
 *                      merge-duplicates write is safe and `scores` is part of
 *                      it.
 *   preserve_unknown - we could NOT read the stored score. The row must still
 *                      land, but if it already exists its `scores` column may
 *                      not be assigned, because we do not know what we would
 *                      be destroying.
 *
 * `scores` is still carried on a `preserve_unknown` plan: it is correct for a
 * row this write CREATES, where there is nothing to protect. It is dropped
 * only on the update half.
 */
type ScoreWritePlan = {
  mode: 'merge' | 'preserve_unknown';
  scores: CanonicalLeadScores;
  warnings: string[];
};

/** The shape every write path below hands to the one classifier. */
type WriteResponse = { data?: unknown; error?: unknown; status?: unknown };

/**
 * What to persist into `scores`, protecting a stored customer-visible score
 * from SILENT recalculation (Prompt 2B).
 *
 * The expensive half is skipped wherever it cannot matter, so this adds a read
 * only on the path that can actually overwrite a score:
 *
 *   - materialization disabled -> the lead's own scores are written unchanged;
 *   - the lead ALREADY carries real scores -> `materializeCanonicalScores`
 *     returns them untouched, so there is nothing to protect against.
 *
 * What remains is the case the defect lived in: an incoming lead with NO
 * scores, where the scorer is about to produce some and the full-row upsert is
 * about to replace whatever the row held. That one looks first.
 *
 * Fail-open ON THE PROJECTION, never on the score (Prompt 2C). If the lookup
 * cannot answer, the lead is still written - a projection must not be refused
 * because a protective read failed - but the `scores` column is NOT part of
 * that write when the row already exists. See `issueCanonicalWrite`: an
 * uncertain read earns `mode: 'preserve_unknown'`, and the warning records
 * both that we could not look and what we did about it.
 *
 * Prompt 2B wrote the computed score here anyway. That made the gate it had
 * just built bypassable by exactly the conditions it was built for: an
 * authorization error, a timeout or an ambiguous transport result all land on
 * `unknown`, and each of them silently replaced an earlier model's
 * customer-visible number with this model's. `LEAD_SCORE_MODEL_TRANSITION`
 * never got a say, because nothing knew there was a transition.
 */
async function scoresToPersist(lead: CanonicalLead): Promise<ScoreWritePlan> {
  const computed = materializeCanonicalScores(lead);

  // A score the record itself carries (System-B via `qualifyLead`) is the
  // record's own fact. `materializeCanonicalScores` returns it untouched, and
  // it is written whatever the kill-switch says.
  if (hasRealScores(lead.scores)) return { mode: 'merge', scores: computed, warnings: [] };

  // THE KILL-SWITCH IS NOT A SCORE ERASER (Prompt 2C, measured).
  //
  // With materialization off, `materializeCanonicalScores` returns
  // `lead.scores ?? {}`, and the ingestion orchestrator never supplies
  // `scores` - so the full-row upsert assigned `'{}'::jsonb` over whatever was
  // stored. Turning the scorer off DESTROYED the scores earlier runs had
  // produced, and skipped the protective read on the way, which is the same
  // defect as the fail-open read wearing a different hat.
  //
  // The switch means "do not run this scorer". It cannot mean "and delete its
  // past output", so there is nothing to write into the column and the column
  // is left out.
  if (!isScoreMaterializationEnabled()) {
    return {
      mode: 'preserve_unknown',
      scores: computed,
      warnings: [
        'lead_intelligence: score materialization is disabled '
        + '(LEAD_SCORE_MATERIALIZATION_ENABLED=false), so the `scores` column was LEFT UNCHANGED '
        + 'on the existing row rather than blanked. A row created by this write carries no score.',
      ],
    };
  }

  const existing = await readCanonicalLeadByDedupeKey(
    lead.organizationId, computeLeadDedupeKey(lead), 'id, scores',
    // No auto-retry. This read is allowed to come back `unknown` — that
    // outcome is HANDLED, by not writing the column — so three extra
    // round trips and 7 s of backoff buy a better answer we do not need.
    // The reconciliation read keeps its retries: it has to establish
    // presence, and there `unknown` leaves a verdict unresolved.
    false,
  );
  if (existing.outcome === 'unknown') {
    return {
      mode: 'preserve_unknown',
      scores: computed,
      warnings: [
        'lead_intelligence: the stored score could not be read before writing, so the `scores` '
        + 'column was LEFT UNCHANGED on the existing row; an earlier model\'s score has NOT been '
        + 'replaced. A row created by this write carries the current model\'s score.',
      ],
    };
  }

  const decision = resolveScoreWrite(existing.outcome === 'found' ? existing.scores : null, computed);
  if (decision.action === 'write') return { mode: 'merge', scores: decision.scores, warnings: [] };

  return {
    mode: 'merge',
    scores: decision.scores,
    warnings: [
      `lead_intelligence: the stored score was produced by model `
      + `${decision.storedVersion ?? 'an unstamped (pre-versioning or source-provided) model'} `
      + `and is PRESERVED; the current model is ${LEAD_SCORE_MODEL_VERSION}. Set `
      + `LEAD_SCORE_MODEL_TRANSITION=${LEAD_SCORE_MODEL_VERSION} to authorize recomputation.`,
    ],
  };
}

/**
 * A 23505 that means "the idempotency key is already taken", as opposed to a
 * genuinely rejected payload.
 *
 * `lead_intelligence` carries exactly ONE unique constraint,
 * `lead_intelligence_dedupe_unique UNIQUE (company_id, dedupe_key)`
 * (20260629000000_lead_intelligence_store.sql:28) — the id is a generated
 * primary key and cannot collide. So on today's schema a 23505 from this table
 * can only be that constraint.
 *
 * The name is matched anyway, and that is not belt-and-braces: if a later
 * migration adds a second unique index, a violation of IT must keep reading as
 * `invalid` (the honest verdict — the payload really was refused) rather than
 * being silently routed into the update half, which would patch a row the
 * conflict was never about.
 */
const DEDUPE_CONSTRAINT = 'lead_intelligence_dedupe_unique';
function isDedupeKeyTaken(error: unknown): boolean {
  const e = error as { code?: string | null; message?: string | null; details?: string | null } | null;
  if (!e || e.code !== '23505') return false;
  return `${e.message ?? ''} ${e.details ?? ''}`.includes(DEDUPE_CONSTRAINT);
}

/**
 * Issue the canonical write, in the one way the score evidence allows.
 *
 * ─── WHY THIS IS NOT A COLUMN OMITTED FROM THE UPSERT ──────────────────────
 * The obvious shape for "write everything except `scores`" is to drop the key
 * from the merge-duplicates upsert body and rely on PostgREST deriving its
 * `ON CONFLICT DO UPDATE SET` list from the keys present. That may well be
 * true, but it is UNVERIFIED here (no PostgREST in this environment), and its
 * failure mode is worse than the defect it fixes: if PostgREST instead builds
 * the SET list from the table's columns, an absent key assigns the column
 * default and the stored score is WIPED to `'{}'::jsonb`. Nothing in this
 * repository omits `scores` today, so that payload shape has never faced a
 * real PostgREST and there is no production evidence either way.
 *
 * So the uncertain path is expressed in two statements whose semantics are not
 * in question:
 *
 *   INSERT  - plain, no `on_conflict`. If it lands, the row is NEW, there was
 *             never a stored score, and the computed one is correct.
 *   PATCH   - only if the insert hit the dedupe constraint, i.e. the row
 *             provably exists. A PostgREST PATCH assigns exactly the keys in
 *             the body; that is what every partial update in this codebase
 *             already depends on, so it is evidenced by production rather than
 *             by a document. `scores` is not among them.
 *
 * It also closes the read-then-write race in the dangerous direction. A score
 * written between our failed read and our write is no longer overwritten,
 * because the update that follows a conflict cannot assign the column.
 *
 * The extra round trip is paid ONLY on the uncertain path, and only when the
 * row already exists. The ordinary path is one statement, exactly as before.
 */
async function issueCanonicalWrite(lead: CanonicalLead, plan: ScoreWritePlan): Promise<WriteResponse> {
  const row = toRow(lead, plan.scores);

  if (plan.mode === 'merge') {
    return await ownedDbTable(TABLE)
      .upsert(row, { onConflict: 'company_id,dedupe_key' })
      .select('id')
      .maybeSingle() as WriteResponse;
  }

  const inserted = await ownedDbTable(TABLE)
    .insert(row)
    .select('id')
    .maybeSingle() as WriteResponse;
  if (!isDedupeKeyTaken(inserted.error)) return inserted;

  // The row exists. Update everything the intake carries EXCEPT the score —
  // refusing the whole update would discard valid canonical intake, which is
  // the opposite error.
  const { scores: _preserved, ...withoutScores } = row;
  return await ownedDbTable(TABLE)
    .update(withoutScores)
    .eq('company_id', lead.organizationId)
    .eq('dedupe_key', computeLeadDedupeKey(lead))
    .select('id')
    .maybeSingle() as WriteResponse;
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

  // SCORE PROTECTION, before the write rather than after it: once the upsert
  // has run, the previous value is gone and there is nothing left to preserve.
  const scoreWrite = await scoresToPersist(lead);
  // Carried onto EVERY outcome below, success and failure alike. A preserved
  // score is a fact about what this write did, and a verdict that dropped it
  // would leave an operator comparing a score against a run that silently
  // declined to update it.
  const withScoreWarnings = (v: LeadProjectionResult): LeadProjectionResult => (
    scoreWrite.warnings.length === 0 ? v : { ...v, warnings: [...scoreWrite.warnings, ...v.warnings] }
  );

  let response: WriteResponse;
  try {
    response = await issueCanonicalWrite(lead, scoreWrite);
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
    if (!code) return withScoreWarnings(failed('write_failed', message));
    const verdict = classifyWriteError(code, message);
    return withScoreWarnings(
      verdict.status === 'pending_reconciliation' ? await reconcile(lead, verdict) : verdict,
    );
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
    return withScoreWarnings(
      verdict.status === 'pending_reconciliation' ? await reconcile(lead, verdict) : verdict,
    );
  }
  // Accepted, with no row handed back. The row may well exist, so claiming
  // either success or failure would be a guess. The upsert is keyed on
  // (company_id, dedupe_key), which is what makes retrying this safe.
  if (!data) return withScoreWarnings(await reconcile(lead, pendingReconciliation('no_row_returned')));
  // The row came back, but `persisted` is DEFINED as "the write returned an
  // id", so the id has to be one. `String()` would otherwise coerce a missing
  // or null `id` into the TRUTHY strings 'undefined'/'null', which satisfies
  // every downstream guard — including the sink's `!outcome.leadId` — and
  // yields `isProjected() === true` for a lead that is not there. That is the
  // original P0 in a new costume, so it is refused at the source rather than
  // caught later. A row with no usable id is exactly the `!data` case: we were
  // told nothing we can act on, so look instead of guessing.
  const rawId = (data as Record<string, unknown>).id;
  if (typeof rawId !== 'string' && typeof rawId !== 'number') {
    return withScoreWarnings(await reconcile(lead, pendingReconciliation('no_row_returned')));
  }
  const leadId = String(rawId);
  if (leadId.length === 0) {
    return withScoreWarnings(await reconcile(lead, pendingReconciliation('no_row_returned')));
  }
  return withScoreWarnings(persisted(leadId));
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
  // `'id'`, not `'id, scores'`. The column list is the ONLY thing that
  // distinguishes these two reads on the wire, and that distinction is load
  // bearing: a reconciliation read and a score-protection read are different
  // events with different meanings, and `piLdbProjectionTransportStages`
  // asserts the reconciliation one is ABSENT after a definitively failed
  // write. If both asked for the same columns, that invariant would become
  // unobservable - and an invariant nothing can check is not one.
  //
  // Asking for exactly what each caller needs is also simply correct: this one
  // has never needed the score.
  const found = await readCanonicalLeadByDedupeKey(companyId, dedupeKey, 'id');
  return found.outcome === 'found' ? { outcome: 'found', leadId: found.leadId } : found;
}

/**
 * PI-LDB C (requirement 6, folded in): presence for MANY keys at once, for a
 * caller that knows its keys up front (reconciliation).
 *
 * Packed by MEASURED request URL length, never by a key count: the builder's
 * own `url` is rendered for each candidate chunk and a key joins the chunk
 * only while the URL stays within `urlBudget` (default 3000 characters, below
 * every common proxy/CDN limit). `IN_FILTER_CHUNK`, MAX_RECONCILE_BATCH and
 * MAX_BATCH_SIZE are row or record caps, not URL budgets, which is why none of
 * them is used here.
 *
 * Returns a verdict ONLY for keys a proven response answered (status 200/206,
 * no error, an array body): `found` with the id, or `absent`. A key whose chunk
 * was not answered - or that alone exceeds the budget, or when the builder
 * exposes no measurable URL - is simply MISSING from the map, and the caller
 * falls back to the per-key three-valued read. A batch read is an
 * optimisation; it never manufactures an `absent`.
 */
export async function findCanonicalLeadIdsByDedupeKeys(
  companyId: string,
  dedupeKeys: readonly string[],
  urlBudget = 3000,
): Promise<Map<string, { outcome: 'found'; leadId: string } | { outcome: 'absent' }>> {
  const out = new Map<string, { outcome: 'found'; leadId: string } | { outcome: 'absent' }>();
  const keys = [...new Set(dedupeKeys.filter((k) => typeof k === 'string' && k.length > 0))];
  if (!companyId || keys.length === 0) return out;

  const build = (chunk: string[]) => ownedDbTable(TABLE)
    .select('dedupe_key, id')
    .eq('company_id', companyId)
    .in('dedupe_key', chunk);
  const urlLength = (chunk: string[]): number | null => {
    try {
      const u = (build(chunk) as unknown as { url?: { toString(): string } }).url;
      return u && typeof u.toString === 'function' ? u.toString().length : null;
    } catch {
      return null;
    }
  };

  const chunks: string[][] = [];
  let current: string[] = [];
  for (const key of keys) {
    const candidate = [...current, key];
    const len = urlLength(candidate);
    if (len === null) return out;                         // unmeasurable: no batch at all
    if (len <= urlBudget) { current = candidate; continue; }
    if (current.length > 0) chunks.push(current);
    const alone = urlLength([key]);
    current = alone !== null && alone <= urlBudget ? [key] : [];   // an oversize key is left to the per-key read
  }
  if (current.length > 0) chunks.push(current);

  for (const chunk of chunks) {
    try {
      const res = await build(chunk).retry(false);
      const { data, error, status } = res as { data: unknown; error: unknown; status?: unknown };
      // A null error is not an answer (Prompt 2F): only a 200/206 with an array is.
      if (error || (status !== 200 && status !== 206) || !Array.isArray(data)) continue;
      const found = new Map<string, string>();
      for (const row of data as Array<{ dedupe_key?: unknown; id?: unknown }>) {
        if (typeof row.dedupe_key === 'string' && row.id != null) found.set(row.dedupe_key, String(row.id));
      }
      for (const k of chunk) {
        const id = found.get(k);
        out.set(k, id ? { outcome: 'found', leadId: id } : { outcome: 'absent' });
      }
    } catch {
      // Unanswered chunk: its keys stay missing and fall back to the per-key read.
    }
  }
  return out;
}

/**
 * THE one keyed read behind both callers (Prompt 2B).
 *
 * Two separate functions issuing two near-identical reads against the same
 * unique key would be the start of a divergence, and the three-valued contract
 * - `found` / `absent` / `unknown`, never a `null` that conflates "not there"
 * with "could not look" - has to hold identically for both, because
 * reconciliation's correctness depends on it. So the query lives here once and
 * the callers choose their columns.
 *
 * `autoRetry` exists because @supabase/postgrest-js 2.105.3 ships its OWN
 * retry engine, on by default, and this is the only retryable call on the
 * projection path: it retries `GET`/`HEAD`/`OPTIONS` (`RETRYABLE_METHODS`) on
 * 503/520 (`RETRYABLE_STATUS_CODES`) up to `DEFAULT_MAX_RETRIES` 3, with
 * 1s/2s/4s backoff. Both writes are POSTs and are never retried. So a
 * degraded gateway costs ~7 s PER RECORD here and nowhere else, which turns a
 * 1,000-record import into nearly two hours that reports success.
 *
 * Whether that is worth paying depends on what the caller does with
 * `unknown`, which is why it is the caller's choice and not a constant.
 */
async function readCanonicalLeadByDedupeKey(
  companyId: string,
  dedupeKey: string,
  columns: 'id' | 'id, scores',
  autoRetry = true,
): Promise<
  | { outcome: 'found'; leadId: string; scores: CanonicalLeadScores }
  | { outcome: 'absent' }
  | { outcome: 'unknown' }
  > {
  if (!companyId || !dedupeKey) return { outcome: 'unknown' };
  try {
    const query = ownedDbTable(TABLE)
      .select(columns)
      .eq('company_id', companyId)
      .eq('dedupe_key', dedupeKey);
    const res = await (autoRetry ? query : query.retry(false)).maybeSingle();
    const { data, error, status } = res as { data: unknown; error: unknown; status?: unknown };
    if (error) return { outcome: 'unknown' };

    // A NULL `error` IS NOT AN ANSWER (Prompt 2F).
    //
    // `absent` is a positive claim - "the database holds no row for this key" -
    // and on this path it authorizes `resolveScoreWrite` to replace the
    // `scores` column. So it may be made only from a response that proves it,
    // and `!error` does not prove it.
    //
    // @supabase/postgrest-js 2.105.3 REWRITES two failures into error-free
    // responses in `processResponse`: a 404 with an EMPTY body becomes
    // `{ status: 204, error: null }`, and a 404 with a JSON ARRAY body becomes
    // `{ data: [], error: null, status: 200 }`. A blank 404 is what an edge, a
    // WAF or a paused project answers, so the first shape arrived here looking
    // exactly like an empty table - `error` null, no row - and returned
    // `absent`. That is the fail-open overwrite this read exists to prevent,
    // reached by the one error shape the read did not inspect.
    //
    // Not a new discovery about the library: `projectionResult.ts` names this
    // same rewrite and holds 204 in `UNCERTAIN_STATUSES` because of it. That
    // reasoning was only ever applied to WRITES. Same library, same lie - the
    // read side now reads the status too.
    //
    // Deliberately NOT the write path's status set. A write must separate
    // pre-send from post-send to stay idempotent; a read only needs to know
    // whether it was answered. So anything that is not a plain 2xx - and 204 in
    // particular, which IS 2xx and still means "no answer" here - is
    // `unknown`, which preserves the stored score.
    //
    // A response carrying NO `status` is left as it was. The real client always
    // sets one, so this concerns only test doubles, and reading their silence as
    // uncertainty would change what those suites assert without making a single
    // production path safer.
    if (typeof status === 'number' && (status === 204 || status < 200 || status >= 300)) {
      return { outcome: 'unknown' };
    }

    const row = data as Record<string, unknown> | null;
    const id = row?.id;
    if (!id) return { outcome: 'absent' };
    return { outcome: 'found', leadId: String(id), scores: obj(row?.scores) as CanonicalLeadScores };
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
