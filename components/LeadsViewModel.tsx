/** Part 1/2 of LeadsView.tsx — verbatim split (barrel preserved; importers unchanged). */
import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  Users, Plus, Code2, Edit2, Trash2, Webhook, Copy, CheckCheck,
  TestTube2, ExternalLink, Calendar, AlertCircle, Loader2, FileText,
  Download, Palette, Link2,
} from 'lucide-react';
import { useCompanyContext } from './CompanyContext';
import EmptyState from './shared/EmptyState';
import ExamplePreview from './shared/ExamplePreview';
import { sampleForm, sampleLead } from '../lib/activation/sampleData';
import { trackActivationEvent } from '../lib/analytics/activationEvents';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldType = 'text' | 'email' | 'phone';
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
  id: string; company_id: string; website_id?: string | null; name: string;
  fields: FormField[]; brand: FormBrand; integration_id: string | null; created_at: string;
}
export interface Lead {
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
export const COLOR_PRESETS = [
  { label: 'Indigo', value: '#6366f1' }, { label: 'Blue', value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' }, { label: 'Emerald', value: '#10b981' },
  { label: 'Rose', value: '#f43f5e' },   { label: 'Orange', value: '#f97316' },
  { label: 'Slate', value: '#64748b' },  { label: 'Black', value: '#111827' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
}
export function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escJs(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
export const SOURCE_LABELS: Record<string, string> = {
  form_embed: 'Embed Form', html_file: 'HTML File', webhook: 'Webhook', manual: 'Manual', direct: 'Direct',
};

// ─── CopyButton ───────────────────────────────────────────────────────────────
export function CopyButton({ text, label }: { text: string; label?: string }) {
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
export function generateEmbedCode(form: CaptureForm, origin: string): string {
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
        function vfGet(storage, key) { try { return storage.getItem(key); } catch (_) { return null; } }
        function vfSet(storage, key, val) { try { storage.setItem(key, val); } catch (_) {} }
        function vfId() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "ov_" + Math.random().toString(36).slice(2); }
        var anon = vfGet(localStorage, "omnivera_anonymous_id") || vfId(); vfSet(localStorage, "omnivera_anonymous_id", anon);
        var sess = vfGet(sessionStorage, "omnivera_session_id") || vfId(); vfSet(sessionStorage, "omnivera_session_id", sess);
        var landing = vfGet(sessionStorage, "omnivera_landing_page") || location.href; vfSet(sessionStorage, "omnivera_landing_page", landing);
        var params = new URLSearchParams(location.search);
        var attribution = {
          website_id: cfg.website_id || null,
          anonymous_id: anon,
          session_id: sess,
          utm_source: params.get("utm_source"),
          utm_medium: params.get("utm_medium"),
          utm_campaign: params.get("utm_campaign"),
          utm_content: params.get("utm_content"),
          utm_term: params.get("utm_term"),
          referrer: document.referrer || "",
          landing_page: landing,
          current_page: location.href,
          consent_state: vfGet(localStorage, "omnivera_consent") || "unknown"
        };
        var data = { form_id: cfg.id, company_id: cfg.company_id, website_id: cfg.website_id || null, source: "embed", attribution: attribution };
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
      function vfGet(storage, key) { try { return storage.getItem(key); } catch (_) { return null; } }
      function vfSet(storage, key, val) { try { storage.setItem(key, val); } catch (_) {} }
      function vfId() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'ov_' + Math.random().toString(36).slice(2); }
      var anon = vfGet(localStorage, 'omnivera_anonymous_id') || vfId(); vfSet(localStorage, 'omnivera_anonymous_id', anon);
      var sess = vfGet(sessionStorage, 'omnivera_session_id') || vfId(); vfSet(sessionStorage, 'omnivera_session_id', sess);
      var landing = vfGet(sessionStorage, 'omnivera_landing_page') || location.href; vfSet(sessionStorage, 'omnivera_landing_page', landing);
      var params = new URLSearchParams(location.search);
      var attribution = {
        website_id: '${escJs(form.website_id || '')}' || null,
        anonymous_id: anon,
        session_id: sess,
        utm_source: params.get('utm_source'),
        utm_medium: params.get('utm_medium'),
        utm_campaign: params.get('utm_campaign'),
        utm_content: params.get('utm_content'),
        utm_term: params.get('utm_term'),
        referrer: document.referrer || '',
        landing_page: landing,
        current_page: location.href,
        consent_state: vfGet(localStorage, 'omnivera_consent') || 'unknown'
      };
      var d = { form_id: '${escJs(form.id)}', company_id: '${escJs(form.company_id)}', website_id: '${escJs(form.website_id || '')}' || null, source: 'html_file', attribution: attribution };
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

export function downloadHtmlFile(form: CaptureForm, origin: string) {
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
import type { useLeadsPage } from '../hooks/useLeadsPage';
