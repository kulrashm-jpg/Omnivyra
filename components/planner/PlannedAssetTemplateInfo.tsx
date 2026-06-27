import React from 'react';
import type { CreatorTemplate } from '../../lib/creator-templates';
import { describeTemplatePlan, validatePlannedAsset, type PlannedAsset } from '../../lib/creator-templates';
import { variantLabel } from '../../lib/creator-templates/discovery';

/**
 * Planner per-asset template panel (CAMPAIGN-003). Read-only display of the
 * SELECTED template's planning facts + live validation status for one planned
 * asset, derived deterministically from the canonical contract via
 * `describeTemplatePlan` / `validatePlannedAsset`. No planner redesign — drop
 * this beside each planned asset. `onChangeTemplate` opens the existing gallery
 * (parent-wired); template-switch migration uses the canonical
 * `migrateTemplateValues` in the parent. No second renderer / registry.
 */
interface Props {
  /** Resolved template for `planned.templateId` (null when unresolved). */
  template: CreatorTemplate | null;
  planned: PlannedAsset;
  onChangeTemplate?: () => void;
}

export default function PlannedAssetTemplateInfo({ template, planned, onChangeTemplate }: Props) {
  const v = validatePlannedAsset(template, planned);
  const d = v.descriptor;
  const rows: Array<[string, string]> = d ? [
    ['Template', d.name],
    ['Style variant', variantLabel(d.variantKey)],
    ['Layout', d.layout ?? (d.family === 'carousel' ? 'slides' : d.family)],
    d.family === 'carousel'
      ? ['Slides', String(planned.slideCount ?? d.defaultSlideCount ?? '—')]
      : d.family === 'infographic'
        ? ['Sections', `${planned.sectionCount ?? d.sectionMin ?? '—'} (${d.sectionMin ?? 0}–${d.sectionMax ?? 0})`]
        : ['CTA', d.hasCTA ? 'available' : 'none'],
  ] : [['Template', planned.templateId || '(none selected)']];

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.badge(v.ok)}>{v.ok ? '✓ Valid' : '⚠ Invalid'}</span>
        {onChangeTemplate ? <button type="button" style={S.change} onClick={onChangeTemplate}>Change template</button> : null}
      </div>
      <dl style={S.dl}>
        {rows.map(([k, val]) => (
          <div key={k} style={S.row}><dt style={S.k}>{k}</dt><dd style={S.v}>{val}</dd></div>
        ))}
      </dl>
      {!v.ok ? (
        <ul style={S.errs}>{v.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      ) : null}
    </div>
  );
}

const S = {
  wrap: { border: '1px solid #1f2937', borderRadius: 10, padding: 12, background: '#0b1220' } as React.CSSProperties,
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } as React.CSSProperties,
  badge: (ok: boolean): React.CSSProperties => ({ fontSize: 11.5, fontWeight: 700, color: ok ? '#86efac' : '#fca5a5', border: `1px solid ${ok ? '#166534' : '#7f1d1d'}`, background: ok ? '#052e16' : '#450a0a', borderRadius: 999, padding: '2px 9px' }),
  change: { fontSize: 12, color: '#93c5fd', background: 'transparent', border: '1px solid #1e3a8a', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' } as React.CSSProperties,
  dl: { margin: 0 } as React.CSSProperties,
  row: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid #111827' } as React.CSSProperties,
  k: { color: '#64748b', margin: 0 } as React.CSSProperties,
  v: { color: '#cbd5e1', margin: 0, textAlign: 'right' } as React.CSSProperties,
  errs: { margin: '8px 0 0', paddingLeft: 18, color: '#fca5a5', fontSize: 12 } as React.CSSProperties,
};
