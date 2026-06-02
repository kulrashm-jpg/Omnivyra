import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithAuth } from '../../community-ai/fetchWithAuth';

type CuratedSource = {
  id: string;
  source_name: string;
  source_type: string;
  source_identifier: string;
  source_url: string | null;
  platform: string | null;
  integration_mode: 'public' | 'public_login' | 'oauth' | 'api_key' | 'manual';
  industry_tags: string[];
  similar_industry_tags: string[];
  opportunity_types: string[];
  recommendation_reason: string | null;
  estimated_signal_quality: number;
  estimated_volume: number;
  is_active: boolean;
  updated_at: string;
};

type FormState = {
  id: string | null;
  source_name: string;
  source_type: string;
  source_identifier: string;
  source_url: string;
  platform: string;
  integration_mode: CuratedSource['integration_mode'];
  industry_tags: string;
  similar_industry_tags: string;
  opportunity_types: string;
  recommendation_reason: string;
  estimated_signal_quality: string;
  estimated_volume: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  source_name: '',
  source_type: 'hackernews',
  source_identifier: '',
  source_url: '',
  platform: 'hackernews',
  integration_mode: 'public_login',
  industry_tags: '',
  similar_industry_tags: '',
  opportunity_types: 'buying_intent, integration_need',
  recommendation_reason: '',
  estimated_signal_quality: '0.65',
  estimated_volume: '120',
  is_active: true,
};

const INTEGRATION_LABEL: Record<CuratedSource['integration_mode'], string> = {
  public: 'Public',
  public_login: 'Login-ready',
  oauth: 'OAuth',
  api_key: 'API key',
  manual: 'Manual',
};

function csv(values: string[] | null | undefined): string {
  return (values ?? []).join(', ');
}

function toForm(source: CuratedSource): FormState {
  return {
    id: source.id,
    source_name: source.source_name,
    source_type: source.source_type,
    source_identifier: source.source_identifier,
    source_url: source.source_url ?? '',
    platform: source.platform ?? '',
    integration_mode: source.integration_mode,
    industry_tags: csv(source.industry_tags),
    similar_industry_tags: csv(source.similar_industry_tags),
    opportunity_types: csv(source.opportunity_types),
    recommendation_reason: source.recommendation_reason ?? '',
    estimated_signal_quality: String(source.estimated_signal_quality ?? 0.65),
    estimated_volume: String(source.estimated_volume ?? 120),
    is_active: source.is_active,
  };
}

function toPayload(form: FormState) {
  return {
    id: form.id,
    source_name: form.source_name,
    source_type: form.source_type,
    source_identifier: form.source_identifier,
    source_url: form.source_url,
    platform: form.platform,
    integration_mode: form.integration_mode,
    industry_tags: form.industry_tags,
    similar_industry_tags: form.similar_industry_tags,
    opportunity_types: form.opportunity_types,
    recommendation_reason: form.recommendation_reason,
    estimated_signal_quality: Number(form.estimated_signal_quality),
    estimated_volume: Number(form.estimated_volume),
    is_active: form.is_active,
  };
}

export default function CuratedSourcesTab() {
  const [sources, setSources] = useState<CuratedSource[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/curated-industry-sources');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Failed to load source catalog');
      setSources(body.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load source catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const active = sources.filter((source) => source.is_active).length;
    const loginReady = sources.filter((source) => source.integration_mode === 'public_login' || source.integration_mode === 'oauth').length;
    const industries = new Set<string>();
    sources.forEach((source) => source.industry_tags?.forEach((tag) => industries.add(tag.toLowerCase())));
    return { active, loginReady, industries: industries.size };
  }, [sources]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetchWithAuth('/api/super-admin/curated-industry-sources', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Failed to save source');
      setSuccess(`${body.source?.source_name || 'Source'} saved.`);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save source');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (source: CuratedSource) => {
    if (!window.confirm(`Delete ${source.source_name} from the catalog?`)) return;
    setError(null);
    setSuccess(null);
    const response = await fetchWithAuth(`/api/super-admin/curated-industry-sources?id=${encodeURIComponent(source.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || 'Failed to delete source');
      return;
    }
    setSuccess(`${source.source_name} deleted.`);
    await load();
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricTile label="Active sources" value={summary.active} />
        <MetricTile label="Login-ready sources" value={summary.loginReady} />
        <MetricTile label="Covered industries" value={summary.industries} />
      </div>

      {(error || success) && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error || success}
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{form.id ? 'Edit Source' : 'Add Source'}</h3>
        </div>
        <div className="grid gap-4 p-6 md:grid-cols-2">
          <TextInput label="Source name" value={form.source_name} onChange={(value) => setField('source_name', value)} />
          <TextInput label="Source URL" value={form.source_url} onChange={(value) => setField('source_url', value)} />
          <TextInput label="Source type" value={form.source_type} onChange={(value) => setField('source_type', value)} />
          <TextInput label="Source identifier" value={form.source_identifier} onChange={(value) => setField('source_identifier', value)} />
          <TextInput label="Platform" value={form.platform} onChange={(value) => setField('platform', value)} />
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Integration</span>
            <select
              value={form.integration_mode}
              onChange={(event) => setField('integration_mode', event.target.value as CuratedSource['integration_mode'])}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {Object.entries(INTEGRATION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <TextInput label="Industry tags" value={form.industry_tags} onChange={(value) => setField('industry_tags', value)} />
          <TextInput label="Similar industries" value={form.similar_industry_tags} onChange={(value) => setField('similar_industry_tags', value)} />
          <TextInput label="Opportunity types" value={form.opportunity_types} onChange={(value) => setField('opportunity_types', value)} />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Signal quality" value={form.estimated_signal_quality} onChange={(value) => setField('estimated_signal_quality', value)} />
            <TextInput label="Volume" value={form.estimated_volume} onChange={(value) => setField('estimated_volume', value)} />
          </div>
          <label className="md:col-span-2 block">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recommendation reason</span>
            <textarea
              value={form.recommendation_reason}
              onChange={(event) => setField('recommendation_reason', event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
          <div className="flex items-center gap-3 md:col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setField('is_active', event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
              />
              Active
            </label>
            <div className="ml-auto flex gap-2">
              {form.id && (
                <button
                  type="button"
                  onClick={() => setForm(EMPTY_FORM)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  New
                </button>
              )}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : form.id ? 'Save changes' : 'Add source'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Industry Source Catalog</h3>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading catalog...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Industries</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Integration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {sources.map((source) => (
                  <tr key={source.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm font-semibold text-gray-900">{source.source_name}</div>
                      <div className="text-xs text-gray-500">{source.source_type} / {source.source_identifier}</div>
                      {source.source_url && (
                        <a className="mt-1 block text-xs text-indigo-600 hover:text-indigo-800" href={source.source_url} target="_blank" rel="noreferrer">
                          {source.source_url}
                        </a>
                      )}
                    </td>
                    <td className="max-w-md px-6 py-4 align-top text-sm text-gray-600">
                      <div>{csv(source.industry_tags) || 'Any matching company'}</div>
                      {source.similar_industry_tags.length > 0 && (
                        <div className="mt-1 text-xs text-gray-400">Similar: {csv(source.similar_industry_tags)}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        {INTEGRATION_LABEL[source.integration_mode] || source.integration_mode}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${source.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {source.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right align-top">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setForm(toForm(source))}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(source)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sources.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">No curated sources yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  );
}
