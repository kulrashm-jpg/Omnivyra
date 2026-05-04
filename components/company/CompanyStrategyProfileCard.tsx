import React, { useEffect, useState } from 'react';
import type { CompanyProfile, CompanyProfileRefinement } from '../../pages/company-profile.types';
import {
  type StrategyProfile,
  buildImprovementSummary,
  getFieldWarning,
  getHighlightCandidates,
  matchHighlights,
  normalizeStrategyProfile,
  toCleanList,
} from './strategyProfileUiUtils';

type Props = {
  companyId?: string;
  profile: CompanyProfile;
  latestRefinement?: CompanyProfileRefinement | null;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onProfileUpdated: (profile: CompanyProfile) => void;
  onNotifyUpdated: (companyId: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string | null) => void;
};

type ContentSample = {
  id: string;
  title?: string;
  excerpt?: string;
  content_blocks?: Array<Record<string, unknown>> | null;
  content_type?: string;
};

const FIELD_HINTS = {
  worldview: 'Tip: Make this specific to your approach. Avoid generic phrases like "help businesses grow."',
  contrarianBeliefs: 'Tip: Add what you disagree with in your industry.',
  primaryFocus: 'Tip: Highlight what you prioritize over alternatives.',
  differentiation: 'Tip: State what makes your approach different, not just better.',
  typicalAngles: 'Tip: Include the perspectives you consistently take in content.',
} as const;

const SAMPLE_TEXT_LIMIT = 900;
const STRATEGY_LOCK_FIELDS = ['brand_positioning', 'competitive_advantages', 'growth_priorities'] as const;

function inferSourceSignals(profile: CompanyProfile, latestRefinement?: CompanyProfileRefinement | null) {
  const sourceSummaries = latestRefinement?.source_summaries ?? [];
  const websitePresent =
    Boolean(profile.website_url) ||
    sourceSummaries.some((item) => ['website_root', 'website_page', 'website'].includes(String(item.label || '').toLowerCase()));
  const contentPresent =
    Boolean(profile.blog_url) ||
    Boolean((profile.content_themes_list ?? []).length) ||
    sourceSummaries.some((item) => String(item.label || '').toLowerCase().includes('blog'));
  const postsPresent =
    Boolean((profile.social_profiles ?? []).length) ||
    Boolean(profile.linkedin_url || profile.x_url || profile.facebook_url || profile.instagram_url);

  let confidence: 'High' | 'Medium' | 'Low' = 'Low';
  if (websitePresent && (contentPresent || postsPresent)) {
    confidence = 'High';
  } else if (contentPresent || postsPresent) {
    confidence = 'Medium';
  }

  return {
    websitePresent,
    contentPresent,
    postsPresent,
    confidence,
  };
}

function FieldGuidance({
  hint,
  warning,
}: {
  hint: string;
  warning?: string | null;
}) {
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-gray-500">{hint}</p>
      {warning ? <p className="text-xs text-amber-700">{warning}</p> : null}
    </div>
  );
}

function extractSampleText(sample: ContentSample | null): string {
  if (!sample) return '';
  const fromBlocks = Array.isArray(sample.content_blocks)
    ? sample.content_blocks
        .map((block) => {
          const text = typeof block?.text === 'string'
            ? block.text
            : typeof block?.body === 'string'
              ? block.body
              : typeof block?.html === 'string'
                ? block.html.replace(/<[^>]+>/g, ' ')
                : '';
          return text.replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean)
        .join(' ')
    : '';
  const combined = [sample.excerpt || '', fromBlocks].filter(Boolean).join(' ').trim();
  if (combined.length <= SAMPLE_TEXT_LIMIT) return combined;
  return `${combined.slice(0, SAMPLE_TEXT_LIMIT).trim()}...`;
}

function renderHighlightedText(text: string, phrases: string[]) {
  if (!text) return <p className="text-sm text-gray-500">No excerpt available.</p>;
  if (phrases.length === 0) return <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{text}</p>;

  const ranges = phrases
    .map((phrase) => {
      const pattern = phrase
        .split(' ')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+');
      const regex = new RegExp(`\\b${pattern}\\b`, 'i');
      const match = regex.exec(text);
      return match ? { start: match.index, end: match.index + match[0].length, text: match[0] } : null;
    })
    .filter((item): item is { start: number; end: number; text: string } => Boolean(item))
    .sort((a, b) => a.start - b.start);

  if (ranges.length === 0) {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">{text}</p>;
  }

  const segments: Array<{ text: string; highlighted: boolean; key: string }> = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor) return;
    if (range.start > cursor) {
      segments.push({
        text: text.slice(cursor, range.start),
        highlighted: false,
        key: `plain-${cursor}-${range.start}`,
      });
    }
    segments.push({
      text: text.slice(range.start, range.end),
      highlighted: true,
      key: `highlight-${index}-${range.start}`,
    });
    cursor = range.end;
  });
  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      highlighted: false,
      key: `plain-${cursor}-end`,
    });
  }

  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
      {segments.map((segment) => (
        segment.highlighted ? (
          <mark key={segment.key} className="rounded bg-amber-100 px-0.5 text-gray-900">
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={segment.key}>{segment.text}</React.Fragment>
        )
      ))}
    </p>
  );
}

function StrategyListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="mt-2 space-y-2">
        {values.map((value, index) => (
          <div key={`${label}-${index}`} className="flex items-center gap-2">
            <input
              value={value}
              onChange={(e) => {
                const next = [...values];
                next[index] = e.target.value;
                onChange(next);
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder={`Add ${label.toLowerCase()}`}
            />
            <button
              type="button"
              onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...values, ''])}
          className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Add item
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
      {children}
    </span>
  );
}

export default function CompanyStrategyProfileCard({
  companyId,
  profile,
  latestRefinement,
  apiFetch,
  onProfileUpdated,
  onNotifyUpdated,
  onSuccess,
  onError,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [draft, setDraft] = useState<StrategyProfile>(normalizeStrategyProfile(profile));
  const [previousStrategy, setPreviousStrategy] = useState<StrategyProfile | null>(null);
  const [saveComparison, setSaveComparison] = useState<{
    reason: string;
    before?: string;
    after?: string;
  } | null>(null);
  const [isExampleOpen, setIsExampleOpen] = useState(false);
  const [isLoadingExample, setIsLoadingExample] = useState(false);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [exampleSample, setExampleSample] = useState<ContentSample | null>(null);

  useEffect(() => {
    setDraft(normalizeStrategyProfile(profile));
  }, [profile]);

  const effectiveCompanyId = companyId || profile.company_id;
  const isLocked = Array.isArray(profile.user_locked_fields)
    && STRATEGY_LOCK_FIELDS.some((field) => profile.user_locked_fields?.includes(field));
  const hasStrategy = Boolean(
    draft.worldview ||
    draft.contrarianBeliefs.length ||
    draft.primaryFocus.length ||
    draft.differentiation.length ||
    draft.typicalAngles.length,
  );
  const isUserDefined = isLocked && profile.last_edited_by === 'user';
  const isAutoDerived = hasStrategy && !isUserDefined;
  const sourceSignals = inferSourceSignals(profile, latestRefinement);
  const highlightPhrases = matchHighlights(extractSampleText(exampleSample), getHighlightCandidates(draft));

  const saveStrategy = async () => {
    if (!effectiveCompanyId) return;
    try {
      setIsSaving(true);
      onError(null);
      const response = await apiFetch('/api/company-profile/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_override',
          companyId: effectiveCompanyId,
          strategyProfile: {
            worldview: draft.worldview?.trim() || null,
            contrarianBeliefs: toCleanList(draft.contrarianBeliefs),
            primaryFocus: toCleanList(draft.primaryFocus),
            differentiation: toCleanList(draft.differentiation),
            typicalAngles: toCleanList(draft.typicalAngles),
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.message || 'Failed to save strategy profile');
      }
      const nextProfile = (data.profile || profile) as CompanyProfile;
      const nextStrategy = normalizeStrategyProfile(nextProfile);
      onProfileUpdated(nextProfile);
      onNotifyUpdated(nextProfile.company_id || effectiveCompanyId);
      onSuccess('Strategy Profile Locked (User Approved)');
      const improvement = buildImprovementSummary({
        previous: previousStrategy,
        next: nextStrategy,
        profile: nextProfile,
      });
      setSaveComparison(improvement?.improved ? {
        reason: improvement.reason || 'Strategy updated',
        before: improvement.before,
        after: improvement.after,
      } : null);
      setIsEditing(false);
    } catch (error) {
      onError((error as Error).message || 'Failed to save strategy profile');
    } finally {
      setIsSaving(false);
    }
  };

  const regenerateStrategy = async () => {
    if (!effectiveCompanyId) return;
    const shouldForce = isLocked
      ? window.confirm('This strategy profile is locked by a user edit. Regenerate and overwrite it?')
      : false;
    if (isLocked && !shouldForce) return;

    try {
      setIsRegenerating(true);
      onError(null);
      const response = await apiFetch('/api/company-profile/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate',
          companyId: effectiveCompanyId,
          forceOverride: shouldForce,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || data?.error || 'Failed to regenerate strategy profile');
      }
      const nextProfile = (data.profile || profile) as CompanyProfile;
      onProfileUpdated(nextProfile);
      onNotifyUpdated(nextProfile.company_id || effectiveCompanyId);
      onSuccess('Strategy profile regenerated from website and existing content.');
      setSaveComparison(null);
      setIsEditing(false);
    } catch (error) {
      onError((error as Error).message || 'Failed to regenerate strategy profile');
    } finally {
      setIsRegenerating(false);
    }
  };

  const openExampleOutput = async () => {
    if (!effectiveCompanyId) return;
    try {
      setIsExampleOpen(true);
      setExampleError(null);
      if (exampleSample) return;
      setIsLoadingExample(true);
      const response = await apiFetch(`/api/company/blogs?company_id=${encodeURIComponent(effectiveCompanyId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load example content');
      }
      const blogs = Array.isArray(data?.blogs) ? data.blogs : [];
      setExampleSample((blogs[0] || null) as ContentSample | null);
    } catch (error) {
      setExampleError((error as Error).message || 'Failed to load example content');
    } finally {
      setIsLoadingExample(false);
    }
  };

  return (
    <div className="border-t pt-6 mt-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Company Strategy Profile</h3>
          <p className="mt-1 text-sm text-gray-600">
            The strategic identity used to keep content intentional, differentiated, and company-specific.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 md:justify-end">
            {isAutoDerived && <StatusBadge>Auto-derived</StatusBadge>}
            {isUserDefined && <StatusBadge>Edited by user</StatusBadge>}
            {isLocked && <StatusBadge>Locked</StatusBadge>}
            {isLocked && <StatusBadge>User-defined strategy</StatusBadge>}
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <div className="font-semibold text-gray-700">Derived From</div>
            <div className="mt-1">Website ({sourceSignals.websitePresent ? 'High' : 'Not used'})</div>
            <div>Content ({sourceSignals.contentPresent ? 'Medium' : 'Not used'})</div>
            <div>Recent Posts ({sourceSignals.postsPresent ? 'Low' : 'Not used'})</div>
            <div className="mt-2 font-medium text-gray-800">Confidence: {sourceSignals.confidence}</div>
          </div>
        </div>
      </div>

      {!hasStrategy && !isEditing && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No strategy profile is available yet. Regenerate from website and existing content to derive one automatically.
        </div>
      )}

      {saveComparison ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <div className="font-semibold">Strategy improved: {saveComparison.reason}</div>
          {saveComparison.before && saveComparison.after && saveComparison.before !== saveComparison.after ? (
            <div className="mt-2 space-y-1 text-xs text-green-900">
              <div><span className="font-medium">Before:</span> {saveComparison.before}</div>
              <div><span className="font-medium">After:</span> {saveComparison.after}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isEditing ? (
        <div className="mt-4 space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Worldview</label>
            <textarea
              value={draft.worldview || ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, worldview: e.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Summarize how this company sees the market in 1-2 lines."
            />
            <FieldGuidance
              hint={FIELD_HINTS.worldview}
              warning={getFieldWarning(draft.worldview || '')}
            />
          </div>
          <StrategyListEditor
            label="Contrarian Beliefs"
            values={draft.contrarianBeliefs || []}
            onChange={(next) => setDraft((prev) => ({ ...prev, contrarianBeliefs: next }))}
          />
          <FieldGuidance
            hint={FIELD_HINTS.contrarianBeliefs}
            warning={(draft.contrarianBeliefs || []).map(getFieldWarning).find(Boolean) || null}
          />
          <StrategyListEditor
            label="Primary Focus"
            values={draft.primaryFocus || []}
            onChange={(next) => setDraft((prev) => ({ ...prev, primaryFocus: next }))}
          />
          <FieldGuidance
            hint={FIELD_HINTS.primaryFocus}
            warning={(draft.primaryFocus || []).map(getFieldWarning).find(Boolean) || null}
          />
          <StrategyListEditor
            label="Differentiation"
            values={draft.differentiation || []}
            onChange={(next) => setDraft((prev) => ({ ...prev, differentiation: next }))}
          />
          <FieldGuidance
            hint={FIELD_HINTS.differentiation}
            warning={(draft.differentiation || []).map(getFieldWarning).find(Boolean) || null}
          />
          <StrategyListEditor
            label="Typical Angles"
            values={draft.typicalAngles || []}
            onChange={(next) => setDraft((prev) => ({ ...prev, typicalAngles: next }))}
          />
          <FieldGuidance
            hint={FIELD_HINTS.typicalAngles}
            warning={(draft.typicalAngles || []).map(getFieldWarning).find(Boolean) || null}
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveStrategy}
              disabled={isSaving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Strategy'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(normalizeStrategyProfile(profile));
                setIsEditing(false);
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        hasStrategy && (
          <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Worldview</div>
              <p className="mt-2 text-sm leading-6 text-gray-800">{draft.worldview || '-'}</p>
              <FieldGuidance
                hint={FIELD_HINTS.worldview}
                warning={getFieldWarning(draft.worldview || '')}
              />
            </div>
            {[
              { key: 'contrarianBeliefs', label: 'Contrarian Beliefs', values: draft.contrarianBeliefs || [] },
              { key: 'primaryFocus', label: 'Primary Focus', values: draft.primaryFocus || [] },
              { key: 'differentiation', label: 'Differentiation', values: draft.differentiation || [] },
              { key: 'typicalAngles', label: 'Typical Angles', values: draft.typicalAngles || [] },
            ].map((section) => (
              <div key={section.label}>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">{section.label}</div>
                {section.values.length > 0 ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-800">
                    {section.values.map((item, index) => (
                      <li key={`${section.label}-${index}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">-</p>
                )}
                <FieldGuidance
                  hint={FIELD_HINTS[section.key as keyof typeof FIELD_HINTS]}
                  warning={section.values.map(getFieldWarning).find(Boolean) || null}
                />
              </div>
            ))}
          </div>
        )
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isEditing && (
          <button
            type="button"
            onClick={() => {
              setPreviousStrategy(normalizeStrategyProfile(profile));
              setSaveComparison(null);
              setIsEditing(true);
            }}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit Strategy
          </button>
        )}
        <button
          type="button"
          onClick={regenerateStrategy}
          disabled={isRegenerating}
          className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50"
        >
          {isRegenerating ? 'Regenerating...' : 'Regenerate from Website'}
        </button>
        {isLocked && (
          <span className="text-xs text-gray-500">
            Automatic refinement will not overwrite this strategy profile unless you confirm a regeneration override.
          </span>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium text-gray-900">This strategy shapes your generated content</div>
            <p className="mt-1 text-xs text-gray-500">
              Review a recent example to see where your contrarian angle, ICP framing, or differentiation shows up.
            </p>
          </div>
          <button
            type="button"
            onClick={openExampleOutput}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            View Example Output
          </button>
        </div>
      </div>

      {isExampleOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Strategy in Recent Content</h4>
                <p className="mt-1 text-sm text-gray-600">
                  Highlighted phrases show where your strategy profile appears in existing content.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsExampleOpen(false)}
                className="text-2xl leading-none text-gray-400 hover:text-gray-700"
                aria-label="Close example output"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              {isLoadingExample ? (
                <p className="text-sm text-gray-500">Loading recent content...</p>
              ) : exampleError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {exampleError}
                </div>
              ) : exampleSample ? (
                <>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                      {exampleSample.content_type || 'content'}
                    </div>
                    <h5 className="mt-1 text-lg font-semibold text-gray-900">{exampleSample.title || 'Latest content'}</h5>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    {renderHighlightedText(extractSampleText(exampleSample), highlightPhrases)}
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Strategy signals checked</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {highlightPhrases.length > 0 ? highlightPhrases.map((phrase) => (
                        <span
                          key={phrase}
                          className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900"
                        >
                          {phrase}
                        </span>
                      )) : (
                        <span className="text-sm text-gray-500">No highlightable strategy phrases available yet.</span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">No recent company content is available yet.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
