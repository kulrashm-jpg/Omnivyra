import { ownedDbTable } from '../db/writeOwner';
import type { AttributionPayload } from './leadAttributionService';
import { buildTouchSnapshot } from './leadAttributionService';

export async function resolveVisitorSession(input: {
  companyId: string;
  websiteId?: string | null;
  attribution: AttributionPayload;
}): Promise<{ sessionId: string | null; firstTouch: Record<string, unknown>; lastTouch: Record<string, unknown> }> {
  const anonymousId = input.attribution.anonymous_id || input.attribution.session_id;
  const sessionKey = input.attribution.session_id || anonymousId;
  const lastTouch = input.attribution.last_touch ?? buildTouchSnapshot(input.attribution);
  if (!anonymousId || !sessionKey) return { sessionId: null, firstTouch: lastTouch, lastTouch };

  const existing = await ownedDbTable('visitor_sessions')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('anonymous_id', anonymousId)
    .eq('session_key', sessionKey)
    .maybeSingle();

  const firstTouch = (existing.data as any)?.first_touch && Object.keys((existing.data as any).first_touch).length > 0
    ? (existing.data as any).first_touch as Record<string, unknown>
    : input.attribution.first_touch ?? lastTouch;

  if (existing.data?.id) {
    await ownedDbTable('visitor_sessions')
      .update({
        website_id: input.websiteId ?? (existing.data as any).website_id ?? null,
        last_current_page: input.attribution.current_page ?? (existing.data as any).last_current_page ?? null,
        last_referrer: input.attribution.referrer ?? (existing.data as any).last_referrer ?? null,
        last_touch: lastTouch,
        consent_state: input.attribution.consent_state ?? (existing.data as any).consent_state ?? null,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.data.id);
    return { sessionId: existing.data.id as string, firstTouch, lastTouch };
  }

  const inserted = await ownedDbTable('visitor_sessions')
    .insert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      anonymous_id: anonymousId,
      session_key: sessionKey,
      first_landing_page: input.attribution.landing_page ?? input.attribution.current_page ?? null,
      last_current_page: input.attribution.current_page ?? null,
      first_referrer: input.attribution.referrer ?? null,
      last_referrer: input.attribution.referrer ?? null,
      utm_source: input.attribution.utm_source ?? null,
      utm_medium: input.attribution.utm_medium ?? null,
      utm_campaign: input.attribution.utm_campaign ?? null,
      utm_content: input.attribution.utm_content ?? null,
      utm_term: input.attribution.utm_term ?? null,
      first_touch: firstTouch,
      last_touch: lastTouch,
      consent_state: input.attribution.consent_state ?? null,
      metadata: input.attribution.metadata ?? {},
    })
    .select('id')
    .single();

  return { sessionId: inserted.data?.id ?? null, firstTouch, lastTouch };
}

export async function stitchSessionToLead(input: {
  leadId: string;
  companyId: string;
  visitorSessionId?: string | null;
  unifiedPersonId?: string | null;
}): Promise<void> {
  if (!input.visitorSessionId) return;
  await ownedDbTable('visitor_sessions')
    .update({
      unified_person_id: input.unifiedPersonId ?? null,
      stitched_at: new Date().toISOString(),
    })
    .eq('id', input.visitorSessionId)
    .eq('company_id', input.companyId);

  await ownedDbTable('campaign_touchpoints')
    .update({ lead_id: input.leadId })
    .eq('visitor_session_id', input.visitorSessionId)
    .eq('company_id', input.companyId)
    .is('lead_id', null);
}

export async function persistCampaignTouchpoint(input: {
  companyId: string;
  websiteId?: string | null;
  visitorSessionId?: string | null;
  leadId?: string | null;
  attribution: AttributionPayload;
  touchpointType: 'first_touch' | 'last_touch' | 'event' | 'conversion';
}): Promise<void> {
  const source = input.attribution.utm_source ?? input.attribution.referrer ?? 'direct';
  try {
    await ownedDbTable('campaign_touchpoints').insert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      visitor_session_id: input.visitorSessionId ?? null,
      lead_id: input.leadId ?? null,
      touchpoint_type: input.touchpointType,
      source,
      medium: input.attribution.utm_medium ?? null,
      campaign: input.attribution.utm_campaign ?? null,
      content: input.attribution.utm_content ?? null,
      term: input.attribution.utm_term ?? null,
      page_url: input.attribution.current_page ?? input.attribution.landing_page ?? null,
      asset_id: input.attribution.asset_id ?? null,
      variant_id: input.attribution.variant_id ?? null,
      creator_strategy_id: input.attribution.creator_strategy_id ?? null,
      metadata: { attribution: buildTouchSnapshot(input.attribution) },
    });
  } catch {
    // Campaign touchpoints are best-effort until the aggregation worker owns retries.
  }
}
