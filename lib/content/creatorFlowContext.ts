export type CreatorFlowContext = {
  topic: string;
  audience?: string;
  platform?: string;
  campaign?: string;
  tone?: string;
  CTA?: string;
  contentType: string;
  creatorType?: string;
  sourceAssetId?: string | null;
  sourceAssetName?: string | null;
};

function clean(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

export function buildCreatorFlowContext(input: {
  topic?: unknown;
  audience?: unknown;
  platform?: unknown;
  campaign?: unknown;
  tone?: unknown;
  CTA?: unknown;
  contentType?: unknown;
  creatorType?: unknown;
  sourceAssetId?: unknown;
  sourceAssetName?: unknown;
}): CreatorFlowContext {
  return {
    topic: clean(input.topic) || 'Creator content',
    audience: clean(input.audience),
    platform: clean(input.platform),
    campaign: clean(input.campaign),
    tone: clean(input.tone),
    CTA: clean(input.CTA),
    contentType: clean(input.contentType) || 'creator-content',
    creatorType: clean(input.creatorType),
    sourceAssetId: clean(input.sourceAssetId) || null,
    sourceAssetName: clean(input.sourceAssetName) || null,
  };
}

export function serializeCreatorFlowContext(context: CreatorFlowContext): string {
  return [
    `Topic: ${context.topic}`,
    context.audience ? `Audience: ${context.audience}` : '',
    context.platform ? `Platform: ${context.platform}` : '',
    context.campaign ? `Campaign: ${context.campaign}` : '',
    context.tone ? `Tone: ${context.tone}` : '',
    context.CTA ? `CTA: ${context.CTA}` : '',
    `Content type: ${context.contentType}`,
    context.creatorType ? `Creator type: ${context.creatorType}` : '',
    context.sourceAssetName ? `Existing asset: ${context.sourceAssetName}` : '',
  ].filter(Boolean).join('\n');
}
