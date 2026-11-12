/**
 * KNOWN-DEFECT FIXTURE for scripts/ci/check-floating-promises.js. NEVER CALLED; never import this.
 *
 * It holds one write that never executes: a voided PostgREST builder (`void ownedDbTable(...).update(...)`
 * builds the request and discards it unsent). The gate refuses to run unless its rule flags the line
 * marked below. That pins the two config facts the rule depends on:
 *   - checkThenables: true and ignoreVoid: false (without either, this line is not flagged);
 *   - tsconfig.backend.json in the project list (this path is in the backend program only; under the
 *     root tsconfig the file is "not found" and unanalysed, which the gate treats as a failure).
 * The gate's scan EXCLUDES this directory, so the fixture is never counted as a real hit.
 */
import { ownedDbTable } from '../db/writeOwner';

export function knownDefectNeverCalled(id: string): void {
  // FLOATING-PROMISE-FIXTURE: the gate's self-check expects the rule to report THIS statement.
  void ownedDbTable('lint_fixture_never_written').update({ touched: true }).eq('id', id);
}
