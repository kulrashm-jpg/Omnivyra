// Shared types used across html sub-modules

export type TemplateChoice =
  | 'best_omnivyra_final_report_template.html'
  | 'omnivyra_snapshot_master_report.html'
  | 'omnivyra_snapshot_compact_report_template.html'
  | 'omnivyra_decision_flow_report_template.html'
  | 'omnivyra_visual_intelligence_report_template.html'
  | 'omnivyra_execution_endgame_report_template.html'
  | 'best_signal_rich_report_template.html'
  | 'best_sparse_signal_report_template.html'
  | 'best_balanced_report_template.html'
  | 'best_executive_report_template.html';

export type BrandProfile = {
  companyName: string;
  websiteUrl: string;
  primaryFocus: string;
  executiveSummary: string;
  confidenceSummary: string;
  scoreSummary: string;
  trustSummary: string;
  conversionSummary: string;
  ctaText: string;
};

export type DerivedDataSource = {
  source: 'gsc' | 'content_coverage' | 'backlinks' | 'ai_visibility' | 'competitor_intelligence' | 'analytics';
  name: string;
  status: 'missing' | 'partial' | 'connected';
  confidence: 'low' | 'medium' | 'high';
  currentState: string;
  impact: string;
  unlocks: string[];
  usedInSections: string[];
  priority: 'high' | 'medium' | 'low';
};

export type SnapshotSectionStatus = 'complete' | 'partial' | 'missing';

export type SnapshotSectionSpec = {
  id: string;
  title: string;
  status: SnapshotSectionStatus;
  html: string;
};
