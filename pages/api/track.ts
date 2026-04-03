
/**
 * POST /api/track
 *
 * Receives batched events from tracker.js v4.
 * Body: { events: TrackEvent[] }  OR single TrackEvent (backward-compat)
 *
 * Security: bot filter, account validation, domain validation.
 * New in v4: referrer_source, intent_meta stored per event.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../backend/db/supabaseClient';

const MAX_TIME  = 7200;
const MAX_BATCH = 20;
const BOT_RE    = /bot|crawl|spider|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|semrushbot|ahrefsbot|facebookexternalhit|ia_archiver/i;

interface TrackEvent {
  account_id?:      string;
  session_id?:      string;
  referrer_source?: string;
  url?:             string;
  event_type?:      string;
  time_on_page?:    number;
  scroll_depth?:    number;
  timestamp?:       string;
  intent_meta?:     Record<string, unknown> | null;
}

function extractHostname(raw: string): string {
  try {
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch { return raw.toLowerCase().replace(/^www\./, ''); }
}

function domainAllowed(origin: string, referer: string, allowed: string, allowSubs: boolean): boolean {
  const target = extractHostname(allowed);
  const check  = (h: string) => {
    if (!h) return false;
    const hn = extractHostname(h);
    return hn === target || (allowSubs && hn.endsWith('.' + target));
  };
  return check(origin) || check(referer);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (BOT_RE.test(String(req.headers['user-agent'] ?? ''))) return res.status(204).end();

  const body = req.body ?? {};
  const raw: TrackEvent[] = Array.isArray(body.events)
    ? (body.events as TrackEvent[]).slice(0, MAX_BATCH)
    : [body as TrackEvent];

  if (!raw.length) return res.status(204).end();

  const accountId = String(raw[0].account_id ?? body.account_id ?? '').trim().slice(0, 64);
  if (!accountId) return res.status(204).end();

  // Validate account
  const { data: company } = await supabase.from('company_profiles').select('company_id').eq('company_id', accountId).maybeSingle();
  if (!company) return res.status(204).end();

  // Domain validation
  const { data: settings } = await supabase.from('blog_intelligence_settings').select('allowed_domain, allow_subdomains').eq('company_id', accountId).maybeSingle();
  if (settings?.allowed_domain) {
    const origin  = String(req.headers.origin  ?? '');
    const referer = String(req.headers.referer ?? '');
    if (!domainAllowed(origin, referer, settings.allowed_domain, !!settings.allow_subdomains)) {
      return res.status(204).end();
    }
  }

  const ALLOWED_INTENT_TYPES = new Set(['pageview', 'pageleave', 'scroll_milestone', 'cta_click', 'link_click', 'copy', 'form_interaction']);

  const rows = raw.map((ev) => {
    const urlSlug = (() => { try { return new URL(String(ev.url ?? '/')).pathname; } catch { return '/'; } })();
    const evType  = typeof ev.event_type === 'string' && ALLOWED_INTENT_TYPES.has(ev.event_type) ? ev.event_type : 'pageview';
    return {
      account_id:      accountId,
      session_id:      typeof ev.session_id      === 'string' ? ev.session_id.slice(0, 64) : null,
      referrer_source: typeof ev.referrer_source === 'string' ? ev.referrer_source.slice(0, 100) : null,
      url_slug:        urlSlug,
      event_type:      evType,
      time_on_page:    Math.max(0, Math.min(parseInt(String(ev.time_on_page ?? 0), 10) || 0, MAX_TIME)),
      scroll_depth:    Math.max(0, Math.min(parseInt(String(ev.scroll_depth ?? 0), 10) || 0, 100)),
      intent_meta:     ev.intent_meta && typeof ev.intent_meta === 'object' ? ev.intent_meta : null,
      created_at:      (typeof ev.timestamp === 'string' && ev.timestamp) ? ev.timestamp : new Date().toISOString(),
    };
  });

  supabase.from('blog_analytics').insert(rows).then(() => {});
  return res.status(204).end();
}
