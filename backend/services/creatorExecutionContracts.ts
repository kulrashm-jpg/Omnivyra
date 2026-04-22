import { checkCapability, normalizeCreatorPlatform } from './creatorCapabilityMap';
import type { CanonicalCreatorOutput } from './executionEngines/types';

type ValidationResult = {
  ok: boolean;
  issues: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function expectedAssetKind(assetType: CanonicalCreatorOutput['asset_type']): string {
  switch (assetType) {
    case 'image':
      return 'image';
    case 'carousel':
      return 'carousel';
    case 'video':
      return 'video';
    case 'post_with_asset':
      return 'image';
    case 'thread_with_asset':
      return 'carousel';
    default:
      return '';
  }
}

function validateNoOverlap(output: CanonicalCreatorOutput): string[] {
  const issues: string[] = [];
  const instructionKeys = new Set(Object.keys(output.asset_instruction || {}));
  const payloadKeys = new Set(Object.keys(output.asset_payload || {}));
  const packagingKeys = new Set(Object.keys(output.packaging || {}));

  for (const key of instructionKeys) {
    if (payloadKeys.has(key)) issues.push(`asset_instruction and asset_payload both contain "${key}"`);
    if (packagingKeys.has(key)) issues.push(`asset_instruction and packaging both contain "${key}"`);
  }
  for (const key of payloadKeys) {
    if (packagingKeys.has(key)) issues.push(`asset_payload and packaging both contain "${key}"`);
  }
  return issues;
}

function validateAssetPayloadByType(output: CanonicalCreatorOutput): string[] {
  const issues: string[] = [];
  const payload = output.asset_payload;
  if (!isObject(payload)) return ['asset_payload must be an object'];

  switch (output.asset_type) {
    case 'carousel':
      if (!Array.isArray(payload.slides) || payload.slides.length === 0) {
        issues.push('carousel asset_payload.slides[] required');
      } else {
        payload.slides.forEach((slide, index) => {
          const item = isObject(slide) ? slide : {};
          if (!requiredString(item.role)) issues.push(`carousel slide ${index + 1} role required`);
          if (!requiredString(item.headline)) issues.push(`carousel slide ${index + 1} headline required`);
          if (!requiredString(item.body_text)) issues.push(`carousel slide ${index + 1} body_text required`);
        });
      }
      break;
    case 'image':
      if (!isObject(payload.visual_descriptor)) {
        issues.push('image asset_payload.visual_descriptor required');
      } else {
        const descriptor = payload.visual_descriptor;
        if (!requiredString(descriptor.visual_description) && !requiredString(descriptor.headline)) {
          issues.push('image requires visual_description or headline');
        }
      }
      break;
    case 'video':
      if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) issues.push('video asset_payload.scenes[] required');
      break;
    case 'post_with_asset':
      if (!isObject(payload.media_bundle)) issues.push('post_with_asset requires media_bundle');
      if (!isObject(payload.caption_blueprint)) {
        issues.push('post_with_asset requires caption_blueprint');
      } else {
        const captionBlueprint = payload.caption_blueprint;
        if (!requiredString(captionBlueprint.hook)) issues.push('post_with_asset caption_blueprint.hook required');
        if (!requiredString(captionBlueprint.body)) issues.push('post_with_asset caption_blueprint.body required');
        if (!requiredString(captionBlueprint.cta)) issues.push('post_with_asset caption_blueprint.cta required');
      }
      break;
    case 'thread_with_asset':
      if (!isObject(payload.media_bundle)) issues.push('thread_with_asset requires media_bundle');
      if (!isObject(payload.caption_blueprint)) issues.push('thread_with_asset requires caption_blueprint');
      if (!Array.isArray(payload.thread_sequence) || payload.thread_sequence.length === 0) {
        issues.push('thread_with_asset requires thread_sequence');
      }
      break;
    default:
      issues.push(`unknown asset_type: ${String((output as any).asset_type)}`);
  }
  return issues;
}

export function validateCreatorExecutionOutput(output: CanonicalCreatorOutput): ValidationResult {
  const issues: string[] = [];
  if (output.intent_type !== 'creator') issues.push('intent_type must be creator');
  if (!isObject(output.asset_instruction)) issues.push('asset_instruction must be an object');
  if (!isObject(output.asset_payload)) issues.push('asset_payload must be an object');
  if (!isObject(output.packaging)) issues.push('packaging must be an object');
  if (!requiredString((output.asset_payload as Record<string, unknown>)?.asset_kind)) {
    issues.push('asset_payload.asset_kind required');
  } else if (String((output.asset_payload as Record<string, unknown>).asset_kind) !== expectedAssetKind(output.asset_type)) {
    issues.push(`asset_kind does not match asset_type ${output.asset_type}`);
  }
  if (!requiredString(output.packaging.caption)) issues.push('packaging.caption required');
  if (!Array.isArray(output.packaging.hashtags)) issues.push('packaging.hashtags must be an array');
  if (!requiredString(output.packaging.meta_description)) issues.push('packaging.meta_description required');
  if (!Array.isArray(output.packaging.keywords)) issues.push('packaging.keywords must be an array');
  if (!requiredString(output.packaging.cta)) issues.push('packaging.cta required');
  issues.push(...validateNoOverlap(output));
  issues.push(...validateAssetPayloadByType(output));
  return { ok: issues.length === 0, issues };
}

export function validateCreatorSchedulingContract(input: {
  output: CanonicalCreatorOutput;
  platform: string;
}): ValidationResult {
  const issues: string[] = [];
  const outputValidation = validateCreatorExecutionOutput(input.output);
  issues.push(...outputValidation.issues);
  const capability = checkCapability(
    input.platform,
    input.output.asset_type,
    input.output.asset_payload && typeof input.output.asset_payload === 'object'
      ? input.output.asset_payload
      : undefined
  );
  if (!capability.ok) {
    issues.push('reason' in capability ? capability.reason : `Unsupported capability for ${input.platform}`);
  }
  const normalizedPlatform = normalizeCreatorPlatform(input.platform);
  if (!normalizedPlatform) issues.push(`Unknown platform taxonomy: ${input.platform}`);
  return { ok: issues.length === 0, issues };
}
