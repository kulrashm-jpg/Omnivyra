/**
 * SECURITY (2026-11-11): the tenant scope for creator-template resolution.
 *
 * lib/creator-templates keys its runtime user-template registry by tenant and
 * asks a provider hook for the CURRENT tenant. On the server that tenant is the
 * company of the render / validation in progress, carried through the async
 * chain by AsyncLocalStorage, so concurrent renders for different companies
 * never see each other's templates. Importing this module installs the
 * provider; outside runWithTemplateTenant the current tenant is null and only
 * platform (ownership 'system') templates resolve - a code path that forgets
 * the scope fails closed instead of leaking.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { setTemplateTenantProvider } from '../../../lib/creator-templates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenantStore = new AsyncLocalStorage<string>();

/** (Re)install this module's provider - done at import; exported for tests that swap it. */
export function installTemplateTenantProvider(): void {
  setTemplateTenantProvider(() => tenantStore.getStore() ?? null);
}
installTemplateTenantProvider();

/** The company whose user templates may be registered/resolved right now, or null. */
export function currentTemplateTenantId(): string | null {
  return tenantStore.getStore() ?? null;
}

/**
 * Run `fn` with `companyId` as the template tenant. A missing or malformed
 * company runs `fn` OUTSIDE any tenant scope (never inheriting an outer one), so
 * it can resolve platform templates only.
 */
export function runWithTemplateTenant<T>(companyId: string | null | undefined, fn: () => T): T {
  const company = typeof companyId === 'string' && UUID.test(companyId.trim()) ? companyId.trim() : null;
  return company ? tenantStore.run(company, fn) : tenantStore.exit(fn);
}
