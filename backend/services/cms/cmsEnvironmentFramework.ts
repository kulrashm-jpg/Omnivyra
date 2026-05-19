/**
 * Canonical, provider-agnostic CMS environment & connectivity framework.
 *
 * This is the single validation layer for every CMS integration (WordPress
 * today; Ghost/Joomla/Drupal/Webflow/Shopify/HubSpot as adapters land). It
 * generalises the original WordPress-only localhost/HTTPS detection into:
 *
 *   - environment classification (localhost / local_network / staging / prod)
 *   - per-provider capability definitions (auth, discovery, https policy)
 *   - generic API-root discovery with provider-aware JSON validation
 *   - a universal connectivity error model (code/severity/retryable/...)
 *   - a standardized validation pipeline + CmsValidationReport
 *
 * Pure logic + injected fetch — no DB, no global side effects. Adapters call
 * runCmsValidationPipeline() and supply only a provider-specific auth probe.
 *
 * Backward compatibility: wordpressEnvironment.ts re-exports the WordPress
 * names from here, so existing WordPress imports keep working unchanged.
 */

// ─────────────────────────────────────────────────────────────────────────────
// A. Environment classification
// ─────────────────────────────────────────────────────────────────────────────

export type CmsEnvironmentType =
  | 'localhost'
  | 'local_network'
  | 'staging'
  | 'production';

export interface CmsEnvironment {
  environmentType: CmsEnvironmentType;
  /** Parsed hostname (lowercased), '' if URL was unparseable. */
  host: string;
  /** Whether the configured site URL uses https://. */
  isHttps: boolean;
  /** True only for production — used by HTTPS enforcement. */
  requiresHttps: boolean;
  /** localhost / local_network / staging may auth over plain HTTP. */
  allowsHttpAuth: boolean;
}

const DEV_TUNNEL_SUFFIXES = [
  'ngrok.io',
  'ngrok-free.app',
  'ngrok.app',
  'loca.lt', // localtunnel
  'trycloudflare.com',
  'devtunnels.ms', // VS Code dev tunnels
  'lhr.life',
  'serveo.net',
  'localhost.run',
];

function isPrivateLanIp(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 127) return true; // loopback
  return false;
}

function looksLikeStaging(host: string): boolean {
  return /(^|[.-])(staging|stage|dev|develop|development|test|testing|qa|uat|preview|sandbox|demo)([.-]|$)/i.test(
    host,
  );
}

/** Pure environment-type classifier (no protocol awareness). */
export function classifyEnvironmentType(siteUrl: string): {
  environmentType: CmsEnvironmentType;
  host: string;
  isHttps: boolean;
} {
  const raw = String(siteUrl || '').trim();
  let host = '';
  let isHttps = false;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProto);
    host = url.hostname.toLowerCase();
    isHttps = url.protocol === 'https:';
  } catch {
    host = '';
  }

  let environmentType: CmsEnvironmentType = 'production';
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.test') ||
    DEV_TUNNEL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))
  ) {
    environmentType = 'localhost';
  } else if (isPrivateLanIp(host)) {
    environmentType = 'local_network';
  } else if (looksLikeStaging(host)) {
    environmentType = 'staging';
  }
  return { environmentType, host, isHttps };
}

export function requiresHttps(env: CmsEnvironmentType): boolean {
  return env === 'production';
}

export function allowsHttpDevelopment(env: CmsEnvironmentType): boolean {
  return env !== 'production';
}

/** Full environment detection. Defaults to the safe `production` bucket. */
export function detectCmsEnvironment(siteUrl: string): CmsEnvironment {
  const { environmentType, host, isHttps } = classifyEnvironmentType(siteUrl);
  return {
    environmentType,
    host,
    isHttps,
    requiresHttps: requiresHttps(environmentType),
    allowsHttpAuth: allowsHttpDevelopment(environmentType),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// B. Provider capability definitions
// ─────────────────────────────────────────────────────────────────────────────

export type CmsProviderId =
  | 'wordpress'
  | 'ghost'
  | 'joomla'
  | 'drupal'
  | 'webflow'
  | 'shopify'
  | 'hubspot'
  | 'custom_blog_api';

export type CmsAuthType =
  | 'app_password'
  | 'admin_api_key'
  | 'api_token'
  | 'oauth2'
  | 'bearer_token';

export type CmsApiDiscoveryMode =
  | 'rest_root_probe' // probe site-relative root patterns (WP/Drupal/Joomla/Ghost)
  | 'fixed_endpoint' // single known endpoint (custom_blog_api)
  | 'central_api' // provider-hosted API, site URL not probeable (Shopify/HubSpot/Webflow)
  | 'none';

export interface CmsLocalDevGuidance {
  summary: string;
  /** Copy-ready config snippet, if the provider needs one. */
  snippet?: string;
  steps: string[];
}

export interface CmsProviderCapabilities {
  provider: CmsProviderId;
  label: string;
  requiresHttpsInProduction: boolean;
  supportsHttpDevelopment: boolean;
  authType: CmsAuthType;
  apiDiscoveryMode: CmsApiDiscoveryMode;
  /** Site-relative path patterns probed in order (rest_root_probe only). */
  restRootPatterns: string[];
  graphqlSupport: boolean;
  webhookSupport: boolean;
  oauthSupport: boolean;
  appPasswordSupport: boolean;
  localDevSupport: boolean;
  localDevGuidance: CmsLocalDevGuidance | null;
}

export const WP_LOCAL_CONFIG_SNIPPET = `define('WP_ENVIRONMENT_TYPE', 'local');

// or, equivalently:
define('WP_ENVIRONMENT_TYPE', 'development');`;

export const CMS_PROVIDER_CAPABILITIES: Record<CmsProviderId, CmsProviderCapabilities> = {
  wordpress: {
    provider: 'wordpress',
    label: 'WordPress',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: true,
    authType: 'app_password',
    apiDiscoveryMode: 'rest_root_probe',
    restRootPatterns: [
      '/wp-json/',
      '/wp/wp-json/',
      '/index.php?rest_route=/',
      '/wp/index.php?rest_route=/',
    ],
    graphqlSupport: false,
    webhookSupport: true,
    oauthSupport: false,
    appPasswordSupport: true,
    localDevSupport: true,
    localDevGuidance: {
      summary:
        'WordPress disables Application Passwords on non-HTTPS environments by default.',
      snippet: WP_LOCAL_CONFIG_SNIPPET,
      steps: [
        'Add the snippet to wp-config.php (above the "That\'s all, stop editing!" line).',
        'Reload wp-admin, then generate the Application Password under Users → Profile → Application Passwords.',
      ],
    },
  },
  ghost: {
    provider: 'ghost',
    label: 'Ghost',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: true,
    authType: 'admin_api_key',
    // Ghost admin endpoints are auth-gated — unauthenticated probing 401s, so
    // the base is deterministic (`/ghost/api/admin`) and the adapter's auth
    // probe is the reachability signal.
    apiDiscoveryMode: 'fixed_endpoint',
    restRootPatterns: [],
    graphqlSupport: false,
    webhookSupport: true,
    oauthSupport: false,
    appPasswordSupport: false,
    localDevSupport: true,
    localDevGuidance: {
      summary:
        'Ghost local development uses an Admin API key from a Custom Integration.',
      steps: [
        'In Ghost Admin → Settings → Integrations → Add custom integration.',
        'Copy the Admin API Key (id:secret) and the API URL; localhost over HTTP is allowed for local installs.',
      ],
    },
  },
  joomla: {
    provider: 'joomla',
    label: 'Joomla',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: true,
    authType: 'api_token',
    // Joomla Web Services API requires a token even for index reads.
    apiDiscoveryMode: 'fixed_endpoint',
    restRootPatterns: [],
    graphqlSupport: false,
    webhookSupport: false,
    oauthSupport: false,
    appPasswordSupport: false,
    localDevSupport: true,
    localDevGuidance: {
      summary: 'Joomla requires the Web Services API and a Joomla API token.',
      steps: [
        'Enable System → Global Configuration → Web Services (REST API).',
        'Create an API token under Users → Manage → (user) → API tokens; localhost over HTTP is allowed.',
      ],
    },
  },
  drupal: {
    provider: 'drupal',
    label: 'Drupal',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: true,
    authType: 'bearer_token',
    apiDiscoveryMode: 'rest_root_probe',
    restRootPatterns: ['/jsonapi', '/jsonapi/', '/api'],
    graphqlSupport: true,
    webhookSupport: false,
    oauthSupport: true,
    appPasswordSupport: false,
    localDevSupport: true,
    localDevGuidance: {
      summary: 'Drupal needs the JSON:API module enabled.',
      steps: [
        'Enable the core JSON:API module (admin/modules).',
        'Grant the integration user JSON:API access; localhost over HTTP is allowed for local sites.',
      ],
    },
  },
  webflow: {
    provider: 'webflow',
    label: 'Webflow',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: false,
    authType: 'oauth2',
    apiDiscoveryMode: 'central_api',
    restRootPatterns: [],
    graphqlSupport: false,
    webhookSupport: true,
    oauthSupport: true,
    appPasswordSupport: false,
    localDevSupport: false,
    localDevGuidance: null,
  },
  shopify: {
    provider: 'shopify',
    label: 'Shopify Blog',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: false,
    authType: 'api_token',
    apiDiscoveryMode: 'central_api',
    restRootPatterns: [],
    graphqlSupport: true,
    webhookSupport: true,
    oauthSupport: true,
    appPasswordSupport: false,
    localDevSupport: false,
    localDevGuidance: null,
  },
  hubspot: {
    provider: 'hubspot',
    label: 'HubSpot CMS',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: false,
    authType: 'oauth2',
    apiDiscoveryMode: 'central_api',
    restRootPatterns: [],
    graphqlSupport: false,
    webhookSupport: true,
    oauthSupport: true,
    appPasswordSupport: false,
    localDevSupport: false,
    localDevGuidance: null,
  },
  custom_blog_api: {
    provider: 'custom_blog_api',
    label: 'Custom Blog API',
    requiresHttpsInProduction: true,
    supportsHttpDevelopment: true,
    authType: 'bearer_token',
    apiDiscoveryMode: 'fixed_endpoint',
    restRootPatterns: [],
    graphqlSupport: false,
    webhookSupport: false,
    oauthSupport: false,
    appPasswordSupport: false,
    localDevSupport: true,
    localDevGuidance: null,
  },
};

export function getProviderCapabilities(provider: string): CmsProviderCapabilities {
  return (
    CMS_PROVIDER_CAPABILITIES[provider as CmsProviderId] ??
    CMS_PROVIDER_CAPABILITIES.custom_blog_api
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// C. API root discovery
// ─────────────────────────────────────────────────────────────────────────────

function joinSiteUrl(siteUrl: string, pattern: string): string {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return pattern.startsWith('/') ? `${base}${pattern}` : `${base}/${pattern}`;
}

/** Provider-aware predicate: does this JSON body look like the API index? */
function looksLikeProviderApi(provider: CmsProviderId, body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  switch (provider) {
    case 'wordpress':
      return Boolean(body.namespaces || body.routes || body.name !== undefined);
    case 'ghost':
      return Boolean(body.site || body.settings);
    case 'drupal':
      return Boolean(body.jsonapi || body.data || body.links);
    case 'joomla':
      return Boolean(body.links || body.data);
    default:
      return true; // any well-formed JSON is acceptable for generic providers
  }
}

/** Compute the resource base to which adapters append paths (e.g. wp/v2). */
export function deriveApiBase(provider: CmsProviderId, candidate: string): string {
  if (provider === 'wordpress') {
    return candidate.includes('rest_route=')
      ? candidate.replace(/rest_route=\/$/, 'rest_route=/wp/v2')
      : `${candidate.replace(/\/+$/, '')}/wp/v2`;
  }
  return candidate.replace(/\/+$/, '');
}

export interface ApiRootDiscovery {
  detectedApiRoot: string | null;
  apiBase: string | null;
  lastStatus: number | null;
  networkError: boolean;
}

/**
 * Probe a provider's site-relative API roots in order. A root is reachable
 * when an unauthenticated GET returns 2xx + JSON shaped like that provider's
 * API index. `central_api`/`none` providers are not site-probeable and return
 * a null discovery (callers treat that as "discovery not applicable").
 */
export async function detectProviderApiRoots(
  provider: string,
  siteUrl: string,
  fetchFn: (url: string) => Promise<Response>,
): Promise<ApiRootDiscovery> {
  const caps = getProviderCapabilities(provider);
  if (caps.apiDiscoveryMode !== 'rest_root_probe' || caps.restRootPatterns.length === 0) {
    return { detectedApiRoot: null, apiBase: null, lastStatus: null, networkError: false };
  }

  let lastStatus: number | null = null;
  let networkError = false;
  for (const pattern of caps.restRootPatterns) {
    const candidate = joinSiteUrl(siteUrl, pattern);
    try {
      const res = await fetchFn(candidate);
      lastStatus = res.status;
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      if (looksLikeProviderApi(caps.provider, body)) {
        return {
          detectedApiRoot: candidate,
          apiBase: deriveApiBase(caps.provider, candidate),
          lastStatus,
          networkError: false,
        };
      }
    } catch {
      networkError = true; // DNS/abort/connection refused — try next
    }
  }
  return { detectedApiRoot: null, apiBase: null, lastStatus, networkError };
}

export function validateApiReachability(discovery: ApiRootDiscovery): boolean {
  return Boolean(discovery.detectedApiRoot);
}

// ─────────────────────────────────────────────────────────────────────────────
// D. Universal error classification
// ─────────────────────────────────────────────────────────────────────────────

export type CmsErrorCode =
  | 'HTTPS_REQUIRED'
  | 'API_UNREACHABLE'
  | 'INVALID_API_ROOT'
  | 'INVALID_CREDENTIALS'
  | 'AUTH_HEADER_BLOCKED'
  | 'API_DISABLED'
  | 'SECURITY_PLUGIN_BLOCK'
  | 'OAUTH_REQUIRED'
  | 'APP_PASSWORD_DISABLED'
  | 'RATE_LIMITED'
  | 'FIREWALL_BLOCKED'
  | 'NETWORK_FAILURE'
  | 'UNKNOWN';

export type CmsErrorSeverity = 'fatal' | 'error' | 'warning';

export interface CmsClassifiedError {
  code: CmsErrorCode;
  severity: CmsErrorSeverity;
  retryable: boolean;
  userSafeMessage: string;
  developerDiagnostics: string;
  remediationSteps: string[];
}

function productionHttpsRemediation(): string[] {
  return [
    'Enable SSL on the site, then update the Site URL to use https://.',
    "Free option: install a Let's Encrypt certificate via your host.",
    'Proxy option: put the site behind Cloudflare with SSL set to Full (strict).',
    'Managed option: enable the one-click SSL/HTTPS toggle in your hosting panel.',
  ];
}

function localDevRemediation(caps: CmsProviderCapabilities): string[] {
  const g = caps.localDevGuidance;
  if (!g) return [];
  return g.snippet ? [g.summary, ...g.steps, g.snippet] : [g.summary, ...g.steps];
}

/**
 * Classify any CMS connectivity/auth failure into the canonical model.
 * Generalised from the WordPress-only classifier; provider capabilities drive
 * provider-specific remediation (e.g. App Password vs Admin API key).
 */
export function classifyConnectivityFailure(args: {
  provider: string;
  httpStatus: number | null;
  env: CmsEnvironment;
  apiReachable: boolean;
  networkError?: boolean;
  body?: unknown;
}): CmsClassifiedError {
  const { httpStatus, env, apiReachable, networkError, body } = args;
  const caps = getProviderCapabilities(args.provider);
  const bodyCode =
    body && typeof body === 'object' && 'code' in (body as any)
      ? String((body as any).code || '')
      : '';
  const bodyMsg =
    body && typeof body === 'object' && 'message' in (body as any)
      ? String((body as any).message || '')
      : '';
  const dev = `provider=${caps.provider} status=${httpStatus ?? 'n/a'} apiReachable=${apiReachable} env=${env.environmentType} https=${env.isHttps}${bodyCode ? ` body.code=${bodyCode}` : ''}`;

  // Production over HTTP — fatal, not retryable until SSL is added.
  if (caps.requiresHttpsInProduction && env.requiresHttps && !env.isHttps) {
    return {
      code: 'HTTPS_REQUIRED',
      severity: 'fatal',
      retryable: false,
      userSafeMessage:
        caps.authType === 'app_password'
          ? `${caps.label} Application Passwords require HTTPS on production websites.`
          : `${caps.label} requires HTTPS on production websites.`,
      developerDiagnostics: dev,
      remediationSteps: productionHttpsRemediation(),
    };
  }

  if (!apiReachable) {
    if (networkError && httpStatus == null) {
      return {
        code: 'NETWORK_FAILURE',
        severity: 'error',
        retryable: true,
        userSafeMessage: `Could not reach ${caps.label} — DNS, connection, or timeout failure.`,
        developerDiagnostics: dev,
        remediationSteps: [
          'Verify the Site URL is correct and the server is online.',
          'Check that the host is reachable from the internet (not firewalled off).',
        ],
      };
    }
    if (httpStatus === 404) {
      return {
        code: 'INVALID_API_ROOT',
        severity: 'error',
        retryable: false,
        userSafeMessage: `${caps.label} API not found at the expected paths.`,
        developerDiagnostics: dev,
        remediationSteps:
          caps.provider === 'wordpress'
            ? [
                'In wp-admin → Settings → Permalinks, choose any option other than "Plain", then Save.',
                'Confirm the Site URL points at the WordPress install root.',
              ]
            : [
                `Confirm the ${caps.label} API is enabled and the Site URL is the install root.`,
                'If the CMS lives in a subdirectory, include it in the Site URL.',
              ],
      };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        code: 'SECURITY_PLUGIN_BLOCK',
        severity: 'error',
        retryable: false,
        userSafeMessage: `The ${caps.label} API is reachable but blocked (security plugin, WAF, or server rule).`,
        developerDiagnostics: dev,
        remediationSteps: [
          `Allowlist the ${caps.label} API path in security/firewall plugins.`,
          'Remove server rules that block the API for unauthenticated index requests.',
        ],
      };
    }
    if (httpStatus === 429) {
      return {
        code: 'RATE_LIMITED',
        severity: 'warning',
        retryable: true,
        userSafeMessage: `${caps.label} is rate-limiting requests. Retry shortly.`,
        developerDiagnostics: dev,
        remediationSteps: ['Wait and retry; reduce validation frequency.'],
      };
    }
    return {
      code: 'API_UNREACHABLE',
      severity: 'error',
      retryable: true,
      userSafeMessage: `Could not locate a working ${caps.label} API root.`,
      developerDiagnostics: dev,
      remediationSteps: [
        'Verify the Site URL is the CMS install root (not a marketing page or CDN).',
        'If the CMS lives in a subdirectory, include it in the Site URL.',
      ],
    };
  }

  // API reachable — interpret the auth failure.
  if (httpStatus === 401 || httpStatus === 403) {
    if (
      caps.appPasswordSupport &&
      (/application password/i.test(bodyMsg) || bodyCode === 'application_passwords_disabled')
    ) {
      return {
        code: 'APP_PASSWORD_DISABLED',
        severity: 'error',
        retryable: false,
        userSafeMessage: `Application Passwords are disabled on this ${caps.label} site.`,
        developerDiagnostics: dev,
        remediationSteps: env.allowsHttpAuth
          ? localDevRemediation(caps)
          : [
              'Ensure the site is served over HTTPS (required on production).',
              'Confirm Application Passwords are not disabled by a security plugin or filter.',
            ],
      };
    }
    if (bodyCode === 'rest_cannot_access' || /authorization header/i.test(bodyMsg)) {
      return {
        code: 'AUTH_HEADER_BLOCKED',
        severity: 'error',
        retryable: false,
        userSafeMessage:
          'The Authorization header is not reaching the CMS (commonly stripped by Apache/Nginx/PHP-FPM).',
        developerDiagnostics: dev,
        remediationSteps: [
          'Apache: add SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1 to .htaccess.',
          'Nginx+FPM: pass fastcgi_param HTTP_AUTHORIZATION $http_authorization;',
        ],
      };
    }
    if (caps.authType === 'oauth2' && /oauth|token expired|invalid_grant/i.test(bodyMsg)) {
      return {
        code: 'OAUTH_REQUIRED',
        severity: 'error',
        retryable: false,
        userSafeMessage: `${caps.label} requires (re)authorization via OAuth.`,
        developerDiagnostics: dev,
        remediationSteps: [`Reconnect ${caps.label} to refresh the OAuth grant.`],
      };
    }
    return {
      code: 'INVALID_CREDENTIALS',
      severity: 'error',
      retryable: false,
      userSafeMessage: `Authentication failed — the ${caps.label} credentials are incorrect.`,
      developerDiagnostics: dev,
      remediationSteps:
        caps.authType === 'app_password'
          ? [
              'Regenerate the Application Password under Users → Profile → Application Passwords.',
              'Paste it with spaces; use the account username, not the email address.',
            ]
          : [`Regenerate the ${caps.label} ${caps.authType.replace('_', ' ')} and re-enter it.`],
    };
  }

  if (httpStatus === 429) {
    return {
      code: 'RATE_LIMITED',
      severity: 'warning',
      retryable: true,
      userSafeMessage: `${caps.label} is rate-limiting requests. Retry shortly.`,
      developerDiagnostics: dev,
      remediationSteps: ['Wait and retry; reduce validation frequency.'],
    };
  }

  if (httpStatus && httpStatus >= 500) {
    return {
      code: 'SECURITY_PLUGIN_BLOCK',
      severity: 'error',
      retryable: true,
      userSafeMessage: `${caps.label} returned status ${httpStatus} — a plugin, WAF, or server error is interfering.`,
      developerDiagnostics: dev,
      remediationSteps: [
        'Check the server / application error log for the failing request.',
        'Temporarily disable security/firewall plugins and retry.',
      ],
    };
  }

  return {
    code: 'UNKNOWN',
    severity: 'error',
    retryable: false,
    userSafeMessage: httpStatus
      ? `${caps.label} returned status ${httpStatus}.`
      : `${caps.label} connection failed.`,
    developerDiagnostics: dev,
    remediationSteps: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// E/F/H. Validation pipeline + standardized report
// ─────────────────────────────────────────────────────────────────────────────

export interface CmsValidationReport {
  provider: CmsProviderId;
  environmentType: CmsEnvironmentType;
  httpsEnabled: boolean;
  apiReachable: boolean;
  detectedApiRoot: string | null;
  apiBase: string | null;
  authSupported: boolean | null;
  authWorking: boolean | null;
  publishSupported: boolean | null;
  webhookSupported: boolean | null;
  errorCode: CmsErrorCode | null;
  severity: CmsErrorSeverity | null;
  retryable: boolean | null;
  remediationSteps: string[];
  diagnostics: Record<string, unknown>;
}

export interface CmsAuthProbeResult {
  ok: boolean;
  status: number | null;
  body: unknown;
  /** Friendly identity to show on success (e.g. WP user name). */
  identityLabel?: string;
}

export interface CmsPipelineInput {
  provider: string;
  siteUrl: string;
  timeoutMs: number;
  fetchFn: (url: string) => Promise<Response>;
  /**
   * Provider-specific authenticated probe against the discovered apiBase.
   * Omit to run discovery-only validation (no auth check).
   */
  authProbe?: (apiBase: string) => Promise<CmsAuthProbeResult>;
}

export interface CmsPipelineResult {
  healthy: boolean;
  message: string;
  code?: CmsErrorCode;
  providerResponse?: unknown;
  report: CmsValidationReport;
}

function blankReport(
  caps: CmsProviderCapabilities,
  env: CmsEnvironment,
): CmsValidationReport {
  return {
    provider: caps.provider,
    environmentType: env.environmentType,
    httpsEnabled: env.isHttps,
    apiReachable: false,
    detectedApiRoot: null,
    apiBase: null,
    authSupported: null,
    authWorking: null,
    publishSupported: null,
    webhookSupported: caps.webhookSupport,
    errorCode: null,
    severity: null,
    retryable: null,
    remediationSteps: [],
    diagnostics: {},
  };
}

function applyError(report: CmsValidationReport, e: CmsClassifiedError): void {
  report.errorCode = e.code;
  report.severity = e.severity;
  report.retryable = e.retryable;
  report.remediationSteps = e.remediationSteps;
  report.diagnostics = { ...report.diagnostics, developerDiagnostics: e.developerDiagnostics };
}

/**
 * Canonical validation pipeline. Steps:
 *  1) classify environment
 *  2) load provider capabilities
 *  3) HTTPS enforcement (production)
 *  4) API root discovery
 *  5) API reachability
 *  6) authentication probe (provider-supplied)
 *  7) capability-derived publish/webhook flags
 *  8) standardized report + user-safe message
 */
export async function runCmsValidationPipeline(
  input: CmsPipelineInput,
): Promise<CmsPipelineResult> {
  const caps = getProviderCapabilities(input.provider);
  const env = detectCmsEnvironment(input.siteUrl);
  const report = blankReport(caps, env);

  // (3) HTTPS enforcement — block production-HTTP before any network call.
  if (caps.requiresHttpsInProduction && env.requiresHttps && !env.isHttps) {
    const e = classifyConnectivityFailure({
      provider: caps.provider,
      httpStatus: null,
      env,
      apiReachable: false,
    });
    applyError(report, e);
    return { healthy: false, message: e.userSafeMessage, code: e.code, report };
  }

  // (4/5) API root discovery + reachability.
  const discovery = await detectProviderApiRoots(caps.provider, input.siteUrl, input.fetchFn);
  const discoveryApplicable = caps.apiDiscoveryMode === 'rest_root_probe';
  report.detectedApiRoot = discovery.detectedApiRoot;
  report.apiBase = discovery.apiBase;
  report.apiReachable = discoveryApplicable ? validateApiReachability(discovery) : true;

  if (discoveryApplicable && !report.apiReachable) {
    const e = classifyConnectivityFailure({
      provider: caps.provider,
      httpStatus: discovery.lastStatus,
      env,
      apiReachable: false,
      networkError: discovery.networkError,
    });
    applyError(report, e);
    return { healthy: false, message: e.userSafeMessage, code: e.code, report };
  }

  // (6) Authentication probe (optional — adapters that can't yet probe skip).
  if (!input.authProbe) {
    report.authSupported = null;
    report.publishSupported = null;
    return {
      healthy: true,
      message: `${caps.label} environment validated (${env.environmentType}).`,
      report,
    };
  }

  const apiBase = report.apiBase ?? input.siteUrl.replace(/\/+$/, '');
  report.authSupported = true;
  const probe = await input.authProbe(apiBase);

  if (probe.ok) {
    report.authWorking = true;
    report.publishSupported = true;
    const localNote =
      env.allowsHttpAuth && !env.isHttps ? ` (local development — HTTP auth allowed)` : '';
    const who = probe.identityLabel ? ` as "${probe.identityLabel}"` : '';
    return {
      healthy: true,
      message: `Connected to ${caps.label}${who}${localNote}.`,
      providerResponse: probe.body,
      report,
    };
  }

  const e = classifyConnectivityFailure({
    provider: caps.provider,
    httpStatus: probe.status,
    env,
    apiReachable: true,
    body: probe.body,
  });
  report.authWorking = false;
  report.publishSupported = false;
  if (e.code === 'APP_PASSWORD_DISABLED') report.authSupported = false;
  applyError(report, e);
  // Local dev fallback guidance when no specific steps were produced.
  if (
    report.remediationSteps.length === 0 &&
    env.allowsHttpAuth &&
    !env.isHttps &&
    caps.localDevGuidance
  ) {
    report.remediationSteps = localDevRemediation(caps);
  }
  return {
    healthy: false,
    message: e.userSafeMessage,
    code: e.code,
    providerResponse: probe.body,
    report,
  };
}
