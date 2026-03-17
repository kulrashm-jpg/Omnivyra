import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  Users, Plus, Code2, Edit2, Trash2, Webhook, Copy, CheckCheck,
  TestTube2, ExternalLink, Calendar, AlertCircle, Loader2, FileText,
  Download, Palette, Link2,
} from 'lucide-react';
import { useCompanyContext } from '../components/CompanyContext';

// ─── Types ────────────────────────────────────────────────────────────────────
type FieldType = 'text' | 'email' | 'phone';
interface FormField { name: string; label: string; type: FieldType; required: boolean }
interface FormBrand {
  heading?: string;
  description?: string;
  submit_label?: string;
  success_message?: string;
  primary_color?: string;
  font?: 'system' | 'sans' | 'serif';
}
interface CaptureForm {
  id: string; company_id: string; name: string;
  fields: FormField[]; brand: FormBrand; integration_id: string | null; created_at: string;
}
interface Lead {
  id: string; name: string; email: string; phone: string | null;
  source: string; form_id: string | null; integration_id: string | null;
  is_test: boolean; created_at: string;
}
interface WebhookIntegration {
  id: string; name: string; status: string; config: Record<string, string>; created_at: string;
}
type Tab = 'leads' | 'forms' | 'connections';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_FIELDS: FormField[] = [
  { name: 'name', label: 'Full Name', type: 'text', required: true },
  { name: 'email', label: 'Email Address', type: 'email', required: true },
  { name: 'phone', label: 'Phone Number', type: 'phone', required: false },
];
const DEFAULT_BRAND: FormBrand = {
  heading: '', description: '', submit_label: 'Submit',
  success_message: "Thank you! We'll be in touch soon.",
  primary_color: '#6366f1', font: 'system',
};
const COLOR_PRESETS = [
  { label: 'Indigo', value: '#6366f1' }, { label: 'Blue', value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' }, { label: 'Emerald', value: '#10b981' },
  { label: 'Rose', value: '#f43f5e' },   { label: 'Orange', value: '#f97316' },
  { label: 'Slate', value: '#64748b' },  { label: 'Black', value: '#111827' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escJs(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
const SOURCE_LABELS: Record<string, string> = {
  form_embed: 'Embed Form', html_file: 'HTML File', webhook: 'Webhook', manual: 'Manual', direct: 'Direct',
};

// ─── CopyButton ───────────────────────────────────────────────────────────────
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <button onClick={copy} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
      {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label || (copied ? 'Copied!' : 'Copy')}
    </button>
  );
}

// ─── Embed code (with brand) ──────────────────────────────────────────────────
function generateEmbedCode(form: CaptureForm, origin: string): string {
  const script = `(function () {
  var id = "${form.id}";
  var base = "${origin}";
  var el = document.querySelector('[data-vf="' + id + '"]');
  if (!el) return;
  fetch(base + "/api/forms/" + id + "/embed")
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (!cfg || !cfg.fields) return;
      var b = cfg.brand || {};
      var color = b.primary_color || "#6366f1";
      var font = b.font === "serif" ? "Georgia,serif" : b.font === "sans" ? "Helvetica,Arial,sans-serif" : "system-ui,sans-serif";
      var heading = b.heading || "";
      var desc = b.description || "";
      var submitLabel = b.submit_label || "Submit";
      var successMsg = b.success_message || "Thank you! We\u2019ll be in touch soon.";
      var s = document.createElement("style");
      s.textContent = ".vf{font-family:" + font + ";max-width:420px}"
        + ".vf .vf-field{margin-bottom:14px}"
        + ".vf label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:5px}"
        + ".vf input{width:100%;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit}"
        + ".vf input:focus{border-color:" + color + ";outline:none;box-shadow:0 0 0 3px " + color + "33}"
        + ".vf .vf-btn{width:100%;padding:10px;background:" + color + ";color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:4px}"
        + ".vf .vf-btn:hover{opacity:.9}.vf .vf-btn:disabled{opacity:.6;cursor:not-allowed}"
        + ".vf .vf-h{font-size:20px;font-weight:700;color:#111827;margin:0 0 6px}"
        + ".vf .vf-d{font-size:13px;color:#6b7280;margin:0 0 20px;line-height:1.5}"
        + ".vf .vf-msg{margin-top:10px;padding:10px 12px;border-radius:6px;font-size:13px;display:none}"
        + ".vf-ok{background:#d1fae5;color:#065f46}.vf-err{background:#fee2e2;color:#991b1b}";
      document.head.appendChild(s);
      var wrap = document.createElement("div"); wrap.className = "vf";
      if (heading) { var h = document.createElement("p"); h.className = "vf-h"; h.textContent = heading; wrap.appendChild(h); }
      if (desc) { var p = document.createElement("p"); p.className = "vf-d"; p.textContent = desc; wrap.appendChild(p); }
      var form = document.createElement("form");
      cfg.fields.forEach(function (f) {
        var w = document.createElement("div"); w.className = "vf-field";
        var lbl = document.createElement("label"); lbl.textContent = f.label + (f.required ? " *" : "");
        var inp = document.createElement("input");
        inp.type = f.type === "phone" ? "tel" : f.type;
        inp.name = f.name; inp.placeholder = f.label; inp.required = !!f.required;
        w.appendChild(lbl); w.appendChild(inp); form.appendChild(w);
      });
      var btn = document.createElement("button"); btn.type = "submit"; btn.className = "vf-btn"; btn.textContent = submitLabel;
      form.appendChild(btn);
      var msg = document.createElement("div"); msg.className = "vf-msg"; form.appendChild(msg);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        btn.disabled = true; btn.textContent = "Sending\u2026"; msg.style.display = "none";
        var data = { form_id: cfg.id, company_id: cfg.company_id, source: "embed" };
        cfg.fields.forEach(function (f) { data[f.name] = form.elements[f.name].value; });
        fetch(base + "/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.lead) { msg.className = "vf-msg vf-ok"; msg.textContent = successMsg; msg.style.display = "block"; form.reset(); }
            else { msg.className = "vf-msg vf-err"; msg.textContent = res.error || "Submission failed."; msg.style.display = "block"; }
            btn.disabled = false; btn.textContent = submitLabel;
          })
          .catch(function () {
            msg.className = "vf-msg vf-err"; msg.textContent = "Network error. Please try again."; msg.style.display = "block";
            btn.disabled = false; btn.textContent = submitLabel;
          });
      });
      wrap.appendChild(form);
      el.appendChild(wrap);
    });
})();`;
  return `<!-- ${form.name} — Lead Capture Form -->\n<div data-vf="${form.id}"></div>\n<script>\n${script}\n<\/script>`;
}

// ─── Standalone HTML file generator ──────────────────────────────────────────
function generateHtmlFile(form: CaptureForm, origin: string): string {
  const b = form.brand || {};
  const color = b.primary_color || '#6366f1';
  const heading = b.heading || form.name;
  const desc = b.description || '';
  const submitLabel = b.submit_label || 'Submit';
  const successMsg = b.success_message || "Thank you! We'll be in touch soon.";
  const fontMap = {
    serif: 'Georgia, "Times New Roman", serif',
    sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    system: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  };
  const fontStack = fontMap[b.font || 'system'];
  // Focus ring: append 33 to hex for ~20% alpha in CSS 8-digit hex
  const focusColor = color + '33';

  const fieldsHtml = form.fields.map(f =>
    `      <div class="field">
        <label for="f_${escHtml(f.name)}">${escHtml(f.label)}${f.required ? ' <span style="color:#ef4444">*</span>' : ''}</label>
        <input type="${f.type === 'phone' ? 'tel' : f.type}" id="f_${escHtml(f.name)}" name="${escHtml(f.name)}" placeholder="${escHtml(f.label)}"${f.required ? ' required' : ''} />
      </div>`
  ).join('\n');

  const fieldDataJs = form.fields.map(f =>
    `        d['${escJs(f.name)}'] = form.elements['${escJs(f.name)}'].value;`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(heading)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 60px 20px 40px;
      min-height: 100vh; background: #f3f4f6;
      font-family: ${fontStack};
      display: flex; align-items: flex-start; justify-content: center;
    }
    .card {
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,.10);
      padding: 40px; width: 100%; max-width: 480px;
    }
    h1 { margin: 0 0 8px; font-size: 26px; font-weight: 700; color: #111827; line-height: 1.3; }
    .desc { margin: 0 0 28px; color: #6b7280; font-size: 15px; line-height: 1.6; }
    .field { margin-bottom: 18px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
    input {
      width: 100%; padding: 10px 14px;
      border: 1.5px solid #d1d5db; border-radius: 8px;
      font-size: 15px; font-family: inherit; color: #111827;
      transition: border-color .15s, box-shadow .15s; outline: none;
    }
    input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${focusColor}; }
    button[type="submit"] {
      width: 100%; padding: 12px; background: ${color}; color: #fff;
      border: none; border-radius: 8px; font-size: 15px; font-weight: 600;
      font-family: inherit; cursor: pointer; transition: opacity .15s; margin-top: 4px;
    }
    button[type="submit"]:hover { opacity: .88; }
    button[type="submit"]:disabled { opacity: .6; cursor: not-allowed; }
    .msg { margin-top: 14px; padding: 12px 16px; border-radius: 8px; font-size: 14px; display: none; }
    .ok { background: #d1fae5; color: #065f46; }
    .err { background: #fee2e2; color: #991b1b; }
    @media (max-width: 520px) { body { padding: 20px 16px; } .card { padding: 28px 20px; } }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escHtml(heading)}</h1>${desc ? `\n    <p class="desc">${escHtml(desc)}</p>` : ''}
    <form id="vf">
${fieldsHtml}
      <button type="submit" id="vf-btn">${escHtml(submitLabel)}</button>
      <div class="msg" id="vf-msg"></div>
    </form>
  </div>
  <script>
    document.getElementById('vf').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = this;
      var btn = document.getElementById('vf-btn');
      var msg = document.getElementById('vf-msg');
      btn.disabled = true; btn.textContent = 'Sending\u2026'; msg.style.display = 'none';
      var d = { form_id: '${escJs(form.id)}', company_id: '${escJs(form.company_id)}', source: 'html_file' };
${fieldDataJs}
      fetch('${escJs(origin)}/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.lead) {
          msg.className = 'msg ok';
          msg.textContent = '${escJs(successMsg)}';
          msg.style.display = 'block';
          form.reset();
        } else {
          msg.className = 'msg err';
          msg.textContent = res.error || 'Submission failed. Please try again.';
          msg.style.display = 'block';
        }
        btn.disabled = false; btn.textContent = '${escJs(submitLabel)}';
      })
      .catch(function () {
        msg.className = 'msg err';
        msg.textContent = 'Network error. Please try again.';
        msg.style.display = 'block';
        btn.disabled = false; btn.textContent = '${escJs(submitLabel)}';
      });
    });
  </script>
</body>
</html>`;
}

function downloadHtmlFile(form: CaptureForm, origin: string) {
  const html = generateHtmlFile(form, origin);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-form.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LeadsPage() {
  const router = useRouter();
  const { selectedCompanyId, userRole } = useCompanyContext();
  const isAdmin = ['COMPANY_ADMIN', 'SUPER_ADMIN'].includes((userRole || '').toUpperCase());

  const [leads, setLeads] = useState<Lead[]>([]);
  const [forms, setForms] = useState<CaptureForm[]>([]);
  const [webhookIntegrations, setWebhookIntegrations] = useState<WebhookIntegration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('leads');

  // Lead filters
  const [filterSearch, setFilterSearch] = useState('');
  const [filterFormId, setFilterFormId] = useState('');
  const [filterSource, setFilterSource] = useState('');

  // Form modal
  const [formModal, setFormModal] = useState<{ open: boolean; editing: CaptureForm | null }>({ open: false, editing: null });
  const [fmName, setFmName] = useState('');
  const [fmFields, setFmFields] = useState<FormField[]>(DEFAULT_FIELDS);
  const [fmIntegrationId, setFmIntegrationId] = useState('');
  const [fmBrand, setFmBrand] = useState<FormBrand>(DEFAULT_BRAND);
  const [fmSaving, setFmSaving] = useState(false);
  const [fmError, setFmError] = useState('');

  // Embed / download modal
  const [embedModal, setEmbedModal] = useState<{ open: boolean; form: CaptureForm | null }>({ open: false, form: null });

  // Manual lead modal
  const [leadModal, setLeadModal] = useState(false);
  const [lmName, setLmName] = useState('');
  const [lmEmail, setLmEmail] = useState('');
  const [lmPhone, setLmPhone] = useState('');
  const [lmSource, setLmSource] = useState('manual');
  const [lmSaving, setLmSaving] = useState(false);
  const [lmError, setLmError] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: 'form' | 'lead'; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; ok?: boolean; msg?: string }>>({});

  const fetchAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true); setError('');
    try {
      const qs = `company_id=${selectedCompanyId}`;
      const [leadsRes, formsRes, intRes] = await Promise.all([
        fetch(`/api/leads?${qs}&is_test=false`).then(r => r.json()),
        fetch(`/api/forms?${qs}`).then(r => r.json()),
        fetch(`/api/integrations?${qs}&type=lead_webhook`).then(r => r.json()),
      ]);
      setLeads(leadsRes.leads || []);
      setForms(formsRes.forms || []);
      setWebhookIntegrations(intRes.integrations || []);
    } catch { setError('Failed to load data. Please refresh.'); }
    finally { setLoading(false); }
  }, [selectedCompanyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const today = new Date().toDateString();
  const todayCount = leads.filter(l => new Date(l.created_at).toDateString() === today).length;
  const fromForms = leads.filter(l => l.source === 'form_embed' || l.source === 'html_file').length;
  const fromWebhooks = leads.filter(l => l.source === 'webhook').length;

  const filteredLeads = leads.filter(l => {
    if (filterSearch && !l.name.toLowerCase().includes(filterSearch.toLowerCase()) &&
      !l.email.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    if (filterFormId && l.form_id !== filterFormId) return false;
    if (filterSource && l.source !== filterSource) return false;
    return true;
  });

  // ── Form modal ─────────────────────────────────────────────────────────────
  function openCreateForm() {
    setFmName(''); setFmFields(DEFAULT_FIELDS.map(f => ({ ...f }))); setFmIntegrationId('');
    setFmBrand({ ...DEFAULT_BRAND }); setFmError('');
    setFormModal({ open: true, editing: null });
  }
  function openEditForm(form: CaptureForm) {
    setFmName(form.name); setFmFields(form.fields.map(f => ({ ...f }))); setFmIntegrationId(form.integration_id || '');
    setFmBrand({ ...DEFAULT_BRAND, ...(form.brand || {}) }); setFmError('');
    setFormModal({ open: true, editing: form });
  }
  function addField() {
    setFmFields(prev => [...prev, { name: `field_${prev.length + 1}`, label: 'New Field', type: 'text', required: false }]);
  }
  function updateField(idx: number, updates: Partial<FormField>) {
    setFmFields(prev => prev.map((f, i) => {
      if (i !== idx) return f;
      const updated = { ...f, ...updates };
      if (updates.label !== undefined) updated.name = slugify(updates.label);
      return updated;
    }));
  }
  function removeField(idx: number) { setFmFields(prev => prev.filter((_, i) => i !== idx)); }
  function setBrand(key: keyof FormBrand, value: string) { setFmBrand(prev => ({ ...prev, [key]: value })); }

  async function saveForm() {
    if (!fmName.trim()) { setFmError('Form name is required'); return; }
    if (fmFields.length === 0) { setFmError('At least one field is required'); return; }
    if (!fmFields.some(f => f.type === 'email')) { setFmError('At least one Email field is required'); return; }
    setFmSaving(true); setFmError('');
    try {
      const body = {
        company_id: selectedCompanyId, name: fmName.trim(), fields: fmFields,
        brand: fmBrand, integration_id: fmIntegrationId || null,
      };
      const url = formModal.editing ? `/api/forms/${formModal.editing.id}` : '/api/forms';
      const method = formModal.editing ? 'PUT' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) { setFmError(data.error || 'Failed to save'); return; }
      setFormModal({ open: false, editing: null }); fetchAll();
    } catch { setFmError('Network error'); }
    finally { setFmSaving(false); }
  }

  // ── Manual lead ────────────────────────────────────────────────────────────
  async function saveLead() {
    if (!lmName.trim() || !lmEmail.trim()) { setLmError('Name and email are required'); return; }
    setLmSaving(true); setLmError('');
    try {
      const r = await fetch('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: selectedCompanyId, name: lmName, email: lmEmail, phone: lmPhone || undefined, source: lmSource }),
      });
      const data = await r.json();
      if (!r.ok) { setLmError(data.error || 'Failed to save'); return; }
      setLeadModal(false); setLmName(''); setLmEmail(''); setLmPhone(''); fetchAll();
    } catch { setLmError('Network error'); }
    finally { setLmSaving(false); }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteConfirm) return;
    setDeleting(true);
    const url = deleteConfirm.kind === 'form'
      ? `/api/forms/${deleteConfirm.id}?company_id=${selectedCompanyId}`
      : `/api/leads/${deleteConfirm.id}?company_id=${selectedCompanyId}`;
    await fetch(url, { method: 'DELETE' }).catch(() => {});
    setDeleteConfirm(null); setDeleting(false); fetchAll();
  }

  // ── Test webhook ───────────────────────────────────────────────────────────
  async function sendTestLead(integration: WebhookIntegration) {
    setTestResults(prev => ({ ...prev, [integration.id]: { loading: true } }));
    try {
      const r = await fetch('/api/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integration_id: integration.id, webhook_secret: integration.config.secret,
          name: 'Test Lead', email: 'test@example.com', phone: '+1 555-0100',
          source: 'connection_test', is_test: true,
        }),
      });
      const data = await r.json();
      const ok = r.ok && !!data.lead;
      setTestResults(prev => ({ ...prev, [integration.id]: { loading: false, ok, msg: ok ? 'Test lead captured.' : (data.error || 'Test failed.') } }));
      if (ok) fetchAll();
    } catch {
      setTestResults(prev => ({ ...prev, [integration.id]: { loading: false, ok: false, msg: 'Network error.' } }));
    }
  }

  function samplePayload(i: WebhookIntegration) {
    return JSON.stringify({
      integration_id: i.id, webhook_secret: i.config.secret || 'YOUR_SECRET',
      name: 'Jane Doe', email: 'jane@example.com', phone: '+1 555-0101', source: 'contact-form',
    }, null, 2);
  }

  if (!selectedCompanyId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="text-center text-gray-500">
          <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">Select a company to manage leads</p>
        </div>
      </div>
    );
  }

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeTab === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Lead Capture</h1>
            <p className="text-sm text-gray-500 mt-0.5">Collect leads from your website, forms, and external tools.</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setLeadModal(true)} className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors">
                <Plus className="h-4 w-4" /> Add Lead
              </button>
              <button onClick={openCreateForm} className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                <FileText className="h-4 w-4" /> Create Form
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Leads', value: leads.length, color: 'text-indigo-600' },
            { label: "Today", value: todayCount, color: 'text-emerald-600' },
            { label: 'From Forms', value: fromForms, color: 'text-blue-600' },
            { label: 'From Webhooks', value: fromWebhooks, color: 'text-purple-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-4">
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className={`text-xs font-medium mt-0.5 ${color}`}>{label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-5 overflow-x-auto pb-1">
          <button onClick={() => setActiveTab('leads')} className={tabCls('leads')}><Users className="h-4 w-4" /> Leads</button>
          <button onClick={() => setActiveTab('forms')} className={tabCls('forms')}><FileText className="h-4 w-4" /> Forms</button>
          <button onClick={() => setActiveTab('connections')} className={tabCls('connections')}><Webhook className="h-4 w-4" /> Webhook</button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 mb-4 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
          </div>
        ) : (
          <>
            {/* ── LEADS TAB ──────────────────────────────────────────────── */}
            {activeTab === 'leads' && (
              <div>
                <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-3 mb-4 flex flex-wrap gap-2">
                  <input type="text" placeholder="Search name or email…" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
                    className="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <select value={filterFormId} onChange={e => setFilterFormId(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white">
                    <option value="">All Forms</option>
                    {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white">
                    <option value="">All Sources</option>
                    <option value="form_embed">Embed Form</option>
                    <option value="html_file">HTML File</option>
                    <option value="webhook">Webhook</option>
                    <option value="manual">Manual</option>
                  </select>
                  {(filterSearch || filterFormId || filterSource) && (
                    <button onClick={() => { setFilterSearch(''); setFilterFormId(''); setFilterSource(''); }} className="text-xs text-gray-500 hover:text-gray-700 underline">Clear</button>
                  )}
                </div>

                {filteredLeads.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Users className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No leads yet</p>
                    <p className="text-sm mt-1">Create a form or set up a webhook connection to start capturing leads.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50/60">
                            <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                            <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                            <th className="hidden sm:table-cell text-left px-4 py-3 font-semibold text-gray-600">Phone</th>
                            <th className="hidden md:table-cell text-left px-4 py-3 font-semibold text-gray-600">Source</th>
                            <th className="hidden lg:table-cell text-left px-4 py-3 font-semibold text-gray-600">Form</th>
                            <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLeads.map(lead => {
                            const form = forms.find(f => f.id === lead.form_id);
                            return (
                              <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                <td className="px-4 py-3 font-medium text-gray-900">
                                  {lead.name}
                                  {lead.is_test && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">test</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-600">{lead.email}</td>
                                <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{lead.phone || '—'}</td>
                                <td className="hidden md:table-cell px-4 py-3">
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{SOURCE_LABELS[lead.source] || lead.source}</span>
                                </td>
                                <td className="hidden lg:table-cell px-4 py-3 text-gray-500 text-xs">{form?.name || '—'}</td>
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDate(lead.created_at)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-50">
                      Showing {filteredLeads.length} of {leads.length} leads
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── FORMS TAB ──────────────────────────────────────────────── */}
            {activeTab === 'forms' && (
              <div>
                {forms.length === 0 ? (
                  <div className="text-center py-16">
                    <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-gray-600">No forms yet</p>
                    {isAdmin && (
                      <button onClick={openCreateForm} className="mt-3 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors">
                        Create Your First Form
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {forms.map(form => {
                      const integration = webhookIntegrations.find(i => i.id === form.integration_id);
                      const formLeads = leads.filter(l => l.form_id === form.id).length;
                      const brand = form.brand || {};
                      const btnColor = brand.primary_color || '#6366f1';
                      return (
                        <div key={form.id} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-5 flex flex-col gap-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: btnColor }} />
                                <h3 className="font-semibold text-gray-900 truncate">{form.name}</h3>
                              </div>
                              {brand.heading && <p className="text-xs text-gray-400 mt-0.5 truncate">"{brand.heading}"</p>}
                              <p className="text-xs text-gray-400 mt-0.5">{form.fields.length} field{form.fields.length !== 1 ? 's' : ''} · {formLeads} lead{formLeads !== 1 ? 's' : ''}</p>
                            </div>
                            {isAdmin && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => openEditForm(form)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors" title="Edit form">
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => setDeleteConfirm({ kind: 'form', id: form.id, name: form.name })} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete form">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {form.fields.map(f => (
                              <span key={f.name} className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                                {f.label}{f.required ? '*' : ''}
                              </span>
                            ))}
                          </div>

                          {integration && (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
                              <Webhook className="h-3 w-3" /> Forwards to: {integration.name}
                            </div>
                          )}

                          <div className="flex gap-2 mt-auto flex-wrap">
                            <a href={`/capture/${form.id}`} target="_blank" rel="noopener noreferrer"
                              className="flex-1 min-w-[80px] flex items-center justify-center gap-1.5 border border-emerald-200 text-emerald-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-emerald-50 transition-colors">
                              <Link2 className="h-3.5 w-3.5" /> Hosted Link
                            </a>
                            <button onClick={() => setEmbedModal({ open: true, form })}
                              className="flex-1 min-w-[80px] flex items-center justify-center gap-1.5 border border-indigo-200 text-indigo-600 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-50 transition-colors">
                              <Code2 className="h-3.5 w-3.5" /> Embed Code
                            </button>
                            <button onClick={() => downloadHtmlFile(form, origin)}
                              className="flex-1 min-w-[80px] flex items-center justify-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors">
                              <Download className="h-3.5 w-3.5" /> Download HTML
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── CONNECTIONS TAB ────────────────────────────────────────── */}
            {activeTab === 'connections' && (
              <div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-800">
                  <p className="font-semibold mb-1">Connect an External Form</p>
                  <p>Already have a form on your website? Point it to <code className="bg-blue-100 px-1 rounded">POST /api/leads</code> with your credentials. Works with any platform — WordPress, Webflow, Squarespace, custom code.</p>
                </div>

                {webhookIntegrations.length === 0 ? (
                  <div className="text-center py-16">
                    <Webhook className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-gray-600">No webhook connections configured</p>
                    <p className="text-sm text-gray-400 mt-1 mb-4">Create a Lead Webhook integration to get your connection credentials.</p>
                    <button onClick={() => router.push('/integrations')} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors inline-flex items-center gap-1.5">
                      <ExternalLink className="h-4 w-4" /> Go to Integrations
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {webhookIntegrations.map(integration => {
                      const test = testResults[integration.id];
                      const secret = integration.config.secret;
                      const webhookLeads = leads.filter(l => l.integration_id === integration.id && !l.is_test).length;
                      return (
                        <div key={integration.id} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-5">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                            <div>
                              <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                              <p className="text-xs text-gray-400 mt-0.5">{webhookLeads} lead{webhookLeads !== 1 ? 's' : ''} received</p>
                            </div>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${integration.status === 'connected' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {integration.status}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                            <div className="bg-gray-50 rounded-lg p-3">
                              <div className="flex justify-between mb-1"><span className="text-xs text-gray-500 font-medium">Endpoint URL</span><CopyButton text={`${origin}/api/leads`} /></div>
                              <code className="text-xs text-gray-700 break-all">{origin}/api/leads</code>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <div className="flex justify-between mb-1"><span className="text-xs text-gray-500 font-medium">Integration ID</span><CopyButton text={integration.id} /></div>
                              <code className="text-xs text-gray-700 break-all">{integration.id}</code>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 sm:col-span-2">
                              <div className="flex justify-between mb-1">
                                <span className="text-xs text-gray-500 font-medium">Webhook Secret</span>
                                {secret ? <CopyButton text={secret} /> : <span className="text-xs text-amber-600">Not set — edit in Integrations</span>}
                              </div>
                              <code className="text-xs text-gray-700">{secret ? '••••••••••••••••' : 'Not configured'}</code>
                            </div>
                          </div>
                          <div className="bg-gray-900 rounded-lg p-3 mb-4 overflow-x-auto">
                            <div className="flex justify-between mb-2"><span className="text-xs text-gray-400 font-medium">Sample Payload</span><CopyButton text={samplePayload(integration)} label="Copy" /></div>
                            <pre className="text-xs text-green-400 whitespace-pre">{samplePayload(integration)}</pre>
                          </div>
                          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                            <button onClick={() => sendTestLead(integration)} disabled={!secret || test?.loading}
                              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                              {test?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                              Send Test Lead
                            </button>
                            <button onClick={() => router.push('/integrations')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
                              <ExternalLink className="h-3.5 w-3.5" /> Manage in Integrations
                            </button>
                            {test && !test.loading && (
                              <span className={`text-sm font-medium ${test.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                                {test.ok ? '✓' : '✗'} {test.msg}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── FORM BUILDER MODAL ──────────────────────────────────────────────── */}
      {formModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">{formModal.editing ? 'Edit Form' : 'Create Form'}</h2>
            </div>
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Form name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Form Name <span className="text-gray-400 font-normal">(internal label)</span></label>
                <input value={fmName} onChange={e => setFmName(e.target.value)} placeholder="e.g. Homepage Contact Form"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>

              {/* Fields */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">Fields</label>
                  <button onClick={addField} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                    <Plus className="h-3.5 w-3.5" /> Add Field
                  </button>
                </div>
                <div className="space-y-2">
                  {fmFields.map((field, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                      <input value={field.label} onChange={e => updateField(idx, { label: e.target.value })} placeholder="Label"
                        className="flex-1 min-w-0 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white" />
                      <select value={field.type} onChange={e => updateField(idx, { type: e.target.value as FieldType })}
                        className="border border-gray-200 rounded-md px-2 py-1.5 text-xs bg-white">
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                      </select>
                      <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                        <input type="checkbox" checked={field.required} onChange={e => updateField(idx, { required: e.target.checked })} className="rounded" /> Req
                      </label>
                      <button onClick={() => removeField(idx)} className="text-gray-300 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                {!fmFields.some(f => f.type === 'email') && fmFields.length > 0 && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Add an Email field.</p>
                )}
              </div>

              {/* ── Brand & Messaging ── */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Palette className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold text-gray-700">Brand & Messaging</h3>
                  <span className="text-xs text-gray-400">How the form looks and sounds to visitors</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Form Heading <span className="font-normal text-gray-400">shown at top of form</span></label>
                    <input value={fmBrand.heading || ''} onChange={e => setBrand('heading', e.target.value)} placeholder={`e.g. "Get in Touch" or "Request a Demo"`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Short Description <span className="font-normal text-gray-400">optional tagline below heading</span></label>
                    <input value={fmBrand.description || ''} onChange={e => setBrand('description', e.target.value)} placeholder={`e.g. "We'll get back within 24 hours"`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Button Text</label>
                      <input value={fmBrand.submit_label || ''} onChange={e => setBrand('submit_label', e.target.value)} placeholder="Submit"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Font Style</label>
                      <select value={fmBrand.font || 'system'} onChange={e => setBrand('font', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
                        <option value="system">System (clean)</option>
                        <option value="sans">Classic Sans-Serif</option>
                        <option value="serif">Editorial Serif</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Thank-You Message</label>
                    <input value={fmBrand.success_message || ''} onChange={e => setBrand('success_message', e.target.value)} placeholder="Thank you! We'll be in touch soon."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Button Color</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {COLOR_PRESETS.map(c => (
                        <button key={c.value} type="button" title={c.label}
                          onClick={() => setBrand('primary_color', c.value)}
                          className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${fmBrand.primary_color === c.value ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''}`}
                          style={{ background: c.value }} />
                      ))}
                      <div className="flex items-center gap-1.5 ml-1">
                        <input type="color" value={fmBrand.primary_color || '#6366f1'} onChange={e => setBrand('primary_color', e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border border-gray-200 p-0.5 bg-white" title="Custom color" />
                        <span className="text-xs text-gray-400">Custom</span>
                      </div>
                    </div>
                  </div>
                  {/* Live preview */}
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-400 mb-2 font-medium">Preview</p>
                    {(fmBrand.heading || fmBrand.description) && (
                      <div className="mb-3">
                        {fmBrand.heading && <p className="text-base font-bold text-gray-900">{fmBrand.heading}</p>}
                        {fmBrand.description && <p className="text-xs text-gray-500 mt-0.5">{fmBrand.description}</p>}
                      </div>
                    )}
                    <div className="h-9 rounded-lg text-sm font-semibold text-white flex items-center justify-center transition-colors"
                      style={{ background: fmBrand.primary_color || '#6366f1' }}>
                      {fmBrand.submit_label || 'Submit'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Integration */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Forward Leads To <span className="font-normal text-gray-400">optional</span></label>
                <select value={fmIntegrationId} onChange={e => setFmIntegrationId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                  <option value="">Store here only</option>
                  {webhookIntegrations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>

              {fmError && <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" /> {fmError}</p>}
            </div>
            <div className="p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button onClick={() => setFormModal({ open: false, editing: null })} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button onClick={saveForm} disabled={fmSaving} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {fmSaving ? 'Saving…' : formModal.editing ? 'Save Changes' : 'Create Form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EMBED / DOWNLOAD MODAL ─────────────────────────────────────────── */}
      {embedModal.open && embedModal.form && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Add to Your Website — {embedModal.form.name}</h2>
              <button onClick={() => setEmbedModal({ open: false, form: null })} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-5">
              {/* Option 0: Hosted link */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-emerald-900 text-sm">Option 1 — Hosted Landing Page</p>
                    <p className="text-xs text-emerald-700 mt-1">The fastest option. Share this link directly — no setup needed. Works in emails, social posts, QR codes, or anywhere you can paste a link.</p>
                    <code className="text-xs text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded mt-2 inline-block break-all">{origin}/capture/{embedModal.form?.id}</code>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <CopyButton text={`${origin}/capture/${embedModal.form?.id}`} label="Copy Link" />
                    <a href={`/capture/${embedModal.form?.id}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 font-medium transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" /> Preview
                    </a>
                  </div>
                </div>
              </div>

              {/* Option 1: Download HTML */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-indigo-900 text-sm">Option 2 — Download HTML File</p>
                    <p className="text-xs text-indigo-700 mt-1">Download a ready-to-upload HTML page. Works on any website platform — WordPress, Wix, Squarespace, or your own server. Just upload the file.</p>
                  </div>
                  <button onClick={() => downloadHtmlFile(embedModal.form!, origin)}
                    className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shrink-0">
                    <Download className="h-4 w-4" /> Download HTML
                  </button>
                </div>
              </div>

              {/* Option 3: Embed snippet */}
              <div>
                <p className="font-semibold text-gray-800 text-sm mb-2">Option 3 — Paste Embed Code</p>
                <p className="text-xs text-gray-500 mb-3">For developers or page builders with custom HTML. Paste the snippet where you want the form to appear.</p>
                <div className="bg-gray-900 rounded-xl p-4 overflow-x-auto">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-400 font-medium">HTML + JavaScript</span>
                    <CopyButton text={generateEmbedCode(embedModal.form, origin)} label="Copy Code" />
                  </div>
                  <pre className="text-xs text-green-300 whitespace-pre overflow-x-auto leading-5">
                    {generateEmbedCode(embedModal.form, origin)}
                  </pre>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <strong>Tip:</strong> To change colors, button text, or your thank-you message, edit the form and update the Brand & Messaging section. Changes apply immediately to all embed versions.
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end">
              <button onClick={() => setEmbedModal({ open: false, form: null })} className="px-4 py-2 text-sm font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MANUAL LEAD MODAL ─────────────────────────────────────────────── */}
      {leadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Add Lead Manually</h2>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Name *', value: lmName, set: setLmName, type: 'text', placeholder: 'Full name' },
                { label: 'Email *', value: lmEmail, set: setLmEmail, type: 'email', placeholder: 'email@example.com' },
                { label: 'Phone', value: lmPhone, set: setLmPhone, type: 'tel', placeholder: '+1 555-0100' },
                { label: 'Source', value: lmSource, set: setLmSource, type: 'text', placeholder: 'e.g. trade-show, referral' },
              ].map(({ label, value, set, type, placeholder }) => (
                <div key={label}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
                  <input type={type} value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              ))}
              {lmError && <p className="text-sm text-red-600">{lmError}</p>}
            </div>
            <div className="p-5 border-t border-gray-100 flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button onClick={() => { setLeadModal(false); setLmError(''); }} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={saveLead} disabled={lmSaving} className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {lmSaving ? 'Saving…' : 'Add Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ────────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete {deleteConfirm.kind === 'form' ? 'Form' : 'Lead'}?</h2>
            <p className="text-sm text-gray-600 mb-5">
              <strong>{deleteConfirm.name}</strong> will be permanently deleted.
              {deleteConfirm.kind === 'form' && ' Leads captured by this form will not be deleted.'}
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
