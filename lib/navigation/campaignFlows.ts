/**
 * The ONE source for campaign flow names and their owner-approved hints (owner decision
 * 2026-11-13; hints approved verbatim). Section tabs, the Ctrl+K palette, breadcrumbs and
 * page headings read from here, so a name or hint is never copied and cannot drift.
 * (The header menu in GlobalHeaderNav.tsx is deferred to the PI landing.)
 */
export const CAMPAIGN_FLOWS = {
  all: { label: 'All Campaigns', hint: 'See and manage every campaign', href: '/campaigns' },
  boltText: { label: 'BOLT Text', hint: 'Quick text posts in minutes', href: '/command-center/bolt-text' },
  boltCreator: { label: 'BOLT Creator', hint: 'Image, carousel and infographic campaigns', href: '/command-center/bolt-creator-strategy' },
  intelligentMix: { label: 'Intelligent Mix', hint: 'Text and visuals together in one campaign', href: '/command-center/intelligent-mix-strategy' },
  strategicMix: { label: 'Strategic Mix', hint: 'Plan a full campaign step by step, your way', href: '/campaign-planner?mode=direct' },
} as const;
