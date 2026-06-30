/**
 * Platform Intelligence React renderer (Phase 21B, Phase J).
 *
 * The ONE React renderer for every intelligence domain. Each component consumes a slice of
 * the platform IntelligencePresentationModel and renders it with the single platform
 * styling registry. The HTML renderer renders the SAME model with the SAME registry — zero
 * duplicated formatting/JSX/styling. Website Intelligence is Consumer #1 (re-exports these).
 */
import React from 'react';
import { badgeStyle, type StyleToken } from '../../backend/services/platformIntelligence/styles';
import type { IntelligencePresentationModel, PMModule, PMRecommendation, PMRoadmap } from '../../backend/services/platformIntelligence/presentationModel';

export type { IntelligencePresentationModel } from '../../backend/services/platformIntelligence/presentationModel';

export const ago = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const t = Date.parse(iso); if (Number.isNaN(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export function Badge({ text, token }: { text: string; token: StyleToken }) {
  return <span className="rounded-full px-2 py-0.5 text-xs font-semibold capitalize" style={badgeStyle(token)}>{text.replace('_', ' ')}</span>;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function WebsiteExecutiveSummary({ summary }: { summary: IntelligencePresentationModel['executiveSummary'] }) {
  if (!summary) return null;
  const Col = ({ label, items, color }: { label: string; items: string[]; color: string }) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>{label}</p>
      <ul className="mt-1 space-y-0.5 text-sm text-gray-700">{(items ?? []).slice(0, 5).map((x, i) => <li key={i}>• {x}</li>)}{(items ?? []).length === 0 && <li className="text-gray-400">—</li>}</ul>
    </div>
  );
  return (
    <Frame title="Executive Summary">
      <div className="flex items-center gap-3">
        <Badge text={summary.status} token={summary.statusToken} />
        <span className="text-2xl font-bold text-gray-900">{summary.score}<span className="text-xs font-medium text-gray-400">/100</span></span>
        <span className="text-xs text-gray-400">confidence {summary.confidencePct}% · updated {ago(summary.updatedAt)}</span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{summary.headline}</p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Col label="Strengths" items={summary.strengths} color="#047857" />
        <Col label="Weaknesses" items={summary.weaknesses} color="#b45309" />
        <Col label="Priority focus" items={summary.priorityFocus} color="#7c3aed" />
      </div>
      {summary.businessImpactSummary && <p className="mt-3 text-xs text-gray-500">{summary.businessImpactSummary}</p>}
    </Frame>
  );
}

export function WebsiteHealthSection({ health }: { health: IntelligencePresentationModel['health'] }) {
  if (!health) return null;
  return (
    <Frame title="Website Health">
      <div className="flex items-center gap-3">
        <Badge text={health.overall} token={health.statusToken} />
        <span className="text-2xl font-bold text-gray-900">{health.score}<span className="text-xs font-medium text-gray-400">/100</span></span>
        <span className="text-xs text-gray-400">tracking {health.trackingActive ? `active · ${ago(health.trackingAt)}` : 'not detected'}</span>
      </div>
    </Frame>
  );
}

export function WebsiteModuleCard({ module }: { module: PMModule }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">{module.label}</span>
        <Badge text={module.status} token={module.statusToken} />
      </div>
      <p className="mt-1 text-2xl font-bold text-gray-900">{module.score == null ? '—' : Math.round(module.score)}<span className="text-xs font-medium text-gray-400">{module.score == null ? '' : '/100'}</span>
        {module.badge ? <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500">{module.badge}</span> : null}</p>
      <p className="text-[11px] text-gray-400">confidence {module.confidencePct}% · updated {ago(module.updatedAt)}</p>
      {module.findings.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-gray-600">{module.findings.slice(0, 3).map((f, i) => <li key={i}>{f}</li>)}</ul>}
    </div>
  );
}

export function WebsiteRecommendationPanel({ recommendations, limit = 10 }: { recommendations: PMRecommendation[]; limit?: number }) {
  const recs = (recommendations ?? []).slice(0, limit);
  if (recs.length === 0) return <Frame title="Recommendations"><p className="text-sm text-gray-500">No recommendations.</p></Frame>;
  return (
    <Frame title="Recommendations">
      <div className="space-y-2">
        {recs.map((r, i) => (
          <div key={i} className="rounded-xl border border-gray-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-900">{r.recommendation}</span>
              <Badge text={r.category} token={r.categoryToken} />
            </div>
            <p className="mt-1 text-xs text-gray-500">impact {r.businessImpact} · effort {r.effort} · ROI {r.roi} · {r.originEngine}{r.affectedModules?.length ? ` · ${r.affectedModules.join(', ')}` : ''}</p>
            {r.impactSummary && <p className="mt-0.5 text-[11px] text-gray-400">{r.impactSummary}</p>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function WebsiteRoadmap({ roadmap }: { roadmap: PMRoadmap[] }) {
  if (!roadmap?.length) return null;
  return (
    <Frame title="Priority Roadmap">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {roadmap.map((h) => (
          <div key={h.horizon}>
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-600">{h.label}</p>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-700">{(h.items ?? []).map((it, i) => <li key={i}>• {it}</li>)}{(h.items ?? []).length === 0 && <li className="text-gray-400">—</li>}</ul>
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function BusinessImpactGraph({ businessImpact }: { businessImpact: IntelligencePresentationModel['businessImpact'] }) {
  if (!businessImpact?.dimensions?.length) return null;
  return (
    <Frame title="Business Impact">
      <div className="space-y-1.5">
        {businessImpact.dimensions.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 capitalize text-gray-600">{d.label}</span>
            <div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-purple-500" style={{ width: `${Math.min(100, d.value)}%` }} /></div>
            <span className="w-8 text-right text-gray-500">{d.value}</span>
          </div>
        ))}
      </div>
      {businessImpact.summary && <p className="mt-2 text-xs text-gray-500">{businessImpact.summary}</p>}
    </Frame>
  );
}

export function ConfidencePanel({ confidence }: { confidence: IntelligencePresentationModel['confidence'] }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs text-gray-500">
      <span>Confidence <strong className="text-gray-800">{confidence.pct}%</strong></span>
      <span>{confidence.fresh ? 'Fresh' : 'Stale'} · updated {ago(confidence.updatedAt)}</span>
    </div>
  );
}

/** Single React entry point — renders the whole presentation model (mirrors the HTML renderer). */
export function WebsiteIntelligenceReport({ model }: { model: IntelligencePresentationModel }) {
  return (
    <div className="space-y-6">
      <WebsiteExecutiveSummary summary={model.executiveSummary} />
      <WebsiteHealthSection health={model.health} />
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900">Website Intelligence Engines</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{model.modules.map((m) => <WebsiteModuleCard key={m.key} module={m} />)}</div>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BusinessImpactGraph businessImpact={model.businessImpact} />
        <WebsiteRoadmap roadmap={model.roadmap} />
      </div>
      <WebsiteRecommendationPanel recommendations={model.recommendations} />
      <ConfidencePanel confidence={model.confidence} />
    </div>
  );
}

/** Domain-agnostic alias — the canonical platform report renderer. */
export const PlatformIntelligenceReport = WebsiteIntelligenceReport;
