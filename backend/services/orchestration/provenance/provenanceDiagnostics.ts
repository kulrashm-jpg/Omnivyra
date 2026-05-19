/**
 * Execution Provenance — observability (Phase-2 Step-16).
 */

const LOG = (tag: string, payload: Record<string, unknown>) =>
  // eslint-disable-next-line no-console
  console.log(`[${tag}]`, JSON.stringify(payload));

export const provenanceDiagnostics = {
  provenance: (c: Record<string, unknown>) => LOG('EXECUTION_PROVENANCE', c),
  write: (c: Record<string, unknown>) => LOG('PROVENANCE_WRITE', c),
  fallback: (c: Record<string, unknown>) => LOG('PROVENANCE_FALLBACK', c),
  rollback: (c: Record<string, unknown>) => LOG('PROVENANCE_ROLLBACK', c),
  hybrid: (c: Record<string, unknown>) => LOG('PROVENANCE_HYBRID', c),
  lineage: (c: Record<string, unknown>) => LOG('PROVENANCE_LINEAGE', c),
};
