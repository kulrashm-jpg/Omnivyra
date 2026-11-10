/**
 * GD-4 ordering postcondition (replayed): after the full migration chain is
 * applied in filename order, the security-gated function bodies are the ones
 * that run. See unit/migrationFunctionOrderSecurity for the static check and
 * the negative control.
 *
 *   - advance_execution_plan carries the not_before floor (20270127000000);
 *   - claim_community_ai_browser_command carries the approval-evidence CAS
 *     (20270126000001), which supersedes the human-approval gate of
 *     20270120000010.
 */
import { db } from './setup';

const bodies = async (fn: string): Promise<string[]> =>
  (await db.query(
    `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [fn],
  )).rows.map((r: { prosrc: string }) => r.prosrc);

describe('replayed function bodies keep their security gates', () => {
  it('advance_execution_plan: exactly one overload, with the not_before floor', async () => {
    const b = await bodies('advance_execution_plan');
    expect(b).toHaveLength(1);
    expect(b[0]).toContain('not_before');
  });

  it('claim_community_ai_browser_command: exactly one overload, with the approval-evidence check', async () => {
    const b = await bodies('claim_community_ai_browser_command');
    expect(b).toHaveLength(1);
    expect(b[0]).toContain('community_action_approval_evidence_code');
  });
});
