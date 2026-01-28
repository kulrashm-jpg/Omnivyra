import React, { useEffect, useState } from 'react';

type ApiSource = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category?: string | null;
  is_active: boolean;
  auth_type: string;
  api_key_name?: string | null;
  health?: {
    freshness_score?: number;
    reliability_score?: number;
  } | null;
};

const emptyForm: Partial<ApiSource> = {
  name: '',
  base_url: '',
  purpose: 'trends',
  category: '',
  is_active: true,
  auth_type: 'none',
  api_key_name: '',
};

export default function ExternalApisPage() {
  const [apis, setApis] = useState<ApiSource[]>([]);
  const [form, setForm] = useState<Partial<ApiSource>>(emptyForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadApis = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/external-apis');
      if (!response.ok) throw new Error('Failed to load APIs');
      const data = await response.json();
      setApis(data.apis || []);
    } catch (error) {
      console.error('Error loading APIs:', error);
      setErrorMessage('Failed to load API sources.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadApis();
    const loadAdminStatus = async () => {
      try {
        const response = await fetch('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, []);

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const saveApi = async () => {
    try {
      resetMessages();
      setIsSaving(true);
      const response = await fetch('/api/external-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error('Failed to save API');
      setForm(emptyForm);
      setSuccessMessage('API source added.');
      await loadApis();
    } catch (error) {
      console.error('Error saving API:', error);
      setErrorMessage('Failed to save API source.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateApi = async (api: ApiSource) => {
    try {
      resetMessages();
      const response = await fetch(`/api/external-apis/${api.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(api),
      });
      if (!response.ok) throw new Error('Failed to update API');
      setSuccessMessage('API source updated.');
      await loadApis();
    } catch (error) {
      console.error('Error updating API:', error);
      setErrorMessage('Failed to update API source.');
    }
  };

  const deleteApi = async (id: string) => {
    try {
      resetMessages();
      const response = await fetch(`/api/external-apis/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete API');
      setSuccessMessage('API source deleted.');
      await loadApis();
    } catch (error) {
      console.error('Error deleting API:', error);
      setErrorMessage('Failed to delete API source.');
    }
  };

  const testFetch = async () => {
    try {
      resetMessages();
      const response = await fetch('/api/trends/fetch');
      if (!response.ok) throw new Error('Failed to fetch trends');
      setSuccessMessage('Trend fetch executed.');
    } catch (error) {
      console.error('Error fetching trends:', error);
      setErrorMessage('Failed to fetch trends.');
    }
  };

  const validateApi = async (id: string) => {
    try {
      resetMessages();
      const response = await fetch(`/api/external-apis/${id}/validate`);
      if (!response.ok) throw new Error('Failed to validate API');
      setSuccessMessage('API validation completed.');
      await loadApis();
    } catch (error) {
      console.error('Error validating API:', error);
      setErrorMessage('Failed to validate API.');
    }
  };

  const getHealthBadge = (health?: ApiSource['health']) => {
    if (!health) return { label: 'Health: N/A', className: 'bg-gray-100 text-gray-700' };
    const combined = (health.freshness_score ?? 1) * (health.reliability_score ?? 1);
    if (combined >= 0.75) return { label: 'Health: Good', className: 'bg-green-100 text-green-700' };
    if (combined >= 0.4) return { label: 'Health: Fair', className: 'bg-yellow-100 text-yellow-700' };
    return { label: 'Health: Poor', className: 'bg-red-100 text-red-700' };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">External API Sources</h1>
          <p className="text-sm text-gray-600">
            Manage external sources for trend and signal discovery.
          </p>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg p-3">
            {successMessage}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add API Source</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Name"
              value={form.name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Base URL"
              value={form.base_url || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Category (optional)"
              value={form.category || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
            />
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={form.purpose}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, purpose: e.target.value }))
              }
            >
              <option value="trends">Trends</option>
              <option value="keywords">Keywords</option>
              <option value="hashtags">Hashtags</option>
              <option value="news">News</option>
              <option value="demographics">Demographics</option>
            </select>
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={form.auth_type || 'none'}
              onChange={(e) => setForm((prev) => ({ ...prev, auth_type: e.target.value }))}
            >
              <option value="none">No Auth</option>
              <option value="query">Query Param</option>
              <option value="header">Header</option>
            </select>
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="API Key Env Name (optional)"
              value={form.api_key_name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, api_key_name: e.target.value }))}
            />
            <div className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!form.is_active}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              Active
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={saveApi}
              disabled={isSaving || !isAdmin}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Add API'}
            </button>
            <button
              onClick={testFetch}
              className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm"
            >
              Test Fetch
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Configured APIs</h2>
          {isLoading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-4">
              {apis.map((api) => (
                <div key={api.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{api.name}</div>
                      <div className="text-xs text-gray-500">{api.base_url}</div>
                      {api.api_key_name && api.auth_type !== 'none' && (
                        <div
                          className="text-xs text-gray-400"
                          title={`Uses env var: ${api.api_key_name}`}
                        >
                          Uses env var: {api.api_key_name}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{api.purpose}</div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={api.is_active}
                        disabled={!isAdmin}
                        onChange={(e) => updateApi({ ...api, is_active: e.target.checked })}
                      />
                      Enabled
                    </label>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getHealthBadge(
                        api.health
                      ).className}`}
                      title="Based on freshness & reliability of data source"
                    >
                      {getHealthBadge(api.health).label}
                    </span>
                    <button
                      onClick={() => validateApi(api.id)}
                      className="text-xs text-indigo-600"
                    >
                      Validate API
                    </button>
                    <button
                      onClick={() => deleteApi(api.id)}
                      disabled={!isAdmin}
                      className="text-xs text-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {apis.length === 0 && (
                <div className="text-sm text-gray-500">No API sources configured.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
