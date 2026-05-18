/**
 * Unified Orchestration Context — observability (Phase-2 Step-6).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const contextDiagnostics = {
  resolve: (c: Record<string, unknown>) => LOG('CONTEXT_RESOLVE', c),
  merge: (c: Record<string, unknown>) => LOG('CONTEXT_MERGE', c),
  fallback: (c: Record<string, unknown>) => LOG('CONTEXT_FALLBACK', c),
  hydrate: (c: Record<string, unknown>) => LOG('CONTEXT_HYDRATE', c),
  conflict: (c: Record<string, unknown>) => LOG('CONTEXT_CONFLICT', c),
  generation: (c: Record<string, unknown>) => LOG('GENERATION_CONTEXT', c),
};
