/**
 * Activation readiness — deterministic, simple, three-check.
 *
 * Activated when:
 *   - ≥1 CMS integration is connected (status='connected', type in CMS providers)
 *   - ≥1 GA4 analytics integration is configured (analytics_integrations row)
 *   - ≥1 lead source exists (an active lead_webhook integration OR any
 *     registered form/landing-page record OR at least one inbound lead)
 *
 * No scoring, no maturity model. Just three booleans + tiny "next step" hints.
 */
import { ownedDbTable } from '../db/writeOwner';
import { listCmsProviders } from './cms/registry';

export interface ActivationCheck {
  id: 'cms' | 'analytics' | 'leads';
  label: string;
  done: boolean;
  detail: string;
  nextActionHref: string;
  nextActionLabel: string;
}

export interface ActivationReadiness {
  companyId: string;
  generatedAt: string;
  activated: boolean;
  checks: ActivationCheck[];
}

async function safeCount(promise: Promise<{ data: unknown; error?: unknown }>): Promise<number> {
  try {
    const { data } = await promise;
    return Array.isArray(data) ? data.length : 0;
  } catch { return 0; }
}

export async function buildActivationReadiness(companyId: string): Promise<ActivationReadiness> {
  const cmsProviders = listCmsProviders();
  const [cmsConnected, ga4Connected, leadWebhook, forms, landingPages, leadCount] = await Promise.all([
    safeCount(
      ownedDbTable('company_integrations')
        .select('id')
        .eq('company_id', companyId)
        .eq('status', 'connected')
        .in('type', cmsProviders as string[])
        .limit(1) as unknown as Promise<{ data: unknown }>,
    ),
    safeCount(
      ownedDbTable('analytics_integrations')
        .select('id')
        .eq('company_id', companyId)
        // Canonical analytics_integrations.provider value for GA4 is 'GA4' (see
        // analyticsIntegrationService GA4_PROVIDER). 'google_analytics' belongs
        // to analytics_provider_config (a different table), so it never matched
        // here and ga4Done was always false even when GA4 was connected.
        .eq('provider', 'GA4')
        .limit(1) as unknown as Promise<{ data: unknown }>,
    ),
    safeCount(
      ownedDbTable('company_integrations')
        .select('id')
        .eq('company_id', companyId)
        .eq('type', 'lead_webhook')
        .eq('status', 'connected')
        .limit(1) as unknown as Promise<{ data: unknown }>,
    ),
    safeCount(
      ownedDbTable('forms')
        .select('id')
        .eq('company_id', companyId)
        .limit(1) as unknown as Promise<{ data: unknown }>,
    ),
    safeCount(
      ownedDbTable('landing_pages')
        .select('id')
        .eq('company_id', companyId)
        .limit(1) as unknown as Promise<{ data: unknown }>,
    ),
    safeCount(
      ownedDbTable('leads')
        .select('id')
        .eq('company_id', companyId)
        .limit(1) as unknown as Promise<{ data: unknown }>,
    ),
  ]);

  const cmsDone = cmsConnected > 0;
  const ga4Done = ga4Connected > 0;
  const leadsDone = leadWebhook > 0 || forms > 0 || landingPages > 0 || leadCount > 0;

  const checks: ActivationCheck[] = [
    {
      id: 'cms',
      label: 'Connect a CMS or blog',
      done: cmsDone,
      detail: cmsDone ? 'A CMS integration is connected.' : 'No CMS integration is connected yet.',
      nextActionHref: '/website-setup',
      nextActionLabel: cmsDone ? 'Manage integrations' : 'Connect a CMS',
    },
    {
      id: 'analytics',
      label: 'Connect Google Analytics (GA4)',
      done: ga4Done,
      detail: ga4Done ? 'GA4 is connected — blog views and traffic sources will populate as data ingests.' : 'Connect GA4 to see views and traffic sources per blog.',
      nextActionHref: '/api/analytics/connect/google',
      nextActionLabel: ga4Done ? 'Reconnect' : 'Connect GA4',
    },
    {
      id: 'leads',
      label: 'Configure a lead source',
      done: leadsDone,
      detail: leadsDone ? 'At least one lead source is wired.' : 'Wire a form, landing page, webhook, or capture SDK.',
      nextActionHref: '/lead-capture',
      nextActionLabel: leadsDone ? 'Manage lead capture' : 'Configure lead capture',
    },
  ];

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    activated: checks.every((c) => c.done),
    checks,
  };
}
