import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import type { TenantContext } from '../db/tenantTable';

export interface StrategyTemplate {
  id: string;
  user_id: string;
  company_id?: string | null;
  name: string;
  description?: string | null;
  objective: string;
  campaign_intent?: string | null;
  target_audience: string;
  key_platforms: string[];
  content_pillars?: Record<string, any> | null;
  content_frequency?: Record<string, any> | null;
  distribution_preferences?: Record<string, any> | null;
  tags?: string[] | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * What a NON-owner may see of a public template: its CONTENT only - never who published it (user_id) or which
 * company (company_id). Being public is evidence to see the template, not to learn its company (05 review). An
 * explicit column list, so a column a later migration adds is never published by default.
 */
export type PublicStrategyTemplate = Omit<StrategyTemplate, 'user_id' | 'company_id'>;
const PUBLIC_TEMPLATE_COLUMNS =
  'id, name, description, objective, campaign_intent, target_audience, key_platforms, content_pillars, '
  + 'content_frequency, distribution_preferences, tags, is_public, created_at, updated_at';
export function toPublicTemplateView(t: StrategyTemplate): PublicStrategyTemplate {
  const { user_id: _userId, company_id: _companyId, ...content } = t;
  return content;
}

const mapTemplate = (row: any): StrategyTemplate => ({
  id: row.id,
  user_id: row.user_id,
  company_id: row.company_id ?? null,
  name: row.name,
  description: row.description ?? null,
  objective: row.objective,
  campaign_intent: row.campaign_intent ?? null,
  target_audience: row.target_audience,
  key_platforms: row.key_platforms || [],
  content_pillars: row.content_pillars ?? null,
  content_frequency: row.content_frequency ?? null,
  distribution_preferences: row.distribution_preferences ?? null,
  tags: row.tags ?? [],
  is_public: row.is_public === true,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

/**
 * S2 (e1, 83 ruling 3): strategy templates are USER-owned (company_id optional) and public templates are
 * readable by every signed-in user by design - so these sites are allow-listed
 * (strategy-templates-user-owned-or-public), not tenant-scoped. Every read is the caller's own rows or
 * is_public rows; every write is pinned to the owner's user_id.
 * The visible set is two exact reads (own, public) - never an interpolated .or() filter string.
 */
export async function listStrategyTemplates(
  userId: string,
  options: { company_id?: string; is_public?: boolean; tags?: string[] } = {}
): Promise<Array<StrategyTemplate | PublicStrategyTemplate>> {
  const read = async (scope: 'own' | 'public') => {
    // Own rows in full; OTHER users' public rows as content only (never user_id / company_id).
    // cross-tenant: strategy-templates-user-owned-or-public
    let query = ownedDbTable('strategy_templates').select(scope === 'own' ? '*' : PUBLIC_TEMPLATE_COLUMNS);
    query = scope === 'own' ? query.eq('user_id', userId) : query.eq('is_public', true).neq('user_id', userId);
    if (options.company_id) query = query.eq('company_id', options.company_id);
    if (options.is_public !== undefined) query = query.eq('is_public', options.is_public);
    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) throw new Error(`Failed to list strategy templates: ${error.message}`);
    return (data || []) as Array<Record<string, any>>;
  };
  const [own, pub] = await Promise.all([read('own'), read('public')]);
  const rows: Array<StrategyTemplate | PublicStrategyTemplate> = [
    ...own.map(mapTemplate),
    ...pub.map((row) => toPublicTemplateView(mapTemplate(row))),
  ];
  return rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
}

export async function getStrategyTemplate(
  templateId: string
): Promise<StrategyTemplate | null> {
  // The ROUTE authorizes the returned row (owner, or public) before anything is disclosed.
  // cross-tenant: strategy-templates-user-owned-or-public
  const { data, error } = await ownedDbTable('strategy_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (error || !data) return null;
  return mapTemplate(data);
}

export async function createStrategyTemplate(
  userId: string,
  template: {
    name: string;
    description?: string | null;
    objective: string;
    campaign_intent?: string | null;
    target_audience: string;
    key_platforms: string[];
    content_pillars?: Record<string, any> | null;
    content_frequency?: Record<string, any> | null;
    distribution_preferences?: Record<string, any> | null;
    tags?: string[];
    is_public?: boolean;
  },
  /** The company to attach, ONLY as the context of the route's access check; absent = a personal template. */
  tenantCtx?: TenantContext,
): Promise<StrategyTemplate> {
  const companyId = tenantCtx ? tenantCtx.companyId : null;
  // user_id is the authenticated caller; company_id comes only from an access-checked TenantContext, never the body.
  // cross-tenant: strategy-templates-user-owned-or-public
  const { data, error } = await ownedDbTable('strategy_templates')
    .insert({
      user_id: userId,
      company_id: companyId,
      name: template.name,
      description: template.description ?? null,
      objective: template.objective,
      campaign_intent: template.campaign_intent ?? null,
      target_audience: template.target_audience,
      key_platforms: template.key_platforms,
      content_pillars: template.content_pillars ?? null,
      content_frequency: template.content_frequency ?? null,
      distribution_preferences: template.distribution_preferences ?? null,
      tags: template.tags ?? [],
      is_public: template.is_public ?? false,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create strategy template: ${error.message}`);
  }
  return mapTemplate(data);
}

export async function updateStrategyTemplate(
  templateId: string,
  ownerUserId: string,
  updates: {
    name?: string;
    description?: string | null;
    objective?: string;
    campaign_intent?: string | null;
    target_audience?: string;
    key_platforms?: string[];
    content_pillars?: Record<string, any> | null;
    content_frequency?: Record<string, any> | null;
    distribution_preferences?: Record<string, any> | null;
    tags?: string[];
    is_public?: boolean;
  }
): Promise<StrategyTemplate> {
  // Pinned to the owner: a template id alone never selects another user's row.
  // cross-tenant: strategy-templates-user-owned-or-public
  const { data, error } = await ownedDbTable('strategy_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', templateId)
    .eq('user_id', ownerUserId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update strategy template: ${error.message}`);
  }
  return mapTemplate(data);
}

export async function deleteStrategyTemplate(templateId: string, ownerUserId: string): Promise<void> {
  // Pinned to the owner: a template id alone never deletes another user's row.
  // cross-tenant: strategy-templates-user-owned-or-public
  const { error } = await ownedDbTable('strategy_templates').delete().eq('id', templateId).eq('user_id', ownerUserId);
  if (error) {
    throw new Error(`Failed to delete strategy template: ${error.message}`);
  }
}
