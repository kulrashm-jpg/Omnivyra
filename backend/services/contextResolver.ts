/**
 * Unified Context Mode System.
 * Resolves company context for Trend, Market Pulse, and Active Leads generators.
 * Influences generator prompts only. No scoring, lifecycle, or processor logic changes.
 */

import { buildCompanyMissionContext, formatMissionContextForPrompt } from './companyMissionContext';
import type { CompanyMissionContext } from './companyMissionContext';
import { getProfile } from './companyProfileService';

export type ContextMode = 'FULL' | 'FOCUSED' | 'NONE';

export type FocusModule =
  | 'TARGET_CUSTOMER'
  | 'PROBLEM_DOMAIN'
  | 'CAMPAIGN_PURPOSE'
  | 'OFFERINGS'
  | 'GEOGRAPHY'
  | 'PRICING';

export interface UnifiedContextInput {
  mode: ContextMode;
  selectedModules?: FocusModule[];
  additionalDirection?: string;
}

const PROBLEM_ENFORCEMENT_BLOCK = `

RESEARCH INTENT ENFORCEMENT:
ONLY surface insights where:
- A real user-facing problem is emerging
- There is friction, urgency, dissatisfaction, confusion
- There is visible demand for a solution

IGNORE:
- Events
- Announcements
- Celebrity chatter
- Generic awareness campaigns
- Non-problem signals
`;

function formatFocusedContext(ctx: CompanyMissionContext | null, modules: FocusModule[], profile: Awaited<ReturnType<typeof getProfile>>): string {
  if (!ctx && !profile) return '';
  const parts: string[] = [];

  if (modules.includes('TARGET_CUSTOMER') && ctx) {
    parts.push(`Target Persona: ${ctx.target_persona}`);
  }
  if (modules.includes('PROBLEM_DOMAIN') && ctx && ctx.core_problem_domains.length > 0) {
    parts.push(`Core Problem Domains:\n${ctx.core_problem_domains.map((d) => `- ${d}`).join('\n')}`);
  }
  if (modules.includes('CAMPAIGN_PURPOSE') && ctx) {
    parts.push(`Company Mission: ${ctx.mission_statement}`);
    if (ctx.opportunity_intent) parts.push(`Opportunity Intent: ${ctx.opportunity_intent}`);
    const sp = ctx.strategic_purpose;
    if (sp) {
      if (sp.primary_objective) parts.push(`Primary Objective: ${sp.primary_objective}`);
      if (sp.campaign_intent) parts.push(`Campaign Intent: ${sp.campaign_intent}`);
      if (sp.dominant_problem_domains?.length) {
        parts.push(`Dominant Problems: ${sp.dominant_problem_domains.join(', ')}`);
      }
    }
  }
  if (modules.includes('OFFERINGS') && ctx) {
    parts.push(`Transformation Outcome: ${ctx.transformation_outcome}`);
    if (profile?.products_services) parts.push(`Products/Services: ${profile.products_services}`);
    if (profile?.unique_value) parts.push(`Unique Value: ${profile.unique_value}`);
  }
  if (modules.includes('GEOGRAPHY') && ctx?.geography) {
    parts.push(`Geography: ${ctx.geography}`);
  }
  if (modules.includes('PRICING') && profile?.pricing_model) {
    parts.push(`Pricing Model: ${profile.pricing_model}`);
  }

  return parts.join('\n\n');
}

/**
 * Build unified context string for generator prompts.
 * Returns null when mode is NONE and additionalDirection is empty.
 */
export async function buildUnifiedContext(
  companyId: string,
  input: UnifiedContextInput
): Promise<string | null> {
  const { mode, selectedModules = [], additionalDirection } = input;

  if (mode === 'NONE') {
    const dir = (additionalDirection ?? '').trim();
    if (!dir) return null;
    return dir + PROBLEM_ENFORCEMENT_BLOCK;
  }

  const profile = await getProfile(companyId, { autoRefine: false, languageRefine: true });
  const missionContext = await buildCompanyMissionContext(companyId, 'FULL');

  let contextBlock = '';

  if (mode === 'FULL' && missionContext) {
    contextBlock = formatMissionContextForPrompt(missionContext);
  } else if (mode === 'FOCUSED') {
    contextBlock = formatFocusedContext(missionContext, selectedModules, profile);
  }

  if (contextBlock) {
    contextBlock += PROBLEM_ENFORCEMENT_BLOCK;
  }

  const dir = (additionalDirection ?? '').trim();
  if (dir) {
    contextBlock += (contextBlock ? '\n\n' : '') + `ADDITIONAL USER DIRECTION:\n${dir}`;
  }

  return contextBlock || null;
}
