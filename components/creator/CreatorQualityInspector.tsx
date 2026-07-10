import React from 'react';
import type { CreatorDiagnosticReport } from '../../backend/services/creator/creatorDiagnosticReport';

/**
 * Creator Quality Inspector — READ-ONLY UI for the deterministic
 * `creator_diagnostic_report` attached to a generated asset's metadata.
 *
 * It DISPLAYS exactly what the report produced — it never recomputes scores,
 * re-validates, or runs business logic. The readiness badge is a pure display
 * mapping of the report's `overallReadiness` value + visual pass flag.
 */

type Status = 'PASS' | 'WARNING' | 'FAILED' | 'REPAIRED' | 'N/A';

const STATUS_COLORS: Record<Status, { bg: string; fg: string; border: string }> = {
  PASS: { bg: '#052e1a', fg: '#86efac', border: '#166534' },
  WARNING: { bg: '#3b2f05', fg: '#fcd34d', border: '#a16207' },
  FAILED: { bg: '#3f1212', fg: '#fca5a5', border: '#b91c1c' },
  REPAIRED: { bg: '#172554', fg: '#93c5fd', border: '#1d4ed8' },
  'N/A': { bg: '#1f2937', fg: '#9ca3af', border: '#374151' },
};

// The diagnostic report emits check values as 'PASS' | 'FAIL' | 'N/A', but this
// UI's palette is keyed 'PASS' | 'WARNING' | 'FAILED' | 'REPAIRED' | 'N/A'.
// Normalize report values onto the UI enum ('FAIL' → 'FAILED') so a failing
// check never lands on an unknown key.
function toUiStatus(raw: unknown): Status {
  switch (raw) {
    case 'PASS': return 'PASS';
    case 'FAIL':
    case 'FAILED': return 'FAILED';
    case 'WARNING': return 'WARNING';
    case 'REPAIRED': return 'REPAIRED';
    default: return 'N/A';
  }
}

function StatusPill({ status }: { status: Status }) {
  // Defensive: an out-of-enum status must degrade to a neutral chip, never crash
  // the whole editor (reading `.fg` on an undefined palette entry white-screens).
  const c = STATUS_COLORS[status] ?? STATUS_COLORS['N/A'];
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: c.fg, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 999, padding: '2px 9px' }}>
      {status}
    </span>
  );
}

function scoreStatus(value: number): Status {
  return value >= 85 ? 'PASS' : value >= 60 ? 'WARNING' : 'FAILED';
}

function readinessBadge(report: CreatorDiagnosticReport): { label: string; status: Status } {
  const v = report.scores.overallReadiness.value;
  if (report.visualValidation.passed && v >= 85) return { label: 'Production Ready', status: 'PASS' };
  if (v >= 60) return { label: 'Needs Review', status: 'WARNING' };
  return { label: 'Requires Fixes', status: 'FAILED' };
}

const CHECK_LABELS: Array<[keyof CreatorDiagnosticReport['visualValidation']['checks'], string]> = [
  ['textFit', 'Text Fit'],
  ['overflow', 'Overflow'],
  ['clipping', 'Clipping'],
  ['spacing', 'Spacing'],
  ['contrast', 'Contrast'],
  ['typography', 'Typography'],
  ['branding', 'Branding'],
  ['infographicDensity', 'Infographic Density'],
  ['carouselSlides', 'Carousel Slides'],
];

const S = {
  panel: { border: '1px solid #1f2937', borderRadius: 14, background: '#0b1220', padding: 18, color: '#e5e7eb', marginTop: 16 } as React.CSSProperties,
  h: { fontSize: 12, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' } as React.CSSProperties,
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0', borderBottom: '1px solid #111827', fontSize: 13 } as React.CSSProperties,
  k: { color: '#9ca3af' } as React.CSSProperties,
  v: { color: '#e5e7eb', fontWeight: 600, textAlign: 'right' } as React.CSSProperties,
  reason: { fontSize: 12, color: '#9ca3af', marginTop: 2 } as React.CSSProperties,
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 } as React.CSSProperties,
  chip: { fontSize: 11, color: '#cbd5e1', background: '#020617', border: '1px solid #1f2937', borderRadius: 999, padding: '3px 10px' } as React.CSSProperties,
  bar: (v: number): React.CSSProperties => ({ height: 6, borderRadius: 3, background: '#1f2937', overflow: 'hidden', marginTop: 6 }),
  barFill: (v: number): React.CSSProperties => ({ height: '100%', width: `${v}%`, background: v >= 85 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444' }),
};

function Section({ title, status, children }: { title: string; status?: Status; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ ...S.h, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{title}</span>
        {status ? <StatusPill status={status} /> : null}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === '' ) return null;
  return (
    <div style={S.row}>
      <span style={S.k}>{k}</span>
      <span style={S.v}>{v}</span>
    </div>
  );
}

export default function CreatorQualityInspector({ report }: { report: CreatorDiagnosticReport }) {
  const [openSlide, setOpenSlide] = React.useState<number | null>(null);
  const vv = report.visualValidation;
  const cv = report.contentValidation;
  const badge = readinessBadge(report);

  const contentStatus: Status =
    (cv.forbiddenWordsRepaired + cv.prohibitedClaimsRemoved + cv.ctaNormalized + cv.fabricatedClaimsRemoved) > 0 ? 'REPAIRED'
      : (cv.missingRequiredTerms.length > 0 || cv.warnings.length > 0) ? 'WARNING' : 'PASS';
  const visualStatus: Status = report.repair.reRendered ? 'REPAIRED' : vv.passed ? 'PASS' : 'FAILED';

  // Per-check deterministic reasons sourced from the report's failures.
  const reasonFor = (category: string): string | null => {
    const f = vv.failures.find((x) => x.category === category);
    return f ? f.flag : null;
  };
  const checkCategory: Record<string, string> = {
    textFit: 'text_fit', overflow: 'text_fit', clipping: 'text_fit', spacing: 'overlap',
    contrast: 'contrast', typography: 'typography', branding: 'branding', infographicDensity: 'text_fit', carouselSlides: 'text_fit',
  };

  const slides = vv.slideCount ?? 0;

  return (
    <div style={S.panel}>
      {/* Readiness badge — prominent */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc' }}>Quality Inspector</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{report.reportVersion}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: STATUS_COLORS[badge.status].fg, background: STATUS_COLORS[badge.status].bg, border: `1px solid ${STATUS_COLORS[badge.status].border}`, borderRadius: 10, padding: '6px 12px' }}>
            {badge.label}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{report.scores.overallReadiness.reason}</div>
        </div>
      </div>

      {/* Generation summary */}
      <Section title="Generation">
        <KV k="Asset type" v={report.generation.assetType} />
        <KV k="Platform" v={report.generation.platform} />
        <KV k="Company" v={report.generation.companyId} />
        <KV k="Duration" v={typeof report.generation.durationMs === 'number' ? `${(report.generation.durationMs / 1000).toFixed(1)}s` : null} />
      </Section>

      {/* Template summary */}
      <Section title="Template">
        <KV k="Name" v={report.template.name ?? report.template.id ?? '—'} />
        <KV k="Version" v={report.template.version != null ? `v${report.template.version}` : null} />
        <KV k="Asset family" v={report.template.assetFamily} />
        <KV k="Rendering contract" v={report.template.renderingContractVersion} />
      </Section>

      {/* Context summary */}
      <Section title="Context Sources Used">
        {report.context.sourcesUsed.length === 0 ? (
          <div style={S.reason}>No canonical company / brand context was available.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {report.context.sourcesUsed.map((s) => <span key={s} style={S.chip}>{s}</span>)}
          </div>
        )}
      </Section>

      {/* Content validation */}
      <Section title="Content Validation" status={contentStatus}>
        <KV k="Forbidden words repaired" v={cv.forbiddenWordsRepaired} />
        <KV k="Prohibited claims removed" v={cv.prohibitedClaimsRemoved} />
        <KV k="CTA normalized" v={cv.ctaNormalized} />
        <KV k="Fabricated claims removed" v={cv.fabricatedClaimsRemoved} />
        {cv.missingRequiredTerms.length > 0 ? <KV k="Missing required terms" v={cv.missingRequiredTerms.join(', ')} /> : null}
        {cv.warnings.length > 0 ? <KV k="Warnings" v={cv.warnings.join('; ')} /> : null}
      </Section>

      {/* Rendering summary */}
      <Section title="Rendering">
        <KV k="Dimensions" v={report.rendering.width && report.rendering.height ? `${report.rendering.width} × ${report.rendering.height}` : null} />
        <KV k="Typography profile" v={report.rendering.typographyProfile} />
        <KV k="Layout profile" v={report.rendering.layoutProfile} />
        <KV k="Branding profile" v={report.rendering.brandingProfile} />
      </Section>

      {/* Visual validation — each check independently */}
      <Section title="Visual Validation" status={visualStatus}>
        <div style={{ marginTop: 6 }}>
          {CHECK_LABELS.map(([key, label]) => {
            const status = toUiStatus(vv.checks[key]);
            const reason = status === 'FAILED' ? reasonFor(checkCategory[key]) : null;
            return (
              <div key={key} style={S.row}>
                <div>
                  <span style={{ color: '#e5e7eb' }}>{label}</span>
                  {reason ? <div style={S.reason}>{reason}</div> : null}
                </div>
                <StatusPill status={status} />
              </div>
            );
          })}
        </div>

        {/* Carousel — select individual slides */}
        {slides > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>Slides ({slides}) — select to inspect:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Array.from({ length: slides }, (_u, i) => i + 1).map((n) => {
                const failed = vv.failures.some((f) => f.slide === n);
                const active = openSlide === n;
                return (
                  <button key={n} type="button" onClick={() => setOpenSlide(active ? null : n)}
                    style={{ width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      border: `1px solid ${active ? '#2563eb' : failed ? '#b91c1c' : '#334155'}`,
                      background: active ? '#1e3a8a' : failed ? '#3f1212' : '#020617',
                      color: failed ? '#fca5a5' : '#cbd5e1' }}>
                    {n}
                  </button>
                );
              })}
            </div>
            {openSlide != null ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>
                {(() => {
                  const slideFailures = vv.failures.filter((f) => f.slide === openSlide);
                  return slideFailures.length === 0
                    ? <span style={{ color: '#86efac' }}>Slide {openSlide}: all checks passed.</span>
                    : <span>Slide {openSlide}: {slideFailures.map((f) => `${f.category} (${f.flag})`).join(', ')}</span>;
                })()}
              </div>
            ) : null}
          </div>
        ) : null}
      </Section>

      {/* Repair summary */}
      {report.repair.occurred ? (
        <Section title="Repairs" status="REPAIRED">
          <KV k="Type" v={report.repair.type} />
          <KV k="Count" v={report.repair.count} />
          <KV k="Re-rendered" v={report.repair.reRendered ? 'Yes' : 'No'} />
          {report.repair.reasons.length > 0 ? <KV k="Reasons" v={report.repair.reasons.join('; ')} /> : null}
        </Section>
      ) : null}

      {/* Quality scores */}
      <Section title="Quality Scores">
        <div style={{ ...S.grid, marginTop: 6 }}>
          {([
            ['Content Quality', report.scores.contentQuality],
            ['Brand Compliance', report.scores.brandCompliance],
            ['Visual Quality', report.scores.visualQuality],
            ['Readability', report.scores.readability],
            ['Template Compliance', report.scores.templateCompliance],
            ['Overall Readiness', report.scores.overallReadiness],
          ] as const).map(([label, score]) => (
            <div key={label} style={{ border: '1px solid #1f2937', borderRadius: 10, padding: 10, background: '#020617' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>{label}</span>
                <StatusPill status={scoreStatus(score.value)} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', marginTop: 4 }}>{score.value}<span style={{ fontSize: 12, color: '#64748b' }}>/100</span></div>
              <div style={S.bar(score.value)}><div style={S.barFill(score.value)} /></div>
              <div style={S.reason}>{score.reason}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
