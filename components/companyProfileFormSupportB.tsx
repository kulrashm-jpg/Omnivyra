/** Part 2/3 of company-profile-form.tsx — verbatim split (barrel preserved; importers unchanged). */
import React from 'react';
import Link from 'next/link';
import ChatVoiceButton from '../components/ChatVoiceButton';
import AIGenerationProgress from '../components/AIGenerationProgress';
import CompanyStrategyProfileCard from '../components/company/CompanyStrategyProfileCard';
import type { useCompanyProfileState } from '../hooks/useCompanyProfileState';
import type {
  CompanyContextIntelligence,
  CompanyDependency,
  CompanyGeographicExposure,
  CompanyProfile,
  CompanyRegulatoryExposure,
  CompanyRevenueSegment,
  CompanyTechnologyDependency,
  CompanyWorkforceProfile,
} from '../pages/company-profile.types';
import { dedupeSocialProfiles, joinList, normalizeProfileSocialUrl, splitToList } from '../pages/company-profile.types';
import { isValidCanonicalWebsite } from '../utils/companyProfileValidation';

import { type ProfileState, SectionCard } from './companyProfileFormSupportA';

const emptyIntelligenceContext = (): CompanyContextIntelligence => ({
  revenue_segments: [],
  geographic_exposures: [],
  dependencies: [],
  regulatory_exposures: [],
  workforce_profile: null,
  technology_dependencies: [],
});

const metadataDefaults = () => ({
  source: 'user',
  review_status: 'needs_review',
  user_confirmed: false,
  confidence: null,
});

function MetadataBadge({ row }: { row?: { source?: string | null; review_status?: string | null; confidence?: number | null; user_confirmed?: boolean | null } | null }) {
  const status = row?.user_confirmed ? 'user_confirmed' : row?.review_status || row?.source || 'unknown';
  const shouldShow =
    row?.user_confirmed ||
    typeof row?.confidence === 'number' ||
    ['inferred', 'stale', 'conflicting', 'deprecated', 'system_generated'].includes(String(status));
  if (!shouldShow) return null;
  const confidence = typeof row?.confidence === 'number' ? `${Math.round(row.confidence * 100)}%` : 'unknown';
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {status.replace(/_/g, ' ')} · confidence {confidence}
    </span>
  );
}

function MiniInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

function MiniSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Unknown</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * Status pill shown on a section header (Guided Capture card / collapsed intelligence
 * section) so the user can tell — at a glance, without expanding — whether that section
 * has been captured. `done` → green "Captured"; otherwise a muted "Not started".
 */
export function StatusChip({ done, doneLabel = 'Captured', pendingLabel = 'Not started' }: {
  done: boolean;
  doneLabel?: string;
  pendingLabel?: string;
}) {
  return done ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
      <span aria-hidden>✓</span>{doneLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 whitespace-nowrap">
      {pendingLabel}
    </span>
  );
}

/**
 * Blue confirmation shown BELOW a filled field so the user knows the value is saved and
 * used downstream (rather than just displayed). Renders nothing when the field is empty.
 */
export function SavedHint({ value }: { value?: unknown }) {
  const text = Array.isArray(value)
    ? value.filter(Boolean).map(String).join(', ').trim()
    : String(value ?? '').trim();
  if (!text) return null;
  return (
    <p className="mt-1 text-xs font-medium text-blue-600">
      ✓ Saved — used by Content Architect
    </p>
  );
}

export function IntelligenceContextSections({
  context,
  readiness,
  loading,
  saving,
  isEditing,
  quality,
  suggestions,
  enrichmentLoading,
  enrichmentReviewingId,
  onChange,
  onSave,
  onRunEnrichment,
  onOpenGuidedCapture,
  onReviewSuggestion,
  onRequestEdit,
}: {
  context: CompanyContextIntelligence | null;
  readiness: ProfileState['intelligenceReadiness'];
  loading: boolean;
  saving: boolean;
  isEditing: boolean;
  quality: ProfileState['contextQuality'];
  suggestions: ProfileState['enrichmentSuggestions'];
  enrichmentLoading: boolean;
  enrichmentReviewingId: string | null;
  onChange: (patch: Partial<CompanyContextIntelligence>) => void;
  onSave: () => void;
  onRunEnrichment: () => void;
  onOpenGuidedCapture: () => void;
  onReviewSuggestion: (suggestionId: string, action: 'accepted' | 'rejected' | 'snoozed') => void;
  onRequestEdit: () => void;
}) {
  const ctx = context ?? emptyIntelligenceContext();
  const updateRows = <K extends keyof CompanyContextIntelligence>(key: K, rows: CompanyContextIntelligence[K]) => {
    onChange({ [key]: rows } as Partial<CompanyContextIntelligence>);
  };
  // Adding a row shouldn't require the user to first find the global "Edit" button
  // (that made these sections look frozen in view mode). Clicking "Add" enters
  // edit mode and appends the new row in one step.
  const addRow = <K extends keyof CompanyContextIntelligence>(key: K, row: unknown) => {
    if (!isEditing) onRequestEdit();
    const existing = Array.isArray(ctx[key]) ? (ctx[key] as unknown[]) : [];
    updateRows(key, [...existing, row] as CompanyContextIntelligence[K]);
  };
  const updateRow = <T,>(rows: T[], index: number, patch: Partial<T>) =>
    rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
  const removeRow = <T,>(rows: T[], index: number) => rows.filter((_, rowIndex) => rowIndex !== index);
  const readinessScores = readiness?.section_scores;
  const readinessScore = readiness?.score ?? 0;
  // "Filled" detection for the collapsed section headers — a section counts as captured
  // when it has at least one row/field carrying real (non-metadata, non-"unknown") data.
  const META_KEYS = new Set(['id', 'source', 'review_status', 'confidence', 'user_confirmed', 'created_at', 'updated_at']);
  const cellHasValue = (v: unknown): boolean => {
    const s = String(Array.isArray(v) ? v.join('') : (v ?? '')).trim().toLowerCase();
    return s.length > 0 && s !== 'unknown';
  };
  const rowHasData = (row: unknown): boolean =>
    Boolean(row) && typeof row === 'object' &&
    Object.entries(row as Record<string, unknown>).some(([k, v]) => !META_KEYS.has(k) && cellHasValue(v));
  const hasRows = (arr: unknown): boolean => Array.isArray(arr) && arr.some(rowHasData);
  const sectionFilled = {
    revenue: hasRows(ctx.revenue_segments),
    market: hasRows(ctx.geographic_exposures),
    operational: hasRows(ctx.dependencies),
    workforce: rowHasData(ctx.workforce_profile),
    regulatory: hasRows(ctx.regulatory_exposures),
    technology: hasRows(ctx.technology_dependencies),
  };
  const recommendations = [
    ctx.revenue_segments.length === 0 ? 'Add your primary customer markets' : null,
    ctx.geographic_exposures.length === 0 ? 'Add the geographies that influence revenue or operations' : null,
    !ctx.workforce_profile ? 'Add workforce dependency' : null,
    ctx.dependencies.length === 0 ? 'Add operational vendor, labor, platform, or logistics dependencies' : null,
    ctx.technology_dependencies.length === 0 ? 'Add cloud/platform dependencies' : null,
    ctx.regulatory_exposures.length === 0 ? 'Add regulatory jurisdictions if they affect operations or customers' : null,
  ].filter((item): item is string => Boolean(item)).slice(0, 4);
  const validationWarnings = ctx.validation_warnings ?? [];

  return (
    <SectionCard
      title="Context Intelligence"
      description="Optional enrichment used by future exposure-aware recommendations, AI reasoning, and dependency intelligence. Empty sections are treated as missing, not as not relevant."
      accent="indigo"
      collapsible
      defaultOpen={
        ctx.revenue_segments.length > 0 ||
        ctx.geographic_exposures.length > 0 ||
        ctx.dependencies.length > 0 ||
        ctx.regulatory_exposures.length > 0 ||
        ctx.technology_dependencies.length > 0 ||
        Boolean(ctx.workforce_profile)
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ['Market', readinessScores?.market_exposure],
          ['Dependency', readinessScores?.dependency],
          ['Workforce', readinessScores?.workforce],
          ['Regulatory', readinessScores?.regulatory],
          ['Geography', readinessScores?.geographic],
          ['Strategy', readinessScores?.strategic_state],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
            <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{typeof value === 'number' ? `${value}%` : '0%'}</div>
          </div>
        ))}
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-indigo-100">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, readinessScore))}%` }} />
      </div>

      {quality ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Density', quality.intelligence_density_score],
            ['Reliability', quality.context_reliability_score],
            ['Inference', quality.inference_coverage_score],
            ['Stale', quality.stale_context_score],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{value}%</div>
            </div>
          ))}
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <div className="mb-4 rounded-xl border border-indigo-100 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Recommended next context</div>
          <div className="mt-2 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            {recommendations.map((item) => (
              <div key={item} className="rounded-lg bg-indigo-50 px-3 py-2">{item}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Guided context capture</div>
            <p className="mt-1 text-sm text-slate-500">Use chat for missing market, dependency, workforce, regulatory, and technology context, then review inferred suggestions before saving.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenGuidedCapture}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white"
            >
              Capture with chat
            </button>
            <button
              type="button"
              onClick={onRunEnrichment}
              disabled={enrichmentLoading}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50"
            >
              {enrichmentLoading ? 'Checking...' : 'Find suggestions'}
            </button>
          </div>
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {suggestions.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.inference_reason}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.inference_strength} inference · confidence {Math.round((item.confidence || 0) * 100)}% · readiness impact +{Math.round(item.readiness_impact_estimate || 0)}%
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" disabled={enrichmentReviewingId === item.id} onClick={() => onReviewSuggestion(item.id, 'accepted')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Accept</button>
                    <button type="button" disabled={enrichmentReviewingId === item.id} onClick={() => onReviewSuggestion(item.id, 'snoozed')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50">Snooze</button>
                    <button type="button" disabled={enrichmentReviewingId === item.id} onClick={() => onReviewSuggestion(item.id, 'rejected')} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50">Reject</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-500">No pending inference suggestions.</div>
        )}
      </div>

      {validationWarnings.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">Review suggested</div>
          <div className="mt-2 space-y-1 text-sm text-amber-800">
            {validationWarnings.map((warning) => (
              <div key={warning.code}>{warning.message}</div>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? <div className="text-sm text-slate-500">Loading intelligence context...</div> : null}

      <div className="space-y-3">
        <details className="rounded-xl border border-slate-200 bg-white p-4" open>
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span>Customer & Revenue Exposure</span><StatusChip done={sectionFilled.revenue} /></summary>
          <p className="mt-2 text-sm text-slate-500">Used to separate revenue dependency from generic audience descriptions.</p>
          <div className="mt-4 space-y-3">
            {ctx.revenue_segments.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('revenue_segments', removeRow(ctx.revenue_segments, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniInput label="Customer industry" value={row.customer_industry} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { customer_industry: value }))} />
                  <MiniInput label="Customer segment" value={row.customer_segment} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { customer_segment: value }))} />
                  <MiniInput label="Geography" value={row.geography} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { geography: value }))} />
                  <MiniInput label="Revenue %" value={row.revenue_percentage} type="number" onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { revenue_percentage: value }))} />
                  <MiniSelect label="Strategic priority" value={row.strategic_priority} options={['low', 'medium', 'high', 'critical']} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { strategic_priority: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('revenue_segments', updateRow(ctx.revenue_segments, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('revenue_segments', { ...metadataDefaults() } as CompanyRevenueSegment)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add revenue segment</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span>Market Exposure</span><StatusChip done={sectionFilled.market} /></summary>
          <p className="mt-2 text-sm text-slate-500">Used to distinguish customer, workforce, vendor, and operational exposure by geography.</p>
          <div className="mt-4 space-y-3">
            {ctx.geographic_exposures.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('geographic_exposures', removeRow(ctx.geographic_exposures, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <MiniInput label="Geography" value={row.geography} onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { geography: value }))} />
                  <MiniSelect label="Exposure type" value={row.exposure_type} options={['revenue', 'operations', 'workforce', 'customers', 'vendors']} onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { exposure_type: value as CompanyGeographicExposure['exposure_type'] }))} />
                  <MiniInput label="Exposure %" value={row.exposure_percentage} type="number" onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { exposure_percentage: value }))} />
                  <MiniSelect label="Criticality" value={row.criticality} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('geographic_exposures', updateRow(ctx.geographic_exposures, index, { criticality: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('geographic_exposures', { exposure_type: 'revenue', ...metadataDefaults() } as CompanyGeographicExposure)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add geography exposure</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span>Operational Dependencies</span><StatusChip done={sectionFilled.operational} /></summary>
          <p className="mt-2 text-sm text-slate-500">Used to capture non-technology dependencies that can disrupt delivery, channels, or costs.</p>
          <div className="mt-4 space-y-3">
            {ctx.dependencies.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('dependencies', removeRow(ctx.dependencies, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniSelect label="Dependency type" value={row.dependency_type} options={['cloud', 'vendor', 'supplier', 'logistics', 'labor', 'platform', 'channel', 'regulatory', 'technology', 'other']} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { dependency_type: value as CompanyDependency['dependency_type'] }))} />
                  <MiniInput label="Name" value={row.dependency_name} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { dependency_name: value }))} />
                  <MiniInput label="Region" value={row.dependency_region} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { dependency_region: value }))} />
                  <MiniSelect label="Criticality" value={row.criticality} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { criticality: value }))} />
                  <MiniInput label="Operational sensitivity" value={row.operational_sensitivity} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { operational_sensitivity: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('dependencies', updateRow(ctx.dependencies, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('dependencies', { dependency_type: 'vendor', ...metadataDefaults() } as CompanyDependency)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add dependency</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span>Workforce & Hiring</span><StatusChip done={sectionFilled.workforce} /></summary>
          <p className="mt-2 text-sm text-slate-500">Used to model labor, immigration, contractor, remote-work, and skill-market sensitivity.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {(() => {
              const row = ctx.workforce_profile ?? { ...metadataDefaults() } as CompanyWorkforceProfile;
              const setWorkforce = (patch: Partial<CompanyWorkforceProfile>) => updateRows('workforce_profile', { ...row, ...patch });
              return (
                <>
                  <MiniInput label="Workforce model" value={row.workforce_model} onChange={(value) => setWorkforce({ workforce_model: value })} />
                  <MiniInput label="Hiring markets" value={Array.isArray(row.hiring_markets) ? row.hiring_markets.join(', ') : row.hiring_markets} onChange={(value) => setWorkforce({ hiring_markets: value })} />
                  <MiniInput label="Key skill dependencies" value={Array.isArray(row.key_skill_dependencies) ? row.key_skill_dependencies.join(', ') : row.key_skill_dependencies} onChange={(value) => setWorkforce({ key_skill_dependencies: value })} />
                  <MiniSelect label="Contractor dependency" value={row.contractor_dependency_level} options={['none', 'low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ contractor_dependency_level: value })} />
                  <MiniSelect label="Immigration dependency" value={row.immigration_dependency_level} options={['none', 'low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ immigration_dependency_level: value })} />
                  <MiniSelect label="Labor sensitivity" value={row.labor_sensitivity_level} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ labor_sensitivity_level: value })} />
                  <MiniSelect label="Remote dependency" value={row.remote_dependency_level} options={['none', 'low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => setWorkforce({ remote_dependency_level: value })} />
                  <div className="flex items-end"><MetadataBadge row={row} /></div>
                </>
              );
            })()}
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span>Regulatory Exposure</span><StatusChip done={sectionFilled.regulatory} /></summary>
          <p className="mt-2 text-sm text-slate-500">Used to capture jurisdictions and rule families that need future relevance filtering.</p>
          <div className="mt-4 space-y-3">
            {ctx.regulatory_exposures.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('regulatory_exposures', removeRow(ctx.regulatory_exposures, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniInput label="Jurisdiction" value={row.jurisdiction} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { jurisdiction: value }))} />
                  <MiniInput label="Regulation type" value={row.regulation_type} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { regulation_type: value }))} />
                  <MiniInput label="Applicability" value={row.applicability} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { applicability: value }))} />
                  <MiniSelect label="Severity" value={row.severity} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { severity: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('regulatory_exposures', updateRow(ctx.regulatory_exposures, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('regulatory_exposures', { ...metadataDefaults() } as CompanyRegulatoryExposure)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add regulatory exposure</button>
          </div>
        </details>

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-slate-900"><span>Technology Dependencies</span><StatusChip done={sectionFilled.technology} /></summary>
          <p className="mt-2 text-sm text-slate-500">Used to identify platform, cloud, AI, payments, analytics, and security dependency sensitivity.</p>
          <div className="mt-4 space-y-3">
            {ctx.technology_dependencies.map((row, index) => (
              <div key={row.id || index} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <MetadataBadge row={row} />
                  <button type="button" disabled={!isEditing} onClick={() => updateRows('technology_dependencies', removeRow(ctx.technology_dependencies, index))} className="text-xs font-medium text-rose-700 disabled:opacity-50">Remove</button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MiniInput label="Provider" value={row.provider_name} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { provider_name: value }))} />
                  <MiniInput label="Category" value={row.provider_category} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { provider_category: value }))} />
                  <MiniSelect label="Criticality" value={row.criticality} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { criticality: value }))} />
                  <MiniSelect label="Spend sensitivity" value={row.spend_sensitivity} options={['low', 'medium', 'high', 'critical', 'unknown']} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { spend_sensitivity: value }))} />
                  <MiniInput label="Operational dependency" value={row.operational_dependency} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { operational_dependency: value }))} />
                  <MiniInput label="Notes" value={row.notes} onChange={(value) => updateRows('technology_dependencies', updateRow(ctx.technology_dependencies, index, { notes: value }))} />
                </div>
              </div>
            ))}
            <button type="button" disabled={saving} onClick={() => addRow('technology_dependencies', { ...metadataDefaults() } as CompanyTechnologyDependency)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50">Add technology dependency</button>
          </div>
        </details>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          Overall intelligence readiness: <span className="font-semibold text-slate-800">{readinessScore}%</span>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!isEditing || saving}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save intelligence context'}
        </button>
      </div>
    </SectionCard>
  );
}

