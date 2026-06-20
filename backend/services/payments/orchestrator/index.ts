/**
 * Payment orchestrator foundation — public surface.
 * Test/sandbox only. No live charging. No UI/billing coupling.
 */
export * from './types';
export { PROVIDER_REGISTRY, getProviders, getProvider, resolveProviders, resolvePrimaryProvider } from './providerRegistry';
export { getProviderCredentials, isProviderConfigured, validateConfiguredProviders, assertConfiguredProvidersOrThrow, getActiveMode } from './providerConfig';
export { getAdapter, getAllAdapters } from './adapters';
export { getWebhookHandler, getRegisteredWebhookProviders, RazorpayWebhookHandler, CashfreeWebhookHandler } from './webhookHandlers';
export {
  initPaymentOrchestrator, resolveProviderForCurrency, createOrder, verifyPayment, handleWebhook, orchestratorHealth,
} from './paymentOrchestrator';
