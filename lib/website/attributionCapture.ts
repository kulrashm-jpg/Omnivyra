/**
 * Client-side attribution capture for the public lead-capture form.
 *
 * Reads UTM + identifier params from the URL, the referrer, and the tracker's
 * session id (sessionStorage `omn_session`, set by public/tracker.js), and persists
 * the FIRST touch (first referrer + first UTMs + landing page) in localStorage so it
 * survives navigation and same-origin returns. Cross-domain journeys (e.g. blog →
 * website) are preserved because the CTA carries the params on the URL, which are
 * captured here on landing.
 *
 * These values are ENRICHMENT only — the server re-derives/validates session +
 * attribution authoritatively (never trusts client identifiers).
 */

import { ensureVisitorIds, getJourneySummary } from './journeyIntelligence';

const FIRST_TOUCH_KEY = 'omn_first_touch';
const TRACKER_SESSION_KEY = 'omn_session';

interface FirstTouch {
  captured?: boolean;
  first_referrer?: string;
  landing_page?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

function readFirstTouch(): FirstTouch {
  try { return JSON.parse(localStorage.getItem(FIRST_TOUCH_KEY) || '{}') as FirstTouch; } catch { return {}; }
}

function readSessionId(): string {
  try { return sessionStorage.getItem(TRACKER_SESSION_KEY) || ''; } catch { return ''; }
}

/**
 * Capture (and persist first-touch once) the hidden attribution fields for a submission.
 *
 * INT-001 Phase 1: when no tracker minted `omn_session`, the ids are now
 * self-minted (consent-gated) so the server-side visitor-session spine engages
 * for OmniVyra's own marketing site; the client journey snapshot rides along
 * as `attribution.metadata.journey`. All previously returned fields are
 * unchanged — additions are strictly additive.
 */
export function captureAttribution(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const get = (...keys: string[]): string => {
    for (const k of keys) { const v = params.get(k); if (v) return v; }
    return '';
  };

  let first = readFirstTouch();
  if (!first.captured) {
    first = {
      captured: true,
      first_referrer: document.referrer || '',
      landing_page: window.location.href,
      utm_source: get('utm_source'),
      utm_medium: get('utm_medium'),
      utm_campaign: get('utm_campaign'),
      utm_content: get('utm_content'),
      utm_term: get('utm_term'),
    };
    try { localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(first)); } catch { /* storage disabled */ }
  }

  // Tracker-minted session wins AND keeps the legacy anonymous_id=session_id
  // aliasing; only the self-minted path (no tracker) uses the durable anon id.
  // Consent-denied visitors get '' exactly as before Phase 1.
  const trackerSession = readSessionId();
  const minted = ensureVisitorIds();
  const sessionId = trackerSession || minted.sessionId;
  const anonymousId = trackerSession || minted.anonymousId || sessionId;
  const journey = getJourneySummary();
  return {
    utm_source: get('utm_source') || first.utm_source || '',
    utm_medium: get('utm_medium') || first.utm_medium || '',
    utm_campaign: get('utm_campaign') || first.utm_campaign || '',
    utm_content: get('utm_content') || first.utm_content || '',
    utm_term: get('utm_term') || first.utm_term || '',
    referrer: document.referrer || '',
    first_referrer: first.first_referrer || '',
    landing_page: first.landing_page || window.location.href,
    current_page: window.location.href,
    session_id: sessionId,
    anonymous_id: anonymousId,
    journey_id: get('journey_id', 'jid'),
    campaign_id: get('campaign_id', 'cid'),
    content_id: get('content_id', 'coid'),
    asset_id: get('asset_id', 'omn_asset_id'),
    cta_id: get('cta_id', 'omn_cta_id'),
    form_id: get('form_id'),
    website_id: get('website_id', 'wid'),
    // INT-001 Phase 1 (additive): journey + click-id enrichment, nested where
    // the server's extractAttributionPayload picks up attribution.metadata.
    attribution: { metadata: { journey } },
  };
}
