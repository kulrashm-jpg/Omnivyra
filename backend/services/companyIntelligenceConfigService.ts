/**
 * Company Intelligence Config Service
 * Phase-3: Company Intelligence Configuration Layer
 *
 * Manages company-level intelligence config for query builder placeholders.
 * Enforces plan limits (max_topics, max_competitors, etc.) on create.
 * Does NOT modify ingestion pipeline.
 */

import { supabase } from '../db/supabaseClient';

export const PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED';

export type ConfigItem = {
  id: string;
  company_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type TopicItem = ConfigItem & { topic: string };
export type CompetitorItem = ConfigItem & { competitor_name: string };
export type ProductItem = ConfigItem & { product_name: string };
export type RegionItem = ConfigItem & { region: string };
export type KeywordItem = ConfigItem & { keyword: string };

const GOVERNANCE_LIMIT_KEYS = {
  topics: 'max_topics',
  competitors: 'max_competitors',
  products: 'max_products',
  regions: 'max_regions',
  keywords: 'max_keywords',
} as const;

/**
 * Resolve plan limits for a company (treats company_id as organization_id for plan resolution).
 * Does NOT modify planResolutionService.
 */
async function getPlanLimit(
  companyId: string,
  limitKey: keyof typeof GOVERNANCE_LIMIT_KEYS
): Promise<number | null> {
  const { data: assignment } = await supabase
    .from('organization_plan_assignments')
    .select('plan_id')
    .eq('organization_id', companyId)
    .maybeSingle();
  if (!assignment?.plan_id) return null;

  const resourceKey = GOVERNANCE_LIMIT_KEYS[limitKey];
  const { data: limitRow } = await supabase
    .from('plan_limits')
    .select('limit_value')
    .eq('plan_id', assignment.plan_id)
    .eq('resource_key', resourceKey)
    .maybeSingle();
  const val = (limitRow as { limit_value?: number | null })?.limit_value;
  if (val === undefined || val === null) return null;
  return Number(val);
}

async function countEnabled(
  table: string,
  companyId: string
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('enabled', true);
  if (error) return 0;
  return count ?? 0;
}

async function checkPlanLimit(
  companyId: string,
  limitKey: keyof typeof GOVERNANCE_LIMIT_KEYS,
  table: string
): Promise<void> {
  const limit = await getPlanLimit(companyId, limitKey);
  if (limit == null) return; // no limit = unlimited
  const current = await countEnabled(table, companyId);
  if (current >= limit) {
    throw new Error(PLAN_LIMIT_EXCEEDED);
  }
}

// --- Topics ---

export async function getCompanyTopics(companyId: string): Promise<TopicItem[]> {
  const { data, error } = await supabase
    .from('company_intelligence_topics')
    .select('id, company_id, topic, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('topic');
  if (error) throw new Error(`getCompanyTopics failed: ${error.message}`);
  return (data ?? []) as TopicItem[];
}

export async function createTopic(companyId: string, topic: string): Promise<TopicItem> {
  await checkPlanLimit(companyId, 'topics', 'company_intelligence_topics');
  const { data, error } = await supabase
    .from('company_intelligence_topics')
    .insert({ company_id: companyId, topic: topic.trim(), enabled: true })
    .select('id, company_id, topic, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createTopic failed: ${error.message}`);
  return data as TopicItem;
}

export async function updateTopic(id: string, topic: string): Promise<TopicItem> {
  const { data, error } = await supabase
    .from('company_intelligence_topics')
    .update({ topic: topic.trim() })
    .eq('id', id)
    .select('id, company_id, topic, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`updateTopic failed: ${error.message}`);
  return data as TopicItem;
}

export async function setTopicEnabled(id: string, enabled: boolean): Promise<TopicItem> {
  const { data, error } = await supabase
    .from('company_intelligence_topics')
    .update({ enabled })
    .eq('id', id)
    .select('id, company_id, topic, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`setTopicEnabled failed: ${error.message}`);
  return data as TopicItem;
}

// --- Competitors ---

export async function getCompanyCompetitors(companyId: string): Promise<CompetitorItem[]> {
  const { data, error } = await supabase
    .from('company_intelligence_competitors')
    .select('id, company_id, competitor_name, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('competitor_name');
  if (error) throw new Error(`getCompanyCompetitors failed: ${error.message}`);
  return (data ?? []) as CompetitorItem[];
}

export async function createCompetitor(companyId: string, competitorName: string): Promise<CompetitorItem> {
  await checkPlanLimit(companyId, 'competitors', 'company_intelligence_competitors');
  const { data, error } = await supabase
    .from('company_intelligence_competitors')
    .insert({ company_id: companyId, competitor_name: competitorName.trim(), enabled: true })
    .select('id, company_id, competitor_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createCompetitor failed: ${error.message}`);
  return data as CompetitorItem;
}

export async function updateCompetitor(id: string, name: string): Promise<CompetitorItem> {
  const { data, error } = await supabase
    .from('company_intelligence_competitors')
    .update({ competitor_name: name.trim() })
    .eq('id', id)
    .select('id, company_id, competitor_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`updateCompetitor failed: ${error.message}`);
  return data as CompetitorItem;
}

export async function setCompetitorEnabled(id: string, enabled: boolean): Promise<CompetitorItem> {
  const { data, error } = await supabase
    .from('company_intelligence_competitors')
    .update({ enabled })
    .eq('id', id)
    .select('id, company_id, competitor_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`setCompetitorEnabled failed: ${error.message}`);
  return data as CompetitorItem;
}

// --- Products ---

export async function getCompanyProducts(companyId: string): Promise<ProductItem[]> {
  const { data, error } = await supabase
    .from('company_intelligence_products')
    .select('id, company_id, product_name, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('product_name');
  if (error) throw new Error(`getCompanyProducts failed: ${error.message}`);
  return (data ?? []) as ProductItem[];
}

export async function createProduct(companyId: string, productName: string): Promise<ProductItem> {
  await checkPlanLimit(companyId, 'products', 'company_intelligence_products');
  const { data, error } = await supabase
    .from('company_intelligence_products')
    .insert({ company_id: companyId, product_name: productName.trim(), enabled: true })
    .select('id, company_id, product_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createProduct failed: ${error.message}`);
  return data as ProductItem;
}

export async function updateProduct(id: string, name: string): Promise<ProductItem> {
  const { data, error } = await supabase
    .from('company_intelligence_products')
    .update({ product_name: name.trim() })
    .eq('id', id)
    .select('id, company_id, product_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`updateProduct failed: ${error.message}`);
  return data as ProductItem;
}

export async function setProductEnabled(id: string, enabled: boolean): Promise<ProductItem> {
  const { data, error } = await supabase
    .from('company_intelligence_products')
    .update({ enabled })
    .eq('id', id)
    .select('id, company_id, product_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`setProductEnabled failed: ${error.message}`);
  return data as ProductItem;
}

// --- Regions ---

export async function getCompanyRegions(companyId: string): Promise<RegionItem[]> {
  const { data, error } = await supabase
    .from('company_intelligence_regions')
    .select('id, company_id, region, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('region');
  if (error) throw new Error(`getCompanyRegions failed: ${error.message}`);
  return (data ?? []) as RegionItem[];
}

export async function createRegion(companyId: string, region: string): Promise<RegionItem> {
  await checkPlanLimit(companyId, 'regions', 'company_intelligence_regions');
  const { data, error } = await supabase
    .from('company_intelligence_regions')
    .insert({ company_id: companyId, region: region.trim(), enabled: true })
    .select('id, company_id, region, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createRegion failed: ${error.message}`);
  return data as RegionItem;
}

export async function updateRegion(id: string, region: string): Promise<RegionItem> {
  const { data, error } = await supabase
    .from('company_intelligence_regions')
    .update({ region: region.trim() })
    .eq('id', id)
    .select('id, company_id, region, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`updateRegion failed: ${error.message}`);
  return data as RegionItem;
}

export async function setRegionEnabled(id: string, enabled: boolean): Promise<RegionItem> {
  const { data, error } = await supabase
    .from('company_intelligence_regions')
    .update({ enabled })
    .eq('id', id)
    .select('id, company_id, region, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`setRegionEnabled failed: ${error.message}`);
  return data as RegionItem;
}

// --- Keywords ---

export async function getCompanyKeywords(companyId: string): Promise<KeywordItem[]> {
  const { data, error } = await supabase
    .from('company_intelligence_keywords')
    .select('id, company_id, keyword, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('keyword');
  if (error) throw new Error(`getCompanyKeywords failed: ${error.message}`);
  return (data ?? []) as KeywordItem[];
}

export async function createKeyword(companyId: string, keyword: string): Promise<KeywordItem> {
  await checkPlanLimit(companyId, 'keywords', 'company_intelligence_keywords');
  const { data, error } = await supabase
    .from('company_intelligence_keywords')
    .insert({ company_id: companyId, keyword: keyword.trim(), enabled: true })
    .select('id, company_id, keyword, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createKeyword failed: ${error.message}`);
  return data as KeywordItem;
}

export async function updateKeyword(id: string, keyword: string): Promise<KeywordItem> {
  const { data, error } = await supabase
    .from('company_intelligence_keywords')
    .update({ keyword: keyword.trim() })
    .eq('id', id)
    .select('id, company_id, keyword, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`updateKeyword failed: ${error.message}`);
  return data as KeywordItem;
}

export async function setKeywordEnabled(id: string, enabled: boolean): Promise<KeywordItem> {
  const { data, error } = await supabase
    .from('company_intelligence_keywords')
    .update({ enabled })
    .eq('id', id)
    .select('id, company_id, keyword, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`setKeywordEnabled failed: ${error.message}`);
  return data as KeywordItem;
}

// --- Query builder helpers (random selection for placeholder resolution) ---

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export async function getRandomTopic(companyId: string): Promise<string | null> {
  const items = await getCompanyTopics(companyId);
  const enabled = items.filter((i) => i.enabled);
  const picked = pickRandom(enabled);
  return picked?.topic ?? null;
}

export async function getRandomCompetitor(companyId: string): Promise<string | null> {
  const items = await getCompanyCompetitors(companyId);
  const enabled = items.filter((i) => i.enabled);
  const picked = pickRandom(enabled);
  return picked?.competitor_name ?? null;
}

export async function getRandomProduct(companyId: string): Promise<string | null> {
  const items = await getCompanyProducts(companyId);
  const enabled = items.filter((i) => i.enabled);
  const picked = pickRandom(enabled);
  return picked?.product_name ?? null;
}

export async function getRandomRegion(companyId: string): Promise<string | null> {
  const items = await getCompanyRegions(companyId);
  const enabled = items.filter((i) => i.enabled);
  const picked = pickRandom(enabled);
  return picked?.region ?? null;
}

export async function getRandomKeyword(companyId: string): Promise<string | null> {
  const items = await getCompanyKeywords(companyId);
  const enabled = items.filter((i) => i.enabled);
  const picked = pickRandom(enabled);
  return picked?.keyword ?? null;
}
