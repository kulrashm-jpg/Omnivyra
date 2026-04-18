import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  type MasterContentPayload,
  type PlatformVariantPayload,
} from '../../backend/services/contentGenerationPipeline';
import { getDefaultThreadTemplates } from './defaultThreadTemplates';

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

  const templateInstruction = resolveTemplateInstruction(input.template_name);
  const extraInstruction = [
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

  const master_content = await generateMasterContentFromIntent(item);
  const [platform_variant] = await buildPlatformVariantsFromMaster({
    ...item,
    master_content,
  });

  if (!platform_variant) {
    throw new Error(`Failed to generate thread variant for platform "${platform}"`);
  }

  return {
    success: true,
    content_type: 'thread',
    template_used: input.template_name?.trim() || null,
    master_content,
    platform_variant,
  };
}
