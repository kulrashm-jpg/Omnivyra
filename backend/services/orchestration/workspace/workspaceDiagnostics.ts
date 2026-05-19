/**
 * workspaceDiagnostics — Phase-2 Step-27 (server-side).
 * Structured single-line logs. Never throws.
 */

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export const workspaceDiagnostics = {
  authoritative: (c: Record<string, unknown>) => LOG('AUTHORITATIVE_WORKSPACE', c),
  projection: (c: Record<string, unknown>) => LOG('WORKSPACE_PROJECTION', c),
  fallback: (c: Record<string, unknown>) => LOG('WORKSPACE_FALLBACK', c),
  rollback: (c: Record<string, unknown>) => LOG('WORKSPACE_ROLLBACK', c),
  diff: (c: Record<string, unknown>) => LOG('WORKSPACE_DIFF', c),
  executionDiff: (c: Record<string, unknown>) => LOG('WORKSPACE_EXECUTION_DIFF', c),
  aiAsset: (c: Record<string, unknown>) => LOG('WORKSPACE_AI_ASSET', c),
};
