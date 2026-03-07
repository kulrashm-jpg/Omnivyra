/**
 * Intelligence Query Builder
 * Expands query templates with placeholders into structured query params and runtime values.
 * Used by the intelligence polling worker only.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';

export type ExternalApiSourceLike = {
  id: string;
  query_params?: Record<string, unknown> | null;
};

export type QueryBuilderInput = {
  source: ExternalApiSourceLike;
  template?: string | null;
  companyId?: string | null;
  topic?: string | null;
  competitor?: string | null;
  product?: string | null;
  region?: string | null;
  keyword?: string | null;
};

export type QueryBuilderOutput = {
  queryParams: Record<string, string>;
  runtimeValues: Record<string, string>;
  queryHash: string;
};

const PLACEHOLDERS = ['topic', 'competitor', 'product', 'region', 'keyword'] as const;

function resolvePlaceholder(
  name: string,
  input: QueryBuilderInput
): string {
  const key = name.toLowerCase();
  if (key === 'topic') return (input.topic ?? '').trim();
  if (key === 'competitor') return (input.competitor ?? '').trim();
  if (key === 'product') return (input.product ?? '').trim();
  if (key === 'region') return (input.region ?? '').trim();
  if (key === 'keyword') return (input.keyword ?? '').trim();
  return '';
}

function expandTemplate(template: string, input: QueryBuilderInput): string {
  return template.replace(/\{\s*([a-zA-Z_]+)\s*\}/g, (_, name) => {
    return resolvePlaceholder(name, input) || '';
  }).trim();
}

function sortedEntries(obj: Record<string, string>): [string, string][] {
  return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
}

function computeQueryHash(queryParams: Record<string, string>, runtimeValues: Record<string, string>): string {
  const combined: Record<string, string> = { ...queryParams, ...runtimeValues };
  const sorted = Object.fromEntries(sortedEntries(combined));
  const raw = JSON.stringify(sorted);
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Load enabled query templates for API source (or global if api_source_id is null).
 */
async function loadTemplates(apiSourceId: string | null): Promise<{ template: string; category?: string }[]> {
  const query = supabase
    .from('intelligence_query_templates')
    .select('template, category')
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  try {
    const { data, error } = apiSourceId
      ? await query.or(`api_source_id.eq.${apiSourceId},api_source_id.is.null`)
      : await query.is('api_source_id', null);

    if (error) return [];
    return (data ?? []).map((r) => ({ template: r.template, category: r.category }));
  } catch {
    return [];
  }
}

/**
 * Expand query templates and produce query params + runtime values.
 * If no template provided, falls back to source.query_params.
 */
export async function expand(
  input: QueryBuilderInput
): Promise<QueryBuilderOutput> {
  const { source, template: explicitTemplate } = input;
  const baseParams = (source.query_params && typeof source.query_params === 'object')
    ? (source.query_params as Record<string, string>)
    : {};

  let queryParams: Record<string, string> = {};
  let runtimeValues: Record<string, string> = {};

  const topic = (input.topic ?? '').trim();
  const competitor = (input.competitor ?? '').trim();
  const product = (input.product ?? '').trim();
  const region = (input.region ?? '').trim();
  const keyword = (input.keyword ?? '').trim();

  if (explicitTemplate && explicitTemplate.trim()) {
    const expanded = expandTemplate(explicitTemplate.trim(), input);
    if (expanded) {
      queryParams.q = expanded;
      queryParams.query = expanded;
    }
    runtimeValues.topic = topic;
    runtimeValues.competitor = competitor;
    runtimeValues.product = product;
    runtimeValues.region = region;
    runtimeValues.keyword = keyword;
  } else {
    const templates = await loadTemplates(source.id);
    if (templates.length > 0) {
      const t = templates[0];
      const expanded = expandTemplate(t.template, input);
      if (expanded) {
        queryParams.q = expanded;
        queryParams.query = expanded;
      }
      runtimeValues.topic = topic;
      runtimeValues.competitor = competitor;
      runtimeValues.product = product;
      runtimeValues.region = region;
      runtimeValues.keyword = keyword;
    }
  }

  const mergedParams = { ...baseParams, ...queryParams };
  const mergedRuntime: Record<string, string> = { ...runtimeValues };
  Object.keys(mergedParams).forEach((k) => {
    const v = mergedParams[k];
    if (v !== undefined && v !== null) {
      mergedRuntime[k] = String(v).trim();
    }
  });

  const queryHash = computeQueryHash(mergedParams, mergedRuntime);

  return {
    queryParams: mergedParams,
    runtimeValues: mergedRuntime,
    queryHash,
  };
}
