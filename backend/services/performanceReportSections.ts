export const performanceSections = [
  'key_decisions',
  'funnel',
  'conversions',
  'top_pages',
  'drop_offs',
  'traffic_sources',
] as const;

export type PerformanceSectionKey = typeof performanceSections[number];
