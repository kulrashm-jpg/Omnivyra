import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletion } from '../../../backend/services/aiGateway';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { buildCompanyKnowledgeGraph, buildKnowledgeGrounding } from '../../../backend/services/companyProfile/companyKnowledgeGraph';
import {
  orchestrateProfileConversation,
  isQuestionEligibleForOrchestration,
} from '../../../backend/services/companyProfile/profileConversationOrchestrator';
import { defineRolloutFlag, resolveRolloutSync } from '../../../lib/platform/rollout';

/**
 * CONVERSATION-INTELLIGENCE-001 Phase C — pilot rollout flag (default OFF).
 *
 * OFF  → this route behaves BYTE-IDENTICALLY to before: the AI-emitted
 *        nextQuestion is returned verbatim (the orchestrator is never invoked).
 * ON   → the canonical orchestrator gates question selection: any AI-emitted
 *        question the knowledge graph marks INELIGIBLE (it maps to an
 *        already-satisfied node — structural never-re-ask + semantic dedup) is
 *        refused and replaced with the orchestrator's highest-value next gap.
 * Reuses the shared Rollout Kit — no new flag family, no new persistence.
 */
const PROFILE_CONVERSATION_ORCHESTRATOR_FLAG = defineRolloutFlag({
  key: 'profile-conversation-orchestrator',
  description:
    'Route company-profile conversation question-selection through the canonical profileConversationOrchestrator (never re-ask known info + semantic dedup). Pilot: define-target-customer. Default off.',
  defaultMode: 'off',
});

/**
 * CONVERSATION-INTELLIGENCE-001 Phase D — multi-field chat extraction (default OFF).
 *
 * OFF  → this route behaves BYTE-IDENTICALLY to before: the user's answers are
 *        never extracted for profile knowledge (the extraction seam is never
 *        even imported — it lives behind a dynamic import inside the gated block).
 * ON   → the user's latest answer is extracted for EVERY recoverable profile
 *        field (not just this section's) through the ONE extraction machinery
 *        (buildExtractionPrompt + gateway + zod validation) and persisted through
 *        the ONE write seam (saveProfile). The refreshed profile then grounds both
 *        the AI question and the orchestrator gate below — so the interview never
 *        re-asks what an answer already revealed (closes Phase C's loop end-to-end).
 * Scoped, independent flag (extraction ⟂ question-governance); reuses the shared
 * Rollout Kit — no new flag family, no new persistence.
 */
const PROFILE_CHAT_EXTRACTION_FLAG = defineRolloutFlag({
  key: 'profile-chat-extraction',
  description:
    'Extract a company-profile conversation answer into ALL recoverable profile fields (reusing buildExtractionPrompt) and persist via saveProfile so the interview advances by knowledge. Pilot: define-target-customer. Default off.',
  defaultMode: 'off',
});

// Commercial fields collected in Phase 1. Field naming matches company_profiles DB columns.
const FIELDS_DESCRIPTION = [
  'target_customer_segment: who they sell to (e.g. SMB, enterprise, vertical)',
  'ideal_customer_profile: 1–2 sentence description of the ideal buyer',
  'pricing_model: e.g. subscription, one-time, usage-based, freemium',
  'sales_motion: e.g. self-serve, sales-led, hybrid, product-led',
  'avg_deal_size: typical deal or contract value (e.g. $5k, $50k)',
  'sales_cycle: e.g. days, weeks, months',
  'key_metrics: 2–4 metrics they care about (e.g. MRR, CAC, LTV)',
].join('\n');

// The 7 Phase-1 commercial fields, in DB-column naming. Used to detect which are
// already captured on the profile so the questionnaire never re-asks them.
const COMMERCIAL_FIELDS = [
  'target_customer_segment',
  'ideal_customer_profile',
  'pricing_model',
  'sales_motion',
  'avg_deal_size',
  'sales_cycle',
  'key_metrics',
] as const;

// Phase 2: Campaign purpose questions. Parsed into campaign_purpose_intent JSONB.
const CAMPAIGN_PURPOSE_QUESTIONS = [
  'Why are you using social media for this business?',
  'What do you ultimately want to achieve through campaigns?',
  'What kind of problems do you want to be known for solving?',
  'What type of campaigns do you intend to run consistently?',
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string) ||
    (req.body?.companyId as string) ||
    (req.body?.company_id as string);
  const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];

  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    let profile = await getProfile(companyId, { autoRefine: false });

    // CONVERSATION-INTELLIGENCE-001 Phase D — multi-field chat extraction
    // (flag-gated; OFF ⇒ this block is inert, the seam module is never imported,
    // and the route is byte-identical to before). ON ⇒ extract the user's latest
    // answer for ALL recoverable profile fields via the ONE extraction machinery
    // and persist through the ONE write seam (saveProfile). The refreshed profile
    // then grounds both the AI question and the orchestrator gate below, so a
    // single answer advances the interview by knowledge, not just by section.
    // Fail-safe: any error leaves the profile untouched.
    try {
      const extractionMode = resolveRolloutSync(PROFILE_CHAT_EXTRACTION_FLAG, { tenantId: companyId }).mode;
      if (extractionMode !== 'off' && conversation.length > 0) {
        let lastUserIdx = -1;
        for (let i = conversation.length - 1; i >= 0; i -= 1) {
          if (String(conversation[i]?.role ?? '').toLowerCase() === 'user') { lastUserIdx = i; break; }
        }
        const lastUserMessage = lastUserIdx >= 0 ? String(conversation[lastUserIdx]?.content ?? '').trim() : '';
        if (lastUserMessage) {
          // The question that prompted the answer = nearest prior non-user turn.
          let questionAsked: string | null = null;
          for (let i = lastUserIdx - 1; i >= 0; i -= 1) {
            if (String(conversation[i]?.role ?? '').toLowerCase() !== 'user') {
              questionAsked = String(conversation[i]?.content ?? '');
              break;
            }
          }
          const { extractAndPersistProfileKnowledge } = await import(
            '../../../backend/services/companyProfile/chatKnowledgeExtraction'
          );
          const { savedProfile } = await extractAndPersistProfileKnowledge({
            companyId,
            message: lastUserMessage,
            questionAsked,
            profile,
          });
          if (savedProfile) profile = savedProfile;
        }
      }
    } catch (extractionErr: any) {
      console.warn('[define-target-customer][phase-d-extraction] skipped:', extractionErr?.message || extractionErr);
    }

    const companyContext = profile
      ? `Company: ${profile.name || companyId}. Industry: ${profile.industry || 'Not set'}. Category: ${profile.category || 'Not set'}.`
      : 'Company not yet profiled.';

    // Fields already captured on the profile. The guided questionnaire must NOT
    // re-ask anything already filled here (that was the reported bug: the chat
    // kept asking "target customer segment" even though Commercial Strategy
    // already had it). We seed known values into the prompt and instruct the
    // model to skip them and only ask about what is genuinely missing.
    const knownCommercial: Record<string, string> = {};
    const missingCommercial: string[] = [];
    for (const field of COMMERCIAL_FIELDS) {
      const value =
        profile && typeof (profile as Record<string, unknown>)[field] === 'string'
          ? String((profile as Record<string, unknown>)[field]).trim()
          : '';
      if (value) knownCommercial[field] = value;
      else missingCommercial.push(field);
    }
    const existingCpi = (profile?.campaign_purpose_intent ?? {}) as Record<string, unknown>;
    const knownCampaignPurpose: Record<string, string> = {};
    for (const key of ['primary_objective', 'campaign_intent', 'monetization_intent', 'brand_positioning_angle']) {
      const value = typeof existingCpi[key] === 'string' ? String(existingCpi[key]).trim() : '';
      if (value) knownCampaignPurpose[key] = value;
    }
    if (Array.isArray(existingCpi.dominant_problem_domains) && existingCpi.dominant_problem_domains.length > 0) {
      knownCampaignPurpose.dominant_problem_domains = (existingCpi.dominant_problem_domains as unknown[])
        .filter((d): d is string => typeof d === 'string')
        .join(', ');
    }

    const knownFieldsBlock =
      Object.keys(knownCommercial).length === 0 && Object.keys(knownCampaignPurpose).length === 0
        ? 'None yet — the profile has no commercial fields captured.'
        : [
            ...Object.entries(knownCommercial).map(([k, v]) => `${k}: ${v}`),
            ...Object.entries(knownCampaignPurpose).map(([k, v]) => `campaign_purpose.${k}: ${v}`),
          ].join('\n');
    const missingBlock = missingCommercial.length > 0 ? missingCommercial.join(', ') : 'none';

    // Canonical Company Knowledge Graph grounding: the single authority for what
    // is already known ACROSS the whole profile (identity, offering, audience,
    // positioning, …) — so this conversation never re-asks anything the graph
    // already knows, in any phrasing (semantic dedup by node identity).
    const kgGrounding = profile ? buildKnowledgeGrounding(buildCompanyKnowledgeGraph(profile)) : null;
    const kgKnownBlock = kgGrounding?.known ?? 'Nothing established yet.';

    const systemPrompt =
      'You are a commercial strategy assistant. Your goal is to capture structured commercial and target-customer information through a short guided conversation.\n\n' +
      'Rules:\n' +
      '- Ask ONE short, clear question at a time.\n' +
      '- NEVER ask about a field listed under ALREADY CAPTURED — treat it as final and reuse its value.\n' +
      '- NEVER repeat a question the user has already answered in the conversation. If the latest answer addresses the current field, move on to the next STILL-MISSING field.\n' +
      '- Ask ONLY about the STILL-MISSING commercial fields, then the campaign purpose items not already captured. If nothing is missing, immediately return done.\n' +
      '- Phase 1 commercial fields (definitions): ' +
      FIELDS_DESCRIPTION +
      '\n\n' +
      '- Phase 2: After the missing commercial fields, ask these campaign purpose questions (one at a time; skip any already captured):\n' +
      CAMPAIGN_PURPOSE_QUESTIONS.map((q) => `  • ${q}`).join('\n') +
      '\n\n' +
      'Response format (JSON only, no markdown, no explanation):\n' +
      '- If you need more information: { "nextQuestion": "your question here" }\n' +
      '- When you have enough to fill all 7 commercial fields AND campaign purpose: { "done": true, "structuredFields": { "target_customer_segment": "...", "ideal_customer_profile": "...", "pricing_model": "...", "sales_motion": "...", "avg_deal_size": "...", "sales_cycle": "...", "key_metrics": "..." }, "campaign_purpose_intent": { "primary_objective": "...", "campaign_intent": "...", "monetization_intent": "...", "dominant_problem_domains": ["...", "..."], "brand_positioning_angle": "..." } }\n' +
      'In structuredFields, ALWAYS return the exact existing value for every ALREADY CAPTURED field (never blank or change it) plus the newly captured ones. Use empty string ONLY for a field that was never captured and could not be inferred. Keep values concise (1–2 sentences max for ideal_customer_profile).\n' +
      'In campaign_purpose_intent: primary_objective = why social media for this business; campaign_intent = what they want to achieve; monetization_intent = how campaigns support revenue; dominant_problem_domains = array of problems they want to solve; brand_positioning_angle = how they want to be perceived. Always return valid JSON.';

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          `Context: ${companyContext}\n\n` +
          `${kgKnownBlock}\n\n` +
          `ALREADY CAPTURED (do NOT ask about these — reuse the value):\n${knownFieldsBlock}\n\n` +
          `STILL MISSING commercial fields (ask only about these): ${missingBlock}\n\n` +
          (conversation.length === 0
            ? missingCommercial.length === 0
              ? 'All commercial fields are already captured. Ask only about any campaign purpose items not yet captured, or return done if nothing is missing.'
              : 'Start the guided questionnaire. Ask the first question about a STILL-MISSING field only.'
            : 'Conversation so far:\n' +
              conversation
                .map((m: { role?: string; content?: string }) => `${m.role}: ${m.content}`)
                .join('\n')),
      },
    ];

    const completion = await runCompletion({
      companyId,
      operation: 'defineTargetCustomer',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages,
    });

    const raw = (completion.output ?? '').trim() || '{}';
    let parsed: {
      nextQuestion?: string;
      done?: boolean;
      structuredFields?: Record<string, string>;
      campaign_purpose_intent?: {
        primary_objective?: string;
        campaign_intent?: string;
        monetization_intent?: string;
        dominant_problem_domains?: string[];
        brand_positioning_angle?: string;
      };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    if (parsed.done && parsed.structuredFields) {
      // Guard against data loss: if the model returns a blank value for a field
      // that was already captured, keep the existing profile value.
      const structuredFields: Record<string, string> = { ...parsed.structuredFields };
      for (const field of COMMERCIAL_FIELDS) {
        const aiValue = String(structuredFields[field] ?? '').trim();
        if (!aiValue && knownCommercial[field]) {
          structuredFields[field] = knownCommercial[field];
        }
      }
      const cpi = parsed.campaign_purpose_intent;
      const campaignPurposeIntent =
        cpi && typeof cpi === 'object'
          ? {
              primary_objective: String(cpi.primary_objective ?? '').trim() || null,
              campaign_intent: String(cpi.campaign_intent ?? '').trim() || null,
              monetization_intent: String(cpi.monetization_intent ?? '').trim() || null,
              dominant_problem_domains: Array.isArray(cpi.dominant_problem_domains)
                ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string')
                : [],
              brand_positioning_angle: String(cpi.brand_positioning_angle ?? '').trim() || null,
            }
          : null;
      return res.status(200).json({
        done: true,
        structuredFields,
        campaign_purpose_intent: campaignPurposeIntent,
      });
    }
    let nextQuestion = parsed.nextQuestion || 'Anything else you’d like to add about your commercial strategy?';

    // Phase C + E pilot (flag-gated; OFF ⇒ this block is inert and the line above
    // is returned verbatim, byte-identically to before). ON ⇒ delegate to the
    // canonical orchestrator:
    //   Phase E (completion intelligence) — if the knowledge core is satisfied,
    //     the interview naturally STOPS: return a completion + descriptive handoff
    //     signal instead of asking another question (the stop decision is the
    //     graph's enoughToProceed; no second threshold, no downstream call).
    //   Phase C (never-re-ask) — otherwise, refuse any AI-emitted question the
    //     graph marks ineligible (a satisfied node, in any phrasing) and replace
    //     it with the orchestrator's highest-value next gap.
    // Fail-safe: any error leaves the AI question untouched. No extraction here
    // (Phase D).
    if (profile && parsed.nextQuestion) {
      try {
        const { mode } = resolveRolloutSync(PROFILE_CONVERSATION_ORCHESTRATOR_FLAG, { tenantId: companyId });
        if (mode !== 'off') {
          const decision = orchestrateProfileConversation(profile, conversation, { stopWhenEnough: true });
          if (decision.complete && decision.transition.ready) {
            // Terminal state: enough is known — hand off to productive work rather
            // than loop. Additive completion fields; no downstream workflow invoked.
            return res.status(200).json({
              complete: true,
              nextQuestion: null,
              transition: decision.transition,
              readiness: decision.readiness,
            });
          }
          if (!isQuestionEligibleForOrchestration(decision, parsed.nextQuestion)) {
            nextQuestion = decision.nextQuestion?.question || nextQuestion;
          }
        }
      } catch {
        // fail-safe: never break the conversation over the governance overlay.
      }
    }

    return res.status(200).json({ nextQuestion });
  } catch (err: any) {
    console.error('Define target customer failed:', err);
    return res.status(500).json({
      error: 'Failed to run define target customer',
      details: err?.message || null,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/define-target-customer' });
