/**
 * workspaceRenderDiagnostics — Phase-2 Step-29 (client, read-only).
 * Render-authority observability. Never throws.
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export const workspaceRenderDiagnostics = {
  authority: (p: Record<string, unknown>) => log('WORKSPACE_RENDER_AUTHORITY', p),
  fallback: (p: Record<string, unknown>) => log('WORKSPACE_RENDER_FALLBACK', p),
  blockers: (p: Record<string, unknown>) => log('WORKSPACE_RENDER_BLOCKERS', p),
  scheduling: (p: Record<string, unknown>) => log('WORKSPACE_RENDER_SCHEDULING', p),
  aiAsset: (p: Record<string, unknown>) => log('WORKSPACE_RENDER_AI_ASSET', p),
  diff: (p: Record<string, unknown>) => log('WORKSPACE_RENDER_DIFF', p),
};
