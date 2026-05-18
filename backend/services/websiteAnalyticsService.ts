import { ownedDbTable } from '../db/writeOwner';

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function aggregateWebsiteAnalytics(input: {
  websiteId?: string;
  day?: string;
  limit?: number;
} = {}): Promise<{ websites: number; events: number }> {
  const day = input.day ?? dayKey();
  const start = `${day}T00:00:00.000Z`;
  const end = `${day}T23:59:59.999Z`;
  let websiteQuery = ownedDbTable('websites').select('id, company_id').is('deleted_at', null);
  if (input.websiteId) websiteQuery = websiteQuery.eq('id', input.websiteId);
  const { data: websites, error } = await websiteQuery.limit(input.limit ?? 100);
  if (error) throw new Error(error.message);

  let eventCount = 0;
  for (const website of websites || []) {
    const eventsResult = await ownedDbTable('tracking_events')
      .select('*')
      .eq('website_id', website.id)
      .gte('occurred_at', start)
      .lte('occurred_at', end)
      .limit(10_000);
    const events = eventsResult.data || [];
    eventCount += events.length;
    const visitors = new Set(events.map((e: any) => e.anonymous_id).filter(Boolean));
    const pageViews = events.filter((e: any) => e.event_name === 'page_view').length;
    const ctaClicks = events.filter((e: any) => e.event_name === 'cta_click').length;
    const formStarts = events.filter((e: any) => e.event_name === 'form_start').length;
    const formSubmits = events.filter((e: any) => e.event_name === 'form_submit').length;
    const outboundClicks = events.filter((e: any) => e.event_name === 'outbound_click').length;

    const conversionsResult = await ownedDbTable('form_conversions')
      .select('id')
      .eq('website_id', website.id)
      .gte('converted_at', start)
      .lte('converted_at', end);

    await ownedDbTable('website_analytics_daily').upsert({
      company_id: website.company_id,
      website_id: website.id,
      day,
      page_views: pageViews,
      unique_visitors: visitors.size,
      cta_clicks: ctaClicks,
      form_starts: formStarts,
      form_submits: formSubmits,
      outbound_clicks: outboundClicks,
      conversions: conversionsResult.data?.length ?? 0,
      source_breakdown: sourceBreakdown(events),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'website_id,day' });

    await aggregatePages(website.id, website.company_id, day, events);
    await aggregateCampaigns(website.id, website.company_id, day, events, conversionsResult.data?.length ?? 0);
    await ownedDbTable('tracking_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('website_id', website.id)
      .gte('occurred_at', start)
      .lte('occurred_at', end)
      .is('processed_at', null);
  }

  return { websites: websites?.length ?? 0, events: eventCount };
}

async function aggregatePages(websiteId: string, companyId: string, day: string, events: any[]): Promise<void> {
  const byPage = new Map<string, any[]>();
  for (const event of events) {
    const page = event.page_url || event.metadata?.current_page;
    if (!page) continue;
    byPage.set(page, [...(byPage.get(page) || []), event]);
  }
  for (const [pageUrl, pageEvents] of byPage) {
    await ownedDbTable('page_analytics_daily').upsert({
      company_id: companyId,
      website_id: websiteId,
      day,
      page_url: pageUrl,
      page_views: pageEvents.filter((e) => e.event_name === 'page_view').length,
      unique_visitors: new Set(pageEvents.map((e) => e.anonymous_id).filter(Boolean)).size,
      cta_clicks: pageEvents.filter((e) => e.event_name === 'cta_click').length,
      conversions: pageEvents.filter((e) => e.event_name === 'form_submit').length,
      avg_scroll_depth: average(pageEvents.map((e) => Number(e.metadata?.scroll_depth || 0)).filter(Boolean)),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'website_id,day,page_url' });
  }
}

async function aggregateCampaigns(websiteId: string, companyId: string, day: string, events: any[], conversions: number): Promise<void> {
  const byCampaign = new Map<string, any[]>();
  for (const event of events) {
    const key = event.metadata?.utm_campaign || event.metadata?.utm_source || 'direct';
    byCampaign.set(String(key), [...(byCampaign.get(String(key)) || []), event]);
  }
  for (const [campaignKey, campaignEvents] of byCampaign) {
    await ownedDbTable('campaign_analytics_daily').upsert({
      company_id: companyId,
      website_id: websiteId,
      campaign_key: campaignKey,
      day,
      sessions: new Set(campaignEvents.map((e) => e.metadata?.session_id || e.visitor_session_id).filter(Boolean)).size,
      page_views: campaignEvents.filter((e) => e.event_name === 'page_view').length,
      cta_clicks: campaignEvents.filter((e) => e.event_name === 'cta_click').length,
      conversions: campaignKey === 'direct' ? conversions : campaignEvents.filter((e) => e.event_name === 'form_submit').length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,website_id,campaign_key,day' });
  }
}

function sourceBreakdown(events: any[]): Record<string, number> {
  return events.reduce((acc, event) => {
    const source = String(event.metadata?.utm_source || event.referrer || 'direct');
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
