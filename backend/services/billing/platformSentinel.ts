/**
 * The all-zero organization id the AI gateway, the external-API executor and
 * the OpenAI adapter write when no company is known (each defines it locally
 * as UNKNOWN_ORG). It is NOT a company: spend recorded under it is platform
 * spend. Financial readers that must not treat it as a customer import this
 * ONE constant; platformSentinel.test.ts pins it to every UNKNOWN_ORG
 * definition so the two can never drift.
 */
export const PLATFORM_SENTINEL_ORG = '00000000-0000-0000-0000-000000000000';
