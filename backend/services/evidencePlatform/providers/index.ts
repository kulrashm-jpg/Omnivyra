/**
 * External Evidence Provider Framework  (BETA-ENGINE-004)
 *
 * The reusable, canonical architecture every external-evidence integration will use: one provider
 * contract, one adapter contract, one registry, and deterministic failure governance — all built on
 * the BETA-ARCH-001 Evidence Platform. No provider is implemented and no external API is called here;
 * this phase ships architecture only.
 */
export * from './providerContract';
export * from './providerFailure';
export * from './providerAdapter';
export * from './providerRegistry';
export { registerAnticipatedProviders, ANTICIPATED_PROVIDERS } from './anticipatedProviders';
