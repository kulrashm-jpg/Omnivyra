/**
 * Test fixture: a community action row carrying a COMPLETE human approval of
 * record (Prompt 3, OD-1), as approve.ts + the database would leave it:
 *
 *   approved_at            the approval time (server-stamped in production)
 *   approved_by            the human approver
 *   approved_content_hash  the binding hash of the stored row (communityApprovalBinding)
 *   passkey_credential_id  the passkey that verified this approval
 *   passkey_verified_at    within the approval's passkey window
 *
 * The hash is computed by the REAL binding function, so a fixture whose content
 * changes after this call is (correctly) refused as APPROVAL_CONTENT_CHANGED.
 * Nothing here weakens a gate: tests that want a refusal pass a row without this.
 */
import { communityApprovalBindingHash } from '../../services/communityApprovalBinding';

export const FIXTURE_APPROVER_ID = '00000000-0000-4000-8000-0000000000a1';
export const FIXTURE_PASSKEY_CREDENTIAL = 'fixture-passkey-credential';

/** An ISO time `ms` before now (default: one hour ago, well inside 7 days). */
export const approvedAgo = (ms = 60 * 60_000): string => new Date(Date.now() - ms).toISOString();

export function withApprovalEvidence<T extends Record<string, any>>(
  row: T,
  opts: { approvedAt?: string; approvedBy?: string } = {},
): T & {
  approved_at: string;
  approved_by: string;
  approved_content_hash: string;
  passkey_credential_id: string;
  passkey_verified_at: string;
} {
  const approvedAt = opts.approvedAt ?? (typeof row.approved_at === 'string' && row.approved_at ? row.approved_at : approvedAgo());
  const binding = communityApprovalBindingHash(row as never);
  if (!binding.ok) throw new Error(`fixture row cannot be bound: ${binding.reason}`);
  return {
    ...row,
    approved_at: approvedAt,
    approved_by: opts.approvedBy ?? FIXTURE_APPROVER_ID,
    approved_content_hash: binding.hash,
    passkey_credential_id: FIXTURE_PASSKEY_CREDENTIAL,
    passkey_verified_at: approvedAt,
  };
}
