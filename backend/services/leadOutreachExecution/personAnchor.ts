/**
 * A3 / Contract 13 — the canonical PERSON ANCHOR resolution order.
 *
 * ONE question, answered in ONE place: which `unified_persons.id` is this
 * outreach task about?
 *
 * ─── THE FROZEN ORDER ──────────────────────────────────────────────────────
 *   1. an explicit caller-supplied `personId`
 *   2. `outreach_tasks.person_id`        — the Contract 12 stored anchor
 *   3. `resolveLeadPersonId()` via `leads.unified_person_id`
 *   4. unresolved
 *
 * The order is strictest-evidence-first. A caller that already knows the person
 * has better information than a stored column, and a stored column is a durable
 * fact recorded at materialisation while the lead link is whatever `leads` says
 * right now. Reversing any pair would let a weaker, later-mutable source
 * override a stronger, earlier-recorded one.
 *
 * ─── TWO FAILURE MODES THAT MUST NEVER BE CONFLATED ────────────────────────
 * READ FAILURE — the database could not be asked. We do not know whether a
 * person-anchored do-not-contact record exists, so the caller FAILS CLOSED.
 * `ok: false` says exactly that, and it is the only thing it says.
 *
 * TRUE IDENTITY ABSENCE — the database answered, and the answer is that there
 * is no person: no anchor, no lead row, or a lead not yet canonicalised. That
 * is not an error and must not block; governance legitimately degrades to
 * target-only matching. But it IS a materially weaker evaluation — a governance
 * record anchored ONLY to a person cannot match a target — so `degraded: true`
 * travels with the result and the caller records it on the persisted decision.
 * Until A3 that degradation was silent, which meant an allowed decision taken
 * with full identity and one taken with none looked identical in the audit log.
 *
 * ─── WHAT THIS MODULE IS NOT ───────────────────────────────────────────────
 * It evaluates no governance rule. `mayContact` in
 * `prospectIdentity/contactGovernance` is the sole owner of those and is called,
 * never reimplemented. This module resolves an identifier and nothing else: no
 * dispatch, no transport, no suppression logic, no writes.
 *
 * It never reads, writes or references `consent_records` — that is an
 * OAuth/platform-capability ledger, a different domain entirely.
 */

import { ownedDbTable } from '../../db/writeOwner';
import type { OutreachTask, PersonAnchorSource } from './types';

/**
 * Which step of the frozen order produced the anchor. The vocabulary is owned
 * by `types.ts` (and mirrored by the `outreach_decisions_identity_anchor_valid`
 * CHECK constraint); it is re-exported here so a caller working with the
 * resolver does not have to reach into two modules for one concept.
 */
export type { PersonAnchorSource };

export interface PersonAnchorResolution {
  /**
   * FALSE means a read failed and the anchor is UNKNOWN. The caller must fail
   * closed. It never means "there is no person" — that is `source: 'none'`.
   */
  ok: boolean;
  personId: string | null;
  source: PersonAnchorSource;
  /**
   * TRUE when identity is genuinely absent and governance therefore falls back
   * to target-only matching. Always exactly `source === 'none'`, which is the
   * invariant `outreach_decisions_identity_coherent` enforces in the database.
   */
  degraded: boolean;
  /** Why, in a stable machine-readable form. Null when fully resolved. */
  reason: string | null;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Never throws — a transport failure is normalized into the same `{ error }`
 * shape PostgREST returns, matching the discipline the rest of this runtime
 * already follows.
 */
async function safeDb<T>(op: () => PromiseLike<{ data?: T; error?: unknown }>): Promise<{ data: T | null; error: unknown | null }> {
  try {
    const res = await op();
    return { data: (res?.data ?? null) as T | null, error: res?.error ?? null };
  } catch (e) {
    return { data: null, error: e ?? new Error('unknown database failure') };
  }
}

/**
 * LI-3D — resolve the canonical person behind an outreach task's lead.
 *
 * `OutreachTask` carries a `leadId`; canonical governance is anchored to
 * `unified_persons.id`. LI-3C could therefore only match target-anchored
 * records, and the LI-3C audit classified that gap P2-1. The relationship it
 * needs already exists — `leads.unified_person_id` — so this resolves it rather
 * than inventing a second identity link.
 *
 * TENANT-SCOPED: the lead is read with `company_id` as the FIRST predicate, so a
 * leadId belonging to another tenant resolves to nothing rather than to their
 * person.
 *
 * FAILS CLOSED via the `ok` flag. An unreadable `leads` row means we cannot know
 * whether a person-anchored DNC exists, and proceeding would risk contacting
 * someone we were told not to.
 *
 * Moved here from `governanceService` by A3 so that every step of the anchor
 * order lives in one module. Its signature and return shape are UNCHANGED, and
 * `governanceService` still re-exports it, so existing callers and the LI-3D
 * tests are unaffected.
 */
export async function resolveLeadPersonId(
  companyId: string,
  leadId: string | null,
): Promise<{ ok: boolean; personId: string | null }> {
  if (!companyId || !leadId) return { ok: true, personId: null };

  const res = await safeDb<Row[]>(() =>
    ownedDbTable('leads')
      .select('id, unified_person_id')
      .eq('company_id', companyId)          // TENANT FIRST, always
      .eq('id', leadId)
      .limit(1),
  );
  if (res.error) return { ok: false, personId: null };

  const row = Array.isArray(res.data) ? res.data[0] : null;
  // No lead, or a lead not yet canonicalised, is not a failure: it simply has no
  // person anchor and target matching remains in force.
  return { ok: true, personId: row ? str(row.unified_person_id) : null };
}

const resolved = (personId: string, source: PersonAnchorSource): PersonAnchorResolution =>
  ({ ok: true, personId, source, degraded: false, reason: null });

const absent = (reason: string): PersonAnchorResolution =>
  ({ ok: true, personId: null, source: 'none', degraded: true, reason });

/**
 * CONTRACT 13 — resolve the person anchor in the frozen order.
 *
 * TENANT SAFETY at every step, by construction rather than by a pre-check:
 *   explicit — the id is handed to `loadGovernanceRecords`, which filters on
 *              `organization_id` first, and to `mayContact`, which filters again
 *              on `organizationId`. An id belonging to another tenant therefore
 *              matches none of their records; it cannot leak a verdict.
 *   task     — `outreach_tasks_person_tenant_fk` makes a cross-tenant stored
 *              anchor unrepresentable in the database, so a value read from the
 *              column is a tenant-correct value by definition.
 *   lead     — `resolveLeadPersonId` puts `company_id` first in the predicate.
 *
 * Performs at most ONE database read, and only when steps 1 and 2 are both
 * empty. Anchoring a task therefore removes a per-evaluation query as well as
 * making the audit answerable.
 */
export async function resolvePersonAnchor(
  companyId: string,
  task: Pick<OutreachTask, 'leadId' | 'personId'>,
  explicitPersonId: string | null,
): Promise<PersonAnchorResolution> {
  // 1 — the caller knows best.
  const explicit = str(explicitPersonId);
  if (explicit) return resolved(explicit, 'explicit');

  // 2 — the Contract 12 stored anchor.
  const stored = str(task?.personId ?? null);
  if (stored) return resolved(stored, 'task');

  // 3 — the lead's canonical link.
  const leadId = str(task?.leadId ?? null);
  if (!leadId) return absent('task_has_no_lead_id');

  const fromLead = await resolveLeadPersonId(companyId, leadId);
  if (!fromLead.ok) {
    // READ FAILURE, not absence. The caller turns this into a block.
    return { ok: false, personId: null, source: 'none', degraded: true, reason: 'lead_person_resolution_failed' };
  }
  if (fromLead.personId) return resolved(fromLead.personId, 'lead');

  // 4 — genuinely unresolved. Target-only matching, recorded as such.
  return absent('lead_absent_or_not_canonicalised');
}
