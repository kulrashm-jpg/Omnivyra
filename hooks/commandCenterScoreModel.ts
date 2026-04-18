import { READINESS_FEATURES } from '../config/readinessFeatures';
import type { FeatureStatus } from '../backend/services/commandCenterReadinessService';

export interface ScoreActivity {
  key: string;
  label: string;
  points: number;
  score: number;
  status: 'done' | 'in_progress' | 'missing';
  href: string;
}

export interface ScoreSection {
  title: string;
  color: string;
  items: ScoreActivity[];
}

export interface ScoreSummary {
  completedCount: number;
  inProgressCount: number;
  totalCount: number;
}

type SectionDef = {
  title: string;
  color: string;
  items: Array<{ key: string; label: string; points: number; href: string }>;
};

const SETUP_SECTIONS: SectionDef[] = [
  {
    title: 'Identity',
    color: '#3b82f6',
    items: [
      { key: 'company_profile_completed', label: 'Company profile (name/industry/size)', points: 30, href: '/company-profile' },
      { key: 'website_connected', label: 'Website connected', points: 20, href: '/company-profile' },
    ],
  },
  {
    title: 'Social',
    color: '#06b6d4',
    items: [{ key: 'social_accounts_connected', label: 'Social accounts connected', points: 30, href: '/social-platforms' }],
  },
  {
    title: 'Tools',
    color: '#f59e0b',
    items: [
      { key: 'api_configured', label: 'API keys configured', points: 10, href: '/external-apis' },
      { key: 'chrome_extension_installed', label: 'Chrome extension installed', points: 10, href: '/integrations' },
    ],
  },
];

const MASTERY_SECTIONS: SectionDef[] = [
  {
    title: 'Reports',
    color: '#6366f1',
    items: [{ key: 'report_generated', label: 'Reports generated', points: 30, href: '/reports' }],
  },
  {
    title: 'Content',
    color: '#ec4899',
    items: [{ key: 'blog_created', label: 'Content created', points: 35, href: '/command-center/content' }],
  },
  {
    title: 'Campaigns',
    color: '#f97316',
    items: [
      { key: 'social_accounts_connected', label: 'Integrations explored', points: 12, href: '/social-platforms' },
      { key: 'campaign_created', label: 'Campaign created', points: 12, href: '/command-center/campaigns' },
      { key: 'campaign_published', label: 'Campaign published', points: 11, href: '/campaigns' },
    ],
  },
];

const READINESS_FEATURE_LINKS: Record<string, string> = {
  company_profile_completed: '/company-profile',
  website_connected: '/company-profile',
  social_accounts_connected: '/social-platforms',
  blog_created: '/command-center/content',
  report_generated: '/reports',
  campaign_created: '/command-center/campaigns',
  campaign_published: '/campaigns',
  chrome_extension_installed: '/integrations',
  api_configured: '/external-apis',
};

function getFeature(features: FeatureStatus[], key: string) {
  return features.find((feature) => feature.key === key);
}

function getStatus(score: number, status?: FeatureStatus['status']): ScoreActivity['status'] {
  if (status === 'completed' || score >= 1) return 'done';
  if (status === 'in_progress' || score > 0) return 'in_progress';
  return 'missing';
}

function buildSections(defs: SectionDef[], features: FeatureStatus[]): ScoreSection[] {
  return defs.map((section) => ({
    title: section.title,
    color: section.color,
    items: section.items.map((item) => {
      const feature = getFeature(features, item.key);
      const score = feature?.score ?? 0;

      return {
        ...item,
        score,
        status: getStatus(score, feature?.status),
        href: item.href,
      };
    }),
  }));
}

export function buildSetupSections(features: FeatureStatus[]): ScoreSection[] {
  return buildSections(SETUP_SECTIONS, features);
}

export function buildMasterySections(features: FeatureStatus[]): ScoreSection[] {
  return buildSections(MASTERY_SECTIONS, features);
}

export function buildReadinessSections(features: FeatureStatus[]): ScoreSection[] {
  const sections = new Map<string, ScoreSection>();

  READINESS_FEATURES.forEach((item) => {
    const feature = getFeature(features, item.key);
    const score = feature?.score ?? 0;
    const existing = sections.get(item.section);
    const nextItem: ScoreActivity = {
      key: item.key,
      label: item.label,
      points: item.weight,
      score,
      status: getStatus(score, feature?.status),
      href: READINESS_FEATURE_LINKS[item.key] || '/command-center',
    };

    if (existing) {
      existing.items.push(nextItem);
      return;
    }

    sections.set(item.section, {
      title: item.section,
      color: item.color,
      items: [nextItem],
    });
  });

  return [...sections.values()];
}

export function scoreSections(sections: ScoreSection[]): number {
  const all = sections.flatMap((section) => section.items);
  const total = all.reduce((sum, item) => sum + item.points, 0);
  const earned = all.reduce((sum, item) => sum + item.score * item.points, 0);
  return total === 0 ? 0 : Math.round((earned / total) * 100);
}

export function summarizeSections(sections: ScoreSection[]): ScoreSummary {
  const all = sections.flatMap((section) => section.items);
  return {
    completedCount: all.filter((item) => item.status === 'done').length,
    inProgressCount: all.filter((item) => item.status === 'in_progress').length,
    totalCount: all.length,
  };
}
