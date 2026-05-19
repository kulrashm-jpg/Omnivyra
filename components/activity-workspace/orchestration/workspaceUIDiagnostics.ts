/**
 * workspaceUIDiagnostics — Phase-2 Step-28 (client, read-only).
 *
 * Never throws. Distinct namespace from the Step-27 server-side
 * workspace diagnostics.
 *
 * NOTE: repo has no `frontend/` root; per the Step-20 precedent this UI
 * authority layer is created under the existing workspace component tree
 * so it is actually reachable instead of dead code.
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export const workspaceUIDiagnostics = {
  authoritative: (p: Record<string, unknown>) => log('AUTHORITATIVE_WORKSPACE_UI', p),
  projection: (p: Record<string, unknown>) => log('WORKSPACE_UI_PROJECTION', p),
  fallback: (p: Record<string, unknown>) => log('WORKSPACE_UI_FALLBACK', p),
  rollback: (p: Record<string, unknown>) => log('WORKSPACE_UI_ROLLBACK', p),
  diff: (p: Record<string, unknown>) => log('WORKSPACE_UI_DIFF', p),
  aiAsset: (p: Record<string, unknown>) => log('WORKSPACE_UI_AI_ASSET', p),
};
