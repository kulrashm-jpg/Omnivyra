/**
 * B7 (WP-10) — renderer for the public-evidence market / ICP PROPOSAL.
 *
 * Presentation only. It reads `payload.market_icp_recommendation` and nothing else, recomputes
 * nothing, and renders '' when the producer abstained entirely at the section level — so a report
 * built before this section existed is byte-identical to before.
 *
 * Two rules the wording has to hold, because they are the point of the section:
 *
 *  1. Every recommended attribute is labelled `Observed` or `Inferred` in the customer-visible
 *     output, not only in the payload. An inference presented as an observation is the defect this
 *     programme has spent seven remediation slices removing.
 *  2. An attribute with no admissible public evidence renders as "Not established", with the reason
 *     and what would resolve it — never as a blank, and never as a guess.
 *
 * The disclaimer renders unconditionally on the section, so the reader cannot take the proposal for
 * a saved profile or an approved ICP.
 */
import type { CanonicalExportPayload } from './canonicalExport';
import type { MarketIcpAttribute } from '../canonicalReport/reportMarketRecommendation';
import { renderSectionHeader } from './exportRendererSectionsA';
import { escape } from './exportRendererCoreModel';

const BASIS_LABEL: Record<'observed' | 'inferred', string> = {
  observed: 'Observed',
  inferred: 'Inferred',
};

const BASIS_NOTE: Record<'observed' | 'inferred', string> = {
  observed: 'read directly from the public record',
  inferred: 'reasoned from public observations, not read directly',
};

function renderAttribute(attribute: MarketIcpAttribute): string {
  if (attribute.status !== 'recommended' || attribute.value === null || attribute.basis === null) {
    return `
      <div class="ds-methodology-row">
        <dt class="ds-methodology-label">${escape(attribute.label)}</dt>
        <dd class="ds-methodology-body">
          <strong>Not established.</strong> ${escape(attribute.reason_unavailable ?? attribute.rationale)}
          ${attribute.unlock ? ` <em>${escape(attribute.unlock)}</em>` : ''}
        </dd>
      </div>
    `;
  }
  const basis = attribute.basis;
  return `
    <div class="ds-methodology-row">
      <dt class="ds-methodology-label">${escape(attribute.label)}</dt>
      <dd class="ds-methodology-body">
        <strong>${escape(attribute.value)}</strong>
        <span class="ds-pill">${escape(BASIS_LABEL[basis])}</span>
        <span style="color:#64748b;"> · ${escape(BASIS_NOTE[basis])} · confidence ${escape(attribute.confidence)}</span>
        <br />${escape(attribute.rationale)}
      </dd>
    </div>
  `;
}

export function renderMarketIcpRecommendation(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const proposal = payload.market_icp_recommendation;
  if (!proposal || proposal.attributes.length === 0) return '';

  const header = renderSectionHeader(
    'Market Proposal',
    'On the public record alone, which market does this company appear to address?',
    eyebrow,
  );

  // Total abstention is a finding, not an empty section. It tells the reader the public record is
  // too thin to characterise the market, which is materially different from not having looked.
  if (proposal.counts.recommended === 0) {
    return `
      <section class="ds-section">
        ${header}
        <p class="ds-framing">${escape(proposal.headline)} Rather than estimate one, each characteristic below states what could not be established and what would resolve it.</p>
        <dl class="ds-methodology-list">
          ${proposal.attributes.map(renderAttribute).join('')}
        </dl>
        <p style="font-size:9pt; margin:3mm 0 0; color:#64748b; font-family:'Inter',system-ui,sans-serif;">${escape(proposal.disclaimer)}</p>
      </section>
    `;
  }

  return `
    <section class="ds-section">
      ${header}
      <p class="ds-framing">${escape(proposal.headline)} Each characteristic below is marked <strong>Observed</strong> where the public record shows it directly, or <strong>Inferred</strong> where it was reasoned from public observations. Where the public record supports neither, the characteristic is reported as not established rather than estimated.</p>
      <dl class="ds-methodology-list">
        ${proposal.attributes.map(renderAttribute).join('')}
      </dl>
      ${proposal.limitations.length > 0
        ? `<p class="ds-methodology-foot">${proposal.limitations.map((l) => escape(l)).join(' ')}</p>`
        : ''}
      <p style="font-size:9pt; margin:3mm 0 0; color:#64748b; font-family:'Inter',system-ui,sans-serif;">${escape(proposal.disclaimer)}</p>
    </section>
  `;
}
