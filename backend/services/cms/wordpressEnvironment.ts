/**
 * BACKWARD-COMPATIBILITY SHIM.
 *
 * The WordPress-specific environment/HTTPS/REST logic was generalised into the
 * provider-agnostic framework in ./cmsEnvironmentFramework.ts. This module now
 * only re-exports the old WordPress-named surface so any legacy imports keep
 * compiling. New code should import from cmsEnvironmentFramework directly.
 */
import {
  CMS_PROVIDER_CAPABILITIES,
  classifyConnectivityFailure,
  detectCmsEnvironment,
  detectProviderApiRoots,
  WP_LOCAL_CONFIG_SNIPPET,
  type CmsEnvironment,
  type CmsEnvironmentType,
  type CmsValidationReport,
} from './cmsEnvironmentFramework';

export { WP_LOCAL_CONFIG_SNIPPET };

export type WordPressEnvironmentType = CmsEnvironmentType;
export type WordPressEnvironment = CmsEnvironment;
/** @deprecated Use CmsValidationReport from cmsEnvironmentFramework. */
export type WordPressValidationReport = CmsValidationReport;
export type WordPressErrorCode =
  | 'REST_ENDPOINT_MISSING'
  | 'HTTPS_REQUIRED'
  | 'APP_PASSWORD_DISABLED'
  | 'INVALID_CREDENTIALS'
  | 'AUTH_HEADER_STRIPPED'
  | 'REST_BLOCKED'
  | 'INVALID_REST_ROOT'
  | 'SECURITY_PLUGIN_INTERFERENCE'
  | 'UNKNOWN';

/** @deprecated Use detectCmsEnvironment(). */
export const detectWordPressEnvironment = detectCmsEnvironment;

export function restRootCandidates(siteUrl: string): string[] {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return CMS_PROVIDER_CAPABILITIES.wordpress.restRootPatterns.map((p) => `${base}${p}`);
}

export function productionHttpsRemediationSteps(): string[] {
  return [
    'WordPress Application Passwords require HTTPS on production websites.',
    'Enable SSL on the site, then update the Site URL above to use https://.',
    "Free option: install a Let's Encrypt certificate via your host.",
    'Proxy option: put the site behind Cloudflare with SSL set to Full (strict).',
    'Managed option: enable the one-click SSL/HTTPS toggle in your hosting panel.',
  ];
}

export function localhostRemediationSteps(): string[] {
  const g = CMS_PROVIDER_CAPABILITIES.wordpress.localDevGuidance!;
  return [g.summary, g.steps[0], g.snippet!, g.steps[1]];
}

/** @deprecated Use detectProviderApiRoots('wordpress', ...). */
export async function detectRestRoot(
  siteUrl: string,
  fetchFn: (url: string) => Promise<Response>,
): Promise<{ detectedRestRoot: string | null; restApiBase: string | null; lastStatus: number | null }> {
  const d = await detectProviderApiRoots('wordpress', siteUrl, fetchFn);
  return { detectedRestRoot: d.detectedApiRoot, restApiBase: d.apiBase, lastStatus: d.lastStatus };
}

const NEW_TO_OLD_CODE: Record<string, WordPressErrorCode> = {
  HTTPS_REQUIRED: 'HTTPS_REQUIRED',
  INVALID_API_ROOT: 'INVALID_REST_ROOT',
  API_UNREACHABLE: 'INVALID_REST_ROOT',
  NETWORK_FAILURE: 'INVALID_REST_ROOT',
  SECURITY_PLUGIN_BLOCK: 'SECURITY_PLUGIN_INTERFERENCE',
  AUTH_HEADER_BLOCKED: 'AUTH_HEADER_STRIPPED',
  APP_PASSWORD_DISABLED: 'APP_PASSWORD_DISABLED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNKNOWN: 'UNKNOWN',
};

/** @deprecated Use classifyConnectivityFailure(). */
export function classifyWordPressError(args: {
  httpStatus: number | null;
  env: WordPressEnvironment;
  restReachable: boolean;
  body?: unknown;
}): { code: WordPressErrorCode; message: string; remediationSteps: string[] } {
  const e = classifyConnectivityFailure({
    provider: 'wordpress',
    httpStatus: args.httpStatus,
    env: args.env,
    apiReachable: args.restReachable,
    body: args.body,
  });
  const code =
    !args.restReachable && args.httpStatus === 404
      ? 'REST_ENDPOINT_MISSING'
      : !args.restReachable && (args.httpStatus === 401 || args.httpStatus === 403)
        ? 'REST_BLOCKED'
        : (NEW_TO_OLD_CODE[e.code] ?? 'UNKNOWN');
  return { code, message: e.userSafeMessage, remediationSteps: e.remediationSteps };
}
