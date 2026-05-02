// Reproduce the exact fetchGa4EventRows payload to capture the 400 body.
import { getValidAccessTokenForIntegration } from '../backend/services/analyticsIntegrationService';
import { supabase } from '../backend/db/supabaseClient';

async function main() {
  const { data: integrations } = await supabase
    .from('analytics_integrations').select('id, company_id').eq('provider', 'GA4').limit(1);
  const integration = integrations![0];
  const { data: prop } = await supabase
    .from('analytics_properties').select('property_id').eq('integration_id', integration.id).eq('is_active', true).single();
  const accessToken = await getValidAccessTokenForIntegration(integration.id);

  const propertyId = prop!.property_id;

  const payload = {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [
      { name: 'dateHourMinute' },
      { name: 'eventName' },
      { name: 'pagePath' },
      { name: 'sessionDefaultChannelGroup' },
      { name: 'sessionMedium' },
      { name: 'sessionCampaignName' },
      { name: 'country' },
      { name: 'region' },
      { name: 'city' },
      { name: 'deviceCategory' },
    ],
    metrics: [{ name: 'eventCount' }, { name: 'totalRevenue' }],
    limit: 10000,
  };

  console.log('dimensions count =', payload.dimensions.length);
  console.log('metrics count    =', payload.metrics.length);

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    },
  );
  console.log('HTTP', res.status);
  console.log(await res.text());
}

main().catch((e) => { console.error(e); process.exit(1); });
