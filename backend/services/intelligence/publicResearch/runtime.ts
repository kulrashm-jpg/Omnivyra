/**
 * Public research — what this run could reach, and why not when it could not.
 *
 * One row per capability, recorded at collection time from the runtime itself: whether an adapter
 * exists, whether a credential is PRESENT (a boolean; values are never read into the record),
 * whether it was attempted, and the outcome, classed as the brief requires:
 *   measured · partial · not_searched · restricted · no_adapter · missing_credential ·
 *   request_failed · quota_restricted · searched_not_found
 * A stale "not configured" from an older run can then be checked against this record.
 */
import type { SurfaceAnswer } from './aiAnswers';
import { SURFACES } from './aiAnswers';

export type ReasonClass =
  | 'measured' | 'partial' | 'not_searched' | 'restricted' | 'no_adapter' | 'missing_credential'
  | 'request_failed' | 'quota_restricted' | 'searched_not_found';

export type Capability = {
  id: string;
  label: string;
  family: 'ai_answers' | 'search' | 'website' | 'social' | 'mentions' | 'reviews' | 'backlinks' | 'page_speed' | 'knowledge_graph';
  adapter: boolean;
  /** Is a credential present at runtime. null = none needed. */
  credential: boolean | null;
  attempted: boolean;
  reason: ReasonClass;
  outcome: string;
  /** The cheapest compliant way to measure it, when it was not measured. */
  nextStep: string | null;
};

export type RuntimeSnapshot = { checkedAt: string; capabilities: Capability[] };

const present = (...names: string[]) => names.some((n) => Boolean(process.env[n] && process.env[n]!.trim()));

/** AI answer tools, from what this run actually did. */
export function aiCapabilities(answers: SurfaceAnswer[]): Capability[] {
  return SURFACES.map((sf): Capability => {
    const rs = answers.filter((a) => a.surface === sf.id);
    const ok = rs.filter((a) => a.status === 'observed').length;
    // A managed (Super Admin) credential is not in the environment: a request that was made proves one.
    const credential = sf.keys.length ? present(...sf.keys) || rs.some((a) => a.status !== 'not_measured') : null;
    const base = { id: `ai:${sf.id}`, label: sf.label, family: 'ai_answers' as const, adapter: !sf.unavailable, credential };
    if (sf.unavailable) {
      return { ...base, attempted: false, reason: 'no_adapter', outcome: sf.unavailable, nextStep: 'An adapter for the provider’s grounded API (paid usage), or a manual check recorded as evidence.' };
    }
    if (!rs.length) return { ...base, attempted: false, reason: 'not_searched', outcome: 'Not run in this report (excluded by configuration).', nextStep: 'Include it in the research run.' };
    if (rs.every((a) => a.status === 'not_measured')) {
      return { ...base, attempted: false, reason: 'missing_credential', outcome: 'No credential is configured.', nextStep: `Add an API key for ${sf.label}.` };
    }
    const failures = rs.filter((a) => a.status === 'failed_source');
    const quota = failures.some((a) => /\b429\b|quota|credit|billing|run out of searches/i.test(a.reason ?? ''));
    if (ok === rs.length) return { ...base, attempted: true, reason: 'measured', outcome: `${ok} of ${rs.length} questions answered from live web search.`, nextStep: null };
    if (ok > 0) return { ...base, attempted: true, reason: 'partial', outcome: `${ok} of ${rs.length} questions answered from live web search; ${failures.length} failed${quota ? ' (quota or billing limit)' : ''}.`, nextStep: quota ? 'Raise the plan or quota.' : 'Retry the failed questions.' };
    // The provider's own words, so the outcome never claims more than the provider said.
    const said = failures.find((a) => a.error?.message)?.error?.message ?? failures[0]?.reason ?? null;
    return { ...base, attempted: true, reason: quota ? 'quota_restricted' : 'request_failed',
      outcome: `Every request was refused${said ? `; the provider said: “${said.slice(0, 140)}”` : ''}.`,
      nextStep: /run out of searches/i.test(said ?? '') ? 'The plan’s searches for this period are used up: wait for the monthly reset, or extend the plan.'
        : quota ? 'Read the provider’s quota page to see which limit applies, then raise it or use a model that has an allowance.' : 'Check the provider status and retry.' };
  });
}

/**
 * Configuration facts only (adapter + credential presence). The report run, not this step, makes
 * these requests, so the ledger takes their outcome from the run's own evidence.
 */
export function configCapabilities(opts: {
  /** Where PageSpeed's credential resolved (pageSpeedClient), so a Super Admin key counts, not just the env. */
  pageSpeed?: 'managed' | 'environment' | 'keyless' | 'disabled' | 'none';
  /** Whether SerpAPI resolved a credential (managed account or env), when the caller knows. */
  serp?: boolean;
} = {}): Capability[] {
  const serp = opts.serp ?? present('SERPAPI_KEY', 'SERP_API_KEY', 'SERPAPI_API_KEY');
  const ahrefs = present('AHREFS_API_KEY');
  const psi = opts.pageSpeed ? ['managed', 'environment', 'keyless'].includes(opts.pageSpeed)
    : present('PAGESPEED_API_KEY') || /^(1|true|on|yes)$/i.test(process.env.PAGESPEED_ENABLED ?? '');
  const row = (id: string, label: string, family: Capability['family'], credential: boolean, next: string): Capability => ({
    id, label, family, adapter: true, credential, attempted: false,
    reason: credential ? 'not_searched' : 'missing_credential',
    outcome: credential ? 'Configured; the outcome comes from the report run.' : 'An adapter exists but no credential is configured.',
    nextStep: credential ? null : next,
  });
  return [
    row('search:serp', 'Search results', 'search', serp, 'Add a SerpAPI key.'),
    row('backlinks', 'Backlinks / referring domains', 'backlinks', ahrefs, 'Connect a backlink data source (an Ahrefs adapter is implemented), or read the Search Console Links report by hand.'),
    opts.pageSpeed === 'disabled'
      ? { ...row('page_speed', 'Page speed', 'page_speed', false, 'Enable Google PageSpeed Insights in Super Admin.'), reason: 'not_searched', outcome: 'Disabled in Super Admin.' }
      : row('page_speed', 'Page speed', 'page_speed', psi, 'Add an application-level PageSpeed Insights key in Super Admin (Google PageSpeed Insights).'),
  ];
}
