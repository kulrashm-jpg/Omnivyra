/**
 * Platform HTML renderer (Phase 21B, Phase J).
 *
 * The ONE server-HTML renderer for every intelligence domain. Consumes the platform
 * presentation model + the platform styling registry (one styling system). No
 * formatting/colour logic is duplicated. Website Intelligence is Consumer #1.
 */
import type { IntelligencePresentationModel, PMModule, PMRecommendation } from './presentationModel';
import { badgeCss, type StyleToken } from './styles';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const day = (iso: string | null | undefined): string => (iso ? esc(iso.slice(0, 10)) : '—');
const badge = (text: string, token: StyleToken): string => `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;${badgeCss(token)}">${esc(text)}</span>`;
const frame = (title: string, body: string): string => `<section style="border:1px solid #e5e7eb;border-radius:16px;padding:16px;margin:12px 0;background:#fff"><h3 style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111827">${esc(title)}</h3>${body}</section>`;
const list = (items: string[]): string => (items.length ? `<ul style="margin:4px 0 0;padding-left:18px;color:#374151;font-size:13px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p style="color:#9ca3af;font-size:13px">—</p>');

function moduleCard(m: PMModule): string {
  return `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;min-width:200px;flex:1">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:#111827">${esc(m.label)}</span>${badge(m.status, m.statusToken)}
    </div>
    <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#111827">${m.score == null ? '—' : Math.round(m.score)}${m.score == null ? '' : '<span style="font-size:11px;color:#9ca3af">/100</span>'}${m.badge ? ` <span style="font-size:10px;color:#6b7280">${esc(m.badge)}</span>` : ''}</p>
    <p style="margin:0;font-size:11px;color:#9ca3af">confidence ${m.confidencePct}% · ${day(m.updatedAt)}</p>
    ${list(m.findings)}
  </div>`;
}

function recRow(r: PMRecommendation): string {
  return `<div style="border:1px solid #f3f4f6;border-radius:12px;padding:10px;margin-top:6px">
    <div style="display:flex;justify-content:space-between;gap:8px">
      <span style="font-size:13px;font-weight:500;color:#111827">${esc(r.recommendation)}</span>${badge(String(r.category).replace('_', ' '), r.categoryToken)}
    </div>
    <p style="margin:4px 0 0;font-size:11px;color:#6b7280">impact ${esc(r.businessImpact)} · effort ${esc(r.effort)} · ROI ${esc(r.roi)} · ${esc(r.originEngine)}</p>
    ${r.impactSummary ? `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af">${esc(r.impactSummary)}</p>` : ''}
  </div>`;
}

export function renderIntelligenceHtml(model: IntelligencePresentationModel): string {
  const es = model.executiveSummary;
  const parts: string[] = [];

  if (es) {
    parts.push(frame('Executive Summary', `
      <div style="display:flex;gap:10px;align-items:center">${badge(es.status, es.statusToken)}<span style="font-size:22px;font-weight:700;color:#111827">${es.score}<span style="font-size:11px;color:#9ca3af">/100</span></span><span style="font-size:11px;color:#9ca3af">confidence ${es.confidencePct}% · ${day(es.updatedAt)}</span></div>
      <p style="margin:8px 0 0;font-size:13px;color:#374151">${esc(es.headline)}</p>
      <div style="display:flex;gap:16px;margin-top:8px">
        <div style="flex:1"><p style="font-size:11px;font-weight:600;color:#047857;text-transform:uppercase">Strengths</p>${list(es.strengths)}</div>
        <div style="flex:1"><p style="font-size:11px;font-weight:600;color:#b45309;text-transform:uppercase">Weaknesses</p>${list(es.weaknesses)}</div>
        <div style="flex:1"><p style="font-size:11px;font-weight:600;color:#7c3aed;text-transform:uppercase">Priority focus</p>${list(es.priorityFocus)}</div>
      </div>`));
  }

  if (model.health) {
    parts.push(frame('Website Health', `<div style="display:flex;gap:10px;align-items:center">${badge(model.health.overall, model.health.statusToken)}<span style="font-size:22px;font-weight:700;color:#111827">${model.health.score}<span style="font-size:11px;color:#9ca3af">/100</span></span><span style="font-size:11px;color:#9ca3af">tracking ${model.health.trackingActive ? `active · ${day(model.health.trackingAt)}` : 'not detected'}</span></div>`));
  }

  parts.push(frame('Website Intelligence Engines', `<div style="display:flex;gap:10px;flex-wrap:wrap">${model.modules.map(moduleCard).join('')}</div>`));

  if (model.businessImpact.dimensions.length) {
    parts.push(frame('Business Impact', `${model.businessImpact.dimensions.map((d) => `<div style="display:flex;gap:8px;align-items:center;font-size:12px;margin:3px 0"><span style="width:120px;color:#4b5563;text-transform:capitalize">${esc(d.label)}</span><div style="flex:1;height:8px;border-radius:9999px;background:#f3f4f6"><div style="height:8px;border-radius:9999px;background:#8b5cf6;width:${Math.min(100, d.value)}%"></div></div><span style="width:32px;text-align:right;color:#6b7280">${d.value}</span></div>`).join('')}<p style="margin-top:6px;font-size:11px;color:#6b7280">${esc(model.businessImpact.summary)}</p>`));
  }

  if (model.recommendations.length) {
    parts.push(frame('Recommendations', model.recommendations.slice(0, 10).map(recRow).join('')));
  }

  if (model.roadmap.length) {
    parts.push(frame('Priority Roadmap', `<div style="display:flex;gap:16px">${model.roadmap.map((h) => `<div style="flex:1"><p style="font-size:11px;font-weight:600;color:#7c3aed;text-transform:uppercase">${esc(h.label)}</p>${list(h.items)}</div>`).join('')}</div>`));
  }

  parts.push(`<div style="display:flex;justify-content:space-between;border:1px solid #e5e7eb;border-radius:12px;padding:8px 14px;font-size:11px;color:#6b7280;margin-top:12px"><span>Confidence <strong>${model.confidence.pct}%</strong></span><span>${model.confidence.fresh ? 'Fresh' : 'Stale'} · ${day(model.confidence.updatedAt)}</span></div>`);

  return `<div class="website-intelligence-report" style="font-family:ui-sans-serif,system-ui,sans-serif">${parts.join('')}</div>`;
}
