// TEMPORARY — CI-GOVERNANCE-001 enforcement probe. Never merged.
// Deliberately violates the auth-integrity invariant (global company_id
// localStorage key) so exactly ONE required check fails, proving branch
// protection blocks the merge. Deleted with this branch.
export function probe(): string | null {
  return localStorage.getItem('selected_company_id');
}
