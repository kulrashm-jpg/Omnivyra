/**
 * Report 1 (Digital Snapshot) export sections — GAP-01.
 *
 * These render the Report 1 surfaces that the canonical builder does NOT own:
 *
 *   • `digital_snapshot` — cross-source opportunities, top priorities, the 30/60/90 plan,
 *     produced by `digitalSnapshotAssembly`.
 *   • `digital_experience` — evidence-linked website findings, produced by `digitalExperience`.
 *   • `competitive_tables` — the two-axis public-domain competition views (Phase 3).
 *
 * All three were computed on every report run, persisted verbatim inside
 * `reports.data.composed_report`, and then discarded because the export payload had no slot for
 * them. Nothing here recomputes, re-ranks, re-scores or re-words any of it.
 *
 * THE RENDERING CONTRACT — this module is a display layer and nothing else:
 *
 *   1. NO DERIVATION. Every number, verdict, ranking and sentence is read from the producer.
 *      The one computation performed is `Math.round` on an already-computed `priorityScore`
 *      for display width, and `index + 1` for list ordinals.
 *   2. NO FABRICATION. An absent surface renders NOTHING — never a placeholder, never an
 *      empty-state that implies measurement was attempted when it was not. The single
 *      exception is an empty 30/60/90 horizon, where the assembler supplies its OWN
 *      explanation in `plan.notes` and that explanation is rendered verbatim, because
 *      "we found no low-effort high-impact work" is itself a finding.
 *   3. EVIDENCE TRAVELS WITH THE CLAIM. Each opportunity renders every one of its evidence
 *      statements with the source domain and the `ScoreState` that produced it, so a reader
 *      can see a `measured` claim and an `unavailable` limitation side by side rather than
 *      being handed a conclusion.
 *   4. UNMEASURABLE OUTCOMES SAY SO. `measurementAvailable: false` is rendered explicitly.
 *      The assembler sets it where verifying the outcome needs a source Omnivyra cannot
 *      currently read; softening that would be exactly the estimate-as-fact transition the
 *      evidence discipline forbids.
 *
 * Styling reuses the existing dossier vocabulary (`ds-section`, `ds-framing`,
 * `ds-playbook-group`, `ds-pill`, `ds-methodology*`). No new stylesheet, no new pipeline.
 */
import type { CanonicalExportPayload } from './canonicalExport';
import { escape } from './exportRendererCoreModel';
import { renderSectionHeader } from './exportRendererSectionsA';

/**
 * Group labels shown above each section title.
 *
 * `renderSectionHeader` uses its third argument as the eyebrow and falls back to the TITLE when
 * it is absent — which for an unnumbered section prints the same words twice. Numbered chapters
 * sidestep that with '01'; `renderDeclaredEvidence` sidesteps it with a distinct eyebrow. These
 * sections do the same, and the label doubles as provenance: the decision layer is the Digital
 * Snapshot's own output, the two evidence sections are direct public observation.
 */
export const EYEBROW_DECISION = 'Digital Snapshot';
export const EYEBROW_EVIDENCE = 'Public Evidence';

type Report1 = NonNullable<CanonicalExportPayload['report1']>;
type DigitalSnapshot = NonNullable<Report1['digital_snapshot']>;
type Opportunity = DigitalSnapshot['opportunities'][number];
type PlanItem = DigitalSnapshot['plan']['days_0_30'][number];
type DigitalExperience = NonNullable<Report1['digital_experience']>;
type CompetitiveTables = NonNullable<Report1['competitive_tables']>;

const titleCase = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/** Source keys are machine tokens (`digital_experience`); readers get words. */
const sourceLabel = (source: string): string => titleCase(source.replace(/_/g, ' '));

/**
 * The evidence state, rendered as the producer classified it.
 *
 * `measured` and `inferred` are claims; `insufficient_signal` and `unavailable` are
 * limitations. Both are shown — an opportunity that rests partly on something Omnivyra could
 * not observe must say so at the point of the claim, not only in a coverage summary.
 */
const stateLabel = (state: string): string => {
  if (state === 'measured') return 'Measured';
  if (state === 'inferred') return 'Inferred';
  if (state === 'insufficient_signal') return 'Insufficient signal';
  if (state === 'unavailable') return 'Not observable';
  return titleCase(String(state).replace(/_/g, ' '));
};

const isLimitation = (state: string): boolean =>
  state === 'unavailable' || state === 'insufficient_signal';

function renderEvidenceList(evidence: Opportunity['evidence']): string {
  if (!Array.isArray(evidence) || evidence.length === 0) return '';
  return `
    <ul style="margin:0 0 3mm; padding-left:5mm; font-size:10pt; line-height:1.55; color:#1a2332;">
      ${evidence
        .map(
          (item) => `
            <li style="margin:0 0 1.5mm;">
              <span class="ds-pill" style="${isLimitation(item.state) ? 'opacity:0.75;' : ''}">${escape(sourceLabel(item.source))} · ${escape(stateLabel(item.state))}</span>
              <span style="margin-left:2mm;">${escape(item.statement)}</span>
            </li>
          `,
        )
        .join('')}
    </ul>
  `;
}

/**
 * Section — Top Priorities.
 *
 * The assembler has already ranked these by `Impact × Confidence ÷ Effort` and capped the list
 * (deterministically: score, then id, so two runs on identical evidence produce identical
 * order). This renders that ranking; it does not re-sort and does not re-cap.
 */
export function renderDigitalSnapshotPriorities(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const snapshot = payload.report1?.digital_snapshot;
  if (!snapshot || snapshot.topPriorities.length === 0) return '';
  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'Top Priorities',
        'Of everything observed in the public record, what deserves attention first?',
        eyebrow,
      )}
      <p class="ds-framing">Ranked by impact weighted for confidence and divided by effort, so a smaller certain win can outrank a larger speculative one. Every priority below is supported by at least one directly measured observation; anything resting only on evidence we could not obtain was dropped rather than softened.</p>
      ${snapshot.topPriorities
        .map(
          (opportunity, index) => `
            <div class="ds-playbook-group">
              <div class="ds-playbook-group-header">
                <p class="ds-playbook-group-label">${escape(`${index + 1}. ${opportunity.title}`)} <span class="ds-pill">Priority ${Math.round(opportunity.priorityScore)}</span></p>
                <p class="ds-playbook-group-desc">${escape(opportunity.problem)}</p>
              </div>
              <div style="display:flex; gap:5mm; flex-wrap:wrap; margin:0 0 3mm; font-family:'Inter',system-ui,sans-serif; font-size:9pt; color:#334155;">
                <span><strong style="color:#0f172a;">Confidence</strong> ${escape(titleCase(opportunity.confidence))}</span>
                <span><strong style="color:#0f172a;">Effort</strong> ${escape(titleCase(opportunity.effort))}</span>
                <span><strong style="color:#0f172a;">Horizon</strong> ${escape(opportunity.horizon)} days</span>
                ${opportunity.crossSource ? '<span class="ds-pill">Cross-source</span>' : ''}
              </div>
              <p style="font-size:10.5pt; line-height:1.6; margin:0 0 2mm; color:#1a2332;"><strong>Why it matters.</strong> ${escape(opportunity.businessImplication)}</p>
              <p style="font-size:10.5pt; line-height:1.6; margin:0 0 2mm; color:#1a2332;"><strong>Do this.</strong> ${escape(opportunity.action)}</p>
              ${renderEvidenceList(opportunity.evidence)}
            </div>
          `,
        )
        .join('')}
    </section>
  `;
}

/**
 * Section — Opportunities.
 *
 * The full evidence-gated set. Where Top Priorities answers "what first", this answers "what
 * did the public record actually surface", including items that ranked below the cap.
 */
export function renderDigitalSnapshotOpportunities(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const snapshot = payload.report1?.digital_snapshot;
  if (!snapshot) return '';

  // The assembler distinguishes "we looked and found nothing supportable" from "we did not
  // look". `empty: true` is the former, and it is a real finding that belongs in the report —
  // but only alongside the reason, which the assembler supplies in `unmeasuredDimensions`.
  if (snapshot.empty || snapshot.opportunities.length === 0) {
    return `
      <section class="ds-section">
        ${renderSectionHeader(
          'Opportunities',
          'What does the public evidence support acting on?',
          eyebrow,
        )}
        <p class="ds-framing">No opportunity could be supported by directly observed public evidence in this run. Nothing is listed here rather than generic marketing activity being substituted for a finding.${
          snapshot.unmeasuredDimensions.length > 0
            ? ` The following could not be measured and are therefore absent rather than assumed weak: ${escape(snapshot.unmeasuredDimensions.join(', '))}.`
            : ''
        }</p>
      </section>
    `;
  }

  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'Opportunities',
        'What does the public evidence support acting on?',
        eyebrow,
      )}
      <p class="ds-framing">Each opportunity below correlates observations across more than one evidence domain — a thin page is a content defect, but a thin page that is also the landing target for something the company sells is a commercial one. Every claim carries the observation it rests on and how that observation was obtained.</p>
      ${snapshot.opportunities.map((opportunity) => renderOpportunity(opportunity)).join('')}
    </section>
  `;
}

function renderOpportunity(opportunity: Opportunity): string {
  return `
    <div class="ds-playbook-group">
      <div class="ds-playbook-group-header">
        <p class="ds-playbook-group-label">${escape(opportunity.title)} ${opportunity.crossSource ? '<span class="ds-pill">Cross-source</span>' : ''}</p>
        <p class="ds-playbook-group-desc">${escape(opportunity.problem)}</p>
      </div>
      ${renderEvidenceList(opportunity.evidence)}
      <p style="font-size:10.5pt; line-height:1.6; margin:0 0 2mm; color:#1a2332;"><strong>Business implication.</strong> ${escape(opportunity.businessImplication)}</p>
      <p style="font-size:10.5pt; line-height:1.6; margin:0 0 2mm; color:#1a2332;"><strong>Recommended action.</strong> ${escape(opportunity.action)}</p>
      <p style="font-size:10.5pt; line-height:1.6; margin:0 0 2mm; color:#1a2332;"><strong>Expected result.</strong> ${escape(opportunity.expectedImpact)}</p>
      ${renderMeasurement(opportunity.measurement, opportunity.measurementAvailable)}
      <div style="display:flex; gap:5mm; flex-wrap:wrap; margin:0; font-family:'Inter',system-ui,sans-serif; font-size:9pt; color:#334155;">
        <span><strong style="color:#0f172a;">Confidence</strong> ${escape(titleCase(opportunity.confidence))}</span>
        <span><strong style="color:#0f172a;">Effort</strong> ${escape(titleCase(opportunity.effort))}</span>
        <span><strong style="color:#0f172a;">Horizon</strong> ${escape(opportunity.horizon)} days</span>
        <span><strong style="color:#0f4c6b;">Priority ${Math.round(opportunity.priorityScore)}</strong></span>
      </div>
    </div>
  `;
}

/**
 * How the reader will know it worked.
 *
 * `measurementAvailable: false` is rendered as a stated limit, not omitted and not reworded
 * into something that sounds achievable. The assembler sets it precisely where confirming the
 * outcome would require a source Omnivyra cannot read today.
 */
function renderMeasurement(measurement: string, available: boolean): string {
  const text = (measurement ?? '').trim();
  if (!text) return '';
  return `
    <p style="font-size:10pt; line-height:1.55; margin:0 0 2mm; color:${available ? '#1a2332' : '#64748b'};">
      <strong style="color:#0f172a;">How you will know.</strong> ${escape(text)}
      ${available ? '' : ' <span class="ds-pill" style="opacity:0.75;">Outcome not currently verifiable from public evidence</span>'}
    </p>
  `;
}

/**
 * Section — the 30/60/90 plan.
 *
 * Horizons come from the assembler's own effort/impact rule. An empty horizon renders the
 * assembler's own note explaining why, because a deliberately empty first thirty days is a
 * more honest artifact than a filled one, and a reader who sees a blank with no explanation
 * will assume a bug rather than a judgement.
 */
export function renderNinetyDayPlan(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const snapshot = payload.report1?.digital_snapshot;
  if (!snapshot) return '';
  const { plan } = snapshot;
  const horizons: Array<{ label: string; caption: string; items: PlanItem[] }> = [
    { label: 'Days 0–30', caption: 'Low effort, real impact — work that can genuinely finish inside a month.', items: plan.days_0_30 },
    { label: 'Days 31–60', caption: 'Work that needs a run-up but not a rebuild.', items: plan.days_31_60 },
    { label: 'Days 61–90', caption: 'Structural work whose payoff is compounding rather than immediate.', items: plan.days_61_90 },
  ];
  const hasAnyItem = horizons.some((h) => h.items.length > 0);
  const hasNotes = plan.notes.length > 0;
  if (!hasAnyItem && !hasNotes) return '';

  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'The Next 90 Days',
        'In what order should this be done, and how will each step be verified?',
        eyebrow,
      )}
      <p class="ds-framing">Sequenced by what can realistically be finished and what is worth finishing first — not by technical severity. A severe but low-impact defect does not claim day one.</p>
      ${horizons
        .map(
          (horizon) => `
            <div class="ds-playbook-group">
              <div class="ds-playbook-group-header">
                <p class="ds-playbook-group-label">${escape(horizon.label)}</p>
                <p class="ds-playbook-group-desc">${escape(horizon.caption)}</p>
              </div>
              ${
                horizon.items.length === 0
                  ? '<p style="font-size:10pt; line-height:1.55; margin:0; color:#64748b;">No work was evidenced for this horizon. It is left empty deliberately — see the plan notes below.</p>'
                  : horizon.items.map((item) => renderPlanItem(item)).join('')
              }
            </div>
          `,
        )
        .join('')}
      ${
        hasNotes
          ? `
            <div class="ds-methodology no-break">
              <p class="ds-methodology-eyebrow">Plan notes</p>
              <h2 class="ds-methodology-title">Why the plan is shaped this way</h2>
              <dl class="ds-methodology-list">
                ${plan.notes
                  .map(
                    (note, index) => `
                      <div class="ds-methodology-row">
                        <dt class="ds-methodology-label">${index + 1}</dt>
                        <dd class="ds-methodology-body">${escape(note)}</dd>
                      </div>
                    `,
                  )
                  .join('')}
              </dl>
            </div>
          `
          : ''
      }
    </section>
  `;
}

function renderPlanItem(item: PlanItem): string {
  return `
    <div style="margin:0 0 4mm;">
      <p style="font-size:11pt; font-weight:600; margin:0 0 1.5mm; color:#0f172a;">${escape(item.title)}</p>
      <p style="font-size:10.5pt; line-height:1.6; margin:0 0 1.5mm; color:#1a2332;">${escape(item.action)}</p>
      <p style="font-size:10pt; line-height:1.55; margin:0 0 1.5mm; color:#334155;">${escape(item.why)}</p>
      ${renderMeasurement(item.measurement, item.measurementAvailable)}
      <div style="display:flex; gap:5mm; flex-wrap:wrap; font-family:'Inter',system-ui,sans-serif; font-size:9pt; color:#334155;">
        <span><strong style="color:#0f172a;">Effort</strong> ${escape(titleCase(item.effort))}</span>
        <span><strong style="color:#0f172a;">Confidence</strong> ${escape(titleCase(item.confidence))}</span>
        ${item.sources.length > 0 ? `<span><strong style="color:#0f172a;">Evidence</strong> ${escape(item.sources.map(sourceLabel).join(', '))}</span>` : ''}
      </div>
    </div>
  `;
}

/**
 * Section — website evidence.
 *
 * The concrete, page-level public observations: URLs that error, pages with no onward path,
 * pages with no title. This is the most verifiable material in the report — a reader can open
 * the URL and check it — and it was previously reduced to a dimension score before reaching
 * the document.
 *
 * `limitations` are rendered as the assessor stated them. A pillar the assessor could not
 * evaluate is shown as unevaluated, never as passing.
 */
export function renderWebsiteExperienceEvidence(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const experience = payload.report1?.digital_experience;
  if (!experience) return '';
  const findings = experience.findings ?? [];
  const limitations = experience.limitations ?? [];
  if (findings.length === 0 && limitations.length === 0) return '';

  const coverage = experience.coverage;
  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'Website Evidence',
        'What does the site itself show, page by page?',
        eyebrow,
      )}
      <p class="ds-framing">Observed directly from the crawled pages — ${escape(String(coverage.pagesEvaluated))} page${coverage.pagesEvaluated === 1 ? '' : 's'} evaluated across ${escape(String(coverage.signalsEvaluated))} of ${escape(String(coverage.signalsTotal))} signals. Readiness is a classification, not a score: no defensible 0–100 benchmark for digital experience exists, and inventing one would restate a judgement as a measurement. This describes the website, never its visitors.</p>
      ${(experience.pillars ?? [])
        .map(
          (pillar) => `
            <div class="ds-playbook-group">
              <div class="ds-playbook-group-header">
                <p class="ds-playbook-group-label">${escape(pillar.label)} <span class="ds-pill">${escape(titleCase(String(pillar.readiness).replace(/_/g, ' ')))}</span></p>
                <p class="ds-playbook-group-desc">${escape(String(pillar.coverage.evaluated))} of ${escape(String(pillar.coverage.total))} signals evaluated.</p>
              </div>
              ${
                pillar.findings.length === 0
                  ? '<p style="font-size:10pt; margin:0; color:#64748b;">No defect was observed in the signals that could be evaluated.</p>'
                  : pillar.findings
                      .map(
                        (finding) => `
                          <div style="margin:0 0 4mm;">
                            <p style="font-size:11pt; font-weight:600; margin:0 0 1.5mm; color:#0f172a;">${escape(finding.problem)} <span class="ds-pill">${escape(titleCase(finding.severity))}</span></p>
                            <p style="font-size:10.5pt; line-height:1.6; margin:0 0 1.5mm; color:#1a2332;"><strong>Observed.</strong> ${escape(finding.evidence)}</p>
                            <p style="font-size:10pt; line-height:1.55; margin:0 0 1.5mm; color:#334155;">${escape(finding.whyItMatters)}</p>
                            <p style="font-size:10.5pt; line-height:1.6; margin:0 0 1.5mm; color:#1a2332;"><strong>Fix.</strong> ${escape(finding.action)}</p>
                            <p style="font-size:10pt; line-height:1.55; margin:0; color:#334155;"><strong style="color:#0f172a;">How you will know.</strong> ${escape(finding.measurement)}</p>
                          </div>
                        `,
                      )
                      .join('')
              }
            </div>
          `,
        )
        .join('')}
      ${
        limitations.length > 0
          ? `
            <div class="ds-methodology no-break">
              <p class="ds-methodology-eyebrow">Limits of this reading</p>
              <h2 class="ds-methodology-title">What a crawl could not observe</h2>
              <dl class="ds-methodology-list">
                ${limitations
                  .map(
                    (limitation) => `
                      <div class="ds-methodology-row">
                        <dt class="ds-methodology-label">${escape(titleCase(String(limitation.kind).replace(/_/g, ' ')))}</dt>
                        <dd class="ds-methodology-body">${escape(limitation.message)}</dd>
                      </div>
                    `,
                  )
                  .join('')}
              </dl>
            </div>
          `
          : ''
      }
    </section>
  `;
}

/**
 * Section — the two competition views.
 *
 * Product competition and market competition are deliberately separate axes: a company can
 * solve the same problem without chasing the same buyer, and collapsing the two into one
 * ranking is what previously made a broad platform indistinguishable from a true rival.
 *
 * A competitor whose axes abstained appears under `unclassified` with the producer's reason —
 * it is never promoted into a category to make a table look complete.
 */
export function renderCompetitiveTables(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const tables = payload.report1?.competitive_tables;
  if (!tables) return '';
  const hasRows =
    tables.productCompetition.length > 0 ||
    tables.marketCompetition.length > 0 ||
    tables.unclassified.length > 0;
  if (!hasRows) {
    // `empty` with a producer-supplied reason is a finding; `empty` with no reason is silence.
    return tables.empty && tables.emptyReason
      ? `
        <section class="ds-section">
          ${renderSectionHeader('Competitive Position', 'Who else is visible to the same buyer?', eyebrow)}
          <p class="ds-framing">${escape(tables.emptyReason)}</p>
        </section>
      `
      : '';
  }

  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'Competitive Position',
        'Who solves the same problem, and who competes for the same decision?',
        eyebrow,
      )}
      <p class="ds-framing">Two separate readings, deliberately not combined. Product competition asks who solves substantially the same problem; market competition asks who competes for the same buyer. A company can be one without being the other, and treating them as a single ranking obscures which of the two a given rival actually is.</p>
      ${renderCompetitorTable(
        'Product competition',
        'Who solves substantially the same problem?',
        tables.productCompetition.map((row) => ({
          competitor: row.competitor,
          domain: row.domain,
          classification: row.classification,
          overlapLabel: 'Product overlap',
          overlap: row.productOverlap,
          confidence: row.confidence,
          state: row.state,
          evidence: row.evidence,
        })),
      )}
      ${renderCompetitorTable(
        'Market competition',
        'Who competes for the same customer decision?',
        tables.marketCompetition.map((row) => ({
          competitor: row.competitor,
          domain: row.domain,
          classification: row.classification,
          overlapLabel: 'Market overlap',
          overlap: row.marketOverlap,
          confidence: row.confidence,
          state: row.state,
          evidence: row.evidence,
        })),
      )}
      ${
        tables.unclassified.length > 0
          ? `
            <div class="ds-methodology no-break">
              <p class="ds-methodology-eyebrow">Unclassified</p>
              <h2 class="ds-methodology-title">Observed, but not placed on either axis</h2>
              <p class="ds-methodology-lead">These companies were observed in the public record but the evidence did not support classifying them. They are listed rather than dropped, and left unclassified rather than assigned a category the evidence does not carry.</p>
              <dl class="ds-methodology-list">
                ${tables.unclassified
                  .map(
                    (row) => `
                      <div class="ds-methodology-row">
                        <dt class="ds-methodology-label">${escape(row.competitor)}</dt>
                        <dd class="ds-methodology-body">${escape(row.reason)} (${escape(String(row.signalCount))} signal${row.signalCount === 1 ? '' : 's'} observed)</dd>
                      </div>
                    `,
                  )
                  .join('')}
              </dl>
            </div>
          `
          : ''
      }
    </section>
  `;
}

type CompetitorRow = {
  competitor: string;
  domain: string | null;
  classification: string;
  overlapLabel: string;
  overlap: number | null;
  confidence: string;
  state: string;
  evidence: string[];
};

function renderCompetitorTable(label: string, caption: string, rows: CompetitorRow[]): string {
  if (rows.length === 0) return '';
  return `
    <div class="ds-playbook-group">
      <div class="ds-playbook-group-header">
        <p class="ds-playbook-group-label">${escape(label)}</p>
        <p class="ds-playbook-group-desc">${escape(caption)}</p>
      </div>
      ${rows
        .map(
          (row) => `
            <div style="margin:0 0 3.5mm;">
              <p style="font-size:11pt; font-weight:600; margin:0 0 1.5mm; color:#0f172a;">
                ${escape(row.competitor)}${row.domain ? ` <span style="font-weight:400; color:#64748b;">${escape(row.domain)}</span>` : ''}
                <span class="ds-pill">${escape(titleCase(String(row.classification).replace(/_/g, ' ')))}</span>
              </p>
              <div style="display:flex; gap:5mm; flex-wrap:wrap; margin:0 0 1.5mm; font-family:'Inter',system-ui,sans-serif; font-size:9pt; color:#334155;">
                <span><strong style="color:#0f172a;">${escape(row.overlapLabel)}</strong> ${row.overlap === null ? 'Not measurable' : `${escape(String(row.overlap))}/100`}</span>
                <span><strong style="color:#0f172a;">Confidence</strong> ${escape(titleCase(row.confidence))}</span>
                <span><strong style="color:#0f172a;">Evidence</strong> ${escape(stateLabel(row.state))}</span>
              </div>
              ${
                row.evidence.length > 0
                  ? `<ul style="margin:0; padding-left:5mm; font-size:10pt; line-height:1.55; color:#334155;">${row.evidence
                      .slice(0, 4)
                      .map((item) => `<li style="margin:0 0 1mm;">${escape(item)}</li>`)
                      .join('')}</ul>`
                  : ''
              }
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

type SearchVisibility = NonNullable<Report1['search_visibility']>;

/**
 * Section — public search visibility.
 *
 * Answers only what public search results establish. It is NOT a Search Console reading and never
 * falls back to one: the rows here came from public SERP responses fetched during this report run.
 *
 * The four states are rendered as four genuinely different statements, because collapsing them is
 * how "we could not look" becomes "you rank nowhere":
 *
 *   measured            — the domain appeared; positions are the provider's own ranks
 *   insufficient_signal — queries ran, the domain did not appear (a finding, not a zero)
 *   unavailable         — acquisition could not run
 *   failed              — acquisition ran and errored
 *
 * A position is never printed as 0. Absence renders as "not in the results returned", because a
 * rank of zero does not exist and a reader would take it for one.
 */
export function renderSearchVisibility(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const search = payload.report1?.search_visibility as SearchVisibility | null | undefined;
  if (!search) return '';

  const header = renderSectionHeader(
    'Public Search Visibility',
    'What do public search results establish about this domain today?',
    eyebrow,
  );

  if (search.state === 'unavailable' || search.state === 'failed') {
    return `
      <section class="ds-section">
        ${header}
        <p class="ds-framing">${escape(search.reason ?? 'Public search results could not be retrieved for this report.')} No conclusion about search visibility is drawn from this run — an unavailable check is not a poor result.</p>
      </section>
    `;
  }

  // Ranked first, then the queries that returned nothing — the reader sees what was found before
  // what was not, and both are shown because "checked and absent" is evidence too.
  const ranked = search.observations.filter((o) => typeof o.position === 'number')
    .sort((a, b) => (a.position as number) - (b.position as number));
  const absent = search.observations.filter((o) => o.position === null);

  const summary = search.state === 'measured'
    ? `The domain appeared for ${search.queriesRanked} of ${search.queriesRun} public quer${search.queriesRun === 1 ? 'y' : 'ies'} checked${search.bestPosition != null ? `, best position ${search.bestPosition}` : ''}.`
    : `${escape(search.reason ?? '')}`;

  return `
    <section class="ds-section">
      ${header}
      <p class="ds-framing">Measured by running public search queries and recording where — or whether — this domain appears. Positions are the search provider's own ranks, not a derived score. This is public-record evidence only; it is not a reading of any connected analytics property.</p>
      <p style="font-size:10.5pt; line-height:1.6; margin:0 0 3mm; color:#1a2332;">${summary}</p>
      ${ranked.length > 0 ? `
        <div class="ds-playbook-group">
          <div class="ds-playbook-group-header">
            <p class="ds-playbook-group-label">Where the domain appears</p>
            <p class="ds-playbook-group-desc">Query, observed position, and the result the searcher would see.</p>
          </div>
          ${ranked.slice(0, 8).map((o) => `
            <div style="margin:0 0 3.5mm;">
              <p style="font-size:11pt; font-weight:600; margin:0 0 1mm; color:#0f172a;">
                ${escape(o.query)} <span class="ds-pill">Position ${escape(String(o.position))}</span>
              </p>
              ${o.title ? `<p style="font-size:10.5pt; margin:0 0 1mm; color:#1a2332;">${escape(o.title)}</p>` : ''}
              ${o.url ? `<p style="font-size:9.5pt; margin:0 0 1mm; color:#64748b;">${escape(o.url)}</p>` : ''}
              ${o.snippet ? `<p style="font-size:10pt; line-height:1.55; margin:0; color:#334155;">${escape(o.snippet)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${absent.length > 0 ? `
        <div class="ds-playbook-group">
          <div class="ds-playbook-group-header">
            <p class="ds-playbook-group-label">Checked, not found</p>
            <p class="ds-playbook-group-desc">These queries ran and the domain did not appear in the results returned. That is an observation, not a ranking of zero.</p>
          </div>
          <ul style="margin:0; padding-left:5mm; font-size:10pt; line-height:1.6; color:#334155;">
            ${absent.slice(0, 10).map((o) => `<li style="margin:0 0 1mm;">${escape(o.query)} <span style="color:#64748b;">— not in the top ${escape(String(o.resultCount))} results</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <p style="font-size:9pt; margin:3mm 0 0; color:#64748b; font-family:'Inter',system-ui,sans-serif;">
        Source: public search results${search.provider ? ` via ${escape(search.provider)}` : ''}${search.observedAt ? ` · observed ${escape(search.observedAt.slice(0, 10))}` : ''} · ${escape(String(search.requestsMade))} quer${search.requestsMade === 1 ? 'y' : 'ies'} issued for this report
      </p>
    </section>
  `;
}

type CompanyIdentity = NonNullable<Report1['company_identity']>;

/**
 * Section — Company Profile, with provenance on every line.
 *
 * The Brand Brief this replaces rendered Offering / Positioning / Market / Differentiation with a
 * `measured` state and no marker, while every value came from the company's own onboarding profile.
 * A reader had no way to tell "your site says this" from "you told us this" — and the field named
 * `homepage_headline` was actually `profile.key_messages`, which is the worst version of that
 * confusion because the name itself asserts an observation.
 *
 * This renders the SAME values — nothing is deleted, declared information is useful — each with the
 * provenance the composer assigned. Labels come from the canonical verdict; this function performs
 * no classification of its own.
 *
 * Where declared and observed disagree, both are shown. Silently preferring one and calling it
 * observed is exactly the failure being corrected.
 */
export function renderCompanyIdentity(
  payload: CanonicalExportPayload,
  eyebrow: string,
): string {
  const identity = payload.report1?.company_identity as CompanyIdentity | null | undefined;
  if (!identity || identity.fields.length === 0) return '';

  const label = (provenance: string): string =>
    provenance === 'PUBLIC_OBSERVED' ? 'Observed'
      : provenance === 'INFERRED' ? 'Inferred'
        : 'Company confirmed';

  // A muted pill for declared values, a solid one for observations — the distinction should be
  // legible at a glance, not only on close reading.
  const pill = (provenance: string): string =>
    `<span class="ds-pill"${provenance === 'COMPANY_CONFIRMED' ? ' style="opacity:0.75;"' : ''}>${escape(label(provenance))}</span>`;

  const note = identity.hasDeclared
    ? 'Lines marked <em>Company confirmed</em> are what you told us during setup — useful context, but not something this report independently observed. Lines marked <em>Observed</em> were read from your public website.'
    : 'Every line below was read from your public website.';

  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'Company Profile',
        'What does the public record say about this company, and what did you tell us?',
        eyebrow,
      )}
      <p class="ds-framing">${note}</p>
      <dl class="ds-methodology-list">
        ${identity.fields.map((field) => `
          <div class="ds-methodology-row">
            <dt class="ds-methodology-label">${escape(field.label)} ${pill(field.provenance)}</dt>
            <dd class="ds-methodology-body">
              ${escape(field.value)}
              ${field.agreement === 'differ' && field.declaredValue ? `
                <span style="display:block; margin-top:1.5mm; font-size:10pt; color:#64748b;">
                  You told us: &ldquo;${escape(field.declaredValue)}&rdquo; — your site says something different. Both are shown rather than one being chosen for you.
                </span>` : ''}
            </dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `;
}
