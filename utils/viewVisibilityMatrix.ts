/**
 * Single visibility map by view mode. Use with getViewMode(role).
 * Replaces scattered boolean helpers.
 */

import type { ViewMode } from './getViewMode';

export const VIEW_RULES: Record<
  ViewMode,
  { showCMOLayer: boolean; showCreatorBrief: boolean; showSystemFields: boolean }
> = {
  USER: {
    showCMOLayer: false,
    showCreatorBrief: true,
    showSystemFields: false,
  },
  CREATOR: {
    showCMOLayer: false,
    showCreatorBrief: true,
    showSystemFields: false,
  },
  CMO: {
    showCMOLayer: true,
    showCreatorBrief: false,
    showSystemFields: false,
  },
  CONTENT_MANAGER: {
    showCMOLayer: true,
    showCreatorBrief: true,
    showSystemFields: true,
  },
  SYSTEM: {
    showCMOLayer: true,
    showCreatorBrief: true,
    showSystemFields: true,
  },
};
