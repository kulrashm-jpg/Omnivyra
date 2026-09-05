/**
 * A2 — the ICP review, edit and ratification workspace.
 *
 * A presentation layer over `/api/prospect-icp/{versions,propose,ratify}`. It
 * computes no score, derives no state and fills no gap: every value is rendered
 * as the canonical services produced it, and every absence is rendered AS an
 * absence — the same discipline `ProspectIntelligencePanel` already follows.
 *
 * ─── SEVEN THINGS THIS SCREEN REFUSES TO CONFLATE ─────────────────────────
 * A formal CRITERION the evaluator can apply · an AI TARGET with ranking and
 * provenance · CONFIDENCE in the proposal (which is NOT an ICP fit score) ·
 * DERIVATION, observed versus inferred · GUIDANCE the contract cannot express
 * as criteria · an ASSUMPTION about company stage · and the RATIFIED ICP, which
 * is the only thing that is authoritative. Collapsing any of these into one
 * "AI recommendation" panel is how a reviewer ratifies something they did not
 * actually read.
 *
 * ─── THE TITLE SHORTLIST IS ONE CRITERION, AND STAYS ONE ──────────────────
 * The evaluator computes `satisfied / evaluable`, so five titles rendered and
 * saved as five criteria would score a matching person at 0.2. The shortlist is
 * therefore edited as the value set of a SINGLE `job_title one_of` criterion.
 * `editedCriteria` rewrites that one criterion's values in place; there is no
 * code path here that can produce a second `job_title` criterion.
 *
 * ─── WHICH PROPOSAL IS "CURRENT" IS NOT DECIDED HERE ──────────────────────
 * A1 recorded that repeated generation creates several `proposed` versions with
 * no supersession semantic. When more than one exists this screen says so and
 * makes the reviewer choose. It does not default to the newest: "newest wins"
 * is a product rule nobody has written, and inventing it in a component would
 * be indistinguishable from having decided it.
 */

import React from 'react';
import useSWR from 'swr';
import { useCompanyContext } from '@/components/CompanyContext';
import { apiFetch } from '@/lib/apiFetch';

// ── The shapes the API returns. Read-only mirrors, not a second contract. ────
type SectionState = 'available' | 'empty' | 'not_evaluated' | 'not_implemented' | 'failed';

interface Predicate { op: string; values?: string[]; min?: number; max?: number; value?: number }
interface Criterion {
  id: string;
  kind: 'mandatory' | 'required' | 'optional';
  subject: 'account' | 'person';
  attribute: string;
  predicate: Predicate;
  description?: string | null;
}
interface Target {
  rank: number;
  title: string;
  roleTypes: string[];
  derivation: 'directly_evidenced' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
  evidenceFields: string[];
  evidenceQuotes: string[];
  orgAssumption: string;
  factors?: Record<string, number>;
}
interface Proposal {
  status?: string;
  ai_value?: string | null;
  guidance?: string | null;
  updated_at?: string | null;
  targets?: Target[];
  rejected?: { title: string; reason: string }[];
  stageAssumption?: { stage: string; evidenceFields: string[]; rationale?: string | null };
}
interface VersionRecord {
  id: string;
  version: number;
  status: 'draft' | 'proposed' | 'ratified' | 'superseded';
  criteria: Criterion[];
  proposal: Proposal;
  proposedByModel: string | null;
  ratifiedAt: string | null;
  createdAt: string;
}
interface VersionSummary {
  version: number;
  status: VersionRecord['status'];
  createdAt: string;
  ratifiedAt: string | null;
  proposedByModel: string | null;
  criteriaCount: number;
  targetCount: number;
}
interface Workspace {
  icpKey: string;
  icpId: string | null;
  ratified: VersionRecord | null;
  proposals: VersionRecord[];
  history: VersionSummary[];
  proposalChoiceRequired: boolean;
}
interface Section<T> { state: SectionState; reason: string; data: T | null }

/** The title shortlist lives here and only here. */
const TITLE_UNION_CRITERION_ID = 'person-title-union';

/**
 * Attributes no source can populate (contract-freeze GAP-3). They are never
 * given an editing control — a field that cannot be filled would only make the
 * screen look more complete than the platform is.
 */
const UNSUPPORTED_ATTRIBUTES = ['seniority', 'authority', 'influence', 'buying_role'];

const describePredicate = (p: Predicate): string => {
  if (p.op === 'one_of' || p.op === 'includes_any' || p.op === 'includes_all') {
    return `${p.op.replace(/_/g, ' ')}: ${(p.values ?? []).join(', ')}`;
  }
  if (p.op === 'between') return `between ${p.min} and ${p.max}`;
  return `${p.op.replace(/_/g, ' ')} ${p.value}`;
};

// ── Small presentational pieces ─────────────────────────────────────────────

function DerivationBadge({ derivation }: { derivation: Target['derivation'] }) {
  const inferred = derivation === 'inferred';
  return (
    <span
      data-testid={`derivation-${derivation}`}
      title={inferred
        ? 'The AI inferred this target from the available evidence. It was not directly stated.'
        : 'Directly evidenced by a verbatim quote from the company profile.'}
      className={inferred ? 'text-amber-700' : 'text-emerald-700'}
    >
      {inferred ? 'Inferred by AI' : 'Directly evidenced'}
    </span>
  );
}

function CriterionRow({ criterion }: { criterion: Criterion }) {
  return (
    <li data-testid={`criterion-${criterion.id}`}>
      <strong>{criterion.attribute}</strong>{' '}
      <span>({criterion.kind})</span>{' '}
      <span>{describePredicate(criterion.predicate)}</span>
      {criterion.description ? <p>{criterion.description}</p> : null}
    </li>
  );
}

function TargetCard({ target }: { target: Target }) {
  return (
    <li data-testid={`target-${target.rank}`}>
      <strong>#{target.rank} {target.title}</strong>
      <span> — {target.roleTypes.join(', ')}</span>
      <DerivationBadge derivation={target.derivation} />
      {/* Never "ICP fit". This is confidence in the PROPOSAL. */}
      <span data-testid={`target-confidence-${target.rank}`}>
        AI proposal confidence: {target.confidence}
      </span>
      <p>Evidence fields: {target.evidenceFields.join(', ')}</p>
      {target.evidenceQuotes.length > 0 ? (
        <ul>
          {target.evidenceQuotes.map((q) => <li key={q}>“{q}”</li>)}
        </ul>
      ) : (
        // An inference legitimately has no quote. Say so rather than showing a gap.
        <p data-testid={`target-noquote-${target.rank}`}>No verbatim quote — inferred from the fields above.</p>
      )}
      <p>Assumption: {target.orgAssumption}</p>
    </li>
  );
}

/** The one editable union. Adding a title edits values, never adds a criterion. */
function TitleUnionEditor({
  values, onChange, disabled,
}: { values: string[]; onChange: (next: string[]) => void; disabled: boolean }) {
  const [draft, setDraft] = React.useState('');
  return (
    <div data-testid="title-union-editor">
      <h4>Target job titles</h4>
      <p>
        These are matched as a single membership test — a prospect qualifies if their
        job title is any one of these. Matching is exact and case-sensitive.
      </p>
      <ul>
        {values.map((title) => (
          <li key={title} data-testid={`title-value-${title}`}>
            <span>{title}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${title}`}
              onClick={() => onChange(values.filter((v) => v !== title))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <input
        aria-label="Add a job title"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        type="button"
        disabled={disabled || !draft.trim()}
        onClick={() => { onChange([...values, draft.trim()]); setDraft(''); }}
      >
        Add title
      </button>
    </div>
  );
}

// ── The workspace ───────────────────────────────────────────────────────────

export default function IcpWorkspace({ icpKey = 'first-cut' }: { icpKey?: string }) {
  const { selectedCompanyId: companyId } = useCompanyContext();

  const key = companyId
    ? `/api/prospect-icp/versions?company_id=${encodeURIComponent(companyId)}&icpKey=${encodeURIComponent(icpKey)}`
    : null;
  const { data, error, isLoading, mutate } = useSWR<Section<Workspace>>(
    key, (u: string) => apiFetch(u).then((r) => r.json()));

  const [selectedVersion, setSelectedVersion] = React.useState<number | null>(null);
  const [editedTitles, setEditedTitles] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirmingRatify, setConfirmingRatify] = React.useState(false);

  if (!companyId) return <p>Select a company to review its Ideal Customer Profile.</p>;
  if (isLoading) return <p>Loading ICP workspace…</p>;
  // A transport failure. NOT "no ICP" — the distinction is the point.
  if (error || !data) {
    return <p data-testid="icp-transport-error">The ICP workspace could not be read. Nothing has been changed — only unread.</p>;
  }
  if (data.state === 'failed') {
    return <p data-testid="icp-failed">The ICP workspace could not be read: {data.reason}</p>;
  }

  const ws = data.data;
  const proposals = ws?.proposals ?? [];
  const ratified = ws?.ratified ?? null;

  const generate = async () => {
    setBusy(true); setNotice(null);
    try {
      const res = await apiFetch('/api/prospect-icp/propose?company_id=' + encodeURIComponent(companyId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icpKey, generate: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The 422 refusal contract: a reason code plus what was refused.
        setNotice(`Could not generate a proposal — ${body.code ?? res.status}: ${body.error ?? 'unknown reason'}`);
      } else {
        setNotice(`Proposal generated as version ${body.version}. Review it before ratifying.`);
        await mutate();
      }
    } finally { setBusy(false); }
  };

  const active = selectedVersion === null
    ? (proposals.length === 1 ? proposals[0] : null)
    : proposals.find((p) => p.version === selectedVersion) ?? null;

  const titleCriterion = active?.criteria.find((c) => c.id === TITLE_UNION_CRITERION_ID) ?? null;
  const currentTitles = editedTitles ?? titleCriterion?.predicate.values ?? [];
  const dirty = editedTitles !== null;

  /** Saving edits creates a NEW version. It never mutates the one on screen. */
  const saveEdits = async () => {
    if (!active || !titleCriterion) return;
    setBusy(true); setNotice(null);
    try {
      // Rewrite the union's values IN PLACE. One job_title criterion in, one out.
      const criteria = active.criteria.map((c) => (
        c.id === TITLE_UNION_CRITERION_ID
          ? { ...c, predicate: { ...c.predicate, values: currentTitles } }
          : c));
      const res = await apiFetch('/api/prospect-icp/propose?company_id=' + encodeURIComponent(companyId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          icpKey,
          criteria,
          status: 'proposed',
          proposal: { ...active.proposal, status: 'edited' },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(`Edit rejected — ${body.code ?? res.status}: ${body.error ?? 'unknown reason'}`);
      } else {
        setNotice(`Saved as version ${body.version}. Version ${active.version} is unchanged. Nothing is ratified yet.`);
        setEditedTitles(null);
        setSelectedVersion(body.version ?? null);
        await mutate();
      }
    } finally { setBusy(false); }
  };

  const ratify = async () => {
    if (!active) return;
    setBusy(true); setNotice(null);
    try {
      const res = await apiFetch('/api/prospect-icp/ratify?company_id=' + encodeURIComponent(companyId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icpKey, version: active.version }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(`Ratification failed — ${body.code ?? res.status}: ${body.error ?? 'unknown reason'}`);
      } else {
        setNotice(`Version ${body.version} is now the ratified ICP.`);
        await mutate();
      }
    } finally { setBusy(false); setConfirmingRatify(false); }
  };

  return (
    <section>
      <h2>Ideal Customer Profile — {icpKey}</h2>
      {notice ? <p role="status" data-testid="icp-notice">{notice}</p> : null}

      {/* ── State: what is authoritative right now ─────────────────────── */}
      {ratified ? (
        <p data-testid="ratified-banner">
          Ratified ICP: version {ratified.version} (ratified {ratified.ratifiedAt}). This is the
          authoritative profile the evaluator uses.
        </p>
      ) : (
        <p data-testid="no-ratified-banner">
          No ratified ICP yet. Nothing is being used for scoring.
        </p>
      )}

      {data.state === 'empty' ? (
        <p data-testid="icp-empty">{data.reason}</p>
      ) : null}

      {ratified && proposals.length > 0 ? (
        <p data-testid="newer-proposal-banner">
          A newer proposal is awaiting review. Version {ratified.version} remains authoritative until
          you ratify a replacement.
        </p>
      ) : null}

      <button type="button" onClick={generate} disabled={busy} data-testid="generate-button">
        Generate an AI proposal
      </button>

      {/* ── Which proposal am I reviewing? ─────────────────────────────── */}
      {ws?.proposalChoiceRequired ? (
        <div data-testid="proposal-choice-required">
          <p>
            {proposals.length} proposals are awaiting a decision. There is no automatic
            &quot;current&quot; proposal — choose the one you want to review.
          </p>
          <ul>
            {proposals.map((p) => (
              <li key={p.version}>
                <button type="button" onClick={() => { setSelectedVersion(p.version); setEditedTitles(null); }}>
                  Review version {p.version} ({p.createdAt})
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── The proposal under review ──────────────────────────────────── */}
      {active ? (
        <article data-testid={`proposal-version-${active.version}`}>
          <h3>Proposal — version {active.version} ({active.status})</h3>

          <section data-testid="proposal-metadata">
            <h4>How this proposal was produced</h4>
            {active.proposedByModel ? <p>Model: {active.proposedByModel}</p> : <p>Authored by a person.</p>}
            {active.proposal.ai_value ? <p>{active.proposal.ai_value}</p> : null}
          </section>

          {active.proposal.guidance ? (
            <section data-testid="proposal-guidance">
              <h4>AI reasoning that is not a formal criterion</h4>
              <p>
                The evaluator does not score any of the following. It is recorded so you can
                weigh it yourself.
              </p>
              <pre>{active.proposal.guidance}</pre>
            </section>
          ) : null}

          <section data-testid="company-icp">
            <h4>Company criteria</h4>
            {active.criteria.filter((c) => c.subject === 'account').length ? (
              <ul>
                {active.criteria.filter((c) => c.subject === 'account')
                  .map((c) => <CriterionRow key={c.id} criterion={c} />)}
              </ul>
            ) : <p>No company-level criteria were proposed.</p>}
          </section>

          <section data-testid="person-icp">
            <h4>Person criteria</h4>
            {titleCriterion ? (
              <TitleUnionEditor values={currentTitles} onChange={setEditedTitles} disabled={busy} />
            ) : <p>No job-title criterion was proposed.</p>}
            {active.criteria
              .filter((c) => c.subject === 'person' && c.id !== TITLE_UNION_CRITERION_ID)
              .map((c) => <CriterionRow key={c.id} criterion={c} />)}
            {/* GAP-3: no controls, and the reason is stated rather than hidden. */}
            <p data-testid="unsupported-attributes">
              Not available for targeting: {UNSUPPORTED_ATTRIBUTES.join(', ')} — no connected source
              can populate them, so a criterion using one would never match.
            </p>
          </section>

          {active.proposal.targets?.length ? (
            <section data-testid="ranked-targets">
              <h4>Ranked person targets</h4>
              <p>Ranking orders your review. It does not affect scoring.</p>
              <ul>{active.proposal.targets.map((t) => <TargetCard key={t.rank} target={t} />)}</ul>
            </section>
          ) : null}

          {active.proposal.stageAssumption ? (
            <section data-testid="stage-assumption">
              <h4>Assumption — not an observed fact</h4>
              <p>
                Assumed target-company stage: {active.proposal.stageAssumption.stage}
                {active.proposal.stageAssumption.rationale
                  ? ` — ${active.proposal.stageAssumption.rationale}` : ''}
              </p>
              <p>Based on: {active.proposal.stageAssumption.evidenceFields.join(', ') || 'no named field'}</p>
            </section>
          ) : null}

          {active.proposal.rejected?.length ? (
            <section data-testid="rejected-targets">
              <h4>Considered and rejected</h4>
              <ul>
                {active.proposal.rejected.map((r) => (
                  <li key={r.title}><strong>{r.title}</strong> — {r.reason}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <button type="button" onClick={saveEdits} disabled={busy || !dirty} data-testid="save-edits">
              Save as a new version
            </button>
            {dirty ? <p data-testid="edit-pending">Unsaved edits. Saving creates a new version; version {active.version} is never altered.</p> : null}

            {/* Ratification is a separate, explicit, confirmed human act. */}
            {!confirmingRatify ? (
              <button type="button" onClick={() => setConfirmingRatify(true)} disabled={busy || dirty} data-testid="ratify-button">
                Ratify this version
              </button>
            ) : (
              <div data-testid="ratify-confirm">
                <p>
                  Ratify version {active.version}
                  {ratified ? `, replacing version ${ratified.version}` : ''}? A ratified version is
                  immutable and becomes the profile the evaluator uses. This cannot be undone —
                  changing it later means ratifying a new version.
                </p>
                <button type="button" onClick={ratify} disabled={busy} data-testid="ratify-confirm-yes">
                  Yes, ratify version {active.version}
                </button>
                <button type="button" onClick={() => setConfirmingRatify(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        </article>
      ) : null}

      {/* ── Version ledger ─────────────────────────────────────────────── */}
      {ws?.history.length ? (
        <section data-testid="version-history">
          <h4>Version history</h4>
          <ul>
            {ws.history.map((h) => (
              <li key={h.version} data-testid={`history-${h.version}`}>
                Version {h.version} — {h.status} — {h.criteriaCount} criteria, {h.targetCount} targets
                {h.proposedByModel ? ` — ${h.proposedByModel}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
