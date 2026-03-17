import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Plus, Plug, Globe, Rss, Pencil, Trash2, RefreshCw, CheckCircle, XCircle, Clock, X } from 'lucide-react';
import Header from '../components/Header';
import { useCompanyContext } from '../components/CompanyContext';

type IntegrationType = 'lead_webhook' | 'wordpress' | 'custom_blog_api';
type IntegrationStatus = 'connected' | 'failed' | 'pending';

interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, string>;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<IntegrationType, string> = {
  lead_webhook: 'Lead Webhook',
  wordpress: 'WordPress',
  custom_blog_api: 'Custom Blog API',
};

const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
  lead_webhook: <Plug className="h-5 w-5" />,
  wordpress: <Globe className="h-5 w-5" />,
  custom_blog_api: <Rss className="h-5 w-5" />,
};

const TYPE_COLORS: Record<IntegrationType, string> = {
  lead_webhook: 'bg-emerald-100 text-emerald-700',
  wordpress: 'bg-blue-100 text-blue-700',
  custom_blog_api: 'bg-violet-100 text-violet-700',
};

const STATUS_BADGE: Record<IntegrationStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  failed:    { label: 'Failed',    cls: 'bg-red-50 text-red-700 border-red-200',       icon: <XCircle className="h-3.5 w-3.5" /> },
  pending:   { label: 'Pending',   cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="h-3.5 w-3.5" /> },
};

// ─── Config field definitions per type ───────────────────────────────────────

const CONFIG_FIELDS: Record<IntegrationType, { key: string; label: string; placeholder: string; type?: string; hint?: string }[]> = {
  lead_webhook: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://your-crm.com/webhooks/leads', hint: 'Receives POST with { name, email, phone, source }' },
    { key: 'secret',     label: 'Secret (optional)', placeholder: 'my-secret-key', hint: 'Sent as X-Webhook-Secret header' },
  ],
  wordpress: [
    { key: 'site_url',     label: 'Site URL',            placeholder: 'https://myblog.com' },
    { key: 'username',     label: 'WordPress Username',  placeholder: 'admin' },
    { key: 'app_password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx', type: 'password', hint: 'Generate in WP Admin → Users → Profile → Application Passwords' },
  ],
  custom_blog_api: [
    { key: 'endpoint_url', label: 'Endpoint URL',         placeholder: 'https://api.myblog.com/posts' },
    { key: 'api_key',      label: 'API Key',              placeholder: 'sk-...', type: 'password' },
    { key: 'auth_header',  label: 'Auth Header (optional)', placeholder: 'Authorization', hint: 'Defaults to "Authorization: Bearer <api_key>"' },
  ],
};

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  mode: 'create' | 'edit';
  initial?: Partial<Integration>;
  onClose: () => void;
  onSave: (data: { type: IntegrationType; name: string; config: Record<string, string> }) => Promise<void>;
}

function IntegrationModal({ mode, initial, onClose, onSave }: ModalProps) {
  const [type, setType] = useState<IntegrationType>(initial?.type || 'lead_webhook');
  const [name, setName] = useState(initial?.name || '');
  const [config, setConfig] = useState<Record<string, string>>(initial?.config || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = CONFIG_FIELDS[type];

  const handleTypeChange = (t: IntegrationType) => {
    setType(t);
    setConfig({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    const requiredField = fields.find(f => !f.key.includes('optional') && !f.hint?.includes('optional') && !config[f.key] && !f.placeholder.includes('optional'));
    if (requiredField && !config[requiredField.key]) {
      setError(`${requiredField.label} is required.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ type, name: name.trim(), config });
    } catch (err: any) {
      setError(err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">
            {mode === 'create' ? 'Add Integration' : 'Edit Integration'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Type selector (only on create) */}
          {mode === 'create' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Integration Type</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(Object.keys(TYPE_LABELS) as IntegrationType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      type === t
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className={`p-1 rounded ${TYPE_COLORS[t]}`}>{TYPE_ICONS[t]}</span>
                    <span>{TYPE_LABELS[t]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${TYPE_LABELS[type]} — Production`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Config fields */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700 border-t border-gray-100 pt-3">Connection Settings</div>
            {fields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                <input
                  type={field.type || 'text'}
                  value={config[field.key] || ''}
                  onChange={(e) => setConfig((c) => ({ ...c, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {field.hint && <p className="text-xs text-gray-500 mt-1">{field.hint}</p>}
              </div>
            ))}
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : mode === 'create' ? 'Add Integration' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Integration Card ─────────────────────────────────────────────────────────

interface CardProps {
  integration: Integration;
  isAdmin: boolean;
  onEdit: (i: Integration) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testing: boolean;
}

function IntegrationCard({ integration, isAdmin, onEdit, onDelete, onTest, testing }: CardProps) {
  const badge = STATUS_BADGE[integration.status];
  const lastTested = integration.last_tested_at
    ? new Date(integration.last_tested_at).toLocaleString()
    : 'Never';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-lg shrink-0 ${TYPE_COLORS[integration.type]}`}>
            {TYPE_ICONS[integration.type]}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{integration.name}</div>
            <div className="text-xs text-gray-500">{TYPE_LABELS[integration.type]}</div>
          </div>
        </div>
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium shrink-0 ${badge.cls}`}>
          {badge.icon}{badge.label}
        </span>
      </div>

      <div className="text-xs text-gray-500 space-y-0.5">
        <div>Last tested: {lastTested}</div>
        {integration.last_error && integration.status === 'failed' && (
          <div className="text-red-600 truncate" title={integration.last_error}>
            Error: {integration.last_error}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
          <button
            onClick={() => onTest(integration.id)}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            Test
          </button>
          <button
            onClick={() => onEdit(integration)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={() => onDelete(integration.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { selectedCompanyId, userRole } = useCompanyContext();
  const router = useRouter();
  const companyId = selectedCompanyId || '';
  const isAdmin = ['SUPER_ADMIN', 'COMPANY_ADMIN'].includes((userRole || '').toUpperCase());

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; integration?: Integration } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations?company_id=${encodeURIComponent(companyId)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setIntegrations(data.integrations || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload: { type: IntegrationType; name: string; config: Record<string, string> }) => {
    if (modal?.mode === 'create') {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } else if (modal?.integration) {
      const res = await fetch(`/api/integrations/${modal.integration.id}?company_id=${encodeURIComponent(companyId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name: payload.name, config: payload.config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    setModal(null);
    load();
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await res.json();
      setTestResult({ id, success: data.success, message: data.message });
      load(); // refresh status
    } catch {
      setTestResult({ id, success: false, message: 'Test request failed.' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this integration? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/integrations/${id}?company_id=${encodeURIComponent(companyId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      load();
    } finally {
      setDeletingId(null);
    }
  };

  const leadIntegrations = integrations.filter((i) => i.type === 'lead_webhook');
  const blogIntegrations = integrations.filter((i) => i.type === 'wordpress' || i.type === 'custom_blog_api');

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Integrations</h1>
            <p className="text-sm text-gray-500 mt-1">Connect external systems for lead capture and blog publishing.</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors w-full sm:w-auto justify-center"
            >
              <Plus className="h-4 w-4" />
              Add Integration
            </button>
          )}
        </div>

        {!companyId && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
            Select a company to manage integrations.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {testResult && (
          <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-3 mb-4 border ${testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {testResult.success ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <span>{testResult.message}</span>
            <button onClick={() => setTestResult(null)} className="ml-auto shrink-0"><X className="h-4 w-4" /></button>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500 text-center py-12">Loading integrations...</div>
        ) : (
          <div className="space-y-8">
            {/* Lead Capture */}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Lead Capture Integrations</h2>
                  <p className="text-xs text-gray-500">Receive incoming leads from external forms and websites.</p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => setModal({ mode: 'create' })}
                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                )}
              </div>
              {leadIntegrations.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-gray-300 text-center py-10 text-sm text-gray-400">
                  No lead capture integrations yet.
                  {isAdmin && (
                    <div className="mt-2">
                      <button onClick={() => setModal({ mode: 'create' })} className="text-indigo-600 hover:text-indigo-700 font-medium">
                        Add one →
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {leadIntegrations.map((i) => (
                    <IntegrationCard
                      key={i.id}
                      integration={i}
                      isAdmin={isAdmin}
                      onEdit={(int) => setModal({ mode: 'edit', integration: int })}
                      onDelete={handleDelete}
                      onTest={handleTest}
                      testing={testingId === i.id}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Blog Publishing */}
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Blog Publishing Integrations</h2>
                  <p className="text-xs text-gray-500">Publish content to WordPress or custom blog APIs.</p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => setModal({ mode: 'create' })}
                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                )}
              </div>
              {blogIntegrations.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-gray-300 text-center py-10 text-sm text-gray-400">
                  No blog publishing integrations yet.
                  {isAdmin && (
                    <div className="mt-2">
                      <button onClick={() => setModal({ mode: 'create' })} className="text-indigo-600 hover:text-indigo-700 font-medium">
                        Add one →
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {blogIntegrations.map((i) => (
                    <IntegrationCard
                      key={i.id}
                      integration={i}
                      isAdmin={isAdmin}
                      onEdit={(int) => setModal({ mode: 'edit', integration: int })}
                      onDelete={handleDelete}
                      onTest={handleTest}
                      testing={testingId === i.id}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {modal && (
        <IntegrationModal
          mode={modal.mode}
          initial={modal.integration}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
