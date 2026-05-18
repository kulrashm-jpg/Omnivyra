import React, { useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';

const STEPS = [
  ['create_website', 'Create/select website'],
  ['verify_domain', 'Verify domain ownership'],
  ['select_cms', 'Select CMS provider'],
  ['connect_cms', 'Connect CMS'],
  ['install_tracking', 'Install tracking'],
  ['connect_forms', 'Connect forms'],
  ['summary', 'Verification summary'],
] as const;

export default function WebsiteSetupPage() {
  const { selectedCompanyId } = useCompanyContext();
  const [website, setWebsite] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [name, setName] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!selectedCompanyId) return;
    const res = await fetch(`/api/websites/setup?company_id=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' });
    const data = await res.json();
    setWebsite(data.website || null);
    setProgress(data.progress || null);
  }

  useEffect(() => { load(); }, [selectedCompanyId]);

  async function createWebsite() {
    if (!selectedCompanyId) return;
    setError('');
    const res = await fetch('/api/websites/setup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: selectedCompanyId, action: 'create_website', name, canonical_url: canonicalUrl, cms_provider: 'wordpress' }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Failed to create website'); return; }
    setWebsite(data.website);
    setProgress(data.progress);
  }

  async function complete(step: string, state: Record<string, unknown> = {}) {
    if (!selectedCompanyId || !website?.id) return;
    const res = await fetch('/api/websites/setup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: selectedCompanyId, website_id: website.id, step, state }),
    });
    const data = await res.json();
    if (res.ok) setProgress(data.progress);
  }

  const completed = new Set(progress?.completed_steps || []);
  const trackerSnippet = website ? `<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/omnivera-tracker.js" data-website-id="${website.id}"></script>` : '';

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Website Setup</h1>
          <p className="mt-1 text-sm text-gray-600">Connect a website, verify it, install tracking, and prepare WordPress publishing.</p>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-3 md:grid-cols-7">
          {STEPS.map(([key, label], index) => (
            <div key={key} className={`rounded-lg border p-3 text-xs ${completed.has(key) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : progress?.current_step === key ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-gray-200 bg-white text-gray-500'}`}>
              <div className="font-semibold">Step {index + 1}</div>
              <div>{label}</div>
            </div>
          ))}
        </div>

        {!website ? (
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold text-gray-900">Create website</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website name" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} placeholder="https://example.com" className="rounded-lg border px-3 py-2 text-sm" />
            </div>
            <button onClick={createWebsite} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Create website</button>
          </section>
        ) : (
          <section className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold text-gray-900">{website.name}</h2>
            <p className="mt-1 text-sm text-gray-500">{website.canonical_url}</p>
            <div className="mt-4 space-y-4">
              <ActionRow title="Verify domain ownership" done={completed.has('verify_domain')} action={() => complete('verify_domain', { verification: 'linked_to_domain_record' })} />
              <ActionRow title="Select WordPress" done={completed.has('select_cms')} action={() => complete('select_cms', { provider: 'wordpress' })} />
              <ActionRow title="Connect CMS in Integrations" done={completed.has('connect_cms')} href="/integrations?focus=website" action={() => complete('connect_cms', { provider: 'wordpress' })} />
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-gray-900">Install tracking</p>
                  <button onClick={() => complete('install_tracking', { snippet: trackerSnippet })} className="rounded bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">Mark installed</button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded bg-gray-950 p-3 text-xs text-green-300">{trackerSnippet}</pre>
              </div>
              <ActionRow title="Connect forms" done={completed.has('connect_forms')} href="/leads?tab=forms" action={() => complete('connect_forms', { source: 'lead_workspace' })} />
              <ActionRow title="Review summary" done={completed.has('summary')} action={() => complete('summary', { reviewed_at: new Date().toISOString() })} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ActionRow({ title, done, href, action }: { title: string; done: boolean; href?: string; action: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
      <span className="text-sm font-semibold text-gray-900">{title}</span>
      <div className="flex gap-2">
        {href && <a href={href} className="rounded border px-3 py-1.5 text-xs font-semibold text-gray-700">Open</a>}
        <button onClick={action} className={`rounded px-3 py-1.5 text-xs font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-600 text-white'}`}>
          {done ? 'Completed' : 'Complete'}
        </button>
      </div>
    </div>
  );
}
