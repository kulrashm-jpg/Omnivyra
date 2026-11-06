/**
 * N-4 — stored message content is cleared only on an admin's approval, never before 3 days.
 *
 * OWNER RULE (2026-11-06): message text and numbers are cleared only after an admin approves
 * it; anything not approved is kept; nothing younger than MIN_RETENTION_DAYS is cleared.
 * Nothing here runs on a schedule. The only caller is the platform-admin route
 * (/api/super-admin/message-retention), and every clearing is one approval row first.
 *
 * STORES
 *   engagement_messages    WhatsApp inbound messages of one tenant: `content` and `raw_payload`.
 *   outreach_outcome_notes operator notes on manual outcomes of one tenant.
 *   dead_letters           `whatsapp-webhook` dead letters (platform-wide): the job's Meta body.
 *
 * WHAT CLEARING KEEPS. Every identity and order key a reader needs survives: the row, its
 * thread, platform_message_id, direction, created_at. Content becomes:
 *   - for a whole-message opt-out (STOP): the keyword exactly as `detectWhatsAppOptOut`
 *     returns it, which the detector accepts again, so a journey still reads it as STOP;
 *   - for anything else: CLEARED_CONTENT, which the detector never accepts.
 * raw_payload keeps only Meta's message id and type. The opt-out itself lives in the
 * governance store and is never touched here.
 *
 * NOT COVERED: notes written before 20270128000003 sit in append-only
 * outreach_outcomes.evidence and cannot be cleared without breaking that table's rule (an
 * owner decision). Redis job data expires on BullMQ's own retention (24 h completed,
 * 7 days failed); the durable copy of a failed job is the dead letter, which is covered.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { detectWhatsAppOptOut } from '../whatsappOptOut';

export const MIN_RETENTION_DAYS = 3;
export const CLEARED_CONTENT = '[redacted]';
export const RETENTION_STORES = ['engagement_messages', 'outreach_outcome_notes', 'dead_letters'] as const;
export type RetentionStore = (typeof RETENTION_STORES)[number];
export const DEAD_LETTER_WORKER = 'whatsapp-webhook';

const PAGE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isRetentionStore = (v: unknown): v is RetentionStore =>
  typeof v === 'string' && (RETENTION_STORES as readonly string[]).includes(v);

/** The content a cleared message keeps: the STOP keyword, or CLEARED_CONTENT. */
export function clearedContentFor(content: unknown): string {
  return detectWhatsAppOptOut(content)?.keyword ?? CLEARED_CONTENT;
}

export class RetentionRefusal extends Error {
  constructor(readonly code: 'cutoff_too_recent' | 'cutoff_invalid' | 'tenant_required' | 'tenant_not_allowed' | 'store_invalid', message: string) {
    super(message);
    this.name = 'RetentionRefusal';
  }
}

export interface ClearingRequest {
  store: RetentionStore;
  /** Required for every store except dead_letters, which is platform-wide. */
  organizationId: string | null;
  /** Only content created strictly before this instant is cleared. */
  cutoff: string;
}

function validate(req: ClearingRequest, now: number): string {
  if (!isRetentionStore(req.store)) throw new RetentionRefusal('store_invalid', 'unknown store');
  if (req.store === 'dead_letters' && req.organizationId) {
    throw new RetentionRefusal('tenant_not_allowed', 'dead letters are platform-wide; name no tenant');
  }
  if (req.store !== 'dead_letters' && !req.organizationId) {
    throw new RetentionRefusal('tenant_required', 'name the tenant whose content is cleared');
  }
  const cutoff = Date.parse(req.cutoff);
  if (!Number.isFinite(cutoff)) throw new RetentionRefusal('cutoff_invalid', 'cutoff is not an instant');
  if (cutoff > now - MIN_RETENTION_DAYS * DAY_MS) {
    throw new RetentionRefusal('cutoff_too_recent', `nothing younger than ${MIN_RETENTION_DAYS} days is cleared`);
  }
  return new Date(cutoff).toISOString();
}

const isCleared = (raw: unknown): boolean =>
  raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).cleared === true;

/** How many rows an approval with this request would clear. Reads only. */
export async function previewClearing(req: ClearingRequest, now = Date.now()): Promise<number> {
  const cutoff = validate(req, now);
  if (req.store === 'outreach_outcome_notes') {
    const r = await ownedDbTable('outreach_outcome_notes')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', String(req.organizationId))
      .lt('created_at', cutoff)
      .is('cleared_at', null);
    if (r.error) throw new Error(`notes unreadable: ${r.error.code ?? 'unknown'}`);
    return r.count ?? 0;
  }
  let n = 0;
  await forEachUncleared(req, cutoff, async (rows) => { n += rows.length; });
  return n;
}

/**
 * Record the approval, then clear. Returns the approval id and how many rows were cleared.
 * The approval is written first: a clearing that stops part-way is still attributable, and
 * re-running the same request clears only what is left.
 */
export async function approveAndClear(
  req: ClearingRequest & { approvedBy: string; reason: string | null },
  now = Date.now(),
): Promise<{ approvalId: string; rowsCleared: number }> {
  const cutoff = validate(req, now);
  const approval = await ownedDbTable('message_retention_approvals')
    .insert({
      organization_id: req.store === 'dead_letters' ? null : req.organizationId,
      store: req.store,
      cutoff,
      approved_by: req.approvedBy,
      reason: req.reason,
    })
    .select('id')
    .single();
  // The database's clock decides the 3-day floor (a CHECK against approved_at): a cutoff this
  // process accepted at the edge of the window is refused there, and reported as such.
  if ((approval.error as { code?: string } | null)?.code === '23514') {
    throw new RetentionRefusal('cutoff_too_recent', `nothing younger than ${MIN_RETENTION_DAYS} days is cleared`);
  }
  if (approval.error || !approval.data) throw new Error(`approval not recorded: ${approval.error?.code ?? 'unknown'}`);
  const approvalId = String((approval.data as { id: string }).id);

  let rowsCleared = 0;
  if (req.store === 'outreach_outcome_notes') {
    const r = await ownedDbTable('outreach_outcome_notes')
      .update({ note: null, cleared_at: new Date(now).toISOString(), clearing_approval_id: approvalId })
      .eq('company_id', String(req.organizationId))
      .lt('created_at', cutoff)
      .is('cleared_at', null)
      .select('id');
    if (r.error) throw new Error(`notes not cleared: ${r.error.code ?? 'unknown'}`);
    rowsCleared = (r.data ?? []).length;
  } else {
    await forEachUncleared(req, cutoff, async (rows) => {
      for (const row of rows) {
        await clearRow(req.store, row, approvalId);
        rowsCleared++;
      }
    });
  }

  const done = await ownedDbTable('message_retention_approvals')
    .update({ executed_at: new Date().toISOString(), rows_cleared: rowsCleared })
    .eq('id', approvalId)
    .is('executed_at', null);
  if (done.error) throw new Error(`approval execution not recorded: ${done.error.code ?? 'unknown'}`);
  return { approvalId, rowsCleared };
}

type Row = Record<string, unknown>;

/** Pages through uncleared rows older than the cutoff, oldest first. */
async function forEachUncleared(req: ClearingRequest, cutoff: string, visit: (rows: Row[]) => Promise<void>): Promise<void> {
  let after: string | null = null;
  for (;;) {
    let q = req.store === 'engagement_messages'
      ? ownedDbTable('engagement_messages')
          .select('id, content, raw_payload')
          .eq('organization_id', String(req.organizationId))
          .eq('platform', 'whatsapp')
          .lt('created_at', cutoff)
      : ownedDbTable('worker_dead_letter_queue')
          .select('id, job_payload')
          .eq('worker_name', DEAD_LETTER_WORKER)
          .lt('created_at', cutoff);
    if (after) q = q.gt('id', after);
    const r = await q.order('id', { ascending: true }).limit(PAGE);
    if (r.error) throw new Error(`${req.store} unreadable: ${r.error.code ?? 'unknown'}`);
    const rows = (r.data ?? []) as Row[];
    if (rows.length === 0) return;
    const pending = rows.filter((row) => req.store === 'engagement_messages'
      ? !isCleared(row.raw_payload)
      : !isCleared((row.job_payload as Row | null)?.data));
    if (pending.length > 0) await visit(pending);
    if (rows.length < PAGE) return;
    after = String(rows[rows.length - 1].id);
  }
}

async function clearRow(store: RetentionStore, row: Row, approvalId: string): Promise<void> {
  if (store === 'engagement_messages') {
    const raw = (row.raw_payload ?? {}) as Row;
    const r = await ownedDbTable('engagement_messages')
      .update({
        content: clearedContentFor(row.content),
        raw_payload: { id: raw.id ?? null, type: raw.type ?? null, cleared: true, approvalId },
      })
      .eq('id', String(row.id));
    if (r.error) throw new Error(`message not cleared: ${r.error.code ?? 'unknown'}`);
    return;
  }
  const payload = (row.job_payload ?? {}) as Row;
  const r = await ownedDbTable('worker_dead_letter_queue')
    .update({ job_payload: { ...payload, data: { cleared: true, approvalId } } })
    .eq('id', String(row.id));
  if (r.error) throw new Error(`dead letter not cleared: ${r.error.code ?? 'unknown'}`);
}

/**
 * N-4: the operator's note on a manual outcome, kept clearable. One per (company, task,
 * type), matching the one-manual-outcome rule. Never throws: the outcome is already
 * recorded, so a lost note is reported to the caller, not turned into a failed request.
 */
export async function recordOutcomeNote(input: {
  companyId: string;
  taskId: string;
  outcomeType: string;
  note: string;
  recordedBy: string | null;
}): Promise<boolean> {
  try {
    const r = await ownedDbTable('outreach_outcome_notes').insert({
      company_id: input.companyId,
      task_id: input.taskId,
      outcome_type: input.outcomeType,
      note: input.note,
      recorded_by: input.recordedBy,
    });
    return !r.error || (r.error as { code?: string }).code === '23505';
  } catch {
    return false;
  }
}
