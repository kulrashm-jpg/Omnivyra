import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

/**
 * Guided website onboarding wizard.
 *
 * 7 user-facing steps mapped onto the EXISTING, unchanged website-setup
 * contract step keys (create_website | verify_domain | select_cms |
 * connect_cms | install_tracking | connect_forms | summary). No backend,
 * API-contract, or schema changes — this only reuses:
 *   GET/POST /api/websites/setup, POST /api/integrations,
 *   POST /api/integrations/[id]/test, GET /api/integrations,
 *   GET /api/integrations/beta-readiness
 * Progressive disclosure, plain language, resumable (server progress),
 * no dead ends, graceful recovery, mobile-safe.
 */

type ProviderId = 'wordpress' | 'shopify' | 'webflow' | 'ghost' | 'drupal' | 'joomla' | 'custom_blog_api';

const PROVIDERS: Array<{ id: ProviderId; label: string; blurb: string }> = [
  { id: 'wordpress', label: 'WordPress', blurb: 'Most common. Uses an Application Password.' },
  { id: 'shopify', label: 'Shopify', blurb: 'Shopify store blog. Uses an Admin API token.' },
  { id: 'webflow', label: 'Webflow', blurb: 'Webflow CMS. Uses an API/OAuth token.' },
  { id: 'ghost', label: 'Ghost', blurb: 'Ghost publication. Uses an Admin API key.' },
  { id: 'drupal', label: 'Drupal', blurb: 'Drupal JSON:API. Uses a bearer token.' },
  { id: 'joomla', label: 'Joomla', blurb: 'Joomla Web Services. Uses an API token.' },
  { id: 'custom_blog_api', label: 'Custom website', blurb: 'Anything else — connect via a publishing API.' },
];

const PROVIDER_FIELDS: Record<ProviderId, Array<{ key: string; label: string; password?: boolean; hint?: string }>> = {
  wordpress: [
    { key: 'site_url', label: 'Website address', hint: 'e.g. https://yoursite.com' },
    { key: 'username', label: 'WordPress username' },
    { key: 'app_password', label: 'Application Password', password: true, hint: 'Users → Profile → Application Passwords' },
  ],
  shopify: [
    { key: 'shop_domain', label: 'Store domain', hint: 'e.g. yourstore.myshopify.com' },
    { key: 'shopify_access_token', label: 'Admin API access token', password: true, hint: 'Custom app token with write_content' },
  ],
  webflow: [{ key: 'access_token', label: 'Webflow API token', password: true, hint: 'Site API token or OAuth access token' }],
  ghost: [
    { key: 'site_url', label: 'Ghost site URL', hint: 'e.g. https://yourblog.com' },
    { key: 'admin_api_key', label: 'Admin API key', password: true, hint: 'Settings → Integrations → Admin API Key (id:secret)' },
  ],
  drupal: [
    { key: 'site_url', label: 'Drupal site URL' },
    { key: 'bearer_token', label: 'Bearer token', password: true },
  ],
  joomla: [
    { key: 'site_url', label: 'Joomla site URL' },
    { key: 'api_token', label: 'Joomla API token', password: true },
  ],
  custom_blog_api: [
    { key: 'endpoint_url', label: 'Publishing endpoint URL' },
    { key: 'api_key', label: 'API key', password: true },
  ],
};

// UX step → existing contract step key it completes.
const WIZARD: Array<{ key: string; title: string; subtitle: string; contractStep: string | null }> = [
  { key: 'url', title: 'Your website', subtitle: 'Where should Omnivyra publish and track?', contractStep: 'create_website' },
  { key: 'platform', title: 'Confirm platform', subtitle: 'Tell us how your site is built so we show the right steps.', contractStep: 'select_cms' },
  { key: 'connect', title: 'Connect it', subtitle: 'Enter the credentials for your platform.', contractStep: null },
  { key: 'validate', title: 'Check publishing', subtitle: 'We verify we can actually publish before you rely on it.', contractStep: 'connect_cms' },
  { key: 'tracking', title: 'Visitor tracking', subtitle: 'Add one snippet so we can attribute visitors and leads.', contractStep: 'install_tracking' },
  { key: 'forms', title: 'Forms & leads', subtitle: 'Capture leads from your site.', contractStep: 'connect_forms' },
  { key: 'review', title: 'Review & activate', subtitle: 'Confirm what we detected and turn it on.', contractStep: 'summary' },
];

function guessProvider(url: string): ProviderId | null {
  const u = url.toLowerCase();
  if (u.includes('myshopify.com')) return 'shopify';
  if (u.includes('webflow.io')) return 'webflow';
  return null;
}

export default function WebsiteSetupPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [website, setWebsite] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const [name, setName] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [revalidateFresh, setRevalidateFresh] = useState(false);
  const [beta, setBeta] = useState<any>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDiag, setShowDiag] = useState(false);

  const completed = useMemo(() => new Set<string>(progress?.completed_steps ?? []), [progress]);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/websites/setup?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      const data = await res.json();
      setWebsite(data.website || null);
      setProgress(data.progress || null);
      if (data.website) {
        setName(data.website.name || '');
        setCanonicalUrl(data.website.canonical_url || '');
      }
      // Recover an existing CMS integration for resumability.
      const intRes = await fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      const intData = await intRes.json().catch(() => ({}));
      const cms = (intData.integrations || []).find((i: any) =>
        ['wordpress', 'shopify', 'webflow', 'ghost', 'drupal', 'joomla', 'custom_blog_api'].includes(i.type),
      );
      if (cms) {
        setIntegrationId(cms.id);
        setProvider(cms.type);
      }
      // Resume at the furthest incomplete step.
      const done: string[] = data.progress?.completed_steps ?? [];
      let resume = 0;
      for (let i = 0; i < WIZARD.length; i += 1) {
        const cs = WIZARD[i].contractStep;
        if (cs && done.includes(cs)) resume = i + 1;
      }
      setStepIndex(Math.min(resume, WIZARD.length - 1));
    } catch {
      setError('Could not load your setup progress. You can keep going — nothing is lost.');
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  async function markStep(contractStep: string, state: Record<string, unknown> = {}) {
    if (!companyId || !website?.id) return;
    const res = await fetch('/api/websites/setup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId, website_id: website.id, step: contractStep, state }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setProgress(data.progress);
  }

  const step = WIZARD[stepIndex];

  const goNext = () => setStepIndex((i) => Math.min(i + 1, WIZARD.length - 1));
  // Going back to edit invalidates any stale validation result so Step 4
  // re-processes from scratch instead of showing the old error.
  const goBack = () => {
    setValidation(null);
    setError('');
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  // STEP 1 — create/select website.
  async function handleUrlStep() {
    setError('');
    if (!companyId) { setError('Select a company first.'); return; }
    if (!canonicalUrl.trim()) { setError('Enter your website address.'); return; }
    setBusy(true);
    try {
      if (!website) {
        const res = await fetch('/api/websites/setup', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyId,
            action: 'create_website',
            name: name.trim() || canonicalUrl.trim(),
            canonical_url: canonicalUrl.trim(),
            cms_provider: provider ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Could not save your website.'); return; }
        setWebsite(data.website);
        setProgress(data.progress);
      }
      const guess = guessProvider(canonicalUrl);
      if (guess) setProvider(guess);
      goNext();
    } finally {
      setBusy(false);
    }
  }

  // STEP 2 — confirm platform (also marks verify_domain + select_cms).
  async function handlePlatformStep() {
    if (!provider) { setError('Choose your website platform to continue.'); return; }
    setError('');
    setBusy(true);
    try {
      if (!completed.has('verify_domain')) await markStep('verify_domain', { verification: 'linked_to_domain_record' });
      await markStep('select_cms', { provider });
      goNext();
    } finally {
      setBusy(false);
    }
  }

  // STEP 3 — create the integration (connection) for the chosen platform.
  async function handleConnectStep() {
    if (!provider) { setError('Pick a platform first.'); return; }
    setError('');
    const fields = PROVIDER_FIELDS[provider];
    const missing = fields.find((f) => !config[f.key]?.trim());
    if (missing) { setError(`${missing.label} is required.`); return; }
    setBusy(true);
    try {
      if (!integrationId) {
        const res = await fetch('/api/integrations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: companyId,
            type: provider,
            name: `${website?.name || canonicalUrl} (${provider})`,
            config,
            website_id: website?.id ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error || 'Could not save the connection.'); return; }
        setIntegrationId(data.integration?.id ?? null);
      } else {
        // Integration already exists — the user edited credentials/URL. PERSIST
        // the change (previously this was a no-op, so a corrected https:// URL
        // was ignored and validation kept failing on the old URL).
        const res = await fetch(`/api/integrations/${integrationId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, config }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error || 'Could not update the connection.'); return; }
      }
      // Force a fresh validation (with API rediscovery) on the next step so the
      // edited URL is actually re-tested and the result reflects reality.
      setValidation(null);
      setRevalidateFresh(true);
      goNext();
    } finally {
      setBusy(false);
    }
  }

  // STEP 4 — validate publishing; only mark connect_cms on success.
  async function handleValidateStep(rediscover = false) {
    if (!integrationId) { setError('Connect your platform first.'); return; }
    setError('');
    setBusy(true);
    // After an edit, force API rediscovery so the corrected URL is re-probed
    // and any cached/persisted base from the failed attempt is discarded.
    const forceFresh = rediscover || revalidateFresh;
    try {
      const res = await fetch(`/api/integrations/${integrationId}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, rediscover: forceFresh }),
      });
      const data = await res.json().catch(() => ({}));
      setValidation(data);
      setRevalidateFresh(false);
      if (data.success) {
        await markStep('connect_cms', { provider, integration_id: integrationId });
      }
    } finally {
      setBusy(false);
    }
  }

  const trackerSnippet = website
    ? `<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/omnivera-tracker.js" data-website-id="${website.id}"></script>`
    : '';

  async function handleReviewLoad() {
    if (!companyId) return;
    try {
      const res = await fetch(`/api/integrations/beta-readiness?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      if (res.ok) setBeta(await res.json());
    } catch { /* review still renders without the report */ }
  }
  useEffect(() => { if (step.key === 'review') void handleReviewLoad(); /* eslint-disable-next-line */ }, [step.key]);

  // Auto-run the publishing check on entering Step 4 when there is no current
  // result (e.g. just arrived, or came back after editing the URL) so the user
  // immediately sees a fresh, accurate result instead of a stale one.
  useEffect(() => {
    if (step.key === 'validate' && integrationId && !validation && !busy) {
      void handleValidateStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.key, integrationId]);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Connect your website</h1>
          <p className="mt-1 text-sm text-gray-600">A few guided steps. You can stop any time — your progress is saved.</p>
        </header>

        {/* Progress rail (mobile-safe horizontal scroll) */}
        <ol className="flex gap-2 overflow-x-auto pb-1">
          {WIZARD.map((w, i) => {
            const isDone = w.contractStep ? completed.has(w.contractStep) : i < stepIndex;
            const isCurrent = i === stepIndex;
            return (
              <li key={w.key}>
                <button
                  type="button"
                  onClick={() => i <= stepIndex && setStepIndex(i)}
                  disabled={i > stepIndex}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
                    isCurrent
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                      : isDone
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 bg-white text-gray-400'
                  }`}
                >
                  {i + 1}. {w.title}
                </button>
              </li>
            );
          })}
        </ol>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {!companyId && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Select a company to start setup.
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">{step.title}</h2>
          <p className="mt-1 text-sm text-gray-500">{step.subtitle}</p>

          <div className="mt-5 space-y-4">
            {step.key === 'url' && (
              <>
                <label className="block text-sm font-medium text-gray-700">
                  Website address
                  <input
                    value={canonicalUrl}
                    onChange={(e) => setCanonicalUrl(e.target.value)}
                    placeholder="https://yoursite.com"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Name (optional)
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My company site"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </>
            )}

            {step.key === 'platform' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={`rounded-lg border p-3 text-left text-sm ${
                      provider === p.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-900">{p.label}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{p.blurb}</div>
                  </button>
                ))}
              </div>
            )}

            {step.key === 'connect' && provider && (
              <div className="space-y-3">
                {PROVIDER_FIELDS[provider].map((f) => (
                  <label key={f.key} className="block text-sm font-medium text-gray-700">
                    {f.label}
                    <input
                      type={f.password ? 'password' : 'text'}
                      value={config[f.key] || ''}
                      onChange={(e) => {
                        setConfig((c) => ({ ...c, [f.key]: e.target.value }));
                        // Editing credentials invalidates the prior result.
                        if (validation) setValidation(null);
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    {f.hint && <span className="mt-1 block text-xs font-normal text-gray-500">{f.hint}</span>}
                  </label>
                ))}
              </div>
            )}

            {step.key === 'validate' && (
              <div className="space-y-3">
                {!validation && <p className="text-sm text-gray-600">Run the check to confirm we can publish to your site.</p>}
                {validation && (
                  <div
                    className={`rounded-lg border p-3 text-sm ${
                      validation.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    <p className="font-medium">{validation.success ? 'Publishing is ready.' : 'We could not publish yet.'}</p>
                    <p className="mt-0.5">{validation.message}</p>
                    {!validation.success && Array.isArray(validation.diagnostics?.remediationSteps) && validation.diagnostics.remediationSteps.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {validation.diagnostics.remediationSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                    {validation.diagnostics && (
                      <button type="button" onClick={() => setShowDiag((v) => !v)} className="mt-2 text-xs font-medium underline">
                        {showDiag ? 'Hide' : 'Show'} technical details
                      </button>
                    )}
                    {showDiag && validation.diagnostics && (
                      <pre className="mt-2 overflow-x-auto rounded bg-white/60 p-2 text-[11px] text-gray-700">
                        {JSON.stringify(validation.diagnostics, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleValidateStep(false)} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {busy ? 'Checking…' : validation ? 'Re-check' : 'Run check'}
                  </button>
                  {validation && !validation.success && (
                    <button onClick={() => handleValidateStep(true)} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">
                      Re-detect API & retry
                    </button>
                  )}
                </div>
              </div>
            )}

            {step.key === 'tracking' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Paste this once into your site's &lt;head&gt;. It links visitors, sessions, and form leads back to campaigns.
                </p>
                <pre className="overflow-x-auto rounded-lg bg-gray-950 p-3 text-[11px] leading-relaxed text-emerald-300">{trackerSnippet}</pre>
                <button
                  onClick={() => navigator.clipboard?.writeText(trackerSnippet).catch(() => undefined)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
                >
                  Copy snippet
                </button>
              </div>
            )}

            {step.key === 'forms' && (
              <div className="space-y-3 text-sm text-gray-600">
                <p>Collect leads from your existing forms, or use an Omnivyra hosted form. Supported form systems are detected automatically once the tracker is live (Contact Form 7, Gravity, Elementor, WPForms, Ninja, generic HTML).</p>
                <a href="/leads?tab=forms" className="inline-block rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">Open forms workspace</a>
              </div>
            )}

            {step.key === 'review' && (
              <div className="space-y-3">
                <ReadinessSummary beta={beta} validation={validation} provider={provider} />
                <p className="text-xs text-gray-500">Activating finishes onboarding. You can revisit any step later from Integrations.</p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex === 0 || busy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-40 sm:w-auto"
            >
              Back
            </button>
            <div className="flex gap-2">
              {step.key === 'tracking' || step.key === 'forms' ? (
                <button
                  type="button"
                  onClick={async () => { if (step.contractStep) await markStep(step.contractStep, { skipped: false }); goNext(); }}
                  disabled={busy}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Done — continue
                </button>
              ) : step.key === 'review' ? (
                <button
                  type="button"
                  onClick={async () => { await markStep('summary', { activated_at: new Date().toISOString() }); void load(); }}
                  disabled={busy || !website}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Activate integration
                </button>
              ) : step.key === 'validate' ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!validation?.success}
                  title={validation?.success ? '' : 'Run a successful check to continue'}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={
                    step.key === 'url' ? handleUrlStep : step.key === 'platform' ? handlePlatformStep : handleConnectStep
                  }
                  disabled={busy || !companyId}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Continue'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ReadinessSummary({ beta, validation, provider }: { beta: any; validation: any; provider: string | null }) {
  const rec = beta?.rolloutRecommendation as string | undefined;
  const tone =
    rec === 'go' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : rec === 'go_with_caution' ? 'border-amber-200 bg-amber-50 text-amber-800'
    : rec === 'hold' ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-gray-200 bg-gray-50 text-gray-700';
  return (
    <div className={`rounded-lg border p-3 text-sm ${tone}`}>
      <p className="font-semibold">
        {validation?.success ? `Publishing verified${provider ? ` for ${provider}` : ''}.` : 'Publishing not yet verified.'}
      </p>
      {beta ? (
        <>
          <p className="mt-1">
            Readiness: <strong>{rec ?? 'unknown'}</strong> · risk <strong>{beta.operationalRisk}</strong>
          </p>
          {Array.isArray(beta.unresolvedBlockers) && beta.unresolvedBlockers.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {beta.unresolvedBlockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-1 text-xs">Readiness report unavailable — you can still activate.</p>
      )}
    </div>
  );
}
