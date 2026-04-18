import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../../backend/services/contentGenerationPipeline';
import { getDefaultPostTemplates } from './defaultPostTemplates';

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

function buildPostGuardrails(input: PostGenerationRequest): string {
  const timingReference = extractExplicitTimingReference(input.topic);
  const soundsLikeLaunch = /\b(launch|launching|introducing|announce|announcing|coming soon|officially launch)\b/i.test(
    input.topic,
  ) || /\blaunch\b/i.test(input.template_name || '');

  return [
    'Factual guardrails for this post:',
    '- Use only facts grounded in the user topic, provided instructions, and company context.',
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

  const templateInstruction = resolveTemplateInstruction(input.template_name);
  const extraInstruction = [
    templateInstruction,
    buildPostGuardrails(input),
    typeof input.extra_instruction === 'string' && input.extra_instruction.trim()
      ? input.extra_instruction.trim()
      : undefined,
  ].filter(Boolean).join('\n\n');

  const item = {
    execution_id: `post-${Date.now()}`,
    company_id: input.company_id,
    platform,
    content_type: 'post',
    topic: input.topic.trim(),
    title: input.topic.trim(),
    intent: {
      objective: input.objective || input.intent || 'Create a platform-native authority post.',
      target_audience: input.target_audience || 'Professional audience aligned to company context',
      tone: input.tone || 'Clear, credible, and engaging',
      cta_type: input.cta || 'Soft CTA',
    },
    active_platform_targets: [
      {
        platform,
        content_type: 'post',
      },
    ],
    ...(extraInstruction ? { extra_instruction: extraInstruction } : {}),
  };

  const master_content = await generateMasterContentFromIntent(item);
  const [platform_variant] = await buildPlatformVariantsFromMaster({
    ...item,
    master_content,
  });

  if (!platform_variant) {
    throw new Error(`Failed to generate post variant for platform "${platform}"`);
  }

  return {
    success: true,
    content_type: 'post',
    template_used: input.template_name?.trim() || null,
    master_content,
    platform_variant,
  };
}
