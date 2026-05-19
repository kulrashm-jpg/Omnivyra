/**
 * aiAssetMutationDiagnostics — Phase-2 Step-22 (client, read-only logging).
 * Never throws. Distinct namespace from Step-20/21 preview logs.
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export const aiAssetMutationDiagnostics = {
  refresh: (p: Record<string, unknown>) => log('AI_ASSET_REFRESH', p),
  mutation: (p: Record<string, unknown>) => log('AI_ASSET_MUTATION', p),
  remove: (p: Record<string, unknown>) => log('AI_ASSET_REMOVE', p),
  restore: (p: Record<string, unknown>) => log('AI_ASSET_RESTORE', p),
  upload: (p: Record<string, unknown>) => log('AI_ASSET_UPLOAD', p),
  refreshFail: (p: Record<string, unknown>) => log('AI_ASSET_REFRESH_FAIL', p),
};
