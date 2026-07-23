/**
 * chatKnowledgeExtraction.ts — CONVERSATION-INTELLIGENCE-001 Phase D.
 *
 * THE multi-field CHAT extraction seam (the Phase-1 audit gap).
 * -----------------------------------------------------------------------------
 * Extraction from WEBSITE evidence is mature (buildExtractionPrompt +
 * runProfileRefinement extract ~15 fields). Extraction from a single USER CHAT
 * MESSAGE into MULTIPLE profile fields was ABSENT — each define-* route
 * extracted only its own section's fields via its own inline prompt and returned
 * them for the client to save (the audit flagged that raw/unvalidated chat-save).
 *
 * This module composes the EXISTING machinery — NO second extractor, NO second
 * prompt, NO second write path:
 *   - PROMPT   → buildExtractionPrompt (refinementPrompts) — the SAME ~15-field
 *                extraction prompt, fed the chat turn as evidence.
 *   - GATEWAY  → runCompletionWithOperation('profileExtraction') — the SAME
 *                completion path runProfileRefinement uses (temp 0, json_object).
 *   - VALIDATE → buildExtractionWithDefaults (extractionSchema zod) — the SAME
 *                normalize + coerce the refine path applies to model output.
 *   - PERSIST  → saveProfile — the ONE canonical write seam (merge `input ??
 *                existing`, honor user_locked_fields, reclassify). No raw write.
 *
 * The ONLY new logic is a DETERMINISTIC mapper from the validated extraction
 * output → Partial<CompanyProfile> that NEVER discards a recoverable field:
 * every extraction field carrying a real (non-missing) value populates its
 * profile column, so ONE message can satisfy MANY knowledge-graph nodes.
 *
 * After the save, the next orchestrator turn rebuilds the graph from the
 * persisted profile and marks the just-satisfied nodes ineligible — closing
 * Phase C's answer→profile loop. This module never touches the graph, the
 * orchestrator, or saveProfile's internals; it composes them.
 */

import type { CompanyProfile, CompanyProfileExtractionOutput } from './types';
import { buildExtractionPrompt } from './refinementPrompts';
import { buildExtractionWithDefaults } from './extractionSchema';
import { runCompletionWithOperation } from '../aiGateway';
import { parseModelOutputOr } from '../ai/safety';
import { saveProfile } from '../companyProfileServiceRest1Rest2Pulse';

/** One extraction field as validated by buildExtractionWithDefaults. */
type ExtractionField = {
  value?: string | string[] | null;
  source?: 'website' | 'social' | 'inferred' | 'user' | 'missing';
  confidence?: 'High' | 'Medium' | 'Low';
};

/** A field is recoverable when it is not 'missing' and carries a non-empty value. */
function fieldText(field: ExtractionField | undefined | null): string | null {
  if (!field || field.source === 'missing') return null;
  const raw = field.value;
  if (raw === null || raw === undefined) return null;
  const text = Array.isArray(raw)
    ? raw.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ')
    : String(raw).trim();
  return text.length ? text : null;
}

export interface ChatExtractionResult {
  /** Validated multi-field extraction (every field, zod-coerced). */
  extraction: CompanyProfileExtractionOutput;
  /**
   * Deterministic Partial<CompanyProfile> derived from the extraction — only
   * fields with a recoverable value; empty object when nothing was recoverable.
   * `field_confidence` (merged over existing) is attached iff any field mapped.
   */
  fields: Partial<CompanyProfile>;
}

/**
 * Deterministic mapper: validated extraction → Partial<CompanyProfile>. Never
 * discards a recoverable field. `field_confidence` bands are merged OVER the
 * existing map (never wiped) using the same keys the knowledge graph reads
 * (NODE_CONFIDENCE_KEY), so a saved value resolves to a satisfied node.
 */
export function mapExtractionToProfileFields(
  extraction: CompanyProfileExtractionOutput,
  existing: CompanyProfile | null,
): Partial<CompanyProfile> {
  const fields: Record<string, unknown> = {};
  const confidence: Record<string, string> = { ...(existing?.field_confidence ?? {}) };

  const set = (column: string, confKey: string, field: ExtractionField | undefined) => {
    const text = fieldText(field);
    if (text === null) return;
    fields[column] = text;
    if (field?.confidence) confidence[confKey] = field.confidence;
  };

  // Core profile fields → canonical columns (scalar form; saveProfile derives the
  // *_list columns via splitToList, so partial list knowledge is never dropped).
  set('name', 'name', extraction.company_name);
  set('industry', 'industry', extraction.industry);
  set('category', 'category', extraction.category);
  set('website_url', 'website_url', extraction.website_url);
  set('geography', 'geography', extraction.geography);
  set('products_services', 'products_services', extraction.products_services);
  set('target_audience', 'target_audience', extraction.target_audience);
  set('brand_voice', 'brand_voice', extraction.brand_voice);
  set('goals', 'goals', extraction.goals);
  set('competitors', 'competitors', extraction.competitors);
  set('unique_value', 'unique_value', extraction.unique_value_proposition);
  set('content_themes', 'content_themes', extraction.content_themes);

  // Social handles → *_url columns (the `social` node reads linkedin_url).
  const social = extraction.social_profiles ?? {};
  set('linkedin_url', 'linkedin_url', social.linkedin);
  set('facebook_url', 'facebook_url', social.facebook);
  set('instagram_url', 'instagram_url', social.instagram);
  set('x_url', 'x_url', social.x);
  set('youtube_url', 'youtube_url', social.youtube);
  set('tiktok_url', 'tiktok_url', social.tiktok);
  set('reddit_url', 'reddit_url', social.reddit);
  set('pinterest_url', 'pinterest_url', social.pinterest);
  set('whatsapp_url', 'whatsapp_url', social.whatsapp);
  set('blog_url', 'blog_url', social.blog);

  if (Object.keys(fields).length > 0) {
    fields.field_confidence = confidence;
  }
  return fields as Partial<CompanyProfile>;
}

/**
 * Extract EVERY recoverable profile field from a single user chat message, using
 * the SAME extraction prompt + gateway + validation the website-refine path uses.
 * Pure of persistence — returns the validated extraction and the mapped fields.
 * Deterministic given the model output (the completion is the only non-determinism;
 * mock it in tests). An empty message short-circuits to no fields (no model call).
 */
export async function extractProfileKnowledgeFromMessage(args: {
  companyId: string | null;
  message: string;
  questionAsked?: string | null;
  profile: CompanyProfile | null;
}): Promise<ChatExtractionResult> {
  const message = String(args.message ?? '').trim();
  if (!message) {
    return { extraction: buildExtractionWithDefaults({}), fields: {} };
  }

  // Reuse the SAME extraction prompt, feeding the chat turn as EVIDENCE (the
  // prompt already extracts all ~15 fields from whatever evidence it is given).
  const questionAsked = String(args.questionAsked ?? '').trim();
  const evidence = [
    ...(questionAsked
      ? [{ label: 'conversation_question', url: 'chat://question', summary: `Interviewer asked: ${questionAsked}` }]
      : []),
    { label: 'user_answer', url: 'chat://answer', summary: `User answered: ${message}` },
  ];

  const currentProfile = (args.profile ?? ({ company_id: args.companyId ?? '' } as CompanyProfile));
  const { systemPrompt, userPrompt } = buildExtractionPrompt(
    evidence,
    currentProfile,
    args.profile?.report_settings?.entity_archetype ?? null,
  );

  const result = await runCompletionWithOperation({
    companyId: args.companyId,
    campaignId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    operation: 'profileExtraction',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const parsed = parseModelOutputOr<any>(result.output, {}, { surface: 'profile.chatExtraction' });
  const extraction = buildExtractionWithDefaults(parsed);
  const fields = mapExtractionToProfileFields(extraction, args.profile ?? null);
  return { extraction, fields };
}

/**
 * Extract from the message and PERSIST every recoverable field through the ONE
 * canonical write seam (saveProfile). Source 'user' — the knowledge originates
 * from the user's own answer, so it is merge+lock aware and sticks (the interview
 * never re-asks it, and later website auto-refine will not clobber it). When no
 * field is recoverable, nothing is written (persisted:false) and the input profile
 * is returned unchanged.
 */
export async function extractAndPersistProfileKnowledge(args: {
  companyId: string;
  message: string;
  questionAsked?: string | null;
  profile: CompanyProfile | null;
}): Promise<{ result: ChatExtractionResult; savedProfile: CompanyProfile | null; persisted: boolean }> {
  const result = await extractProfileKnowledgeFromMessage(args);
  if (Object.keys(result.fields).length === 0) {
    return { result, savedProfile: args.profile ?? null, persisted: false };
  }
  const savedProfile = await saveProfile(
    { ...result.fields, company_id: args.companyId },
    { source: 'user' },
  );
  return { result, savedProfile, persisted: true };
}
