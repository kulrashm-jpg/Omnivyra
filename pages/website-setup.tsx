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

type ProviderId = 'wordpress' | 'shopify' | 'webflow' | 'ghost' | 'drupal' | 'joomla' | 'hubspot' | 'wix' | 'squarespace' | 'custom_blog_api';

const PROVIDERS: Array<{ id: ProviderId; label: string; blurb: string }> = [
  { id: 'wordpress', label: 'WordPress', blurb: 'Most common. Uses an Application Password.' },
  { id: 'shopify', label: 'Shopify', blurb: 'Shopify store blog. Uses an Admin API token.' },
  { id: 'webflow', label: 'Webflow', blurb: 'Webflow CMS. Uses an API/OAuth token.' },
  { id: 'ghost', label: 'Ghost', blurb: 'Ghost publication. Uses an Admin API key.' },
  { id: 'drupal', label: 'Drupal', blurb: 'Drupal JSON:API. Uses a bearer token.' },
  { id: 'joomla', label: 'Joomla', blurb: 'Joomla Web Services. Uses an API token.' },
  { id: 'hubspot', label: 'HubSpot CMS', blurb: 'HubSpot Blog Posts API. Uses an access token + blog_id.' },
  { id: 'wix', label: 'Wix', blurb: 'Wix Blog. Uses an API key + site id.' },
  { id: 'squarespace', label: 'Squarespace', blurb: 'Read-only — Squarespace has no public write API; publishing is not supported.' },
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
  hubspot: [
    { key: 'access_token', label: 'HubSpot access token', password: true, hint: 'Private-app token OR OAuth access token (content scope).' },
    { key: 'blog_id', label: 'HubSpot Blog ID', hint: 'Marketing → Website → Blog → Blog ID.' },
  ],
  wix: [
    { key: 'api_key', label: 'Wix API key', password: true, hint: 'Wix Dashboard → Settings → Headless settings.' },
    { key: 'wix_site_id', label: 'Wix Site ID' },
    { key: 'wix_account_id', label: 'Wix Account ID (optional)', hint: 'Required for app tokens; leave blank for site tokens.' },
  ],
  squarespace: [
    { key: 'site_url', label: 'Squarespace site URL', hint: 'Reachability validated only — publishing is NOT supported.' },
  ],
};

// UX step → existing contract step key it completes.
const WIZARD: Array<{ key: string; title: string; subtitle: string; contractStep: string | null }> = [
  { key: 'url', title: 'Your website', subtitle: 'Where should Omnivyra publish and track?', contractStep: 'create_website' },
  { key: 'platform', title: 'Confirm platform', subtitle: 'Tell us how your site is built so we show the right steps.', contractStep: 'select_cms' },
  { key: 'verify', title: 'Verify your domain', subtitle: 'Prove you own the domain to unlock verified attribution. Optional — capture still works while pending.', contractStep: 'verify_domain' },
  { key: 'connect', title: 'Connect it', subtitle: 'Enter the credentials for your platform.', contractStep: null },
  { key: 'validate', title: 'Check publishing', subtitle: 'We verify we can actually publish before you rely on it.', contractStep: 'connect_cms' },
  { key: 'analytics', title: 'Connect Google Analytics (GA4)', subtitle: 'Optional — lets us show per-blog views and traffic sources.', contractStep: null },
  { key: 'tracking', title: 'Visitor tracking', subtitle: 'Add one snippet so we can attribute visitors and leads.', contractStep: 'install_tracking' },
  { key: 'forms', title: 'Forms & leads', subtitle: 'Capture leads from your site.', contractStep: 'connect_forms' },
  { key: 'review', title: 'Review & activate', subtitle: 'Confirm what we detected and turn it on.', contractStep: 'summary' },
];

function guessProvider(url: string): ProviderId | null {
  const u = url.toLowerCase();
  if (u.includes('myshopify.com')) return 'shopify';
  if (u.includes('webflow.io')) return 'webflow';
  if (u.includes('squarespace.com')) return 'squarespace';
  if (u.includes('wixsite.com') || u.includes('wix.com')) return 'wix';
  if (u.includes('hubspotpagebuilder.com') || u.includes('hubspot.com')) return 'hubspot';
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

  // Phase 17 — domain verification, WordPress self-service token, activation readiness.
  const [domainStatus, setDomainStatus] = useState<any>(null);
  const [domainToken, setDomainToken] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainMsg, setDomainMsg] = useState('');
  const [wpToken, setWpToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [readiness, setReadiness] = useState<any>(null);
  const [settingsForm, setSettingsForm] = useState<{ allowUnverified: boolean; allowedDomains: string } | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  const completed = useMemo(() => new Set<string>(progress?.completed_steps ?? []), [progress]);
  const domainHost = useMemo(() => {
    try { return canonicalUrl ? new URL(canonicalUrl.startsWith('http') ? canonicalUrl : `https://${canonicalUrl}`).hostname : ''; } catch { return ''; }
  }, [canonicalUrl]);
  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => undefined); };

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

  // ── Phase 17 reused-API handlers (no backend changes) ──
  const loadDomainStatus = useCallback(async () => {
    if (!companyId) return;
    setDomainMsg('');
    try {
      const res = await fetch(`/api/domain/verification-status?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDomainStatus(data);
      else { setDomainStatus(null); setDomainMsg(data.error === 'DOMAIN_NOT_FOUND' ? 'No domain record yet for this company.' : (data.details || data.error || 'Could not load verification status.')); }
    } catch { setDomainMsg('Could not load verification status.'); }
  }, [companyId]);

  async function regenDomainToken() {
    setDomainBusy(true); setDomainMsg('');
    try {
      const res = await fetch('/api/domain/regenerate-token', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(domainStatus?.final_domain ? { domain: domainStatus.final_domain } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) { setDomainToken(data.token); await loadDomainStatus(); }
      else setDomainMsg(data.details || data.error || 'Could not generate a verification token.');
    } finally { setDomainBusy(false); }
  }

  async function verifyDomain() {
    setDomainBusy(true); setDomainMsg('');
    try {
      const domain = domainStatus?.final_domain || domainHost;
      const res = await fetch('/api/domain/verify', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'verified') {
        await loadDomainStatus();
        if (!completed.has('verify_domain')) await markStep('verify_domain', { method: data.method });
      } else {
        setDomainMsg(data.details || data.code || 'Not verified yet — add the record below, then refresh.');
      }
    } finally { setDomainBusy(false); }
  }

  async function genWpToken() {
    if (!companyId) return;
    setDomainBusy(true);
    try {
      const res = await fetch('/api/wordpress-plugin/setup-session', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, website_id: website?.id ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.setupToken) setWpToken({ token: data.setupToken, expiresAt: data.expiresAt });
      else setError(data.error || 'Could not generate a WordPress setup token.');
    } finally { setDomainBusy(false); }
  }

  async function saveSettings() {
    if (!website?.id || !companyId || !settingsForm) return;
    setSettingsBusy(true); setSettingsMsg('');
    try {
      const allowed_tracking_domains = settingsForm.allowedDomains.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/websites/${website.id}?company_id=${encodeURIComponent(companyId)}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { allow_unverified_ingestion: settingsForm.allowUnverified, allowed_tracking_domains } }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.website) { setWebsite(data.website); setSettingsMsg('Saved.'); }
      else setSettingsMsg(data.error || 'Could not save settings.');
    } finally { setSettingsBusy(false); }
  }

  const loadReadiness = useCallback(async () => {
    if (!companyId) return;
    try {
      const [r, i] = await Promise.all([
        fetch(`/api/activation/readiness?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
        fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      setReadiness({ checks: r?.checks ?? [], activated: !!r?.activated, hasWebhook: ((i?.integrations) || []).some((x: any) => x.type === 'lead_webhook') });
    } catch { /* review still renders */ }
  }, [companyId]);

  const step = WIZARD[stepIndex];

  useEffect(() => { if (step.key === 'verify') void loadDomainStatus(); }, [step.key, loadDomainStatus]);
  useEffect(() => { if (step.key === 'review') { void loadReadiness(); void loadDomainStatus(); } }, [step.key, loadReadiness, loadDomainStatus]);
  useEffect(() => {
    if (website && settingsForm === null) {
      setSettingsForm({
        allowUnverified: website.settings?.allow_unverified_ingestion !== false,
        allowedDomains: Array.isArray(website.settings?.allowed_tracking_domains) ? website.settings.allowed_tracking_domains.join(', ') : '',
      });
    }
  }, [website, settingsForm]);

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
      // verify_domain is now owned by the dedicated "Verify your domain" step.
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

            {step.key === 'verify' && (() => {
              const st = domainStatus?.verification_status as string | undefined;
              const verified = st === 'verified' || st === 'admin_override';
              return (
                <div className="space-y-3 text-sm text-gray-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Domain:</span>
                    <code className="rounded bg-gray-100 px-1.5 py-0.5">{domainStatus?.final_domain || domainHost || '—'}</code>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${verified ? 'bg-emerald-100 text-emerald-700' : st === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {verified ? 'Verified' : (st || 'unverified')}
                    </span>
                  </div>
                  {domainMsg && <p className="text-xs text-amber-700">{domainMsg}</p>}
                  {verified ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
                      Domain verified{domainStatus?.verification_method ? ` via ${domainStatus.verification_method}` : ''}. Secure attribution is enabled.
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={verifyDomain} disabled={domainBusy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{domainBusy ? 'Checking…' : 'Verify now'}</button>
                        <button onClick={() => void loadDomainStatus()} disabled={domainBusy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">Refresh status</button>
                        <button onClick={regenDomainToken} disabled={domainBusy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">{domainStatus?.token_issued ? 'Regenerate token' : 'Generate token'}</button>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
                        <p className="font-medium text-gray-800">Add ONE of these, then click “Verify now”:</p>
                        <p className="mt-2 font-semibold">DNS TXT record</p>
                        <pre className="mt-1 overflow-x-auto rounded bg-white p-2">{`omnivira-verification=${domainToken || '<generate a token above>'}`}</pre>
                        {domainToken && <button onClick={() => copy(`omnivira-verification=${domainToken}`)} className="mt-1 text-indigo-600 underline">Copy DNS value</button>}
                        <p className="mt-3 font-semibold">— or — Hosted file</p>
                        <p className="mt-1">Serve the token at <code className="rounded bg-white px-1">{domainStatus?.instructions?.http || '/.well-known/omnivira.txt'}</code></p>
                        {domainToken && <button onClick={() => copy(domainToken)} className="mt-1 text-indigo-600 underline">Copy token</button>}
                      </div>
                    </>
                  )}
                  <p className="text-xs text-gray-500">Verification is optional to continue — leads are captured in compatibility mode until the domain is verified.</p>
                </div>
              );
            })()}

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
                {/* Webflow: surface discovered sites + collections so operator can copy the right collection_id. */}
                {provider === 'webflow' && validation?.success && Array.isArray((validation.diagnostics as any)?.providerResponse?.sites) && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
                    <p className="font-medium text-gray-800">Webflow sites + collections discovered</p>
                    <p className="text-gray-500">Copy a collection ID and paste it into the integration's <code>collection_id</code> config to enable publishing.</p>
                    <ul className="mt-1 space-y-1">
                      {((validation.diagnostics as any).providerResponse.sites as Array<{ id: string; name: string; collections: Array<{ id: string; name: string }> }>).map((s) => (
                        <li key={s.id}>
                          <strong>{s.name}</strong>
                          <ul className="ml-3 list-disc">
                            {s.collections.map((c) => (
                              <li key={c.id}>
                                {c.name} — <code className="rounded bg-white px-1">{c.id}</code>
                                <button
                                  type="button"
                                  className="ml-1 text-indigo-600 underline"
                                  onClick={() => navigator.clipboard?.writeText(c.id).catch(() => undefined)}
                                >
                                  Copy
                                </button>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {step.key === 'analytics' && (
              <div className="space-y-3 text-sm text-gray-600">
                <p>
                  Connect Google Analytics 4 to see <strong>views per blog</strong> and traffic sources. This is optional — you can skip it and connect later from Integrations.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/analytics/connect/google?company_id=${encodeURIComponent(companyId)}`}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Connect Google Analytics
                  </a>
                  <button
                    type="button"
                    onClick={() => setStepIndex((i) => Math.min(i + 1, WIZARD.length - 1))}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
                  >
                    Skip for now
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  After connecting, you'll be redirected here. We auto-detect your GA4 properties on the Analytics page.
                </p>
              </div>
            )}

            {step.key === 'tracking' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Paste this once into your site's &lt;head&gt;. It links visitors, sessions, and form leads back to campaigns.
                </p>
                <pre className="overflow-x-auto rounded-lg bg-gray-950 p-3 text-[11px] leading-relaxed text-emerald-300">{trackerSnippet}</pre>
                <button
                  onClick={() => copy(trackerSnippet)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
                >
                  Copy snippet
                </button>

                {provider === 'wordpress' && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
                    <p className="font-medium text-gray-800">Prefer the WordPress plugin?</p>
                    <p className="mt-1 text-gray-600">Generate a one-time setup token yourself and paste it into the OmniVyra WordPress plugin — no code editing needed.</p>
                    <button onClick={genWpToken} disabled={domainBusy} className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50">{domainBusy ? 'Generating…' : 'Generate setup token'}</button>
                    {wpToken && (
                      <div className="mt-2 space-y-1">
                        <pre className="overflow-x-auto rounded bg-white p-2">{wpToken.token}</pre>
                        <div className="flex flex-wrap gap-3">
                          <button onClick={() => copy(wpToken.token)} className="text-indigo-600 underline">Copy token</button>
                          <span className="text-gray-500">Expires {new Date(wpToken.expiresAt).toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {settingsForm && (
                  <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
                    <p className="font-medium text-gray-800">Tracking settings</p>
                    <label className="mt-2 flex items-center gap-2">
                      <input type="checkbox" checked={settingsForm.allowUnverified} onChange={(e) => setSettingsForm((s) => s && { ...s, allowUnverified: e.target.checked })} />
                      <span>Accept traffic before domain verification (compatibility mode)</span>
                    </label>
                    <label className="mt-3 block font-medium text-gray-700">
                      Allowed tracking domains <span className="font-normal text-gray-400">(comma-separated; blank = your website domain)</span>
                      <input
                        value={settingsForm.allowedDomains}
                        onChange={(e) => setSettingsForm((s) => s && { ...s, allowedDomains: e.target.value })}
                        placeholder="example.com, blog.example.com"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="mt-2 flex items-center gap-3">
                      <button onClick={saveSettings} disabled={settingsBusy} className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-50">{settingsBusy ? 'Saving…' : 'Save settings'}</button>
                      {settingsMsg && <span className={settingsMsg === 'Saved.' ? 'text-emerald-600' : 'text-amber-700'}>{settingsMsg}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {step.key === 'forms' && (
              <div className="space-y-4 text-sm text-gray-600">
                <p>Tell us where your leads come from. We'll save your choice so the right integrations show up on the next step.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    { k: 'SAME_SITE', t: 'Same-site forms' },
                    { k: 'EXTERNAL_LANDING_PAGES', t: 'External landing pages' },
                    { k: 'EMBEDDED_FORMS', t: 'Embedded forms' },
                    { k: 'SPA_FUNNEL', t: 'SPA / web app' },
                    { k: 'WEBHOOK_ONLY', t: 'Webhook-only' },
                    { k: 'HYBRID_MULTI_SOURCE', t: 'Hybrid / multi-source' },
                  ].map((opt) => {
                    const on = (config.__topology_picks ?? '').split(',').filter(Boolean).includes(opt.k);
                    return (
                      <button key={opt.k} type="button"
                        onClick={() => setConfig((c) => {
                          const cur = String(c.__topology_picks ?? '').split(',').filter(Boolean);
                          const next = cur.includes(opt.k) ? cur.filter((x) => x !== opt.k) : [...cur, opt.k];
                          return { ...c, __topology_picks: next.join(',') };
                        })}
                        className={`rounded-lg border p-2 text-left text-xs ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-700'}`}>
                        {opt.t}{on ? ' ✓' : ''}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500">Multi-select if your setup spans more than one. You can refine this any time from <a href="/lead-capture" className="text-indigo-600">Lead Capture</a>.</p>
                <a href="/leads?tab=forms" className="inline-block rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700">Open forms workspace</a>
              </div>
            )}

            {step.key === 'review' && (
              <div className="space-y-3">
                {(() => {
                  const checkBy = (id: string) => !!readiness?.checks?.find((c: any) => c.id === id)?.done;
                  const st = domainStatus?.verification_status as string | undefined;
                  const leadsReady = checkBy('leads');
                  const rows: Array<{ label: string; ok: boolean; note?: string }> = [
                    { label: 'Domain Verified', ok: st === 'verified' || st === 'admin_override' || completed.has('verify_domain') },
                    { label: 'Tracking Installed', ok: completed.has('install_tracking') },
                    { label: 'Forms Ready', ok: completed.has('connect_forms') || leadsReady },
                    { label: 'Lead Capture Ready', ok: leadsReady },
                    { label: 'Webhook Ready', ok: !!readiness?.hasWebhook },
                    { label: 'Repository Connected', ok: leadsReady, note: 'Receives leads once a source is live' },
                    { label: 'Lead Intelligence Connected', ok: leadsReady, note: 'Leads flow into the workspace automatically' },
                  ];
                  return (
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="text-sm font-semibold text-gray-900">Activation checklist</p>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {rows.map((r) => (
                          <li key={r.label} className="flex items-center justify-between gap-3">
                            <span className="text-gray-700">{r.label}{r.note && <span className="ml-1 text-xs text-gray-400">· {r.note}</span>}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${r.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{r.ok ? 'Ready' : 'Pending'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
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
                  onClick={async () => {
                    if (step.key === 'forms') {
                      // Persist topology picks before marking the step done. The
                      // existing contract step state carries the choice; the new
                      // topology endpoint records it durably for downstream
                      // diagnostics + dynamic-option rendering.
                      const picks = String(config.__topology_picks ?? '').split(',').filter(Boolean);
                      if (companyId && picks.length > 0) {
                        await fetch('/api/website-intelligence/lead-capture-topology', {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ company_id: companyId, topologies: picks }),
                        }).catch(() => undefined);
                      }
                      if (step.contractStep) await markStep(step.contractStep, { topologies: picks, source: 'website_setup_wizard' });
                    } else {
                      if (step.contractStep) await markStep(step.contractStep, { skipped: false });
                    }
                    goNext();
                  }}
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
              ) : step.key === 'verify' ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
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
