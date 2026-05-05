import { config } from '@/config';

const PROD_MARKERS = ['production', 'prod'];

function isProductionRuntime(): boolean {
  const candidates = [
    process.env.NODE_ENV,
    process.env.OMNIVYRA_ENV,
    process.env.DRISHIQ_ENV,
    process.env.VERCEL_ENV,
  ]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.toLowerCase());
  return candidates.some((v) => PROD_MARKERS.includes(v));
}

export function isMockPlatformsEnabled(): boolean {
  return config.USE_MOCK_PLATFORMS === true;
}

export function assertMockPlatformsAllowed(callerLabel: string): void {
  if (!isMockPlatformsEnabled()) return;
  if (!isProductionRuntime()) return;
  const message =
    `mock_platforms_in_production: USE_MOCK_PLATFORMS=true is forbidden in production runtime ` +
    `(caller=${callerLabel})`;
  throw new Error(message);
}
