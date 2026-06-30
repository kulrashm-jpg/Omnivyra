'use client';

/**
 * SampleGallery — the end-user outcome chooser. As of CREATOR-UX-001 it renders the
 * outcome-first OutcomeGallery (one outcome per screen, dominant preview, plain language,
 * single action) instead of the TemplateDiscovery marketplace grid. The canonical
 * TemplateDiscovery power-browser is unchanged and remains available for multi-scope/ops use;
 * this flow deliberately does not expose it to normal users. The `onUse(template)` contract
 * for the two creation workspaces is preserved exactly.
 */

import React from 'react';
import type { CreatorTemplate, TemplateAssetFamily } from '../../lib/creator-templates/types';
import { OutcomeGallery } from './OutcomeGallery';

export function SampleGallery({ goalId, goalLabel, family, onUse, onBack, onAdvanced }: {
  goalId: string | null;
  goalLabel?: string;
  family?: TemplateAssetFamily;
  onUse: (template: CreatorTemplate) => void;
  onBack?: () => void;
  /** Deprecated — the advanced browser is no longer surfaced in the end-user flow. */
  onAdvanced?: () => void;
}) {
  void onAdvanced;
  return (
    <OutcomeGallery
      goalId={goalId}
      goalLabel={goalLabel}
      family={family}
      onUse={onUse}
      onBack={onBack}
    />
  );
}
