/**
 * GenerationExecutionContext — observability (Phase-2 Step-8).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const generationDiagnostics = {
  authoritative: (c: Record<string, unknown>) => LOG('GENERATION_CONTEXT_AUTHORITATIVE', c),
  mode: (c: Record<string, unknown>) => LOG('GENERATION_MODE', c),
  route: (c: Record<string, unknown>) => LOG('GENERATION_ROUTE', c),
  readiness: (c: Record<string, unknown>) => LOG('GENERATION_READINESS', c),
  ownedContent: (c: Record<string, unknown>) => LOG('OWNED_CONTENT_GENERATION', c),
  fallback: (c: Record<string, unknown>) => LOG('GENERATION_FALLBACK', c),
  conflict: (c: Record<string, unknown>) => LOG('GENERATION_CONFLICT', c),
};
