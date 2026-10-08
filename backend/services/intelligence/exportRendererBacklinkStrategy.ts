/**
 * BACKLINK AUTHORITY — renderer for the certified observation + strategy surface.
 *
 * TWO BLOCKS, AND THE SEPARATION IS THE POINT.
 *
 *   BACKLINK OBSERVATION      what the public record shows about external authority today.
 *   CONTEXTUAL LINK STRATEGY  which KINDS of external authority would be worth building.
 *
 * They are rendered as two separately headed blocks with different framing sentences, because a
 * CMO skimming this must not be able to mistake one for the other. A recommended type is not an
 * existing backlink, and the absence of a measurement is not a weakness.
 *
 * WHAT THIS RENDERER WILL NOT DO
 *   • It never prints "weak backlinks" — there is no such string, and the unavailable branch
 *     renders the certified limitation sentence instead, which says in so many words that no
 *     finding about the company follows from an unavailable provider.
 *   • It never prints a zero for an unavailable measurement: the metric row is omitted entirely
 *     unless the value is a real number, so `null` cannot render as `0`.
 *   • It never ranks by domain authority. Order is the certified `priority` ordinal, which the
 *     module derived from relevance verdicts. Provider authority is not consulted here at all,
 *     and `domain_authority` is deliberately NOT among the rendered metrics for that reason.
 *   • It invents no score. There is no backlink score in the payload and none is computed here.
 *   • It prints no publisher, domain, URL or person: it renders only the certified fields, and
 *     the module's own tests prove those fields carry no target.
 *
 * ENUM TOKENS NEVER REACH THE READER. Every union value — priority, horizon, evidence state,
 * relevance verdict — passes through a label map below. A raw `insufficient_evidence` or
 * `now` token in customer-facing prose is the defect these maps exist to prevent.
 */
import type { CanonicalExportPayload } from './canonicalExport';
import type {
  BacklinkEvidenceState,
  BacklinkHorizon,
  BacklinkPriority,
  BacklinkStrategyRecommendation,
  RelevanceVerdict,
} from '../canonicalReport/reportBacklinkStrategy';
import { renderSectionHeader } from './exportRendererSectionsA';
import { escape } from './exportRendererCoreModel';

const PRIORITY_LABEL: Record<BacklinkPriority, string> = {
  now: 'Start now',
  next: 'Next',
  later: 'Later',
};

const PRIORITY_NOTE: Record<BacklinkPriority, string> = {
  now: 'The asset that would earn this already exists, so nothing has to be built first.',
  next: 'Relevant, but the asset that earns it has to exist before the work can start.',
  later: 'Relevance is only partly established — revisit once more is known.',
};

const HORIZON_LABEL: Record<BacklinkHorizon, string> = {
  immediate: 'Immediate',
  near_term: 'Near term',
  sustained: 'Sustained effort',
};

const EVIDENCE_STATE_LABEL: Record<BacklinkEvidenceState, string> = {
  observed: 'Observed',
  declared: 'From what you told us',
  inferred: 'Inferred',
  estimated: 'Estimated',
  unavailable: 'Not available',
  insufficient_evidence: 'Not established',
};

const VERDICT_LABEL: Record<RelevanceVerdict, string> = {
  supports: 'Supports',
  neutral: 'Neutral',
  against: 'Counts against',
  unknown: 'Not established',
};

/** A metric row, rendered ONLY when the value is a real number. `null` renders nothing. */
function metricRow(label: string, value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return `
    <div class="ds-metric">
      <span class="ds-metric-label">${escape(label)}</span>
      <span class="ds-metric-value">${escape(String(value))}</span>
    </div>
  `;
}

function renderObservation(payload: CanonicalExportPayload): string {
  const surface = payload.backlink_authority;
  if (!surface) return '';
  const obs = surface.observation;

  const measured = obs.state === 'measured' || obs.state === 'inferred';

  // UNAVAILABLE. The certified limitation text is rendered verbatim; it is the sentence that says
  // an unmeasured profile establishes nothing about the company.
  if (!measured) {
    return `
      <div class="ds-subsection">
        <h4 class="ds-subsection-title">Backlink observation</h4>
        <p class="ds-framing">External backlink authority is <strong>not measured</strong> for this report.${
          obs.reason_unavailable ? ` ${escape(obs.reason_unavailable)}` : ''
        }</p>
        ${obs.limitations.length > 0
          ? `<p class="ds-methodology-foot">${obs.limitations.map((l) => escape(l)).join(' ')}</p>`
          : ''}
      </div>
    `;
  }

  // MEASURED — including a genuine measured zero, which is evidence and is shown as 0.
  return `
    <div class="ds-subsection">
      <h4 class="ds-subsection-title">Backlink observation</h4>
      <p class="ds-framing">This is what an external backlink provider reported for this domain${
        obs.observed_at ? ` as at ${escape(obs.observed_at)}` : ''
      }. A reported zero is a measurement, not a missing reading.</p>
      <div class="ds-metric-row">
        ${metricRow('Referring domains', obs.referring_domains)}
        ${metricRow('Backlinks', obs.backlinks)}
      </div>
      <p class="ds-methodology-foot">${escape(
        obs.growth.state === 'measured'
          ? `Change across comparable observations: ${obs.growth.referring_domain_delta ?? 0} referring domains (${obs.growth.comparable_observations} comparable observations).`
          : obs.growth.reason,
      )}</p>
      ${obs.limitations.length > 0
        ? `<p class="ds-methodology-foot">${obs.limitations.map((l) => escape(l)).join(' ')}</p>`
        : ''}
    </div>
  `;
}

function renderRecommendation(rec: BacklinkStrategyRecommendation): string {
  const supporting = rec.relevance.filter((r) => r.verdict === 'supports');
  const unestablished = rec.relevance.filter((r) => r.verdict === 'unknown');

  return `
    <div class="ds-strategy-card">
      <div class="ds-strategy-head">
        <span class="ds-strategy-type">${escape(rec.label)}</span>
        <span class="ds-strategy-priority">${escape(PRIORITY_LABEL[rec.priority])}</span>
        <span class="ds-strategy-state">${escape(EVIDENCE_STATE_LABEL[rec.evidenceState])}</span>
      </div>
      <p class="ds-strategy-why">${escape(rec.whyItMatters)}</p>
      <dl class="ds-strategy-detail">
        <div><dt>Why this type</dt><dd>${escape(rec.strategicRole)}</dd></div>
        <div><dt>What would earn it</dt><dd>${escape(rec.recommendedAsset)}</dd></div>
        <div><dt>How to pursue it</dt><dd>${escape(rec.suggestedAcquisitionMotion)}</dd></div>
        <div><dt>Timing</dt><dd>${escape(HORIZON_LABEL[rec.horizon])} — ${escape(PRIORITY_NOTE[rec.priority])}</dd></div>
        <div><dt>How success would be measured</dt><dd>${escape(rec.measurementMethod)}</dd></div>
        ${rec.marketContext ? `<div><dt>Market signal</dt><dd>${escape(rec.marketContext)}</dd></div>` : ''}
        <div><dt>What this rests on</dt><dd>${rec.evidenceBasis.map((b) => escape(b)).join('; ')}</dd></div>
        <div><dt>Relevance</dt><dd>${escape(
          `${supporting.length} of ${rec.relevance.length} relevance checks support this`
          + (unestablished.length > 0
            ? `; ${unestablished.map((u) => u.label.toLowerCase()).join(', ')} could not be established`
            : ''),
        )}</dd></div>
        ${rec.dependencies.length > 0
          ? `<div><dt>Depends on</dt><dd>${rec.dependencies.map((d) => escape(d)).join(' ')}</dd></div>`
          : ''}
      </dl>
      <p class="ds-methodology-foot">${rec.caveats.map((c) => escape(c)).join(' ')}</p>
    </div>
  `;
}

function renderStrategy(payload: CanonicalExportPayload): string {
  const surface = payload.backlink_authority;
  if (!surface) return '';
  const strategy = surface.strategy;

  // ABSTENTION IS A FINDING. An empty strategy says the context was too thin to recommend
  // anything for THIS company, which is materially different from having no advice to give.
  if (strategy.abstained || strategy.recommendations.length === 0) {
    return `
      <div class="ds-subsection">
        <h4 class="ds-subsection-title">Contextual link strategy</h4>
        <p class="ds-framing">${escape(strategy.headline)}${
          strategy.abstention_reason ? ` ${escape(strategy.abstention_reason)}` : ''
        }</p>
        <p style="font-size:9pt; margin:3mm 0 0; color:#64748b; font-family:'Inter',system-ui,sans-serif;">${escape(strategy.disclaimer)}</p>
      </div>
    `;
  }

  return `
    <div class="ds-subsection">
      <h4 class="ds-subsection-title">Contextual link strategy</h4>
      <p class="ds-framing">These are <strong>types of external authority worth building</strong> for this company's category and market — not links it already has, and not a list of sites to contact. ${escape(strategy.headline)}</p>
      ${strategy.recommendations.map(renderRecommendation).join('')}
      ${strategy.limitations.length > 0
        ? `<p class="ds-methodology-foot">${strategy.limitations.map((l) => escape(l)).join(' ')}</p>`
        : ''}
      <p style="font-size:9pt; margin:3mm 0 0; color:#64748b; font-family:'Inter',system-ui,sans-serif;">${escape(strategy.disclaimer)}</p>
    </div>
  `;
}

/**
 * The Authority subsection. Returns '' when the surface is absent, so a report built before this
 * field existed renders exactly as it did before.
 */
export function renderBacklinkAuthority(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  if (!payload.backlink_authority) return '';

  return `
    <section class="ds-section">
      ${renderSectionHeader(
    'External Authority',
    'What the public record shows about inbound authority — and which kinds would be worth building',
    eyebrow,
  )}
      <p class="ds-framing">Two different things follow, kept apart on purpose. The first is what was <strong>observed</strong>. The second is what would be <strong>strategically valuable to build</strong>. A recommended type is not a link this company already has.</p>
      ${renderObservation(payload)}
      ${renderStrategy(payload)}
    </section>
  `;
}
