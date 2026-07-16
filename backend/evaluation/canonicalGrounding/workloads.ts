/**
 * RF-3A — supported grounding-consumer workloads.
 * Each workload declares the grounding fields its prompt consumes; the harness
 * projects a comparable prompt from those fields so the Legacy vs Canonical diff
 * isolates the grounding effect (the same projection is applied to both arms).
 * These projections are EVALUATION scaffolding — they do not import or alter any
 * production prompt-assembly code.
 */
import type { WorkloadDef } from './types';

export const WORKLOADS: WorkloadDef[] = [
  { key: 'campaign_planning', label: 'AI Campaign Planning',
    fields: ['name', 'industry', 'ideal_customer_profile', 'target_audience', 'growth_priorities', 'unique_value'] },
  { key: 'content_generation', label: 'Content Generation',
    fields: ['name', 'products_services', 'brand_voice', 'content_themes', 'target_audience', 'pain_symptoms'] },
  { key: 'bolt', label: 'BOLT Execution',
    fields: ['name', 'products_services', 'content_themes', 'growth_priorities', 'target_audience'] },
  { key: 'platform_variants', label: 'Platform Variants',
    fields: ['brand_voice', 'content_themes', 'unique_value'] },
  { key: 'reports', label: 'Reports',
    fields: ['name', 'industry', 'competitive_advantages', 'brand_positioning', 'growth_priorities'] },
  { key: 'brief_suggestions', label: 'Brief Suggestions', additive: true,
    fields: ['products_services', 'unique_value', 'ideal_customer_profile', 'industry'] },
  { key: 'website_intelligence', label: 'Website Intelligence',
    fields: ['name', 'industry', 'unique_value', 'brand_positioning'] },
  { key: 'company_profile', label: 'Company Profile Generation',
    fields: ['name', 'industry', 'products_services', 'ideal_customer_profile', 'unique_value', 'brand_positioning'] },
  { key: 'strategic_mix', label: 'Strategic Mix',
    fields: ['content_themes', 'growth_priorities', 'competitive_advantages'] },
  { key: 'intelligent_mix', label: 'Intelligent Mix',
    fields: ['content_themes', 'target_audience', 'products_services'] },
  { key: 'prompt_builders', label: 'Prompt Builders',
    fields: ['name', 'industry', 'brand_voice', 'unique_value', 'target_audience'] },
  { key: 'campaign_execution', label: 'Campaign Execution',
    fields: ['name', 'products_services', 'growth_priorities', 'ideal_customer_profile'] },
  { key: 'creator', label: 'Creator',
    fields: ['name', 'brand_voice', 'content_themes', 'products_services'] },
];

/** Project a deterministic prompt from a grounding record for one workload.
 *  Empty fields are omitted (mirrors real `.filter(Boolean)` prompt assembly). */
export function projectPrompt(workload: WorkloadDef, grounding: Record<string, unknown>, additiveBlock?: string): string {
  const lines: string[] = [`# ${workload.label}`];
  for (const f of workload.fields) {
    const v = grounding[f];
    const text = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : v == null ? '' : String(v);
    if (text && text.trim()) lines.push(`${f}: ${text.trim()}`);
  }
  if (workload.additive && additiveBlock && additiveBlock.trim()) {
    lines.push(`Company facts (ground every suggestion in these):\n${additiveBlock.trim()}`);
  }
  return lines.join('\n');
}
