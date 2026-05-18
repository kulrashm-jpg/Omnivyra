import { ownedDbTable } from '../db/writeOwner';
import { createWebsite, getWebsites, type Website } from './websiteService';
import { getWebsiteHealthSummary } from './integrationHealthService';

export type WebsiteSetupStep =
  | 'create_website'
  | 'verify_domain'
  | 'select_cms'
  | 'connect_cms'
  | 'install_tracking'
  | 'connect_forms'
  | 'summary';

const STEP_ORDER: WebsiteSetupStep[] = ['create_website', 'verify_domain', 'select_cms', 'connect_cms', 'install_tracking', 'connect_forms', 'summary'];

export async function getOrCreateWebsiteSetup(input: {
  companyId: string;
  userId?: string | null;
  websiteId?: string | null;
}): Promise<{ website: Website | null; progress: Record<string, unknown> | null }> {
  let website: Website | null = null;
  if (input.websiteId) {
    const { data } = await ownedDbTable('websites').select('*').eq('id', input.websiteId).eq('company_id', input.companyId).maybeSingle();
    website = data as Website | null;
  } else {
    const websites = await getWebsites(input.companyId);
    website = websites[0] ?? null;
  }

  if (!website) return { website: null, progress: null };

  const existing = await ownedDbTable('website_setup_progress')
    .select('*')
    .eq('website_id', website.id)
    .maybeSingle();
  if (existing.data) {
    await ownedDbTable('website_setup_progress')
      .update({
        health_summary: await getWebsiteHealthSummary(input.companyId, website.id),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.data.id);
    return { website, progress: existing.data as Record<string, unknown> };
  }

  const { data } = await ownedDbTable('website_setup_progress')
    .insert({
      company_id: input.companyId,
      website_id: website.id,
      current_step: nextStep(['create_website']),
      completed_steps: ['create_website'],
      health_summary: await getWebsiteHealthSummary(input.companyId, website.id),
      created_by: input.userId ?? null,
    })
    .select('*')
    .single();

  return { website, progress: data as Record<string, unknown> };
}

export async function createWebsiteFromSetup(input: {
  companyId: string;
  userId: string;
  name: string;
  canonicalUrl: string;
  cmsProvider?: string | null;
}): Promise<{ website: Website; progress: Record<string, unknown> }> {
  const website = await createWebsite({
    companyId: input.companyId,
    createdBy: input.userId,
    name: input.name,
    canonicalUrl: input.canonicalUrl,
    cmsProvider: input.cmsProvider ?? null,
    settings: { allow_unverified_ingestion: true },
  });
  const progress = await markWebsiteSetupStep({
    companyId: input.companyId,
    websiteId: website.id,
    step: 'create_website',
    state: { canonical_url: website.canonical_url },
  });
  return { website, progress };
}

export async function markWebsiteSetupStep(input: {
  companyId: string;
  websiteId: string;
  step: WebsiteSetupStep;
  state?: Record<string, unknown>;
  error?: string | null;
}): Promise<Record<string, unknown>> {
  const existing = await ownedDbTable('website_setup_progress')
    .select('*')
    .eq('website_id', input.websiteId)
    .maybeSingle();
  const completed = new Set<string>((existing.data as any)?.completed_steps ?? []);
  completed.add(input.step);
  const completedSteps = Array.from(completed);
  const state = {
    ...((existing.data as any)?.step_state ?? {}),
    [input.step]: input.state ?? {},
  };
  const currentStep = nextStep(completedSteps);

  const { data, error } = await ownedDbTable('website_setup_progress')
    .upsert({
      company_id: input.companyId,
      website_id: input.websiteId,
      current_step: currentStep,
      completed_steps: completedSteps,
      step_state: state,
      health_summary: await getWebsiteHealthSummary(input.companyId, input.websiteId),
      last_error: input.error ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'website_id' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

function nextStep(completed: string[]): WebsiteSetupStep {
  return STEP_ORDER.find((step) => !completed.includes(step)) ?? 'summary';
}
