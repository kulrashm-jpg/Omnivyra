import { ownedDbTable } from '../db/writeOwner';
/**
 * Company Intelligence Config Service
 * Phase-3: Company Intelligence Configuration Layer
 *
 * Manages company-level intelligence config for query builder placeholders.
 * Enforces plan limits (max_topics, max_competitors, etc.) on create.
 * Does NOT modify ingestion pipeline.
 */

import { supabase } from '../db/supabaseClient';

import {
  buildCandidatesFromNames,
  extractCompetitiveContextFromProfile,
  getFinalCompetitors,
} from './competitorEngineService';
import type { CompanyProfile } from './companyProfile/types';

export const PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED';

/**
 * COMPANY-INTELLIGENCE-SEC-001.
 *
 * A mutation that names a row the AUTHORIZED company does not own is rejected
 * with this sentinel. The same sentinel is used whether the row belongs to
 * another tenant, does not exist, or is not a well-formed identifier, so the
 * response is not an existence oracle for another tenant's row ids.
 *
 * It is a distinct, distinguishable outcome — the route maps it to 404. A
 * rejected mutation must never look like a successful one to the caller, which
 * is what a bare `WHERE id = ? AND company_id = ?` UPDATE returning "0 rows
 * changed" would have done.
 */
export const RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND';

/**
 * `id` and `company_id` are both `uuid` (database/company_intelligence_config.sql).
 * A value that is not a uuid can never match a row, and comparing it in the
 * predicate raises 22P02 instead — the same deterministic-identity reasoning
 * TenantGuard.isDeterministicIdentityError applies. Rejecting it here keeps the
 * outcome deterministic AND keeps the mutation sink unreached.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * THE ownership predicate for this service.
 *
 * `companyId` is the company the ROUTE authorized (requireCompanyContext ->
 * enforceCompanyAccess -> assertTenantAccess). It is never `body.companyId`
 * taken on trust, and never the target row's own `company_id` — reading the
 * tenant back off the row being mutated authorizes nothing.
 *
 * The ownership read runs BEFORE any mutation or any other sink, so a rejected
 * request reaches no write and no downstream service at all. It is scoped by
 * `company_id` too, so a foreign row is not even read back.
 */
async function requireOwnedRow(
  table: string,
  companyId: string,
  id: string,
  label: string,
): Promise<void> {
  if (!isUuid(companyId) || !isUuid(id)) throw new Error(RESOURCE_NOT_FOUND);
  const { data, error } = await ownedDbTable(table)
    .select('id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new Error(`${label} failed: ${error.message}`);
  if (!data) throw new Error(RESOURCE_NOT_FOUND);
}

/**
 * Ownership-bound update: the row must already have been proven to belong to
 * `companyId`, and the UPDATE still carries the `company_id` predicate so the
 * write cannot land on another tenant's row between the check and the write.
 */
async function updateOwnedRow<T>(
  table: string,
  columns: string,
  companyId: string,
  id: string,
  patch: Record<string, unknown>,
  label: string,
): Promise<T> {
  await requireOwnedRow(table, companyId, id, label);
  const { data, error } = await ownedDbTable(table)
    .update(patch)
    .eq('id', id)
    .eq('company_id', companyId)
    .select(columns)
    .maybeSingle();
  if (error) throw new Error(`${label} failed: ${error.message}`);
  if (!data) throw new Error(RESOURCE_NOT_FOUND);
  return data as T;
}

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
  const { data: assignment } = await ownedDbTable('organization_plan_assignments')
    .select('plan_id')
    .eq('organization_id', companyId)
    .maybeSingle();
  if (!assignment?.plan_id) return null;

  const resourceKey = GOVERNANCE_LIMIT_KEYS[limitKey];
  const { data: limitRow } = await ownedDbTable('plan_limits')
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
  const { count, error } = await ownedDbTable(table)
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

async function loadCompetitiveContext(companyId: string) {
  const { data } = await ownedDbTable('company_profiles')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  return extractCompetitiveContextFromProfile((data ?? null) as CompanyProfile | null);
}

async function getValidatedCompetitors(companyId: string, names: string[]) {
  const context = await loadCompetitiveContext(companyId);
  return getFinalCompetitors({
    candidates: buildCandidatesFromNames(names, 'manual'),
    context,
    max: Math.max(1, names.length),
    useNetwork: true,
    companyId,
  });
}

async function getValidatedCompetitorNames(companyId: string, names: string[]): Promise<string[]> {
  const finalCompetitors = await getValidatedCompetitors(companyId, names);
  return finalCompetitors.map((competitor) => competitor.name);
}

async function requireValidatedCompetitorName(companyId: string, name: string): Promise<string> {
  const [validatedName] = await getValidatedCompetitorNames(companyId, [name]);
  if (!validatedName) {
    throw new Error('INVALID_COMPETITOR');
  }
  return validatedName;
}

function competitorLookupKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

// --- Topics ---

export async function getCompanyTopics(companyId: string): Promise<TopicItem[]> {
  const { data, error } = await ownedDbTable('company_intelligence_topics')
    .select('id, company_id, topic, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('topic');
  if (error) throw new Error(`getCompanyTopics failed: ${error.message}`);
  return (data ?? []) as TopicItem[];
}

export async function createTopic(companyId: string, topic: string): Promise<TopicItem> {
  await checkPlanLimit(companyId, 'topics', 'company_intelligence_topics');
  const { data, error } = await ownedDbTable('company_intelligence_topics')
    .insert({ company_id: companyId, topic: topic.trim(), enabled: true })
    .select('id, company_id, topic, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createTopic failed: ${error.message}`);
  return data as TopicItem;
}

const TOPIC_COLUMNS = 'id, company_id, topic, enabled, created_at, updated_at';

export async function updateTopic(companyId: string, id: string, topic: string): Promise<TopicItem> {
  return updateOwnedRow<TopicItem>(
    'company_intelligence_topics', TOPIC_COLUMNS, companyId, id,
    { topic: topic.trim() }, 'updateTopic',
  );
}

export async function setTopicEnabled(companyId: string, id: string, enabled: boolean): Promise<TopicItem> {
  return updateOwnedRow<TopicItem>(
    'company_intelligence_topics', TOPIC_COLUMNS, companyId, id,
    { enabled }, 'setTopicEnabled',
  );
}

// --- Competitors ---

export async function getCompanyCompetitors(companyId: string): Promise<CompetitorItem[]> {
  const { data, error } = await ownedDbTable('company_intelligence_competitors')
    .select('id, company_id, competitor_name, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('competitor_name');
  if (error) throw new Error(`getCompanyCompetitors failed: ${error.message}`);
  const rows = (data ?? []) as CompetitorItem[];
  const validatedCompetitors = await getValidatedCompetitors(
    companyId,
    rows.map((row) => row.competitor_name),
  );
  const validatedSet = new Set(validatedCompetitors.flatMap((competitor) => [
    competitorLookupKey(competitor.name),
    competitorLookupKey(competitor.domain),
  ]).filter(Boolean));
  return rows
    .filter((row) => validatedSet.has(competitorLookupKey(row.competitor_name)))
    .map((row) => {
      const canonical = validatedCompetitors.find((competitor) =>
        competitorLookupKey(competitor.name) === competitorLookupKey(row.competitor_name) ||
        competitorLookupKey(competitor.domain) === competitorLookupKey(row.competitor_name),
      )?.name;
      return canonical ? { ...row, competitor_name: canonical } : row;
    });
}

export async function createCompetitor(companyId: string, competitorName: string): Promise<CompetitorItem> {
  await checkPlanLimit(companyId, 'competitors', 'company_intelligence_competitors');
  const validatedName = await requireValidatedCompetitorName(companyId, competitorName);
  const { data, error } = await ownedDbTable('company_intelligence_competitors')
    .insert({ company_id: companyId, competitor_name: validatedName, enabled: true })
    .select('id, company_id, competitor_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createCompetitor failed: ${error.message}`);
  return data as CompetitorItem;
}

const COMPETITOR_COLUMNS = 'id, company_id, competitor_name, enabled, created_at, updated_at';

export async function updateCompetitor(companyId: string, id: string, name: string): Promise<CompetitorItem> {
  // Ownership is settled FIRST. The previous shape read the row's own
  // company_id and validated against THAT, which authorized nothing and made
  // the competitor-validation path (a network sink) reachable for a foreign
  // row. The authorized company now drives both the check and the validation.
  //
  // This check is deliberately not folded into updateOwnedRow's: it must run
  // BEFORE the validation call, and updateOwnedRow must keep its own so no
  // future caller can reach the write without one. One extra indexed
  // point-select on an admin PUT is the cost of that independence.
  await requireOwnedRow('company_intelligence_competitors', companyId, id, 'updateCompetitor');
  const validatedName = await requireValidatedCompetitorName(companyId, name);
  return updateOwnedRow<CompetitorItem>(
    'company_intelligence_competitors', COMPETITOR_COLUMNS, companyId, id,
    { competitor_name: validatedName }, 'updateCompetitor',
  );
}

export async function setCompetitorEnabled(companyId: string, id: string, enabled: boolean): Promise<CompetitorItem> {
  return updateOwnedRow<CompetitorItem>(
    'company_intelligence_competitors', COMPETITOR_COLUMNS, companyId, id,
    { enabled }, 'setCompetitorEnabled',
  );
}

// --- Products ---

export async function getCompanyProducts(companyId: string): Promise<ProductItem[]> {
  const { data, error } = await ownedDbTable('company_intelligence_products')
    .select('id, company_id, product_name, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('product_name');
  if (error) throw new Error(`getCompanyProducts failed: ${error.message}`);
  return (data ?? []) as ProductItem[];
}

export async function createProduct(companyId: string, productName: string): Promise<ProductItem> {
  await checkPlanLimit(companyId, 'products', 'company_intelligence_products');
  const { data, error } = await ownedDbTable('company_intelligence_products')
    .insert({ company_id: companyId, product_name: productName.trim(), enabled: true })
    .select('id, company_id, product_name, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createProduct failed: ${error.message}`);
  return data as ProductItem;
}

const PRODUCT_COLUMNS = 'id, company_id, product_name, enabled, created_at, updated_at';

export async function updateProduct(companyId: string, id: string, name: string): Promise<ProductItem> {
  return updateOwnedRow<ProductItem>(
    'company_intelligence_products', PRODUCT_COLUMNS, companyId, id,
    { product_name: name.trim() }, 'updateProduct',
  );
}

export async function setProductEnabled(companyId: string, id: string, enabled: boolean): Promise<ProductItem> {
  return updateOwnedRow<ProductItem>(
    'company_intelligence_products', PRODUCT_COLUMNS, companyId, id,
    { enabled }, 'setProductEnabled',
  );
}

// --- Regions ---

export async function getCompanyRegions(companyId: string): Promise<RegionItem[]> {
  const { data, error } = await ownedDbTable('company_intelligence_regions')
    .select('id, company_id, region, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('region');
  if (error) throw new Error(`getCompanyRegions failed: ${error.message}`);
  return (data ?? []) as RegionItem[];
}

export async function createRegion(companyId: string, region: string): Promise<RegionItem> {
  await checkPlanLimit(companyId, 'regions', 'company_intelligence_regions');
  const { data, error } = await ownedDbTable('company_intelligence_regions')
    .insert({ company_id: companyId, region: region.trim(), enabled: true })
    .select('id, company_id, region, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createRegion failed: ${error.message}`);
  return data as RegionItem;
}

const REGION_COLUMNS = 'id, company_id, region, enabled, created_at, updated_at';

export async function updateRegion(companyId: string, id: string, region: string): Promise<RegionItem> {
  return updateOwnedRow<RegionItem>(
    'company_intelligence_regions', REGION_COLUMNS, companyId, id,
    { region: region.trim() }, 'updateRegion',
  );
}

export async function setRegionEnabled(companyId: string, id: string, enabled: boolean): Promise<RegionItem> {
  return updateOwnedRow<RegionItem>(
    'company_intelligence_regions', REGION_COLUMNS, companyId, id,
    { enabled }, 'setRegionEnabled',
  );
}

// --- Keywords ---

export async function getCompanyKeywords(companyId: string): Promise<KeywordItem[]> {
  const { data, error } = await ownedDbTable('company_intelligence_keywords')
    .select('id, company_id, keyword, enabled, created_at, updated_at')
    .eq('company_id', companyId)
    .order('keyword');
  if (error) throw new Error(`getCompanyKeywords failed: ${error.message}`);
  return (data ?? []) as KeywordItem[];
}

export async function createKeyword(companyId: string, keyword: string): Promise<KeywordItem> {
  await checkPlanLimit(companyId, 'keywords', 'company_intelligence_keywords');
  const { data, error } = await ownedDbTable('company_intelligence_keywords')
    .insert({ company_id: companyId, keyword: keyword.trim(), enabled: true })
    .select('id, company_id, keyword, enabled, created_at, updated_at')
    .single();
  if (error) throw new Error(`createKeyword failed: ${error.message}`);
  return data as KeywordItem;
}

const KEYWORD_COLUMNS = 'id, company_id, keyword, enabled, created_at, updated_at';

export async function updateKeyword(companyId: string, id: string, keyword: string): Promise<KeywordItem> {
  return updateOwnedRow<KeywordItem>(
    'company_intelligence_keywords', KEYWORD_COLUMNS, companyId, id,
    { keyword: keyword.trim() }, 'updateKeyword',
  );
}

export async function setKeywordEnabled(companyId: string, id: string, enabled: boolean): Promise<KeywordItem> {
  return updateOwnedRow<KeywordItem>(
    'company_intelligence_keywords', KEYWORD_COLUMNS, companyId, id,
    { enabled }, 'setKeywordEnabled',
  );
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
