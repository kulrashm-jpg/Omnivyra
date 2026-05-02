/**
 * extractionSchema.ts — Zod-based extraction schema helpers,
 * buildExtractionWithDefaults, computeMissingFields, computeConfidenceScore.
 */

import { z } from 'zod';
import { CompanyProfileExtractionOutput } from './types';
import { normalizeUrl } from './normalization';

// ─── Extraction schema helpers ────────────────────────────────────────────────

const extractionFieldSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  values: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  source: z.enum(['website', 'social', 'inferred', 'user', 'missing']),
  confidence: z.enum(['High', 'Medium', 'Low']),
});

const normalizeSourceValue = (
  value: any
): 'website' | 'social' | 'inferred' | 'user' | 'missing' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.startsWith('website')) return 'website';
  if (normalized.startsWith('social')) return 'social';
  if (normalized === 'inferred') return 'inferred';
  if (normalized === 'user') return 'user';
  if (normalized === 'missing') return 'missing';
  return 'missing';
};

export const normalizeExtractionOutput = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return raw;
  const normalizedInput = { ...raw };
  if (normalizedInput.industry_list && !normalizedInput.industry) normalizedInput.industry = normalizedInput.industry_list;
  if (normalizedInput.category_list && !normalizedInput.category) normalizedInput.category = normalizedInput.category_list;
  if (normalizedInput.geography_list && !normalizedInput.geography) normalizedInput.geography = normalizedInput.geography_list;
  if (normalizedInput.competitors_list && !normalizedInput.competitors) normalizedInput.competitors = normalizedInput.competitors_list;
  if (normalizedInput.content_themes_list && !normalizedInput.content_themes) normalizedInput.content_themes = normalizedInput.content_themes_list;
  if (normalizedInput.products_services_list && !normalizedInput.products_services) normalizedInput.products_services = normalizedInput.products_services_list;
  if (normalizedInput.target_audience_list && !normalizedInput.target_audience) normalizedInput.target_audience = normalizedInput.target_audience_list;
  if (normalizedInput.goals_list && !normalizedInput.goals) normalizedInput.goals = normalizedInput.goals_list;
  if (normalizedInput.brand_voice_list && !normalizedInput.brand_voice) normalizedInput.brand_voice = normalizedInput.brand_voice_list;

  const normalizeField = (field: any) => {
    if (!field || typeof field !== 'object') return field;
    const rawValue = field.value ?? field.values;
    const normalizedValue = Array.isArray(rawValue)
      ? rawValue.filter((item: any) => item !== null && item !== undefined && String(item).trim().length > 0)
      : rawValue;
    return {
      ...field,
      source: normalizeSourceValue(field.source),
      value: Array.isArray(normalizedValue) && normalizedValue.length === 0 ? null : normalizedValue,
    };
  };

  return {
    ...normalizedInput,
    company_name: normalizeField(normalizedInput.company_name),
    industry: normalizeField(normalizedInput.industry),
    category: normalizeField(normalizedInput.category),
    website_url: normalizeField(normalizedInput.website_url),
    social_profiles: raw.social_profiles
      ? {
          linkedin: normalizeField(raw.social_profiles.linkedin),
          facebook: normalizeField(raw.social_profiles.facebook),
          instagram: normalizeField(raw.social_profiles.instagram),
          x: normalizeField(raw.social_profiles.x),
          youtube: normalizeField(raw.social_profiles.youtube),
          tiktok: normalizeField(raw.social_profiles.tiktok),
          reddit: normalizeField(raw.social_profiles.reddit),
          pinterest: normalizeField(raw.social_profiles.pinterest),
          whatsapp: normalizeField(raw.social_profiles.whatsapp),
          blog: normalizeField(raw.social_profiles.blog),
        }
      : raw.social_profiles,
    geography: normalizeField(normalizedInput.geography),
    products_services: normalizeField(normalizedInput.products_services),
    target_audience: normalizeField(normalizedInput.target_audience),
    brand_voice: normalizeField(normalizedInput.brand_voice),
    goals: normalizeField(normalizedInput.goals),
    competitors: normalizeField(normalizedInput.competitors),
    unique_value_proposition: normalizeField(normalizedInput.unique_value_proposition),
    content_themes: normalizeField(normalizedInput.content_themes),
    missing_fields: Array.isArray(normalizedInput.missing_fields) ? normalizedInput.missing_fields : undefined,
  };
};

const defaultField = (): { value: null; source: 'missing'; confidence: 'Low' } => ({
  value: null,
  source: 'missing',
  confidence: 'Low',
});

type ExtractionField = { value?: string | string[] | null; values?: string | string[] | null; source: 'user' | 'social' | 'website' | 'inferred' | 'missing'; confidence: 'High' | 'Medium' | 'Low' };
const coerceField = (field: any): ExtractionField => {
  const normalized = normalizeExtractionOutput({ field }).field;
  const validation = extractionFieldSchema.safeParse(normalized);
  if (!validation.success) return defaultField();
  return validation.data as ExtractionField;
};

export const buildExtractionWithDefaults = (raw: any): CompanyProfileExtractionOutput => {
  const normalized = normalizeExtractionOutput(raw || {});
  const social = normalized.social_profiles || {};
  return {
    company_name: coerceField(normalized.company_name),
    industry: coerceField(normalized.industry),
    category: coerceField(normalized.category),
    website_url: coerceField(normalized.website_url),
    social_profiles: {
      linkedin: coerceField(social.linkedin),
      facebook: coerceField(social.facebook),
      instagram: coerceField(social.instagram),
      x: coerceField(social.x),
      youtube: coerceField(social.youtube),
      tiktok: coerceField(social.tiktok),
      reddit: coerceField(social.reddit),
      pinterest: coerceField(social.pinterest),
      whatsapp: coerceField(social.whatsapp),
      blog: coerceField(social.blog),
    },
    geography: coerceField(normalized.geography),
    products_services: coerceField(normalized.products_services),
    target_audience: coerceField(normalized.target_audience),
    brand_voice: coerceField(normalized.brand_voice),
    goals: coerceField(normalized.goals),
    competitors: coerceField(normalized.competitors),
    unique_value_proposition: coerceField(normalized.unique_value_proposition),
    content_themes: coerceField(normalized.content_themes),
    missing_fields: Array.isArray(normalized.missing_fields)
      ? normalized.missing_fields
      : [],
  };
};

export const computeMissingFields = (extraction: CompanyProfileExtractionOutput): string[] => {
  const fields: Array<[string, any]> = [
    ['company_name', extraction.company_name],
    ['industry', extraction.industry],
    ['category', extraction.category],
    ['website_url', extraction.website_url],
    ['social_profiles.linkedin', extraction.social_profiles?.linkedin],
    ['social_profiles.facebook', extraction.social_profiles?.facebook],
    ['social_profiles.instagram', extraction.social_profiles?.instagram],
    ['social_profiles.x', extraction.social_profiles?.x],
    ['social_profiles.youtube', extraction.social_profiles?.youtube],
    ['social_profiles.tiktok', extraction.social_profiles?.tiktok],
    ['social_profiles.reddit', extraction.social_profiles?.reddit],
    ['social_profiles.pinterest', extraction.social_profiles?.pinterest],
    ['social_profiles.whatsapp', extraction.social_profiles?.whatsapp],
    ['social_profiles.blog', extraction.social_profiles?.blog],
    ['geography', extraction.geography],
    ['products_services', extraction.products_services],
    ['target_audience', extraction.target_audience],
    ['brand_voice', extraction.brand_voice],
    ['goals', extraction.goals],
    ['competitors', extraction.competitors],
    ['unique_value_proposition', extraction.unique_value_proposition],
    ['content_themes', extraction.content_themes],
  ];

  return fields
    .filter(([, field]) => field?.source === 'missing' || field?.confidence === 'Low')
    .map(([name]) => name);
};

export const computeConfidenceScore = (extraction: CompanyProfileExtractionOutput): number => {
  const fields = [
    extraction.company_name,
    extraction.industry,
    extraction.category,
    extraction.website_url,
    extraction.geography,
    extraction.products_services,
    extraction.target_audience,
    extraction.brand_voice,
    extraction.goals,
    extraction.competitors,
    extraction.unique_value_proposition,
    extraction.content_themes,
  ];
  const total = fields.length;
  const extracted = fields.filter((field) => field && field.source !== 'missing').length;
  return Math.round((extracted / total) * 100);
};
