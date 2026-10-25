'use client';

/**
 * "More versions in this look" (PR5). Generates a few versions of the current
 * brief with the chosen look locked, each varying composition / subject / angle.
 * Renders nothing unless a look is chosen for an image.
 */

import React from 'react';
import { getVisualDirection } from '../../lib/content/guidedCreativeDirection';
import { DEFAULT_LOOK_VARIATION_COUNT, runLookVariations } from '../../lib/variants/lookVariationRunner';

export default function LookVariationsButton(props: {
  lookId: string | null | undefined;
  disabled?: boolean;
  /** The normal generation payload for the current form state, or null when the brief is incomplete. */
  buildPayload: () => Record<string, unknown> | null;
}) {
  const [inFlight, setInFlight] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const look = getVisualDirection(props.lookId ?? null, 'image');
  if (!look) return null;

  const onClick = async () => {
    const basePayload = props.buildPayload();
    if (!basePayload) {
      setSummary('Please answer the main topic question first.');
      return;
    }
    setInFlight(true);
    setSummary(`Generating version 1 of ${DEFAULT_LOOK_VARIATION_COUNT}…`);
    try {
      const result = await runLookVariations({
        basePayload,
        lookId: look.id,
        count: DEFAULT_LOOK_VARIATION_COUNT,
        onProgress: (done, total) => {
          if (done < total) setSummary(`Generating version ${done + 1} of ${total}…`);
        },
      });
      setSummary(
        `${result.successCount} of ${result.outcomes.length} versions in the ${look.title} look generated — find them in your saved assets.`
        + (result.failureCount > 0 ? ` ${result.failureCount} failed.` : ''),
      );
    } catch (err) {
      setSummary(err instanceof Error ? err.message : 'Could not generate more versions.');
    } finally {
      setInFlight(false);
    }
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => { void onClick(); }}
        disabled={inFlight || props.disabled}
        className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        title={`Generate ${DEFAULT_LOOK_VARIATION_COUNT} more versions that keep the ${look.title} look and give each one its own setting, composition and viewpoint. Each version is inspired by the look's sample — a new, original image, not a copy of it.`}
      >
        {inFlight ? 'Generating versions…' : 'More versions in this look'}
      </button>
      {summary ? <span className="text-xs text-gray-600" role="status">{summary}</span> : null}
    </div>
  );
}
