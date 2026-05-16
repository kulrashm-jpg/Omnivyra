import { createHash } from 'crypto';
import sharp from 'sharp';
import { recordCreatorRenderMetric } from './creatorRenderObservability';

export type VisualRegressionSnapshot = {
  rendererId: string;
  platform: string;
  assetType: string;
  width: number;
  height: number;
  pixelHash: string;
  byteLength: number;
  createdAt: string;
  perceptualHash?: string;
};

export type VisualRegressionResult = {
  ok: boolean;
  driftScore: number;
  errors: string[];
  baselineHash: string;
  candidateHash: string;
  diffArtifact?: {
    baselinePerceptualHash?: string;
    candidatePerceptualHash?: string;
  };
};

export type VisualRegressionBaselineSuite =
  | 'linkedin'
  | 'x'
  | 'twitter'
  | 'instagram'
  | 'facebook'
  | 'infographic_layouts'
  | 'carousel_layouts'
  | 'brand_cards'
  | 'banners';

export const CREATOR_VISUAL_REGRESSION_BASELINE_SUITES: VisualRegressionBaselineSuite[] = [
  'linkedin',
  'x',
  'twitter',
  'instagram',
  'facebook',
  'infographic_layouts',
  'carousel_layouts',
  'brand_cards',
  'banners',
];

export function createVisualRegressionSnapshot(input: {
  buffer: Buffer;
  rendererId: string;
  platform: string;
  assetType: string;
  width: number;
  height: number;
}): VisualRegressionSnapshot {
  return {
    rendererId: input.rendererId,
    platform: input.platform,
    assetType: input.assetType,
    width: input.width,
    height: input.height,
    pixelHash: createHash('sha256').update(input.buffer).digest('hex'),
    byteLength: input.buffer.length,
    createdAt: new Date().toISOString(),
  };
}

async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x] ?? 0;
      const right = data[y * 9 + x + 1] ?? 0;
      bits += left > right ? '1' : '0';
    }
  }
  let hex = '';
  for (let index = 0; index < bits.length; index += 4) {
    hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return hex.padStart(16, '0');
}

function hammingDistance(a: string, b: string): number {
  let distance = 0;
  const max = Math.max(a.length, b.length);
  const left = a.padStart(max, '0');
  const right = b.padStart(max, '0');
  for (let index = 0; index < max; index += 1) {
    const xor = parseInt(left[index] || '0', 16) ^ parseInt(right[index] || '0', 16);
    distance += xor.toString(2).split('1').length - 1;
  }
  return distance;
}

export async function createPerceptualVisualRegressionSnapshot(input: {
  buffer: Buffer;
  rendererId: string;
  platform: string;
  assetType: string;
  width: number;
  height: number;
}): Promise<VisualRegressionSnapshot> {
  return {
    ...createVisualRegressionSnapshot(input),
    perceptualHash: await computePerceptualHash(input.buffer),
  };
}

export function compareVisualRegressionSnapshots(input: {
  baseline: VisualRegressionSnapshot;
  candidate: VisualRegressionSnapshot;
  maxDriftScore?: number;
}): VisualRegressionResult {
  const errors: string[] = [];
  if (input.baseline.rendererId !== input.candidate.rendererId) errors.push('renderer_identity_changed');
  if (input.baseline.platform !== input.candidate.platform) errors.push('platform_changed');
  if (input.baseline.assetType !== input.candidate.assetType) errors.push('asset_type_changed');
  if (input.baseline.width !== input.candidate.width || input.baseline.height !== input.candidate.height) errors.push('dimensions_changed');
  const byteDelta = Math.abs(input.baseline.byteLength - input.candidate.byteLength) / Math.max(1, input.baseline.byteLength);
  const perceptualDistance = input.baseline.perceptualHash && input.candidate.perceptualHash
    ? hammingDistance(input.baseline.perceptualHash, input.candidate.perceptualHash) / 64
    : input.baseline.pixelHash === input.candidate.pixelHash ? 0 : 0.5;
  const driftScore = Math.min(1, byteDelta * 0.25 + perceptualDistance);
  if (driftScore > (input.maxDriftScore ?? 0.18)) errors.push('pixel_drift_exceeds_threshold');
  if (errors.length) {
    recordCreatorRenderMetric({
      name: 'visual_regression_failure',
      tags: {
        rendererId: input.candidate.rendererId,
        platform: input.candidate.platform,
        assetType: input.candidate.assetType,
        driftScore: driftScore.toFixed(4),
      },
    });
  }
  return {
    ok: errors.length === 0,
    driftScore,
    errors,
    baselineHash: input.baseline.pixelHash,
    candidateHash: input.candidate.pixelHash,
    diffArtifact: {
      baselinePerceptualHash: input.baseline.perceptualHash,
      candidatePerceptualHash: input.candidate.perceptualHash,
    },
  };
}
