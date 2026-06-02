import type { NextApiRequest, NextApiResponse } from 'next';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import { resolveVisitorSession, persistCampaignTouchpoint } from '../../../backend/services/attributionResolverService';
import { checkWebsiteOrigin, hashIp } from '../../../backend/services/websiteDomainEnforcementService';
import { checkInMemoryRateLimit, isLikelyBot } from '../../../backend/services/trackingRateLimitService';

type TrackingPayload = {
  website_id?: string;
  anonymous_id?: string;
  session_id?: string;
  batch_id?: string;
  events?: TrackingPayload[];
  event_id?: string;
  event_name?: string;
  event_type?: string;
  current_page?: string;
  landing_page?: string;
  referrer?: string;
  consent_state?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  // Creator identifiers as they arrive on the wire (omn_* link-param form),
  // plus the canonical names the attribution services consume.
  omn_asset_id?: string;
  omn_variant_id?: string;
  omn_strategy_id?: string;
  asset_id?: string | null;
  variant_id?: string | null;
  creator_strategy_id?: string | null;
  first_touch?: Record<string, unknown>;
  last_touch?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

function setCors(req: NextApiRequest, res: NextApiResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0]?.trim();
  const body = (req.body || {}) as TrackingPayload;
  const events = Array.isArray(body.events) ? body.events.slice(0, 25) : [body];
  const websiteId = body.website_id || events[0]?.website_id;
  const anonymousId = body.anonymous_id || events[0]?.anonymous_id;
  if (!websiteId || typeof websiteId !== 'string') return res.status(400).json({ error: 'website_id is required' });
  if (!anonymousId || typeof anonymousId !== 'string') return res.status(400).json({ error: 'anonymous_id is required' });

  const rate = checkInMemoryRateLimit(`${websiteId}:${ip || anonymousId}`, 240, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const { data: website, error: websiteError } = await ownedDbTable('websites')
    .select('*')
    .eq('id', websiteId)
    .is('deleted_at', null)
    .single();
  if (websiteError || !website) return res.status(404).json({ error: 'Website not found' });

  const enforcement = await checkWebsiteOrigin(website as any, typeof req.headers.origin === 'string' ? req.headers.origin : undefined);
  if (!enforcement.allowed) return res.status(403).json({ error: enforcement.message });

  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  const botFlag = isLikelyBot(userAgent);
  const accepted: string[] = [];

  for (const event of events) {
    const payload = { ...body, ...event, website_id: websiteId, anonymous_id: event.anonymous_id || anonymousId };
    // Normalize creator ids from the omn_* link-param form (current URL, else
    // the first/last-touch snapshot the tracker persisted) into the canonical
    // column names the attribution services write. Leaves utm_* + first/last
    // touch passthrough untouched.
    const ft = (payload.first_touch ?? {}) as Record<string, unknown>;
    const lt = (payload.last_touch ?? {}) as Record<string, unknown>;
    const pickCreatorId = (omnKey: string) =>
      (payload as any)[omnKey] ?? (lt[omnKey] as string | undefined) ?? (ft[omnKey] as string | undefined) ?? null;
    payload.asset_id = pickCreatorId('omn_asset_id');
    payload.variant_id = pickCreatorId('omn_variant_id');
    payload.creator_strategy_id = pickCreatorId('omn_strategy_id');
    const session = await resolveVisitorSession({
      companyId: website.company_id,
      websiteId: website.id,
      attribution: payload,
    });
    const eventName = String(payload.event_name || 'page_view').slice(0, 120);
    const dedupeKey = payload.event_id || `${payload.session_id || payload.anonymous_id}:${eventName}:${payload.current_page || ''}:${payload.properties?.timestamp || ''}`;
    const metadata = {
      ...(payload.properties ?? {}),
      event_type: payload.event_type || eventName,
      session_id: payload.session_id || payload.anonymous_id,
      utm_source: payload.utm_source ?? null,
      utm_medium: payload.utm_medium ?? null,
      utm_campaign: payload.utm_campaign ?? null,
      utm_content: payload.utm_content ?? null,
      utm_term: payload.utm_term ?? null,
      domain_enforcement: enforcement,
    };
    const insert = await ownedDbTable('tracking_events').insert({
      company_id: website.company_id,
      website_id: website.id,
      visitor_session_id: session.sessionId,
      anonymous_id: payload.anonymous_id,
      event_name: eventName,
      event_category: categoryForEvent(eventName),
      page_url: payload.current_page ?? null,
      referrer: payload.referrer ?? null,
      metadata,
      consent_state: payload.consent_state ?? 'unknown',
      dedupe_key: dedupeKey,
      batch_id: body.batch_id ?? null,
      user_agent: userAgent,
      ip_hash: hashIp(ip),
      bot_flag: botFlag,
    });
    if (!insert.error) accepted.push(eventName);

    if (payload.utm_campaign || payload.utm_source) {
      await persistCampaignTouchpoint({
        companyId: website.company_id,
        websiteId: website.id,
        visitorSessionId: session.sessionId,
        attribution: payload,
        touchpointType: eventName === 'page_view' ? 'first_touch' : 'event',
      });
    }
  }

  return res.status(202).json({ ok: true, accepted: accepted.length, events: accepted });
}

function categoryForEvent(eventName: string): 'navigation' | 'engagement' | 'conversion' | 'system' {
  if (eventName === 'page_view') return 'navigation';
  if (eventName === 'cta_click' || eventName === 'form_submit' || eventName === 'outbound_click') return 'conversion';
  return 'engagement';
}
