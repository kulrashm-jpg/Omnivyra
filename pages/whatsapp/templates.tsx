/**
 * WhatsApp Message Templates — /whatsapp/templates
 * Company admin: create, submit for Meta approval, view status.
 * Users: view approved templates available for broadcasts.
 *
 * APIs:
 *   GET  /api/whatsapp/templates?company_id=&status=&active_only=
 *   POST /api/whatsapp/templates — submit new template to Meta
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCompanyContext } from '@/components/CompanyContext';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
} from 'lucide-react';

type Template = {
  id: string;
  template_name: string;
  template_category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language_code: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEPRECATED' | 'PAUSED' | 'DISABLED';
  is_active: boolean;
  version: number;
  components: any[];
  rejection_reason?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  created_at: string;
};

type WaAccount = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  PENDING:    'bg-yellow-100 text-yellow-700',
  APPROVED:   'bg-green-100 text-green-700',
  REJECTED:   'bg-red-100 text-red-700',
  DEPRECATED: 'bg-gray-100 text-gray-500',
  PAUSED:     'bg-orange-100 text-orange-700',
  DISABLED:   'bg-gray-100 text-gray-500',
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'APPROVED') return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
  if (status === 'REJECTED') return <XCircle className="h-3.5 w-3.5 text-red-600" />;
  if (status === 'PAUSED' || status === 'DISABLED') return <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />;
  return <Clock className="h-3.5 w-3.5 text-yellow-600" />;
};

const CATEGORY_OPTIONS = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
const LANGUAGE_OPTIONS = [
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'es',    label: 'Spanish' },
  { code: 'fr',    label: 'French' },
  { code: 'de',    label: 'German' },
  { code: 'pt_BR', label: 'Portuguese (BR)' },
  { code: 'ar',    label: 'Arabic' },
  { code: 'hi',    label: 'Hindi' },
];

export default function WhatsAppTemplatesPage() {
  const { selectedCompanyId } = useCompanyContext();
  const companyId = selectedCompanyId || '';

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // WA accounts for picker
  const [waAccounts, setWaAccounts] = useState<WaAccount[]>([]);

  // Form state
  const [form, setForm] = useState({
    social_account_id: '',
    template_name: '',
    template_category: 'MARKETING' as typeof CATEGORY_OPTIONS[number],
    language_code: 'en_US',
    body_text: '',
    header_text: '',
    footer_text: '',
    has_header: false,
    has_footer: false,
  });

  // Load WA social accounts
  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/social-accounts/status?companyId=${encodeURIComponent(companyId)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : { accounts: [] })
      .then((data) => {
        const wa = (data.accounts ?? []).filter(
          (a: any) => a.platform_key === 'whatsapp' && a.connected && !a.expired && a.social_account_id
        );
        setWaAccounts(wa.map((a: any) => ({ id: a.social_account_id, name: a.account_name ?? 'WhatsApp Account' })));
        if (wa.length > 0) setForm((f) => ({ ...f, social_account_id: wa[0].social_account_id }));
      })
      .catch(() => {});
  }, [companyId]);

  const fetchTemplates = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ company_id: companyId });
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`/api/whatsapp/templates?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load templates');
      setTemplates(data.templates ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, filterStatus]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    // Build components array
    const components: any[] = [];
    if (form.has_header && form.header_text.trim()) {
      components.push({ type: 'HEADER', format: 'TEXT', text: form.header_text.trim() });
    }
    components.push({ type: 'BODY', text: form.body_text.trim() });
    if (form.has_footer && form.footer_text.trim()) {
      components.push({ type: 'FOOTER', text: form.footer_text.trim() });
    }

    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          company_id: companyId,
          social_account_id: form.social_account_id,
          template_name: form.template_name.toLowerCase().replace(/\s+/g, '_'),
          template_category: form.template_category,
          language_code: form.language_code,
          components,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to submit template');
      setSuccess(`Template submitted to Meta for review (ID: ${data.template_id}). Approval usually takes a few minutes.`);
      setShowForm(false);
      setForm({ social_account_id: waAccounts[0]?.id ?? '', template_name: '', template_category: 'MARKETING', language_code: 'en_US', body_text: '', header_text: '', footer_text: '', has_header: false, has_footer: false });
      await fetchTemplates();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyName = (name: string) => {
    navigator.clipboard.writeText(name).catch(() => {});
  };

  if (!companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Select a company to manage templates
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>WhatsApp Templates</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/whatsapp" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Message Templates</h1>
              <p className="text-xs text-gray-500">
                Templates must be approved by Meta before use in broadcasts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTemplates}
              className="p-2 rounded border border-gray-300 hover:bg-gray-50"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => { setShowForm((v) => !v); setError(null); setSuccess(null); }}
              className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              New Template
            </button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded text-sm">{success}</div>
          )}

          {/* No WA account warning */}
          {waAccounts.length === 0 && !loading && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-yellow-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                No WhatsApp account connected. Please connect one before submitting templates.
              </div>
              <Link href="/social-platforms" className="text-yellow-900 underline font-medium shrink-0 ml-3">
                Connect account
              </Link>
            </div>
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">Filter:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">All statuses</option>
              {Object.keys(STATUS_STYLE).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Create Template Form */}
          {showForm && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Submit New Template</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                {waAccounts.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Account</label>
                    <select
                      value={form.social_account_id}
                      onChange={(e) => setForm((f) => ({ ...f, social_account_id: e.target.value }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      required
                    >
                      {waAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Template Name <span className="text-gray-400 font-normal">(snake_case, no spaces)</span>
                    </label>
                    <input
                      type="text"
                      required
                      pattern="[a-z0-9_]+"
                      value={form.template_name}
                      onChange={(e) => setForm((f) => ({ ...f, template_name: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="order_confirmation"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select
                      value={form.template_category}
                      onChange={(e) => setForm((f) => ({ ...f, template_category: e.target.value as any }))}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
                  <select
                    value={form.language_code}
                    onChange={(e) => setForm((f) => ({ ...f, language_code: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  >
                    {LANGUAGE_OPTIONS.map((l) => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>

                {/* Header toggle */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.has_header}
                      onChange={(e) => setForm((f) => ({ ...f, has_header: e.target.checked }))}
                      className="rounded"
                    />
                    Add Header (optional text header)
                  </label>
                  {form.has_header && (
                    <input
                      type="text"
                      value={form.header_text}
                      onChange={(e) => setForm((f) => ({ ...f, header_text: e.target.value }))}
                      className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Order Confirmation"
                    />
                  )}
                </div>

                {/* Body */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Body Text <span className="text-gray-400 font-normal">— use {'{{1}}'}, {'{{2}}'} for variables</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={form.body_text}
                    onChange={(e) => setForm((f) => ({ ...f, body_text: e.target.value }))}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={`Hello {{1}},\n\nYour order {{2}} has been confirmed and will be delivered by {{3}}.\n\nThank you for shopping with us!`}
                  />
                  <p className="text-xs text-gray-400 mt-1">{form.body_text.length}/1024 characters</p>
                </div>

                {/* Footer toggle */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.has_footer}
                      onChange={(e) => setForm((f) => ({ ...f, has_footer: e.target.checked }))}
                      className="rounded"
                    />
                    Add Footer (optional)
                  </label>
                  {form.has_footer && (
                    <input
                      type="text"
                      value={form.footer_text}
                      onChange={(e) => setForm((f) => ({ ...f, footer_text: e.target.value }))}
                      className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      placeholder="Reply STOP to unsubscribe"
                    />
                  )}
                </div>

                <div className="bg-blue-50 border border-blue-100 rounded p-3 text-xs text-blue-700">
                  Meta reviews templates before approval (usually minutes to hours). Once approved, the template becomes available for broadcasts.
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !form.social_account_id || !form.body_text.trim()}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {submitting ? 'Submitting...' : 'Submit to Meta'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Templates list */}
          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              No templates yet. Create your first template to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => {
                const isExpanded = expandedId === t.id;
                const bodyComponent = t.components?.find((c: any) => c.type === 'BODY');
                const headerComponent = t.components?.find((c: any) => c.type === 'HEADER');
                const footerComponent = t.components?.find((c: any) => c.type === 'FOOTER');
                return (
                  <div key={t.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
                      onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <StatusIcon status={t.status} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium text-gray-900">{t.template_name}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyName(t.template_name); }}
                              className="text-gray-400 hover:text-gray-600"
                              title="Copy name"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <span className="text-xs text-gray-400">v{t.version}</span>
                            {t.is_active && (
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">active</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {t.template_category} · {t.language_code} ·{' '}
                            {t.submitted_at ? new Date(t.submitted_at).toLocaleDateString() : new Date(t.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[t.status] ?? STATUS_STYLE.PENDING}`}>
                          {t.status}
                        </span>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-4 space-y-3">
                        {headerComponent && (
                          <div>
                            <div className="text-xs font-medium text-gray-400 mb-1">HEADER</div>
                            <p className="text-sm font-semibold text-gray-800">{headerComponent.text}</p>
                          </div>
                        )}
                        {bodyComponent && (
                          <div>
                            <div className="text-xs font-medium text-gray-400 mb-1">BODY</div>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded p-3">
                              {bodyComponent.text}
                            </p>
                          </div>
                        )}
                        {footerComponent && (
                          <div>
                            <div className="text-xs font-medium text-gray-400 mb-1">FOOTER</div>
                            <p className="text-xs text-gray-500">{footerComponent.text}</p>
                          </div>
                        )}
                        {t.rejection_reason && (
                          <div className="bg-red-50 border border-red-100 rounded p-3 text-sm text-red-700">
                            <span className="font-medium">Rejection reason:</span> {t.rejection_reason}
                          </div>
                        )}
                        {t.approved_at && (
                          <p className="text-xs text-gray-400">
                            Approved {new Date(t.approved_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
