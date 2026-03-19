/**
 * Campaign Prompt Builder
 * Single entry point for AI planning prompt construction.
 * Constructs prompts from PlanningGenerationInput — ALL user-defined constraints
 * (frequency, platforms, content mix) are injected as hard rules, not hints.
 */

import { getProfile } from './companyProfileService';
import type { PlanningGenerationInput } from '../types/campaignPlanning';

export type PromptMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Platform-to-supported-content-types map for validation hints in the prompt. */
const PLATFORM_CONTENT_GUIDE: Record<string, string[]> = {
  youtube: ['video', 'short', 'reel'],
  tiktok: ['video', 'short', 'reel'],
  instagram: ['post', 'reel', 'story', 'carousel', 'image'],
  linkedin: ['post', 'article', 'carousel', 'video'],
  twitter: ['post', 'thread', 'tweet'],
  x: ['post', 'thread', 'tweet'],
  facebook: ['post', 'video', 'image', 'story'],
  pinterest: ['image', 'carousel'],
  reddit: ['post', 'article'],
  discord: ['post'],
  slack: ['post'],
};

/** Platforms that are video-first — topics going here must use video content type. */
const VIDEO_FIRST_PLATFORMS = new Set(['youtube', 'tiktok']);

function buildContextBlock(input: PlanningGenerationInput): string {
  const parts: string[] = [];
  const spine = input.idea_spine;
  const title = (spine?.refined_title ?? spine?.title ?? '').toString().trim();
  const desc = (spine?.refined_description ?? spine?.description ?? '').toString().trim();
  if (title) parts.push(`Campaign title: ${title}`);
  if (desc) parts.push(`Campaign description: ${desc}`);
  const dir = typeof input.campaign_direction === 'string' ? input.campaign_direction.trim() : '';
  if (dir) parts.push(`Campaign direction: ${dir}`);

  const strat = input.strategy_context;
  const duration = Number(strat?.duration_weeks) || 12;
  const platforms = Array.isArray(strat?.platforms) && strat.platforms.length > 0
    ? strat.platforms.map((p) => String(p).toLowerCase().trim())
    : ['linkedin'];
  const goal = (strat?.campaign_goal ?? '').toString().trim();
  const audience = Array.isArray(strat?.target_audience)
    ? (strat.target_audience as string[]).filter(Boolean).join(', ')
    : (strat?.target_audience ?? '').toString().trim();

  parts.push(`Duration: ${duration} weeks`);
  parts.push(`Platforms to use (ONLY these, no others): ${platforms.join(', ')}`);
  if (goal) parts.push(`Goal: ${goal}`);
  if (audience) parts.push(`Target audience: ${audience}`);

  // --- Strategic Focus (aspects + offerings selected by user from company profile) ---
  const selAspects = Array.isArray((strat as any)?.selected_aspects)
    ? ((strat as any).selected_aspects as string[]).filter(Boolean)
    : [];
  const selOfferings = Array.isArray((strat as any)?.selected_offerings)
    ? ((strat as any).selected_offerings as string[]).filter(Boolean)
    : [];
  if (selAspects.length > 0) {
    parts.push(`Strategic focus areas: ${selAspects.join(', ')}`);
    parts.push('Align content topics and messaging to these focus areas throughout the campaign.');
  }
  if (selOfferings.length > 0) {
    const offeringLabels = selOfferings.map((o) => (o.includes(':') ? o.split(':').slice(1).join(':').trim() : o));
    parts.push(`Specific offerings to highlight: ${offeringLabels.join(', ')}`);
    parts.push('Ensure these offerings are prominently featured in relevant content pieces.');
  }

  // --- Account Context (influences planning behavior) ---
  if (input.account_context) {
    const ctx = input.account_context;
    parts.push(`\nAccount Context (use this to tailor planning strategy):`);
    parts.push(`  Maturity Stage: ${ctx.maturityStage} (${ctx.overallScore}/100 overall score)`);
    parts.push(`  Platform Performance:`);
    ctx.platforms.forEach(p => {
      const audienceTerm = p.platform === 'linkedin' ? 'connections' : p.platform === 'youtube' ? 'subscribers' : p.platform === 'reddit' ? 'members' : 'followers';
      parts.push(`    ${p.platform}: ${p.followers.toLocaleString()} ${audienceTerm}, ${p.engagementRate}% engagement`);
    });
    if (ctx.recommendations.length > 0) {
      parts.push(`  Key Recommendations: ${ctx.recommendations.slice(0, 3).join(', ')}`);
    }
    parts.push(`  Tailor content strategy and pacing to account maturity level. ${ctx.maturityStage === 'NEW' ? 'Focus on awareness and engagement building.' : ctx.maturityStage === 'GROWING' ? 'Balance awareness with conversion opportunities.' : 'Optimize for high-value conversions and retention.'}`);
  }

  // --- Previous Campaign Intelligence (feed-forward — richer when full context available) ---
  const pcc = input.previous_campaign_context;
  const ppi = input.previous_performance_insights;

  // Use full campaign context when available; fall back to standalone performance insights
  if (pcc && (pcc.validation || pcc.paid_recommendation || pcc.performance_insights)) {
    parts.push('\nPrevious Campaign Intelligence (use this to make this campaign smarter):');

    // What the plan looked like
    if (pcc.validation) {
      const v = pcc.validation;
      parts.push(`  Plan quality: ${v.confidenceScore}/100 confidence (risk: ${v.riskLevel})`);
      if (v.issues.length > 0) {
        parts.push('  Plan issues to avoid repeating:');
        v.issues.slice(0, 3).forEach((i) => parts.push(`    - ${i}`));
      }
      if (v.suggestions.length > 0) {
        parts.push('  Plan improvements already identified:');
        v.suggestions.slice(0, 2).forEach((s) => parts.push(`    → ${s}`));
      }
    }

    // What the paid decision was
    if (pcc.paid_recommendation) {
      const pr = pcc.paid_recommendation;
      parts.push(`  Paid amplification: ${pr.overallRecommendation}`);
      if (pr.reasoning.length > 0) {
        parts.push(`    Reason: ${pr.reasoning[0]}`);
      }
    }

    // What execution actually delivered
    if (pcc.performance_insights) {
      const pi = pcc.performance_insights;
      if (pi.issues.length > 0) {
        parts.push('  Execution issues (what failed — do not repeat):');
        pi.issues.slice(0, 3).forEach((i) => parts.push(`    ✗ ${i}`));
      }
      if (pi.opportunities.length > 0) {
        parts.push('  Execution wins (what worked — amplify these):');
        pi.opportunities.slice(0, 2).forEach((o) => parts.push(`    ✓ ${o}`));
      }
      if (pi.recommendations.length > 0) {
        parts.push('  Carry-forward recommendations:');
        pi.recommendations.slice(0, 3).forEach((r) => parts.push(`    → ${r}`));
      }
    }

    if (pcc.captured_at) {
      const age = Math.round((Date.now() - new Date(pcc.captured_at).getTime()) / 86400000);
      parts.push(`  (Context from ${age} day(s) ago)`);
    }
  } else if (ppi && (ppi.issues.length > 0 || ppi.opportunities.length > 0)) {
    // Fallback: standalone performance insights only
    parts.push('\nPrevious Campaign Learnings (incorporate — do NOT repeat past mistakes):');
    if (ppi.issues.length > 0) {
      parts.push('  Issues to avoid repeating:');
      ppi.issues.slice(0, 3).forEach((i) => parts.push(`    - ${i}`));
    }
    if (ppi.opportunities.length > 0) {
      parts.push('  Patterns to amplify:');
      ppi.opportunities.slice(0, 2).forEach((o) => parts.push(`    + ${o}`));
    }
    if (ppi.recommendations.length > 0) {
      parts.push('  Recommended adjustments:');
      ppi.recommendations.slice(0, 3).forEach((r) => parts.push(`    → ${r}`));
    }
  }

  // --- Posting frequency (user-defined, MUST be followed exactly) ---
  const freq = strat?.posting_frequency;
  if (freq && typeof freq === 'object' && Object.keys(freq).length > 0) {
    const freqLines = Object.entries(freq)
      .filter(([, v]) => Number(v) > 0)
      .map(([p, v]) => `  ${p}: ${v} posts/week`);
    if (freqLines.length > 0) {
      parts.push(`\nPosting frequency (MUST match exactly in platform_allocation each week):\n${freqLines.join('\n')}`);
    }
  }

  // --- Content mix (user-defined) ---
  const mix = strat?.content_mix;
  if (mix && typeof mix === 'object' && Object.keys(mix).length > 0) {
    const mixLines = Object.entries(mix)
      .filter(([, v]) => Number(v) > 0)
      .map(([ct, v]) => `  ${ct}: ${v} per week`);
    if (mixLines.length > 0) {
      parts.push(`\nContent type mix (MUST follow):\n${mixLines.join('\n')}`);
    }
  }

  // --- Platform-content requests (most specific user input — take priority over mix) ---
  const pcr = input.platform_content_requests;
  if (pcr && typeof pcr === 'object' && Object.keys(pcr).length > 0) {
    const pcrLines: string[] = [];
    for (const [plat, typeCounts] of Object.entries(pcr)) {
      if (typeCounts && typeof typeCounts === 'object') {
        for (const [ct, count] of Object.entries(typeCounts as Record<string, number>)) {
          if (Number(count) > 0) {
            pcrLines.push(`  ${plat} → ${ct}: ${count}/week`);
          }
        }
      }
    }
    if (pcrLines.length > 0) {
      parts.push(`\nExact platform-content schedule (highest priority — override content_type_mix if they conflict):\n${pcrLines.join('\n')}`);
    }
  }

  // --- Platform content-type guide ---
  const platformGuideLines = platforms
    .map((p) => {
      const types = PLATFORM_CONTENT_GUIDE[p];
      return types ? `  ${p}: supports ${types.join(', ')}` : null;
    })
    .filter(Boolean);
  if (platformGuideLines.length > 0) {
    parts.push(`\nPlatform content-type compatibility (DO NOT assign incompatible types):\n${platformGuideLines.join('\n')}`);
  }

  return parts.join('\n');
}

/**
 * Build AI planning prompt from input.
 * All user constraints (platforms, frequency, content mix) are injected as hard rules.
 * Includes repair_instruction when present.
 */
export async function buildCampaignPlanningPrompt(
  input: PlanningGenerationInput
): Promise<PromptMessage[]> {
  const message = buildContextBlock(input) || 'Generate a campaign plan.';
  let companyContext = '';
  if (input.companyId && typeof input.companyId === 'string') {
    try {
      const profile = await getProfile(input.companyId, { autoRefine: false, languageRefine: false });
      if (profile) {
        const p = profile as Record<string, unknown>;
        const items: string[] = [];
        if (p.name) items.push(`Company: ${String(p.name)}`);
        if (p.industry) items.push(`Industry: ${String(p.industry)}`);
        if (p.target_audience) items.push(`Target audience: ${String(p.target_audience)}`);
        if (p.key_messages) items.push(`Key messages: ${String(p.key_messages)}`);
        if (items.length > 0) {
          companyContext = '\n\nCompany context:\n' + items.join('\n');
        }
      }
    } catch {
      // continue without company context
    }
  }

  const repairBlock =
    input.repair_instruction && input.repair_instruction.trim().length > 0
      ? `\n\nREPAIR INSTRUCTION: ${input.repair_instruction.trim()}`
      : '';

  const systemPrompt = `You are a campaign planner. Generate a detailed campaign plan strictly following the user's platform, frequency, and content type settings.

HARD RULES (never violate):
1. platform_allocation MUST exactly match the posting frequency the user specified. If the user says "linkedin: 3", use "linkedin": 3 every week.
2. Only use platforms listed under "Platforms to use". Never add platforms not listed.
3. content_type_mix MUST only include content types supported by the chosen platforms.
4. YouTube and TikTok only support video/short/reel — never assign post/article/thread to them.
5. A topic must NEVER appear on the same platform more than once across the ENTIRE CAMPAIGN (all weeks combined). Not just within a week — across ALL weeks. If "Topic A" was on LinkedIn in Week 2, it can NEVER go to LinkedIn again in any other week.
6. If a topic is repurposed across platforms, each platform gets a DIFFERENT content type appropriate for that platform. Example: LinkedIn gets "post", YouTube gets "video". Never assign the same content type to the same topic on the same platform more than once.
7. total_weekly_content_count = sum of unique content pieces (not total postings — shared content counts as 1 piece).
8. topics_to_cover must be distinct topics, not repetitions of the same idea. A topic title used in Week 3 must NOT appear again in Week 5, 6, or any other week.
9. Maintain thematic consistency across weeks — each week builds on the previous.
10. When Account Context is provided, tailor the planning strategy to the account's maturity level:
    - NEW accounts (low scores): Focus on awareness-building, engagement, and community growth. Use simpler content, educational topics, and soft CTAs.
    - GROWING accounts (medium scores): Balance awareness with conversion opportunities. Include thought leadership and product education.
    - MATURE accounts (high scores): Optimize for conversions, retention, and high-value actions. Use advanced content and direct CTAs.

OUTPUT FORMAT:
Output ONLY the plan wrapped in BEGIN_12WEEK_PLAN and END_12WEEK_PLAN.
Each week must have: week, phase_label, primary_objective, platform_allocation, content_type_mix, topics_to_cover, cta_type ("None"|"Soft CTA"|"Hard CTA"|"Conversion"), total_weekly_content_count, weekly_kpi_focus.

After END_12WEEK_PLAN, add:
\`\`\`recommendations
{"recommended_goal": "<Brand Awareness|Lead Generation|Product Education|Product Launch|Community Growth|Customer Retention|Thought Leadership|Event Promotion>", "recommended_audience": ["<B2B Marketers|Founders / Entrepreneurs|Marketing Leaders|Sales Teams|Product Managers|Developers|General Consumers>"]}
\`\`\``;

  const userContent = `Generate a campaign plan based on the following. Follow all platform, frequency, and content type constraints exactly.\n\n${message}${companyContext}${repairBlock}`;

  return [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userContent },
  ];
}
