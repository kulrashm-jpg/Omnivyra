/**
 * An ambiguity the engine refused to guess at.
 *
 * ─── A QUESTION, NOT A WARNING ────────────────────────────────────────────
 * `AmbiguityQuestion` always carries at least two options and always includes
 * a way out, because a tenant must never be forced to invent a destination for
 * a column they do not care about (`mappingTypes.ts`). So this renders the
 * engine's own `question` text and its own `options` verbatim — including the
 * `target: null` "ignore" option, which is a first-class answer and is styled
 * like every other choice rather than as a refusal.
 *
 * It does not editorialise. The reason codes get a short plain-language label
 * so a non-engineer knows WHY they are being asked, but the question itself is
 * the engine's, because the engine is the thing that knows.
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import type { AmbiguityQuestionView, AmbiguityReason } from '@/lib/prospects/import/types';

/** Why we are asking, for someone who has never read the registry. */
const REASON_LABELS: Record<AmbiguityReason, string> = {
  polysemous_header: 'This heading has more than one common meaning',
  entity_ambiguous: 'This could describe the person or their employer',
  competing_source_fields: 'Several columns are claiming the same destination',
  composite_field: 'This column looks like it holds more than one value',
  identity_critical: 'This decides who the record is, so it needs confirming',
  schema_drift: 'Your saved mapping no longer matches this file',
};

export default function AmbiguityQuestionCard({
  question,
  selected,
  onAnswer,
}: {
  question: AmbiguityQuestionView;
  /** The currently chosen target, or `null` for ignore. `undefined` = unanswered. */
  selected: string | null | undefined;
  onAnswer: (target: string | null) => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {REASON_LABELS[question.reason]}
          </p>
          <p className="mt-1 text-sm text-gray-800">{question.question}</p>

          <div className="mt-3 space-y-2">
            {question.options.map((option) => {
              const value = option.target === null ? '__ignore__' : option.target;
              const isSelected =
                selected !== undefined &&
                ((selected === null && option.target === null) || selected === option.target);
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border bg-white px-3 py-2 transition ${
                    isSelected
                      ? 'border-purple-400 ring-1 ring-purple-200'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <input
                    type="radio"
                    name={`ambiguity-${question.reason}-${question.question.slice(0, 24)}`}
                    className="mt-1"
                    checked={isSelected}
                    onChange={() => onAnswer(option.target)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                    <span className="block text-xs text-gray-500">{option.rationale}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {selected === undefined ? (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Answer this to continue — or choose to ignore the column.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
