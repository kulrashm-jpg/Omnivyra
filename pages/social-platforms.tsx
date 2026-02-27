import React, { useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import { supabase } from '../utils/supabaseClient';

type PlatformConfig = {
  id: string;
  name: string;
  base_url: string;
  api_key_name?: string | null;
  platform_type: string;
  supported_content_types?: string[];
  promotion_modes?: string[];
  required_metadata?: Record<string, boolean>;
  posting_constraints?: Record<string, any>;
  is_active: boolean;
  requires_admin: boolean;
  health?: {
    freshness_score?: number;
    reliability_score?: number;
  } | null;
};

const emptyForm: Partial<PlatformConfig> = {
  name: '',
  base_url: '',
  api_key_name: '',
  platform_type: 'social',
  supported_content_types: [],
  promotion_modes: ['organic'],
  required_metadata: {
    hashtags: false,
    seo_keywords: false,
    cta: false,
    best_time: false,
  },
  posting_constraints: {},
  is_active: true,
  requires_admin: true,
};

const FALLBACK_CONTENT_TYPE_OPTIONS = [
  'video',
  'shorts',
  'text',
  'carousel',
  'podcast',
  'blog',
  'quote',
  'newsletter',
];
const promotionModeOptions = ['organic', 'paid', 'both'];
const requiredMetadataOptions = ['hashtags', 'seo_keywords', 'hook', 'cta', 'best_time'];

export default function SocialPlatformsPage() {
  const { selectedCompanyId, hasPermission } = useCompanyContext();
  const [configs, setConfigs] = useState<PlatformConfig[]>([]);
  const [form, setForm] = useState<Partial<PlatformConfig>>(emptyForm);
  const [contentTypeOptions, setContentTypeOptions] = useState<string[]>(FALLBACK_CONTENT_TYPE_OPTIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [constraintsText, setConstraintsText] = useState<string>('{}');
  const canManage = isAdmin || hasPermission('MANAGE_EXTERNAL_APIS');

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    let token = data.session?.access_token;
    if (!token) {
      const refreshed = await supabase.auth.refreshSession();
      token = refreshed.data.session?.access_token;
    }
    if (!token) {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  };

  const buildExternalApisUrl = (id?: string): string => {
    if (isAdmin) {
      return id ? `/api/external-apis/${id}?scope=platform` : '/api/external-apis?scope=platform';
    }
    if (!selectedCompanyId) {
      throw new Error('Select a company to load platform configs.');
    }
    return id
      ? `/api/external-apis/${id}?companyId=${encodeURIComponent(selectedCompanyId)}`
      : `/api/external-apis?companyId=${encodeURIComponent(selectedCompanyId)}`;
  };

  const loadConfigs = async () => {
    try {
      if (!isAdmin && !selectedCompanyId) return;
      setIsLoading(true);
      const response = await fetchWithAuth(buildExternalApisUrl());
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error || 'Failed to load configs');
      }
      const data = await response.json();
      setConfigs(data.apis || []);
    } catch (error) {
      console.error('Error loading configs:', error);
      setErrorMessage((error as Error).message || 'Failed to load platform configs.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const response = await fetchWithAuth('/api/admin/check-super-admin');
        if (!response.ok) return;
        const data = await response.json();
        setIsAdmin(!!data?.isSuperAdmin);
      } catch (error) {
        console.warn('Unable to load admin status');
      }
    };
    loadAdminStatus();
  }, []);

  useEffect(() => {
    loadConfigs();
  }, [isAdmin, selectedCompanyId]);

  useEffect(() => {
    const loadContentTypes = async () => {
      try {
        const response = await fetchWithAuth('/api/platform-intelligence/catalog');
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        const platforms = Array.isArray(data?.platforms) ? data.platforms : [];
        const union = new Set<string>();
        platforms.forEach((p: any) => {
          (Array.isArray(p?.supported_content_types) ? p.supported_content_types : []).forEach((t: any) => {
            const v = String(t || '').trim().toLowerCase();
            if (v) union.add(v);
          });
        });
        // Keep existing options as fallback and superset (some configs use broader categories like "newsletter")
        const merged = Array.from(new Set([...FALLBACK_CONTENT_TYPE_OPTIONS, ...Array.from(union)])).sort();
        setContentTypeOptions(merged);
      } catch {
        // ignore
      }
    };
    loadContentTypes();
  }, []);

  const saveConfig = async () => {
    try {
      resetMessages();
      setIsSaving(true);

      let constraintsPayload: Record<string, any> = {};
      try {
        constraintsPayload = constraintsText ? JSON.parse(constraintsText) : {};
      } catch (error) {
        setErrorMessage('Posting constraints must be valid JSON.');
        setIsSaving(false);
        return;
      }

      const payload = {
        ...form,
        supported_content_types: form.supported_content_types || [],
        promotion_modes: form.promotion_modes || [],
        required_metadata: form.required_metadata || {},
        posting_constraints: constraintsPayload,
        purpose: 'posting',
        auth_type: form.api_key_name ? 'header' : 'none',
      };

      const response = await fetchWithAuth(buildExternalApisUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error || 'Failed to save config');
      }
      setForm(emptyForm);
      setConstraintsText('{}');
      setSuccessMessage('Platform config saved.');
      await loadConfigs();
    } catch (error) {
      console.error('Error saving config:', error);
      setErrorMessage('Failed to save platform config.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateConfig = async (config: PlatformConfig) => {
    try {
      resetMessages();
      const response = await fetchWithAuth(buildExternalApisUrl(config.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error || 'Failed to update config');
      }
      setSuccessMessage('Platform config updated.');
      await loadConfigs();
    } catch (error) {
      console.error('Error updating config:', error);
      setErrorMessage('Failed to update platform config.');
    }
  };

  const deleteConfig = async (id: string) => {
    try {
      resetMessages();
      const response = await fetchWithAuth(buildExternalApisUrl(id), {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error || 'Failed to delete config');
      }
      setSuccessMessage('Platform config deleted.');
      await loadConfigs();
    } catch (error) {
      console.error('Error deleting config:', error);
      setErrorMessage('Failed to delete platform config.');
    }
  };

  const getHealthBadge = (health?: PlatformConfig['health']) => {
    if (!health) return { label: 'Health: N/A', className: 'bg-gray-100 text-gray-700' };
    const combined = (health.freshness_score ?? 1) * (health.reliability_score ?? 1);
    if (combined >= 0.75) return { label: 'Health: Good', className: 'bg-green-100 text-green-700' };
    if (combined >= 0.4) return { label: 'Health: Fair', className: 'bg-yellow-100 text-yellow-700' };
    return { label: 'Health: Poor', className: 'bg-red-100 text-red-700' };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Social Platform Settings</h1>
          <p className="text-sm text-gray-600">
            Configure platform APIs and posting rules. Admin access required to edit.
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
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Platform Config</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Platform name (Facebook, LinkedIn, YouTube)"
              value={form.name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="API base URL / page ID"
              value={form.base_url || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="Access token env name"
              value={form.api_key_name || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, api_key_name: e.target.value }))}
            />
            <select
              className="border rounded-lg px-3 py-2"
              value={form.platform_type || 'social'}
              onChange={(e) => setForm((prev) => ({ ...prev, platform_type: e.target.value }))}
            >
              <option value="social">Social</option>
              <option value="video">Video</option>
              <option value="blog">Blog</option>
              <option value="podcast">Podcast</option>
            </select>
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500 mb-2">Supported content types</div>
              <div className="flex flex-wrap gap-3">
                {contentTypeOptions.map((field) => (
                  <label key={field} className="flex items-center gap-1 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={(form.supported_content_types || []).includes(field)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          supported_content_types: e.target.checked
                            ? [...(prev.supported_content_types || []), field]
                            : (prev.supported_content_types || []).filter((item) => item !== field),
                        }))
                      }
                    />
                    {field}
                  </label>
                ))}
              </div>
            </div>
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500 mb-2">Promotion modes</div>
              <div className="flex flex-wrap gap-3">
                {promotionModeOptions.map((field) => (
                  <label key={field} className="flex items-center gap-1 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={(form.promotion_modes || []).includes(field)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          promotion_modes: e.target.checked
                            ? [...(prev.promotion_modes || []), field]
                            : (prev.promotion_modes || []).filter((item) => item !== field),
                        }))
                      }
                    />
                    {field}
                  </label>
                ))}
              </div>
            </div>
            <div className="border rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500 mb-2">Required metadata</div>
              <div className="flex flex-wrap gap-3">
                {requiredMetadataOptions.map((field) => (
                  <label key={field} className="flex items-center gap-1 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={!!form.required_metadata?.[field]}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          required_metadata: {
                            ...(prev.required_metadata || {}),
                            [field]: e.target.checked,
                          },
                        }))
                      }
                    />
                    {field}
                  </label>
                ))}
              </div>
            </div>
            <textarea
              className="border rounded-lg px-3 py-2 min-h-[110px]"
              placeholder='Posting constraints JSON (e.g. {"max_length":2200})'
              value={constraintsText}
              onChange={(e) => setConstraintsText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-600 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                Active
              </label>
              <label className="text-xs text-gray-600 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!form.requires_admin}
                  onChange={(e) => setForm((prev) => ({ ...prev, requires_admin: e.target.checked }))}
                />
                Requires admin
              </label>
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={saveConfig}
              disabled={isSaving || !canManage}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Config'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Configured Platforms</h2>
          {isLoading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-4">
              {configs.map((config) => (
                <div key={config.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-gray-900">{config.name}</div>
                      <div className="text-xs text-gray-500">{config.base_url}</div>
                      {config.api_key_name && (
                        <div className="text-xs text-gray-400" title={`Uses env var: ${config.api_key_name}`}>
                          Uses env var: {config.api_key_name}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{config.platform_type}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                    <span>Content: {config.supported_content_types?.join(', ') || '—'}</span>
                    <span>Promotion: {config.promotion_modes?.join(', ') || '—'}</span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${getHealthBadge(
                        config.health
                      ).className}`}
                      title="Based on freshness & reliability of data source"
                    >
                      {getHealthBadge(config.health).label}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={config.is_active}
                        disabled={!canManage}
                        onChange={(e) => updateConfig({ ...config, is_active: e.target.checked })}
                      />
                      Active
                    </label>
                    <button
                      onClick={() => deleteConfig(config.id)}
                      disabled={!canManage}
                      className="text-xs text-red-600 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {configs.length === 0 && (
                <div className="text-sm text-gray-500">No platform configs yet.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
