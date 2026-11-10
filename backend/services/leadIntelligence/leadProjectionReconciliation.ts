/**
 * PROJECTION RECONCILIATION - re-project durable canonical prospects whose
 * read-model row is missing (Prompt 2B).
 *
 * ─── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 * The ingestion path is deliberately fail-open about projection: a record
 * whose `lead_intelligence` write fails still leaves a durable canonical
 * prospect, person, employer and evidence behind, and the outcome says so
 * (`failed` / `pending_reconciliation`). That is the right trade - good intake
 * is not discarded over a display concern - but it left no way BACK. The
 * prospect existed, was invisible to the Lead Database, and the only repair
 * available was to run the discovery search again, which pays the vendor a
 * second time for records already held.
 *
 * This is that way back. It reads durable prospects, finds the ones with no
 * projection, and projects them from the records already stored. It contacts
 * no provider and costs nothing.
 *
 * ─── WHY THIS IS NOT A SECOND PROJECTION FRAMEWORK ─────────────────────────
 * It owns no projection logic at all. Every step is the existing one:
 *
 *   `routeToCanonicalInput('crm', row)`  the SAME adapter the read-path bridge
 *                                        uses for a `canonical_leads` row
 *                                        (`projectExistingRow('crm', ...)`).
 *   `computeLeadDedupeKey`               the SAME pure key function the write
 *                                        path uses.
 *   `findCanonicalLeadIdByDedupeKey`     the SAME three-valued keyed read
 *                                        reconciliation already relies on.
 *   `ingestCanonicalLead` + `durableLeadIntelligenceSink`
 *                                        the SAME pipeline and sink the
 *                                        orchestrator projects through.
 *
 * ─── WHY IT IS IDEMPOTENT, STRUCTURALLY RATHER THAN CAREFULLY ──────────────
 * `computeLeadDedupeKey` prefers `sourceRef` whenever it carries an id, and
 * for a canonical prospect it always does. Both sides produce
 *
 *     src:<canonicalProspectSource>|tbl:canonical_leads|id:<prospectId>
 *
 * and they cannot disagree about the source either, because the reader below
 * DROPS `unified_source` from every row before adapting it, so `crmAdapter`'s
 * unified layers are unreachable for it and both sides resolve from the row's
 * own `source` - the asymmetry documented in
 * `sourceTaxonomy.canonicalProspectSource`. So the key this computes is the
 * key the original write used or would have used.
 *
 * That drop is load bearing, and it is NOT belt-and-braces (Prompt 2C). An
 * earlier draft of this comment claimed the column simply does not exist. It
 * IS declared - `20260620_unified_source_columns.sql` adds it to
 * `public.canonical_leads` - and is merely unapplied in the environments
 * checked. The reader asks for `*`, so the day that migration is applied and
 * backfilled, the adapter would resolve a DIFFERENT source, the key's source
 * segment would move, and this pass would INSERT A SECOND ROW for a prospect
 * it is supposed to recognise. `leadProjectionReconciliation`'s own test
 * proves a row carrying `unified_source` yields a different key, so the
 * hazard is measured rather than imagined. The ingestion side cannot use the
 * column either way - its input is a provider payload, not a stored row - so
 * dropping it is what makes the two sides agree.
 *
 * Three consequences, all of them the point:
 *   - a prospect already projected is RECOGNISED and not written again;
 *   - a prospect projected under a different name cannot be created, because
 *     the key is a function of the prospect id, not of the run;
 *   - `lead_intelligence_dedupe_unique (company_id, dedupe_key)` means a
 *     concurrent reconciliation and ingestion collapse onto one row.
 *
 * Running it twice therefore does the work once. Running it during ingestion is
 * safe. Neither relies on this file being careful.
 *
 * ─── IT CANNOT CREATE AN IDENTITY ──────────────────────────────────────────
 * The identity port ECHOES the prospect's own person id and resolves nothing.
 * A reconciliation pass that resolved identities again could attach a
 * different person to an existing prospect and split one lead in two - and it
 * has no need to, because the dedupe key above does not depend on identity.
 *
 * ─── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 * It does not delete, re-key or re-originate anything, and it never downgrades
 * a projected lead. It also cannot restore a person's NAME or JOB TITLE:
 * `canonical_leads` stores no person attributes, which is the whole reason
 * PI-LDB-4 projected them from the provider record in the first place. A
 * reconciled lead is therefore visible and correctly sourced but may be
 * unnamed - better than invisible, and not as good as a successful ingestion.
 * Said plainly here so nobody reads a clean reconciliation as a full repair.
 *
 * ─── NOT WIRED TO A ROUTE OR A SCHEDULE ────────────────────────────────────
 * This exports a function and nothing invokes it. Deciding WHO may trigger a
 * tenant-wide re-projection, and whether it runs on a schedule, is an
 * authorization question with its own gate; arming it here would answer that
 * question by accident. See the owner decisions in the Prompt 2B report.
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  computeLeadDedupeKey,
  ingestCanonicalLead,
  projectionFailureFrom,
  routeToCanonicalInput,
  type CanonicalLeadInput,
  type IdentityResolverPort,
  type LeadIntelligenceSink,
  type LeadProjectionResult,
} from '../../../lib/leadIntelligence';
import { durableLeadIntelligenceSink } from './durableLeadIntelligenceSink';
import { findCanonicalLeadIdByDedupeKey, findCanonicalLeadIdsByDedupeKeys } from './leadIntelligenceRepository';

const CANONICAL_TABLE = 'canonical_leads';

/** Bounded so one call cannot sweep an unbounded tenant. */
export const MAX_RECONCILE_BATCH = 500;

export type ReconcileItemStatus =
  /** A projection already exists for this prospect. Nothing was written. */
  | 'already_projected'
  /** Was missing, and is now projected. */
  | 'projected'
  /** Was missing, the re-projection did not confirm. The prospect is unharmed. */
  | 'still_missing'
  /** The keyed read could not answer, so nothing was attempted. */
  | 'unknown'
  /** The row carries nothing to key on, so it cannot be projected or found. */
  | 'skipped';

export interface ReconcileItemOutcome {
  readonly prospectId: string | null;
  readonly dedupeKey: string | null;
  readonly status: ReconcileItemStatus;
  /** The projection verdict, when one was obtained. */
  readonly projection?: LeadProjectionResult;
  readonly detail?: string;
}

export interface ReconcileProjectionsResult {
  readonly organizationId: string;
  readonly examined: number;
  readonly alreadyProjected: number;
  readonly projected: number;
  readonly stillMissing: number;
  readonly unknown: number;
  readonly skipped: number;
  /** More prospects exist than this call examined. */
  readonly truncated: boolean;
  readonly outcomes: readonly ReconcileItemOutcome[];
}

export interface ReconcileProspectRow {
  readonly [column: string]: unknown;
}

export interface ReconcileProjectionsPorts {
  /** Read durable canonical prospects for this tenant, newest first. */
  readonly readProspects?: (organizationId: string, limit: number) => Promise<{
    rows: ReconcileProspectRow[];
    truncated: boolean;
  }>;
  readonly findProjection?: typeof findCanonicalLeadIdByDedupeKey;
  /** PI-LDB C: batched presence for every adapted key (URL-budgeted). */
  readonly findProjections?: typeof findCanonicalLeadIdsByDedupeKeys;
  readonly sink?: LeadIntelligenceSink;
  readonly now?: () => string;
}

export interface ReconcileProjectionsInput {
  readonly organizationId: string;
  readonly limit?: number;
  readonly ports?: ReconcileProjectionsPorts;
}

/**
 * Columns dropped from every prospect row before it is adapted.
 *
 * `select('*')` is kept deliberately - the adapter decides which fields matter
 * and an explicit list would freeze its input - so the one column that would
 * MOVE THE DEDUPE KEY is removed here instead. See the idempotency argument at
 * the top of this file.
 */
const KEY_MOVING_COLUMNS = ['unified_source'] as const;

/**
 * The default reader. Tenant-scoped in the QUERY rather than filtered
 * afterwards, and bounded. It asks for one row more than the limit so
 * `truncated` is a fact rather than an inference from a full page.
 */
/** People per `unified_persons` read: 40 uuids keep the request URL near 1.8 KB. */
const PERSON_READ_CHUNK = 40;

/**
 * PI-LDB C (reqs 7-10): recover the display NAME and JOB TITLE a projected lead
 * would otherwise lack. `canonical_leads` stores no person attributes, but the
 * prospect's `unified_person_id` points at the spine row that holds them, and
 * the adapter already reads `row.name` / `row.title` for display. A READ of the
 * spine (never a write, so the LI-2 boundary is untouched), tenant-filtered,
 * at zero vendor cost. Best-effort: an unanswered read leaves the display empty
 * (honest unknown) rather than failing the pass.
 */
async function attachPersonDisplay(
  organizationId: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(rows.map((r) => r.unified_person_id).filter((v): v is string => typeof v === 'string' && v.length > 0))];
  if (ids.length === 0) return rows;
  const display = new Map<string, { name: string | null; title: string | null }>();
  for (let i = 0; i < ids.length; i += PERSON_READ_CHUNK) {
    try {
      const res = await ownedDbTable('unified_persons')
        .select('id, full_name, job_title')
        .eq('company_id', organizationId)
        .in('id', ids.slice(i, i + PERSON_READ_CHUNK));
      const { data, error, status } = res as { data: unknown; error: unknown; status?: number };
      if (error || (status !== 200 && status !== 206) || !Array.isArray(data)) continue;
      for (const p of data as Array<Record<string, unknown>>) {
        const fullName = p['full_name'];
        const jobTitle = p['job_title'];
        display.set(String(p.id), {
          name: typeof fullName === 'string' && fullName.trim() ? fullName : null,
          title: typeof jobTitle === 'string' && jobTitle.trim() ? jobTitle : null,
        });
      }
    } catch { /* unanswered chunk: those leads keep an empty display */ }
  }
  return rows.map((r) => {
    const d = typeof r.unified_person_id === 'string' ? display.get(r.unified_person_id) : undefined;
    if (!d) return r;
    const out = { ...r };
    if (out.name == null && d.name) out.name = d.name;
    if (out.title == null && d.title) out.title = d.title;
    return out;
  });
}

async function readProspectsDefault(
  organizationId: string,
  limit: number,
): Promise<{ rows: ReconcileProspectRow[]; truncated: boolean }> {
  const res = await ownedDbTable(CANONICAL_TABLE)
    .select('*')
    .eq('company_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  const { data, error } = res as { data: unknown; error: unknown };
  if (error) {
    const e = error as { message?: string | null; code?: string | null };
    throw new Error(`canonical_leads could not be read (${e.code ?? 'unknown'}): ${e.message ?? 'no message'}`);
  }
  const all = (Array.isArray(data) ? (data as Record<string, unknown>[]) : []).map((row) => {
    if (!KEY_MOVING_COLUMNS.some((c) => c in row)) return row as ReconcileProspectRow;
    const kept = { ...row };
    for (const c of KEY_MOVING_COLUMNS) delete kept[c];
    return kept as ReconcileProspectRow;
  });
  const page = all.slice(0, limit);
  return {
    rows: (await attachPersonDisplay(organizationId, page as Record<string, unknown>[])) as ReconcileProspectRow[],
    truncated: all.length > limit,
  };
}

/**
 * The tenant a row NAMES, checked strictly (PI-LDB C, reqs 7-10).
 *
 * The adapter's `tenantOf` reads `organization_id ?? company_id`, while this
 * pass used to read `company_id ?? organization_id`. A row carrying both, with
 * different values, would pass a guard that looked at one and then be adapted
 * into the tenant named by the other. So EVERY tenant-naming field present on
 * the row must equal the batch tenant; a row naming none, or naming two
 * different tenants, is refused.
 */
function rowTenantVerdict(row: ReconcileProspectRow, organizationId: string): { ok: true } | { ok: false; detail: string } {
  const named = (['company_id', 'organization_id', 'companyId', 'organizationId'] as const)
    .map((k) => row[k])
    .filter((v) => v !== undefined && v !== null && String(v) !== '')
    .map((v) => String(v));
  if (named.length === 0) return { ok: false, detail: 'the row names no tenant' };
  const other = named.find((t) => t !== organizationId);
  if (other !== undefined) return { ok: false, detail: `the row names tenant '${other}' in a pass owned by '${organizationId}'` };
  return { ok: true };
}

export async function reconcileLeadProjections(
  input: ReconcileProjectionsInput,
): Promise<ReconcileProjectionsResult> {
  const { organizationId } = input;
  if (!organizationId?.trim()) {
    throw new Error('reconcileLeadProjections: organizationId is required — reconciliation is never tenant-less');
  }
  const limit = Math.max(1, Math.min(input.limit ?? MAX_RECONCILE_BATCH, MAX_RECONCILE_BATCH));
  const ports = input.ports ?? {};
  const readProspects = ports.readProspects ?? readProspectsDefault;
  const findProjection = ports.findProjection ?? findCanonicalLeadIdByDedupeKey;
  // Batched presence only when the caller did not inject a per-key port of its
  // own: a test or caller that supplies `findProjection` gets exactly that.
  const findProjections = ports.findProjections
    ?? (ports.findProjection ? async () => new Map() : findCanonicalLeadIdsByDedupeKeys);
  const sink = ports.sink ?? durableLeadIntelligenceSink;
  const now = () => ports.now?.() ?? new Date().toISOString();

  const { rows, truncated } = await readProspects(organizationId, limit);
  const outcomes: ReconcileItemOutcome[] = [];

  // PI-LDB C: the keys are known up front here (unlike the import path), so
  // presence is read in URL-budgeted batches first. A key the batch did not
  // answer falls back to the per-key three-valued read below; the batch never
  // turns an unanswered read into `absent`.
  const knownKeys: string[] = [];
  for (const row of rows) {
    if (row.id == null || !rowTenantVerdict(row, organizationId).ok) continue;
    try { knownKeys.push(computeLeadDedupeKey(routeToCanonicalInput('crm', row as Record<string, unknown>))); } catch { /* adapted again below */ }
  }
  let batched = new Map<string, { outcome: 'found'; leadId: string } | { outcome: 'absent' }>();
  try { batched = await findProjections(organizationId, knownKeys); } catch { /* per-key fallback */ }

  for (const row of rows) {
    const prospectId = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : null;

    // The tenant of the BATCH is authoritative. A row that names another one is
    // refused rather than projected into whichever tenant it claimed - the same
    // rule `ingestLeadBatch` applies to an adapter's output.
    const tenant = rowTenantVerdict(row, organizationId);
    if (!prospectId || !tenant.ok) {
      outcomes.push({
        prospectId,
        dedupeKey: null,
        status: 'skipped',
        detail: !prospectId
          ? 'the prospect row carries no id, so it has no stable projection key'
          : (tenant as { detail: string }).detail,
      });
      continue;
    }

    let projectionInput: CanonicalLeadInput;
    let dedupeKey: string;
    try {
      // `'crm'` is the adapter key for a `canonical_leads` row, matching the
      // read-path bridge exactly. The adapter re-resolves the DISPLAY source
      // from the row itself, so this is not a claim that the prospect is a CRM
      // lead - an Apollo prospect still resolves through
      // `canonicalProspectSource` and still carries its `pi_discovery` origin.
      projectionInput = routeToCanonicalInput('crm', row as Record<string, unknown>);
      dedupeKey = computeLeadDedupeKey(projectionInput);
    } catch (e) {
      outcomes.push({
        prospectId,
        dedupeKey: null,
        status: 'skipped',
        detail: `the prospect row could not be adapted: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    // Belt to the row check above: the ADAPTED lead must belong to this pass's
    // tenant too, whatever precedence the adapter applied.
    if (projectionInput.organizationId !== organizationId) {
      outcomes.push({
        prospectId,
        dedupeKey: null,
        status: 'skipped',
        detail: `the adapted lead names tenant '${projectionInput.organizationId}' in a pass owned by '${organizationId}'`,
      });
      continue;
    }

    // LOOK FIRST. A prospect that is already projected is not written again:
    // the upsert would be harmless, but it would also bump `updated_at` and
    // re-run score materialization on a row nobody asked to change, and a
    // repair pass that quietly rewrites healthy rows is not a repair pass.
    const existing = batched.get(dedupeKey) ?? await findProjection(organizationId, dedupeKey);
    if (existing.outcome === 'found') {
      outcomes.push({ prospectId, dedupeKey, status: 'already_projected' });
      continue;
    }
    if (existing.outcome === 'unknown') {
      // Not treated as absent. Projecting on an unestablished read is how a
      // reconciliation pass starts writing rows it has no evidence are needed.
      outcomes.push({
        prospectId,
        dedupeKey,
        status: 'unknown',
        detail: 'the projection could not be read back, so nothing was attempted for this prospect',
      });
      continue;
    }

    // ECHO, never resolve. See the header.
    const identity: IdentityResolverPort = {
      resolve: async () => ({
        unifiedPersonId: projectionInput.identity.unifiedPersonId ?? null,
        matchedBy: 'projection_reconciliation',
      }),
    };

    // The sink's verdict is the only evidence a row landed, so it is captured
    // rather than inferred from the absence of a throw - the PI-LDB P0 in
    // miniature, and the same wrapper the orchestrator uses for the same
    // reason.
    const observed: { verdict: LeadProjectionResult | null } = { verdict: null };
    const observedSink: LeadIntelligenceSink = {
      async emit(lead) {
        const result = await sink.emit(lead);
        observed.verdict = result;
        return result;
      },
    };

    let verdict: LeadProjectionResult | null;
    try {
      await ingestCanonicalLead(projectionInput, { identity, sink: observedSink, now });
      verdict = observed.verdict;
    } catch (e) {
      // A typed failure carries its classified verdict; anything else is not
      // turned into one. `null` below reports `still_missing`, which is the
      // honest answer for "we tried and cannot say it worked".
      verdict = projectionFailureFrom(e);
      if (!verdict) {
        outcomes.push({
          prospectId,
          dedupeKey,
          status: 'still_missing',
          detail: `the re-projection raised: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
    }

    outcomes.push({
      prospectId,
      dedupeKey,
      // `persisted` is the ONLY status that means the Lead Database will list
      // it. Everything else - failed, pending, skipped, no verdict at all -
      // is still missing as far as an operator is concerned, and collapsing
      // them into success is the defect this whole line of work exists for.
      status: verdict?.status === 'persisted' ? 'projected' : 'still_missing',
      ...(verdict ? { projection: verdict } : {}),
    });
  }

  const count = (s: ReconcileItemStatus): number => outcomes.filter((o) => o.status === s).length;
  return {
    organizationId,
    examined: outcomes.length,
    alreadyProjected: count('already_projected'),
    projected: count('projected'),
    stillMissing: count('still_missing'),
    unknown: count('unknown'),
    skipped: count('skipped'),
    truncated,
    outcomes,
  };
}
