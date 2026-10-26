/**
 * Public research — free provider checks, so a source gap is explained by evidence.
 *
 * Only endpoints that cost nothing are called: SerpAPI's account endpoint (documented as not counted
 * toward the quota), the model-list / model-metadata endpoints of OpenAI, Anthropic and Gemini, and a
 * PageSpeed Insights run through the shared client (no paid usage; keyless allowed). Nothing generates text,
 * searches or grounds an answer here.
 *
 * Credential values are never recorded: only whether one resolved, from where (managed account or
 * environment variable name), and what the provider said about it. Each record says where it ran
 * ("production" or "local"), because a workstation's credentials can differ from production's.
 */
import { errorEvidence, classifyProviderError, sanitize, type ErrorClass } from './providerErrors';
import { pageSpeedFailure, pageSpeedSuccess, runPageSpeed, type PageSpeedIssue } from '../../pageSpeedClient';

/** A PageSpeed client issue in this module's outcome vocabulary. */
const PSI_OUTCOME: Record<PageSpeedIssue, ProviderCheck['outcome']> = {
  disabled: 'disabled', not_configured: 'not_configured', invalid_key: 'invalid_credential', api_disabled: 'permission_denied',
  quota_exhausted: 'quota_exhausted', timeout: 'request_failed', provider_failure: 'provider_unavailable', malformed_response: 'request_failed',
};

export type ProviderCheck = {
  provider: string;
  check: string;
  /** The operation called, without any key. */
  operation: string;
  at: string;
  environment: 'production' | 'local';
  credential: 'present' | 'absent' | 'not_needed';
  credentialSource: string | null;
  httpStatus: number | null;
  /** `not_configured` / `disabled`: no request was made (no credential; switched off in Super Admin). */
  outcome: 'ok' | ErrorClass | 'not_checked' | 'not_configured' | 'disabled';
  causeConfirmed: boolean;
  detail: string;
};

// A pulled .env file can carry VERCEL=1 locally; only a running Vercel function has AWS_LAMBDA_FUNCTION_NAME.
// Reports are also generated on the Railway worker, which Railway itself labels with its environment name.
const ENV = (): ProviderCheck['environment'] =>
  (process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.VERCEL_ENV === 'production') || /^production$/i.test(process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? '')
    ? 'production' : 'local';
const firstEnv = (names: string[]) => names.find((n) => process.env[n]?.trim()) ?? null;

async function call(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<{ status: number | null; body: any }> {
  try {
    // ssrf-ok: fixed provider endpoints only (serpapi.com, api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, www.googleapis.com)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (error) {
    return { status: null, body: { error: { message: error instanceof Error ? error.message : String(error) } } };
  }
}

function judged(status: number | null, body: unknown, okDetail: string): Pick<ProviderCheck, 'httpStatus' | 'outcome' | 'causeConfirmed' | 'detail'> {
  if (status != null && status < 400) return { httpStatus: status, outcome: 'ok', causeConfirmed: true, detail: okDetail };
  const ev = errorEvidence(status, body);
  const c = classifyProviderError(ev);
  return { httpStatus: status, outcome: c.errorClass, causeConfirmed: c.causeConfirmed, detail: `${c.basis}${ev.message ? ` Provider message: “${ev.message}”.` : ''}` };
}

export async function runProviderChecks(domain: string, opts: { environment?: ProviderCheck['environment'] } = {}): Promise<ProviderCheck[]> {
  const at = () => new Date().toISOString();
  const environment = opts.environment ?? ENV();
  const checks: Promise<ProviderCheck>[] = [];

  // SerpAPI — the credential the report run resolves (managed account first), then the plan's remaining searches.
  checks.push((async () => {
    const { resolveProviderCredential } = await import('../../providerCredentialResolver').catch(() => ({ resolveProviderCredential: null as never }));
    const cred = resolveProviderCredential ? await resolveProviderCredential('serpapi').catch(() => null) : null;
    const base = { provider: 'SerpAPI', check: 'Credential and remaining searches', operation: 'GET serpapi.com/account.json (free; not counted toward the quota)', at: at(), environment,
      credential: (cred?.value ? 'present' : 'absent') as ProviderCheck['credential'], credentialSource: cred?.value ? (cred.source === 'managed' ? 'managed Super Admin account' : `environment variable ${cred.envName}`) : null };
    if (!cred?.value) return { ...base, httpStatus: null, outcome: 'not_checked', causeConfirmed: true, detail: 'No SerpAPI credential resolved.' };
    const r = await call(`https://serpapi.com/account.json?api_key=${encodeURIComponent(cred.value)}`);
    const left = r.body?.total_searches_left ?? r.body?.plan_searches_left;
    const res = judged(r.status, r.body, `Valid key; plan “${sanitize(String(r.body?.plan_name ?? 'unknown'))}”; ${left ?? 'unknown'} searches left this period.`);
    return { ...base, ...res, outcome: res.outcome === 'ok' && Number(left) === 0 ? 'quota_exhausted' : res.outcome };
  })());

  const keyed = (provider: string, envNames: string[], url: string, headers: (k: string) => Record<string, string>, okDetail: (b: any) => string, operation: string) => (async (): Promise<ProviderCheck> => {
    const name = firstEnv(envNames);
    const base = { provider, check: 'Credential (model list / metadata)', operation, at: at(), environment, credential: (name ? 'present' : 'absent') as ProviderCheck['credential'], credentialSource: name ? `environment variable ${name}` : null };
    if (!name) return { ...base, httpStatus: null, outcome: 'not_checked', causeConfirmed: true, detail: `No credential (${envNames.join(' / ')}) is configured.` };
    const r = await call(url, headers(process.env[name]!.trim()));
    return { ...base, ...judged(r.status, r.body, okDetail(r.body)) };
  })();

  checks.push(keyed('OpenAI', ['OPENAI_API_KEY'], 'https://api.openai.com/v1/models', (k) => ({ authorization: `Bearer ${k}` }),
    (b) => `Key accepted; ${Array.isArray(b?.data) ? b.data.length : 'some'} models listed. Listing models does not test credit or search entitlement.`, 'GET /v1/models (free)'));
  checks.push(keyed('Anthropic', ['ANTHROPIC_API_KEY'], 'https://api.anthropic.com/v1/models', (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
    (b) => `Key accepted; ${Array.isArray(b?.data) ? b.data.length : 'some'} models listed. Listing models does not test credit or web-search entitlement.`, 'GET /v1/models (free)'));
  const geminiModel = process.env.PUBLIC_RESEARCH_GEMINI_MODEL ?? 'gemini-2.5-flash';
  checks.push(keyed('Gemini', ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}`, (k) => ({ 'x-goog-api-key': k }),
    (b) => `Key accepted; model “${sanitize(String(b?.displayName ?? geminiModel))}” is visible. Model metadata does not test the Google Search grounding quota.`, `GET models/${geminiModel} (free metadata)`));
  checks.push(Promise.resolve({ provider: 'Perplexity', check: 'Credential', operation: '— (no free check endpoint used)', at: at(), environment,
    credential: (firstEnv(['PERPLEXITY_API_KEY']) ? 'present' : 'absent') as ProviderCheck['credential'], credentialSource: firstEnv(['PERPLEXITY_API_KEY']) ? 'environment variable PERPLEXITY_API_KEY' : null,
    httpStatus: null, outcome: 'not_checked' as const, causeConfirmed: true, detail: firstEnv(['PERPLEXITY_API_KEY']) ? 'A key is present but was not tested (no free endpoint is called).' : 'No credential is configured.' }));

  // PageSpeed Insights: one mobile run of the company's own homepage, through the shared client (the
  // application-level Super Admin key, else PAGESPEED_API_KEY, else the documented keyless route;
  // nothing when disabled in Super Admin). A fresh result the report run already fetched is reused.
  checks.push((async () => {
    const target = `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/`;
    const r = await runPageSpeed({ url: target, strategy: 'mobile', category: 'performance', timeoutMs: 90_000, allowKeyless: true });
    const how = r.source === 'managed' ? 'Super Admin key' : r.source === 'environment' ? 'environment key' : r.source === 'keyless' ? 'keyless' : r.source;
    const base = { provider: 'PageSpeed Insights', check: 'Homepage, mobile', operation: `GET pagespeedonline/v5/runPagespeed (${how})`, at: at(), environment,
      credential: (r.source === 'managed' || r.source === 'environment' ? 'present' : r.source === 'keyless' ? 'not_needed' : 'absent') as ProviderCheck['credential'],
      credentialSource: r.source === 'managed' ? 'Super Admin (Google PageSpeed Insights)' : r.source === 'environment' ? 'environment variable PAGESPEED_API_KEY' : null };
    const fail = pageSpeedFailure(r);
    if (fail) return { ...base, httpStatus: fail.httpStatus, outcome: PSI_OUTCOME[fail.issue], causeConfirmed: fail.issue !== 'provider_failure', detail: fail.detail };
    const ok = pageSpeedSuccess(r)!;
    const lh = (ok.body as any)?.lighthouseResult;
    const score = typeof lh?.categories?.performance?.score === 'number' ? Math.round(lh.categories.performance.score * 100) : null;
    const audit = (id: string) => sanitize(String(lh?.audits?.[id]?.displayValue ?? '—'));
    return { ...base, httpStatus: 200, outcome: 'ok' as const, causeConfirmed: true,
      detail: `${score == null ? 'Answered without a performance score.' : `Performance ${score}/100; LCP ${audit('largest-contentful-paint')}; CLS ${audit('cumulative-layout-shift')}; TBT ${audit('total-blocking-time')} (lab data, one run).`}${ok.fromCache ? ` Result fetched ${ok.fetchedAt.slice(0, 16).replace('T', ' ')} UTC and reused from cache.` : ''}` };
  })());

  return Promise.all(checks);
}
