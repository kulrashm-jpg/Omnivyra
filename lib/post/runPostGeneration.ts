import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../../backend/services/contentGenerationPipeline';
import { getDefaultPostTemplates } from './defaultPostTemplates';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  extractCompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
  scoreCompanyContext,
  getDynamicContextThreshold,
  buildDiagnosticRetryReasons,
} from '../content/companyContextBlock';
// Closure Pass — Phase 4. Post generation now resolves governance
// from the same company profile it already loaded and threads it
// onto the pipeline `item` so system prompts pick up the preamble.
import { buildGovernancePromptContext } from '../../backend/services/creator/strategyGovernancePromptContext';

export interface PostGenerationRequest {
  company_id: string;
  topic: string;
  platform?: string;
  intent?: string;
  objective?: string;
  target_audience?: string;
  tone?: string;
  cta?: string;
  template_name?: string;
  extra_instruction?: string;
}

export interface PostGenerationResult {
  success: true;
  content_type: 'post';
  template_used: string | null;
  master_content: MasterContentPayload;
  platform_variant: PlatformVariantPayload;
}

function resolveTemplateInstruction(templateName?: string): string | undefined {
  if (!templateName || !templateName.trim()) return undefined;
  const normalized = templateName.trim().toLowerCase();
  const template = getDefaultPostTemplates().find(
    (entry) => entry.name.trim().toLowerCase() === normalized,
  );
  if (!template) return `Use the "${templateName.trim()}" template style while keeping the post concise and platform-native.`;
  return `Use the "${template.name}" template style. ${template.description}`;
}

function extractExplicitTimingReference(topic: string): string | null {
  const monthYearMatch = topic.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b/i,
  );
  if (monthYearMatch?.[0]) return monthYearMatch[0];

  const yearMatch = topic.match(/\b20\d{2}\b/);
  if (yearMatch?.[0]) return yearMatch[0];

  return null;
}

function buildPostFactualGuardrails(input: PostGenerationRequest): string {
  // Content-integrity rules (NOT anti-generic rules — those come from the shared
  // buildAntiGenericRules). These prevent hallucinated proof points and wrong
  // timing in launch/announce-style posts.
  const timingReference = extractExplicitTimingReference(input.topic);
  const soundsLikeLaunch = /\b(launch|launching|introducing|announce|announcing|coming soon|officially launch)\b/i.test(
    input.topic,
  ) || /\blaunch\b/i.test(input.template_name || '');

  return [
    'Factual guardrails for this post:',
    '- Do NOT invent testimonials, customer quotes, adoption, user outcomes, case studies, or proof points unless they were explicitly provided.',
    '- Do NOT imply the product is already widely used, proven, or endorsed if that proof was not supplied.',
    '- Do NOT introduce random historical references or past-year framing such as 2023 or 2024 unless the user explicitly asked for that exact year.',
    timingReference
      ? `- Preserve this explicit timing reference exactly: ${timingReference}. Do not replace it with another year or timeline.`
      : null,
    soundsLikeLaunch
      ? '- This is launch-oriented copy. If timing is not fully specified, keep the framing upcoming/present without inventing a month, quarter, or year.'
      : null,
  ].filter(Boolean).join('\n');
}

export async function runPostGeneration(
  input: PostGenerationRequest,
): Promise<PostGenerationResult> {
  const platform = typeof input.platform === 'string' && input.platform.trim()
    ? input.platform.trim().toLowerCase()
    : 'linkedin';

  // Resolve company identity for shared prompt-level enforcement (A4 parity
  // with long-form). Identity lock + anti-generic rules are the SAME builders
  // used by blog/article/whitepaper — no duplicated inline rules here.
  const profile = await getProfile(input.company_id, { autoRefine: false, languageRefine: false }).catch(() => null);
  const identity = extractCompanyIdentity(profile);
  const companyEnforcement = (identity.companyName || identity.industry || identity.coreProblem)
    ? `${buildIdentityLock(identity, 'post')}\n\n${buildAntiGenericRules(identity)}`
    : '';

  const templateInstruction = resolveTemplateInstruction(input.template_name);
  const masterNeutralityInstruction = [
    'Master-content rule for this post:',
    '- Write the master draft as platform-agnostic source content.',
    '- Do NOT optimize the master draft specifically for LinkedIn or any other single platform.',
    '- Do NOT use platform-specific cues such as "LinkedIn post", "professional network", or channel-native formatting in the master draft.',
    '- Save platform-native shaping for the variant generation step only.',
  ].join('\n');
  const extraInstruction = [
    companyEnforcement || undefined,
    templateInstruction,
    masterNeutralityInstruction,
    buildPostFactualGuardrails(input),
    typeof input.extra_instruction === 'string' && input.extra_instruction.trim()
      ? input.extra_instruction.trim()
      : undefined,
  ].filter(Boolean).join('\n\n');

  // Closure Pass — Phase 4. Build the governance context from the
  // already-loaded company profile. The post path normally has no
  // operator-selected purpose strategy, so `selectedStrategy=null`;
  // industry-level directives still apply.
  const governance = profile
    ? buildGovernancePromptContext({
        companyContext: {
          industry: profile.industry ?? null,
          industry_list: profile.industry_list ?? null,
          category: profile.category ?? null,
          category_list: profile.category_list ?? null,
        },
        contentType: 'image', // posts share the image-lane policy
        selectedStrategy: null,
      })
    : null;

  const masterItem = {
    execution_id: `post-${Date.now()}`,
    company_id: input.company_id,
    platform: 'multi',
    content_type: 'post',
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      objective: input.objective || input.intent || 'Create a strong master post that can be repurposed across platforms.',
      target_audience: input.target_audience || 'Professional audience aligned to company context',
      tone: input.tone || 'Clear, credible, and engaging',
      cta_type: input.cta || 'Soft CTA',
    },
    active_platform_targets: [
      {
        platform: 'multi',
        content_type: 'post',
      },
    ],
    ...(extraInstruction ? { extra_instruction: extraInstruction } : {}),
    ...(governance ? { governance } : {}),
  };

  const variantItem = {
    ...masterItem,
    platform,
    intent: {
      ...masterItem.intent,
      objective: input.objective || input.intent || 'Create a platform-native authority post.',
    },
    active_platform_targets: [
      {
        platform,
        content_type: 'post',
      },
    ],
  };

  let master_content = await generateMasterContentFromIntent(masterItem);
  let [platform_variant] = await buildPlatformVariantsFromMaster({
    ...variantItem,
    master_content,
  });

  if (!platform_variant) {
    throw new Error(`Failed to generate post variant for platform "${platform}"`);
  }

  // D3: short-form company-context gate. If the variant scores below threshold,
  // regenerate once with a diagnostic message appended so the model treats the
  // company-context failures as mandatory fixes. Lightweight — single regen,
  // no deep structural parsing.
  if (companyEnforcement) {
    const variantText = [
      platform_variant.generated_content || '',
      master_content.content || '',
    ].filter(Boolean).join('\n\n');

    if (variantText.trim().length >= 40) {
      const wordCount = variantText.split(/\s+/).filter(Boolean).length;
      const threshold = getDynamicContextThreshold('post', wordCount);
      const score = scoreCompanyContext(variantText, identity, { contentType: 'post' });
      let retryCount = 0;
      let finalScore = score.score;

      if (score.score < threshold) {
        const diagnostic = buildDiagnosticRetryReasons(score, identity);
        const regenMasterItem = {
          ...masterItem,
          extra_instruction: [
            masterItem.extra_instruction ?? '',
            `\n\n## PREVIOUS DRAFT FAILED COMPANY-CONTEXT CHECK (score ${score.score}/100)\n${diagnostic}`,
          ].filter(Boolean).join(''),
        };
        try {
          retryCount = 1;
          const regenMaster = await generateMasterContentFromIntent(regenMasterItem);
          const [regenVariant] = await buildPlatformVariantsFromMaster({
            ...variantItem,
            master_content: regenMaster,
          });
          if (regenVariant) {
            const regenText = [
              regenVariant.generated_content || '',
              regenMaster.content || '',
            ].filter(Boolean).join('\n\n');
            const regenScore = scoreCompanyContext(regenText, identity, { contentType: 'post' });
            // Keep the regen only if it actually improved the score — never
            // ship something worse than the first attempt.
            if (regenScore.score > score.score) {
              master_content = regenMaster;
              platform_variant = regenVariant;
              finalScore = regenScore.score;
            }
          }
        } catch { /* regen is best-effort; keep original on transient failure */ }
      }

      console.info('[content-enforcement]', {
        contentType: 'post',
        target_words: wordCount,
        threshold,
        final_score: finalScore,
        retry_count: retryCount,
      });
    }
  }

  return {
    success: true,
    content_type: 'post',
    template_used: input.template_name?.trim() || null,
    master_content,
    platform_variant,
  };
}
