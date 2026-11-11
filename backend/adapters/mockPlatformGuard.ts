/**
 * USE_MOCK_PLATFORMS must never run in production: every adapter then returns a
 * mock_* id, which the worker records as a real publication.
 *
 * Refused at publishToPlatform, the one route to the adapters, rather than at
 * config load: a config failure exits the whole process, web and worker, for a
 * fault that only publishing has. Uses the production signals the certification
 * fake already refuses on (see certFakePublisher).
 */
import { CERT_FAKE_PROD_MARKERS, DEPLOYMENT_MARKERS, TARGET_VARS } from './certFakePublisher';

type Env = Record<string, string | undefined>;

/** Why mock platforms may not run in this environment (empty → allowed). Never includes values. */
export function mockPlatformsRefusals(env: Env = process.env): string[] {
  const out: string[] = [];
  if (env.NODE_ENV === 'production') out.push('NODE_ENV is production');
  for (const k of DEPLOYMENT_MARKERS) if (typeof env[k] === 'string' && env[k]!.trim() !== '') out.push(`deployment marker ${k} is set`);
  for (const k of TARGET_VARS) {
    const v = env[k];
    if (typeof v === 'string' && CERT_FAKE_PROD_MARKERS.some((m) => v.includes(m))) out.push(`${k} carries a production marker`);
  }
  return out;
}
