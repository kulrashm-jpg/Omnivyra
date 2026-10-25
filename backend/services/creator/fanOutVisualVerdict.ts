/**
 * PR4 publish gate (dependency-free, safe to import statically): the asset's OWN post-render visual verdict for the fan-out
 * response projection, or null when the render carried none (e.g. it was
 * queued). A null verdict makes the asset "not assessed" downstream, which
 * blocks publishing until it has been checked.
 */
export function fanOutAssetVisualVerdict(
  asset: { result?: { output?: unknown } | null },
): { passed: boolean; failures: unknown[]; slideCount?: number } | null {
  const output = (asset.result?.output ?? null) as { asset_payload?: { media_bundle?: { metadata?: Record<string, unknown> } } } | null;
  const vv = output?.asset_payload?.media_bundle?.metadata?.visual_validation;
  if (!vv || typeof vv !== 'object' || Array.isArray(vv)) return null;
  const v = vv as Record<string, unknown>;
  if (typeof v.passed !== 'boolean') return null;
  return {
    passed: v.passed,
    failures: Array.isArray(v.failures) ? v.failures : [],
    ...(typeof v.slideCount === 'number' ? { slideCount: v.slideCount } : {}),
  };
}
