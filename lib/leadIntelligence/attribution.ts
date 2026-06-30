/**
 * Unified attribution contract builder.
 *
 * Maps a raw source record into the canonical attribution shape while GUARANTEEING
 * no attribution information is discarded: every raw key not explicitly mapped is
 * preserved verbatim under `sourceMetadata`.
 */

import type { CanonicalAttribution, CanonicalIdentityHints } from './types';

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') { const t = v.trim(); return t || null; }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

const first = (...vals: unknown[]): string | null => {
  for (const v of vals) { const s = str(v); if (s) return s; }
  return null;
};

/** Keys consumed into typed attribution fields — excluded from `sourceMetadata`. */
const MAPPED_KEYS = new Set([
  'source', 'originalSource', 'channel', 'medium', 'originalChannel',
  'campaign', 'utm_campaign', 'content', 'utm_content', 'contentText',
  'session', 'session_id', 'sessionId', 'journey', 'touchpoints', 'first_touch',
  'referrer', 'utm', 'utm_source', 'utm_medium', 'utm_term',
]);

export function buildAttributionContract(
  raw: Record<string, unknown>,
  identity: CanonicalIdentityHints,
): CanonicalAttribution {
  const utmObj = (raw.utm && typeof raw.utm === 'object' && !Array.isArray(raw.utm))
    ? (raw.utm as Record<string, unknown>)
    : {};

  const sourceMetadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!MAPPED_KEYS.has(k) && v !== undefined) sourceMetadata[k] = v;
  }

  return {
    originalSource: first(raw.source, raw.originalSource),
    originalChannel: first(raw.channel, raw.medium, raw.originalChannel),
    campaign: first(raw.campaign, raw.utm_campaign, utmObj.campaign),
    content: first(raw.content, raw.utm_content, utmObj.content, raw.contentText),
    session: first(raw.session_id, raw.sessionId, raw.session),
    journey: raw.journey ?? raw.touchpoints ?? raw.first_touch ?? null,
    referrer: first(raw.referrer),
    utm: {
      source: first(raw.utm_source, utmObj.source),
      medium: first(raw.utm_medium, utmObj.medium),
      campaign: first(raw.utm_campaign, utmObj.campaign),
      content: first(raw.utm_content, utmObj.content),
      term: first(raw.utm_term, utmObj.term),
    },
    identity,
    sourceMetadata,
  };
}
