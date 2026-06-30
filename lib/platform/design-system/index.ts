/**
 * Canonical module: design-system (CREATOR-137 reference implementation).
 *
 * STYLE only — structurally blind (component refs + composition belong to Blueprint,
 * CREATOR-132). Owns DesignLanguage + Photography + per-component styling. Exposes the
 * canonical module surface (types + validator + serializer) over the foundation. This
 * is the PATTERN every other module follows during its migration.
 *
 * Re-homes the CREATOR-130 contracts (lib/creator-design-system) — those become this
 * module's `types/` and are deleted from their old location during legacy removal.
 */

import type { DesignLanguage, PhotographySystem } from '../../creator-design-system/designSystem';
import {
  type CanonicalModule, type Validatable, type ValidationResult, type CanonicalObject,
  makeSerializer,
} from '../governance/canonicalObject';

export type { DesignLanguage, PhotographySystem };

/** v1.0 DesignSystem payload — STYLE ONLY. `componentStyling` is the sole component
 *  coupling (a per-type variant choice); it carries NO structure. */
export interface DesignSystemData {
  name: string;
  industry?: string;
  designLanguage: DesignLanguage;
  photographySystem?: PhotographySystem;
  componentStyling: Record<string, { variant: string }>;
}

export type DesignSystemObject = CanonicalObject<DesignSystemData>;

/** RULE 10 — the object validates itself; no consumer owns this. */
const validator: Validatable<DesignSystemData> = {
  validate(data): ValidationResult {
    const errors: string[] = [];
    if (!data?.name?.trim()) errors.push('name required');
    if (!data?.designLanguage) errors.push('designLanguage required');
    else {
      if (!data.designLanguage.typography?.family) errors.push('typography.family required');
      if (!data.designLanguage.colorTokens?.primary) errors.push('colorTokens.primary required');
      if (!Array.isArray(data.designLanguage.spacingScale) || data.designLanguage.spacingScale.length === 0) errors.push('spacingScale required');
    }
    if (!data?.componentStyling || typeof data.componentStyling !== 'object') errors.push('componentStyling required');
    return { ok: errors.length === 0, errors };
  },
};

/** The canonical design-system module surface (RULE 1/3). */
export const designSystemModule: CanonicalModule<DesignSystemData> = {
  name: 'design-system',
  validator,
  serializer: makeSerializer<DesignSystemData>(),
};
