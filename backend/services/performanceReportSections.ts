export const performanceSections = [
  // Pre-drill calibration: "What matters most" surfaces at the top of every
  // report so the reader sees risks/opportunities/next-steps before being
  // walked through individual sections.
  'what_matters_most',
  'report_quality',
  'snapshot_foundation',
  'key_decisions',
  'funnel',
  'conversions',
  'behavior_quality',
  'organic_search',
  'top_pages',
  'drop_offs',
  'traffic_sources',
  'competitive_pressure',
] as const;

export type PerformanceSectionKey = typeof performanceSections[number];
