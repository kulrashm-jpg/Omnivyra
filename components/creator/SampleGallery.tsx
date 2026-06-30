'use client';

/**
 * SampleGallery — now a thin scope-configured use of the ONE canonical
 * TemplateDiscovery capability (CREATOR-144). It no longer owns card/search/details/
 * preview logic (those exist exactly once in TemplateDiscovery); it just renders the
 * SYSTEM scope for a goal+family and adapts the template_id selection back to its
 * existing `onUse(template)` callers (the creation workspaces). The "advanced browser"
 * link is gone — TemplateDiscovery IS the full browser (the merge).
 */

import React from 'react';
import type { CreatorTemplate, TemplateAssetFamily } from '../../lib/creator-templates/types';
import { CURATED_SYSTEM_TEMPLATES } from '../../lib/creator-outcomes/curatedSystemTemplates';
import { TemplateDiscovery } from './TemplateDiscovery';

export function SampleGallery({ goalId, goalLabel, family, onUse, onBack, onAdvanced }: {
  goalId: string | null;
  goalLabel?: string;
  family?: TemplateAssetFamily;
  onUse: (template: CreatorTemplate) => void;
  onBack?: () => void;
  /** Deprecated — TemplateDiscovery is the full browser; kept for call-site compatibility. */
  onAdvanced?: () => void;
}) {
  void onAdvanced;
  const byId = (id: string): CreatorTemplate | null => CURATED_SYSTEM_TEMPLATES.find((t) => t.id === id) ?? null;
  return (
    <TemplateDiscovery
      scopes={['SYSTEM']}
      initialScope="SYSTEM"
      family={family}
      goalId={goalId}
      goalLabel={goalLabel}
      title="Pick an example you like"
      onSelect={(id) => { const t = byId(id); if (t) onUse(t); }}
      onBack={onBack}
    />
  );
}
