/**
 * Avoid-recent novelty picks (follow-up to "looks inspire, every generation is
 * new", owner 2026-10-25).
 *
 * Before a render builds its novelty plan, read the last few creator assets'
 * recorded `novelty.picks` for the SAME company and the SAME look, so this
 * generation's primary picks (setting, composition, palette direction) step
 * past what the user has just seen.
 *
 * Best-effort and read-only:
 *   - one tenant-scoped SELECT on the existing `creator_assets` table
 *     (company_id filter always applied; no writes, no new tables);
 *   - time-boxed; any error, timeout, missing company or missing look → `{}`
 *     (no avoidance — the plan is exactly what it was before this module).
 */

import { ownedDbTable } from '../../db/writeOwner';
import { getVisualStyle } from '../../../lib/creator-outcomes/creatorVisualStyleRegistry';

export const RECENT_NOVELTY_LIMIT = 5;
export const RECENT_NOVELTY_TIMEOUT_MS = 750;

/** Recent picks per novelty key ('scene', 'composition', 'palette', …). */
export type NoveltyAvoid = Record<string, string[]>;

type TableFn = (table: string) => any;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function loadRecentNoveltyPicks(input: {
  companyId: string | null | undefined;
  lookId: string | null | undefined;
  limit?: number;
  timeoutMs?: number;
  /** Injection seam for tests; defaults to the owned DB table seam. */
  table?: TableFn;
}): Promise<NoveltyAvoid> {
  const companyId = typeof input.companyId === 'string' ? input.companyId.trim() : '';
  const lookId = getVisualStyle(input.lookId ?? null)?.id ?? null;
  if (!companyId || !lookId) return {};
  const limit = Math.max(1, Math.min(10, Math.floor(input.limit ?? RECENT_NOVELTY_LIMIT)));
  const timeoutMs = Math.max(50, Math.floor(input.timeoutMs ?? RECENT_NOVELTY_TIMEOUT_MS));
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const query = (input.table ?? ownedDbTable)('creator_assets')
      .select('novelty:metadata->novelty')
      .eq('company_id', companyId)
      .eq('metadata->novelty->>look_id', lookId)
      .order('created_at', { ascending: false })
      .limit(limit);
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      if (timer && typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref();
    });
    const result = await Promise.race([Promise.resolve(query), timeout]) as { data?: unknown; error?: unknown } | null;
    if (!result || result.error || !Array.isArray(result.data)) return {};
    const out: NoveltyAvoid = {};
    for (const row of result.data as unknown[]) {
      const picks = obj(obj(obj(row).novelty).picks);
      for (const [key, value] of Object.entries(picks)) {
        if (typeof value !== 'string' || !value || value.length > 200) continue;
        const list = out[key] ?? (out[key] = []);
        if (!list.includes(value) && list.length < 10) list.push(value);
      }
    }
    return out;
  } catch {
    return {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sets `media_bundle.metadata.novelty_avoid` once per render payload (in place,
 * next to `novelty_seed`). A payload that already carries it (the fix loop's
 * re-render, a reproduction) keeps it, so retries see the same avoid list.
 */
export async function attachRecentNoveltyAvoid(
  assetPayload: Record<string, unknown>,
  companyId: string | null | undefined,
  deps: { load?: typeof loadRecentNoveltyPicks } = {},
): Promise<void> {
  try {
    const bundle = obj(assetPayload.media_bundle);
    const rawMeta = bundle.metadata;
    // Only write into a real metadata object (pinNoveltySeed guarantees one).
    if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) return;
    const meta = rawMeta as Record<string, unknown>;
    if (meta.novelty_avoid && typeof meta.novelty_avoid === 'object') return;
    const guided = obj(meta.guided_creative ?? obj(meta.creator_card).guided_creative);
    const lookId = typeof guided.visual_direction_id === 'string' ? guided.visual_direction_id : null;
    if (!companyId || !getVisualStyle(lookId)) return;
    meta.novelty_avoid = await (deps.load ?? loadRecentNoveltyPicks)({ companyId, lookId });
  } catch {
    // Fail-open: no avoidance.
  }
}
