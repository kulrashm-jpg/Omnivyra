/**
 * WP3 / L7 — provider message id → exactly one tenant, task and attempt.
 *
 * Adapted from the ENG-003 reference (pi-consol), with two corrections:
 *   • the provider name is the one the SEND path records
 *     (`SES_EDGE_PROVIDER_NAME`, 'supabase_edge_ses'); the reference looked
 *     events up under 'ses' and would therefore have resolved nothing;
 *   • the ATTEMPT is required, not best-effort: every evidence row the send path
 *     and this webhook write names its attempt.
 *
 * WHY A SET, NOT `LIMIT 1`. `(company_id, provider, provider_message_id)` is not
 * unique — one message legitimately produces several evidence rows (the send,
 * then delivery, then perhaps a bounce). So every matching row is read and the
 * set must be UNANIMOUS on tenant, task and attempt. Disagreement is refused,
 * because picking a row would attach a provider fact to work it did not
 * describe — or to another tenant.
 *
 * WHY THE TENANT IS DISCOVERED HERE. There is exactly one platform SES identity
 * today, so an SES notification carries nothing that names a tenant. Discovery
 * by message id is safe only because (1) the event is already authenticated
 * (verified SNS signature from an allow-listed topic), so the id is AWS's; (2)
 * the id was minted for OUR send, whose evidence row this reads; and (3) it
 * resolves only on a unique tenant. Per-tenant sender identities (WP4) are the
 * authoritative replacement.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { OUTREACH_DELIVERY_TABLE } from '../leadOutreachExecution/storage';

export type ProviderMessageFailure =
  | 'invalid_provider_message_id'
  | 'not_found'
  | 'cross_tenant_mismatch'
  | 'ambiguous_task'
  | 'ambiguous_attempt'
  | 'attempt_unknown'
  | 'read_failed';

/** One shape with nullable fields — `strict: false` does not narrow unions. */
export interface ProviderMessageResolution {
  ok: boolean;
  companyId: string | null;
  taskId: string | null;
  attemptId: string | null;
  matchedRows: number;
  failure: ProviderMessageFailure | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const fail = (failure: ProviderMessageFailure, matchedRows = 0): ProviderMessageResolution => ({
  ok: false, companyId: null, taskId: null, attemptId: null, matchedRows, failure,
});

/** A provider id is opaque; it must be a non-empty single-line string. */
export function isUsableProviderMessageId(value: unknown): boolean {
  const candidate = str(value);
  if (!candidate || candidate.length > 512) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001F\u007F]/.test(candidate);
}

function distinct(rows: ReadonlyArray<Record<string, unknown>>, key: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const v = str(row?.[key]);
    if (v) seen.add(v);
  }
  return [...seen];
}

/** Resolve an authenticated provider event to its send. Never throws. */
export async function resolveProviderMessage(provider: string, providerMessageId: unknown): Promise<ProviderMessageResolution> {
  if (!isUsableProviderMessageId(providerMessageId)) return fail('invalid_provider_message_id');
  const messageId = String(providerMessageId).trim();

  let res: { data?: unknown; error?: unknown };
  try {
    res = await ownedDbTable(OUTREACH_DELIVERY_TABLE)
      .select('company_id, task_id, attempt_id')
      .eq('provider', provider)
      .eq('provider_message_id', messageId);
  } catch {
    return fail('read_failed');
  }
  if (res?.error) return fail('read_failed');
  const rows = (Array.isArray(res?.data) ? res.data : []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return fail('not_found');

  const tenants = distinct(rows, 'company_id');
  if (tenants.length !== 1) return fail(tenants.length === 0 ? 'not_found' : 'cross_tenant_mismatch', rows.length);

  const tasks = distinct(rows, 'task_id');
  if (tasks.length !== 1) return fail(tasks.length === 0 ? 'not_found' : 'ambiguous_task', rows.length);

  const attempts = distinct(rows, 'attempt_id');
  if (attempts.length === 0) return fail('attempt_unknown', rows.length);
  if (attempts.length > 1) return fail('ambiguous_attempt', rows.length);

  return {
    ok: true, companyId: tenants[0], taskId: tasks[0], attemptId: attempts[0], matchedRows: rows.length, failure: null,
  };
}
