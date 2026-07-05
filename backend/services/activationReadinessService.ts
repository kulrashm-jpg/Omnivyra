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

// ── "Once = forever" latch ────────────────────────────────────────────────────
//
// The three checks read live state, so disconnecting an integration (CMS delete,
// GA4 disconnect) or deleting lead records would normally drop the check back to
// undone. The activation capability, once demonstrated, is permanent — so each
// check that is ever satisfied is latched into a durable per-company flag and
// OR-ed back into the live signal. Stored under company_profiles.report_settings
// .activation_latch (an existing JSONB column — no migration). Fully fail-soft:
// any read/write error degrades to pure live-state behavior.

type ActivationLatch = { cms?: boolean; analytics?: boolean; leads?: boolean };

export interface ActivationLiveState { cms: boolean; analytics: boolean; leads: boolean }
export interface ActivationLatchResolution {
  cmsDone: boolean;
  analyticsDone: boolean;
  leadsDone: boolean;
  nextLatch: ActivationLatch;
  changed: boolean;
}

/**
 * Pure latch resolution: a check that is live-done OR was ever latched reads done,
 * and any check newly satisfied live is added to the latch (changed=true triggers a
 * one-time persist). Steady state (already latched) returns changed=false.
 */
export function resolveActivationLatch(
  live: ActivationLiveState,
  latch: ActivationLatch,
): ActivationLatchResolution {
  const nextLatch: ActivationLatch = { ...latch };
  let changed = false;
  if (live.cms && latch.cms !== true) { nextLatch.cms = true; changed = true; }
  if (live.analytics && latch.analytics !== true) { nextLatch.analytics = true; changed = true; }
  if (live.leads && latch.leads !== true) { nextLatch.leads = true; changed = true; }
  return {
    cmsDone: live.cms || latch.cms === true,
    analyticsDone: live.analytics || latch.analytics === true,
    leadsDone: live.leads || latch.leads === true,
    nextLatch,
    changed,
  };
}

async function readActivationLatch(
  companyId: string,
): Promise<{ latch: ActivationLatch; settings: Record<string, unknown> }> {
  try {
    const { data } = (await (ownedDbTable('company_profiles')
      .select('report_settings')
      .eq('company_id', companyId)
      .maybeSingle() as unknown as Promise<{ data: { report_settings?: unknown } | null }>));
    const settings =
      data?.report_settings && typeof data.report_settings === 'object'
        ? (data.report_settings as Record<string, unknown>)
        : {};
    const raw = settings.activation_latch;
    const latch: ActivationLatch = raw && typeof raw === 'object' ? (raw as ActivationLatch) : {};
    return { latch, settings };
  } catch {
    return { latch: {}, settings: {} };
  }
}

async function persistActivationLatch(
  companyId: string,
  settings: Record<string, unknown>,
  nextLatch: ActivationLatch,
): Promise<void> {
  try {
    const merged = { ...settings, activation_latch: nextLatch };
    await (ownedDbTable('company_profiles')
      .update({ report_settings: merged })
      .eq('company_id', companyId) as unknown as Promise<unknown>);
  } catch {
    // Latch persistence must never break the readiness read.
  }
}

export async function buildActivationReadiness(companyId: string): Promise<ActivationReadiness> {
  const cmsProviders = listCmsProviders();
  const [latchState, cmsConnected, ga4Connected, leadWebhook, forms, landingPages, leadCount] = await Promise.all([
    readActivationLatch(companyId),
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

  const liveCms = cmsConnected > 0;
  const liveGa4 = ga4Connected > 0;
  const liveLeads = leadWebhook > 0 || forms > 0 || landingPages > 0 || leadCount > 0;

  // Latch: a check that has ever been satisfied stays satisfied.
  const { cmsDone, analyticsDone: ga4Done, leadsDone, nextLatch, changed } = resolveActivationLatch(
    { cms: liveCms, analytics: liveGa4, leads: liveLeads },
    latchState.latch,
  );

  // Persist any newly-earned latch exactly once (guarded — steady state writes
  // nothing). Fire-and-forget so it never delays or breaks the read.
  if (changed) {
    void persistActivationLatch(companyId, latchState.settings, nextLatch);
  }

  const checks: ActivationCheck[] = [
    {
      id: 'cms',
      label: 'Connect a CMS or blog',
      done: cmsDone,
      detail: liveCms
        ? 'A CMS integration is connected.'
        : cmsDone
          ? 'A CMS integration was connected — capability proven.'
          : 'No CMS integration is connected yet.',
      nextActionHref: '/website-setup',
      nextActionLabel: cmsDone ? 'Manage integrations' : 'Connect a CMS',
    },
    {
      id: 'analytics',
      label: 'Connect Google Analytics (GA4)',
      done: ga4Done,
      detail: liveGa4
        ? 'GA4 is connected — blog views and traffic sources will populate as data ingests.'
        : ga4Done
          ? 'GA4 was connected — capability proven.'
          : 'Connect GA4 to see views and traffic sources per blog.',
      nextActionHref: '/api/analytics/connect/google',
      nextActionLabel: ga4Done ? 'Reconnect' : 'Connect GA4',
    },
    {
      id: 'leads',
      label: 'Configure a lead source',
      done: leadsDone,
      detail: liveLeads
        ? 'At least one lead source is wired.'
        : leadsDone
          ? 'A lead source was configured — capability proven.'
          : 'Wire a form, landing page, webhook, or capture SDK.',
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
