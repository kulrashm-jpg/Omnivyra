import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../../backend/services/contentGenerationPipeline';
import { getDefaultThreadTemplates } from './defaultThreadTemplates';
import { getProfile } from '../../backend/services/companyProfileService';
import {
  extractCompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
  scoreCompanyContext,
  getDynamicContextThreshold,
  buildDiagnosticRetryReasons,
} from '../content/companyContextBlock';

export interface ThreadGenerationRequest {
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

export interface ThreadGenerationResult {
  success: true;
  content_type: 'thread';
  template_used: string | null;
  master_content: MasterContentPayload;
  platform_variant: PlatformVariantPayload;
}

function resolveTemplateInstruction(templateName?: string): string | undefined {
  if (!templateName || !templateName.trim()) return undefined;
  const normalized = templateName.trim().toLowerCase();
  const template = getDefaultThreadTemplates().find(
    (entry) => entry.name.trim().toLowerCase() === normalized,
  );
  if (!template) return `Use the "${templateName.trim()}" thread style with strong pacing and standalone posts.`;
  return `Use the "${template.name}" template style. ${template.description}`;
}

export async function runThreadGeneration(
  input: ThreadGenerationRequest,
): Promise<ThreadGenerationResult> {
  const platform = typeof input.platform === 'string' && input.platform.trim()
    ? input.platform.trim().toLowerCase()
    : 'x';

  // D1 + A4 parity: resolve identity and inject shared enforcement (identity
  // lock + anti-generic) into the prompt the downstream pipeline sees.
  const profile = await getProfile(input.company_id, { autoRefine: false, languageRefine: false }).catch(() => null);
  const identity = extractCompanyIdentity(profile);
  const companyEnforcement = (identity.companyName || identity.industry || identity.coreProblem)
    ? `${buildIdentityLock(identity, 'thread')}\n\n${buildAntiGenericRules(identity)}`
    : '';

  const templateInstruction = resolveTemplateInstruction(input.template_name);
  const extraInstruction = [
    companyEnforcement || undefined,
    templateInstruction,
    typeof input.extra_instruction === 'string' && input.extra_instruction.trim()
      ? input.extra_instruction.trim()
      : undefined,
  ].filter(Boolean).join('\n\n');

  const item = {
    execution_id: `thread-${Date.now()}`,
    company_id: input.company_id,
    platform,
    content_type: 'thread',
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      objective: input.objective || input.intent || 'Create a high-retention educational thread.',
      target_audience: input.target_audience || 'Audience looking for concise, high-signal insights',
      tone: input.tone || 'Punchy, clear, and momentum-building',
      cta_type: input.cta || 'Engagement CTA',
    },
    active_platform_targets: [
      {
        platform,
        content_type: 'thread',
      },
    ],
    ...(extraInstruction ? { extra_instruction: extraInstruction } : {}),
  };

  let master_content = await generateMasterContentFromIntent(item);
  let [platform_variant] = await buildPlatformVariantsFromMaster({
    ...item,
    master_content,
  });

  if (!platform_variant) {
    throw new Error(`Failed to generate thread variant for platform "${platform}"`);
  }

  // D3: short-form company-context gate. Lightweight single regen on failure.
  if (companyEnforcement) {
    const variantText = [
      platform_variant.generated_content || '',
      master_content.content || '',
    ].filter(Boolean).join('\n\n');

    if (variantText.trim().length >= 40) {
      const wordCount = variantText.split(/\s+/).filter(Boolean).length;
      const threshold = getDynamicContextThreshold('thread', wordCount);
      const score = scoreCompanyContext(variantText, identity, { contentType: 'thread' });
      let retryCount = 0;
      let finalScore = score.score;

      if (score.score < threshold) {
        const diagnostic = buildDiagnosticRetryReasons(score, identity);
        const regenItem = {
          ...item,
          extra_instruction: [
            item.extra_instruction ?? '',
            `\n\n## PREVIOUS DRAFT FAILED COMPANY-CONTEXT CHECK (score ${score.score}/100)\n${diagnostic}`,
          ].filter(Boolean).join(''),
        };
        try {
          retryCount = 1;
          const regenMaster = await generateMasterContentFromIntent(regenItem);
          const [regenVariant] = await buildPlatformVariantsFromMaster({
            ...regenItem,
            master_content: regenMaster,
          });
          if (regenVariant) {
            const regenText = [
              regenVariant.generated_content || '',
              regenMaster.content || '',
            ].filter(Boolean).join('\n\n');
            const regenScore = scoreCompanyContext(regenText, identity, { contentType: 'thread' });
            if (regenScore.score > score.score) {
              master_content = regenMaster;
              platform_variant = regenVariant;
              finalScore = regenScore.score;
            }
          }
        } catch { /* best-effort regen */ }
      }

      console.info('[content-enforcement]', {
        contentType: 'thread',
        target_words: wordCount,
        threshold,
        final_score: finalScore,
        retry_count: retryCount,
      });
    }
  }

  return {
    success: true,
    content_type: 'thread',
    template_used: input.template_name?.trim() || null,
    master_content,
    platform_variant,
  };
}
