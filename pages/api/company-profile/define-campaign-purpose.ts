import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Define Campaign Purpose & Strategic Intent.
 * Guided conversation to capture campaign_purpose_intent JSONB.
 * Reuses same pattern as define-target-customer.
 *
 * CONVERSATION-INTELLIGENCE-003 — this route is now migrated onto the canonical
 * Company Profile conversation intelligence (the SAME implementation certified on
 * the define-target-customer pilot). It reuses — never forks — the canonical
 * Company Knowledge Graph, Conversation Orchestrator, Readiness Evaluator,
 * Knowledge Extraction, and Completion Intelligence, behind the SAME two rollout
 * flags as the pilot (so one toggle governs the whole Company Profile
 * conversation uniformly). Both flags default OFF; when OFF this route is
 * byte-identical to before (original prompt, original response contract).
 */

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
 * CONVERSATION-INTELLIGENCE — canonical question-governance flag (default OFF).
 * REUSES the pilot's flag key (no new flag family): one toggle governs question
 * selection across every migrated Company Profile interview route uniformly.
 *
 * OFF  → byte-identical to before: the AI-emitted nextQuestion is returned
 *        verbatim (the orchestrator + knowledge grounding are never invoked).
 * ON   → the canonical orchestrator gates question selection (refuse any AI
 *        question that maps to an already-satisfied knowledge node — structural
 *        never-re-ask + semantic dedup) and, once the knowledge core is
 *        satisfied, naturally STOPS with a completion + handoff signal. The
 *        prompt is also grounded with what the graph already knows.
 */
const PROFILE_CONVERSATION_ORCHESTRATOR_FLAG = defineRolloutFlag({
  key: 'profile-conversation-orchestrator',
  description:
    'Route company-profile conversation question-selection through the canonical profileConversationOrchestrator (never re-ask known info + semantic dedup + natural completion). Covers define-target-customer + define-campaign-purpose. Default off.',
  defaultMode: 'off',
});

/**
 * CONVERSATION-INTELLIGENCE — canonical multi-field chat extraction (default OFF).
 * REUSES the pilot's flag key.
 *
 * OFF  → byte-identical to before: the user's answers are never extracted for
 *        profile knowledge (the extraction seam is never even imported — it lives
 *        behind a dynamic import inside the gated block).
 * ON   → the user's latest answer is extracted for EVERY recoverable profile
 *        field through the ONE extraction machinery (buildExtractionPrompt +
 *        gateway + zod validation) and persisted through the ONE write seam
 *        (saveProfile), so the interview advances by knowledge, not just by turn.
 */
const PROFILE_CHAT_EXTRACTION_FLAG = defineRolloutFlag({
  key: 'profile-chat-extraction',
  description:
    'Extract a company-profile conversation answer into ALL recoverable profile fields (reusing buildExtractionPrompt) and persist via saveProfile so the interview advances by knowledge. Covers define-target-customer + define-campaign-purpose. Default off.',
  defaultMode: 'off',
});

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

    // CONVERSATION-INTELLIGENCE-003 — canonical multi-field chat extraction
    // (flag-gated; OFF ⇒ this block is inert, the seam module is never imported,
    // and the route is byte-identical to before). ON ⇒ extract the user's latest
    // answer for ALL recoverable profile fields via the ONE extraction machinery
    // and persist through the ONE write seam (saveProfile). The refreshed profile
    // then grounds both the AI question and the orchestrator gate below.
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
      console.warn('[define-campaign-purpose][chat-extraction] skipped:', extractionErr?.message || extractionErr);
    }

    const companyContext = profile
      ? `Company: ${profile.name || companyId}. Industry: ${profile.industry || 'Not set'}. Target: ${profile.target_customer_segment || 'Not set'}.`
      : 'Company not yet profiled.';

    // Canonical Company Knowledge Graph grounding (flag-gated so OFF stays
    // byte-identical): the single authority for what is already known ACROSS the
    // whole profile — so when the program is enabled this conversation never
    // re-asks anything the graph already knows, in any phrasing.
    const orchestratorMode = resolveRolloutSync(PROFILE_CONVERSATION_ORCHESTRATOR_FLAG, { tenantId: companyId }).mode;
    const kgKnownBlock =
      profile && orchestratorMode !== 'off'
        ? buildKnowledgeGrounding(buildCompanyKnowledgeGraph(profile)).known ?? ''
        : '';

    const systemPrompt =
      'You are a campaign strategy assistant. Capture campaign purpose and strategic intent through a short guided conversation.\n\n' +
      'Ask the user (one question at a time):\n' +
      '1. Why are you using social media for this business?\n' +
      '2. What do you ultimately want to achieve through campaigns?\n' +
      '3. What kind of problems do you want to be known for solving?\n' +
      '4. What type of campaigns do you intend to run consistently? (examples: lead_generation, brand_awareness, authority_positioning, network_expansion, engagement_growth, product_promotion)\n\n' +
      'Also capture (ask only if missing / not clear from answers):\n' +
      '- reader_emotion_target: what should the reader feel after consuming the content (e.g. confident, curious, urgent, relieved).\n' +
      '- narrative_flow_seed: a 3-step or 4-step weekly progression seed (pattern + steps).\n' +
      '- recommended_cta_style: recommended CTA style aligned to campaign type (e.g. Soft, Direct, Engagement prompts, Light).\n\n' +
      'Response format (JSON only, no markdown, no explanation):\n' +
      '- If you need more information: { "nextQuestion": "your question here" }\n' +
      '- When you have enough: { "done": true, "campaign_purpose_intent": { "primary_objective": "...", "campaign_intent": "...", "monetization_intent": "...", "dominant_problem_domains": ["...", "..."], "brand_positioning_angle": "...", "reader_emotion_target": "...", "narrative_flow_seed": { "pattern": "...", "steps": ["...", "...", "..."] }, "recommended_cta_style": "..." } }\n' +
      'Map answers: primary_objective=why social media; campaign_intent=what to achieve; monetization_intent=how campaigns support revenue; dominant_problem_domains=array of problems to solve; brand_positioning_angle=how to be perceived. Always valid JSON.';

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Context: ${companyContext}\n\n${kgKnownBlock ? `${kgKnownBlock}\n\n` : ''}${
          conversation.length === 0
            ? 'Start the questionnaire. Ask the first question about campaign purpose.'
            : 'Conversation so far:\n' +
              conversation
                .map((m: { role?: string; content?: string }) => `${m.role}: ${m.content}`)
                .join('\n')
        }`,
      },
    ];

    const completion = await runCompletion({
      companyId,
      operation: 'defineCampaignPurpose',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages,
    });

    const raw = (completion.output ?? '').trim() || '{}';
    let parsed: {
      nextQuestion?: string;
      done?: boolean;
      campaign_purpose_intent?: {
        primary_objective?: string;
        campaign_intent?: string;
        monetization_intent?: string;
        dominant_problem_domains?: string[];
        brand_positioning_angle?: string;
        reader_emotion_target?: string;
        narrative_flow_seed?: unknown;
        recommended_cta_style?: string;
      };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    if (parsed.done && parsed.campaign_purpose_intent) {
      const cpi = parsed.campaign_purpose_intent;
      const normalizeString = (value: unknown): string | null => {
        const s = typeof value === 'string' ? value : String(value ?? '');
        const t = s.trim();
        return t ? t : null;
      };
      const normalizeStringArray = (value: unknown, max?: number): string[] => {
        if (!Array.isArray(value)) return [];
        const out = value
          .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
          .filter(Boolean);
        return max != null ? out.slice(0, max) : out;
      };
      const normalizeNarrativeSeed = (value: unknown): { pattern?: string | null; steps?: string[] | null } | null => {
        if (value == null) return null;
        if (typeof value === 'string') {
          const pattern = normalizeString(value);
          return pattern ? { pattern } : null;
        }
        if (typeof value !== 'object') return null;
        const pattern = normalizeString((value as any)?.pattern);
        const steps = normalizeStringArray((value as any)?.steps, 8);
        if (!pattern && steps.length === 0) return null;
        return {
          pattern: pattern ?? null,
          steps: steps.length > 0 ? steps : null,
        };
      };
      const campaignPurposeIntent = {
        primary_objective: normalizeString(cpi.primary_objective) ?? null,
        campaign_intent: normalizeString(cpi.campaign_intent) ?? null,
        monetization_intent: normalizeString(cpi.monetization_intent) ?? null,
        dominant_problem_domains: Array.isArray(cpi.dominant_problem_domains)
          ? cpi.dominant_problem_domains.filter((d): d is string => typeof d === 'string')
          : [],
        brand_positioning_angle: normalizeString(cpi.brand_positioning_angle) ?? null,
        reader_emotion_target: normalizeString(cpi.reader_emotion_target) ?? null,
        narrative_flow_seed: normalizeNarrativeSeed(cpi.narrative_flow_seed),
        recommended_cta_style: normalizeString(cpi.recommended_cta_style) ?? null,
      };
      return res.status(200).json({
        done: true,
        campaign_purpose_intent: campaignPurposeIntent,
      });
    }

    let nextQuestion =
      parsed.nextQuestion ||
      'Anything else you’d like to add about your campaign purpose?';

    // CONVERSATION-INTELLIGENCE-003 — canonical orchestrator gate + completion
    // (flag-gated; OFF ⇒ this block is inert and the line above is returned
    // verbatim, byte-identically to before). ON ⇒ delegate to the canonical
    // orchestrator:
    //   Completion intelligence — if the knowledge core is satisfied, the
    //     interview naturally STOPS: return a completion + descriptive handoff
    //     signal instead of asking another question (the stop decision is the
    //     graph's enoughToProceed; no second threshold, no downstream call).
    //   Never-re-ask — otherwise, refuse any AI-emitted question the graph marks
    //     ineligible (a satisfied node, in any phrasing) and replace it with the
    //     orchestrator's highest-value next gap.
    // Fail-safe: any error leaves the AI question untouched.
    if (profile && parsed.nextQuestion && orchestratorMode !== 'off') {
      try {
        const decision = orchestrateProfileConversation(profile, conversation, { stopWhenEnough: true });
        if (decision.complete && decision.transition.ready) {
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
      } catch {
        // fail-safe: never break the conversation over the governance overlay.
      }
    }

    return res.status(200).json({ nextQuestion });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({
      error: 'Failed to run define campaign purpose',
      details: message,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/define-campaign-purpose' });
