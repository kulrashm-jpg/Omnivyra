/**
 * Combined (Intelligent Mix) blueprint sanitizer.
 *
 * Text-mode BOLT runs pass through `sanitizeBoltPlanForTextOnly`, which strips
 * BOLT-excluded content types (blog / whitepaper / and ALSO media formats like
 * video/reel/carousel). Combined mode CANNOT use that — it must KEEP creator
 * media formats. But the AI planner sometimes still emits a genuinely
 * unsupported type (e.g. `blog`, which BOLT excludes as "too long"), and with no
 * sanitizer the commit-plan validator rejects the whole run with
 * BLUEPRINT_INVALID_CONTENT_TYPE.
 *
 * This sanitizer is the combined-mode equivalent: it converts ONLY content types
 * that are not valid for combined (neither a BOLT text format nor a creator
 * format) into the safe BOLT long-form text fallback `article`, and leaves every
 * valid text + creator format untouched. "Valid for combined" reuses the exact
 * predicate trio `validateBoltBlueprint.isKnownContentType` uses, so anything the
 * sanitizer keeps is guaranteed to pass validation.
 */

import { isSupportedTextFormat } from './formatGovernance';
import { isAutonomousRenderableFormat, isAttachmentRequiredFormat } from '../creatorGovernanceRegistry';

/** The safe fallback for an unsupported (typically long-form text) type. */
const FALLBACK_CONTENT_TYPE = 'article';

/** True iff `ct` is a content type a combined campaign can actually run
 *  (text format OR creator format) — mirrors validateBoltBlueprint's
 *  isKnownContentType. */
export function isCombinedValidContentType(ct: unknown): boolean {
  const c = String(ct ?? '').trim().toLowerCase();
  if (!c) return false;
  return isSupportedTextFormat(c) || isAutonomousRenderableFormat(c) || isAttachmentRequiredFormat(c);
}

/** Keep a valid combined content type; remap anything else to `article`. */
function remap(ct: unknown): string {
  const c = String(ct ?? '').trim();
  if (!c) return c;
  return isCombinedValidContentType(c) ? c : FALLBACK_CONTENT_TYPE;
}

/**
 * Sanitize a combined plan's weeks: remap unsupported content types to `article`
 * across the three places the validator/generator read them — activities/posts,
 * content_type_mix, and platform_content_breakdown — preserving counts and all
 * valid text + creator formats. Pure (clones; never mutates the input).
 */
export function sanitizeBoltPlanForCombined(weeks: unknown[]): unknown[] {
  if (!Array.isArray(weeks) || weeks.length === 0) return weeks;
  return weeks.map((w: any) => {
    if (!w || typeof w !== 'object') return w;
    const week = { ...w };

    // 1. activities / posts → { content_type | type | format }
    const actsKey = Array.isArray(week.activities) ? 'activities' : (Array.isArray(week.posts) ? 'posts' : null);
    if (actsKey) {
      week[actsKey] = week[actsKey].map((act: any) => {
        if (!act || typeof act !== 'object') return act;
        const a = { ...act };
        if (typeof a.content_type === 'string') a.content_type = remap(a.content_type);
        if (typeof a.type === 'string') a.type = remap(a.type);
        if (typeof a.format === 'string') a.format = remap(a.format);
        return a;
      });
    }

    // 2. content_type_mix → "N type" | "type"
    if (Array.isArray(week.content_type_mix)) {
      week.content_type_mix = week.content_type_mix.map((raw: any) => {
        const s = String(raw ?? '').trim();
        if (!s) return raw;
        const m = s.match(/^(\d+)\s+(.+)$/);
        return m ? `${m[1]} ${remap(m[2])}` : remap(s);
      });
    }

    // 3. platform_content_breakdown → { platform: [{ type | content_type }] }
    if (week.platform_content_breakdown && typeof week.platform_content_breakdown === 'object') {
      const pcb: Record<string, unknown> = {};
      for (const [platform, items] of Object.entries(week.platform_content_breakdown)) {
        pcb[platform] = Array.isArray(items)
          ? items.map((it: any) => {
              if (!it || typeof it !== 'object') return it;
              const o = { ...it };
              if (typeof o.type === 'string') o.type = remap(o.type);
              if (typeof o.content_type === 'string') o.content_type = remap(o.content_type);
              return o;
            })
          : items;
      }
      week.platform_content_breakdown = pcb;
    }

    return week;
  });
}
