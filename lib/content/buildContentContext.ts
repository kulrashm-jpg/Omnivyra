import type { CompanyContext } from '../blog/blogRunnerTypes';
import { getProfile } from '../../backend/services/companyProfileService';
import { buildFormattedStyleInstructions } from './writingStyleEngine';

export interface BuiltContentContext {
  companyProfile?: Record<string, unknown>;
  writingStyleInstructions?: string;
  companyContext: CompanyContext;
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayField(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = source[key];
  return Array.isArray(value) && value.length > 0
    ? value.filter((entry: unknown) => typeof entry === 'string') as string[]
    : undefined;
}

export async function buildContentContext(companyId: string): Promise<BuiltContentContext> {
  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  const companyProfile = profile ? profile as Record<string, unknown> : undefined;
  const writingStyleInstructions = profile ? buildFormattedStyleInstructions(profile) : undefined;
  const p = companyProfile || {};

  return {
    companyProfile,
    writingStyleInstructions,
    companyContext: {
      audience: stringField(p, 'target_audience') || stringField(p, 'audience'),
      brand_voice: stringField(p, 'brand_voice') || stringField(p, 'writing_style'),
      industry: stringField(p, 'industry'),
      writingStyleInstructions,
      companyName: stringField(p, 'name'),
      uniqueValue: stringField(p, 'unique_value'),
      competitiveAdvantages: stringField(p, 'competitive_advantages'),
      productsServices: stringField(p, 'products_services'),
      contentThemes: stringField(p, 'content_themes'),
      campaignFocus: stringField(p, 'campaign_focus'),
      growthPriorities: stringField(p, 'growth_priorities'),
      coreProblemStatement: stringField(p, 'core_problem_statement'),
      painSymptoms: stringArrayField(p, 'pain_symptoms'),
      authorityDomains: stringArrayField(p, 'authority_domains'),
      desiredTransformation: stringField(p, 'desired_transformation'),
      keyMessages: stringField(p, 'key_messages'),
      goals: stringField(p, 'goals'),
      geography: stringField(p, 'geography'),
    },
  };
}

