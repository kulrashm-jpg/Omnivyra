import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronRight, Home } from 'lucide-react';
import { HOME_ROUTE } from './homeRoute';

const ROUTE_LABELS: Record<string, string> = {
  'command-center': 'Command Center',
  dashboard: 'Dashboard',
  blogs: 'Blogs',
  create: 'Create',
  edit: 'Edit',
  'content-studio': 'Content Studio',
  'content-creation': 'Content',
  campaigns: 'Campaigns',
  'campaign-planner': 'Strategic Mix Planner',
  'campaign-details': 'Campaign Details',
  engagement: 'Engagement',
  reports: 'Reports',
  recommendations: 'Recommendations',
  analytics: 'Analytics',
  leads: 'Active Leads',
  'bolt-text-strategy': 'BOLT (Text)',
  'bolt-creator-strategy': 'Creator Strategy',
  'intelligent-mix-strategy': 'Multi-Channel Campaigns',
};

function getLabel(segment: string): string {
  return (
    ROUTE_LABELS[segment] ||
    segment
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

const Breadcrumbs: React.FC = () => {
  const router = useRouter();
  const segments = router.pathname
    .split('/')
    .filter(Boolean)
    .filter((segment) => !segment.startsWith('['));

  if (segments.length <= 1) return null;

  const crumbs = segments.map((segment, index) => ({
    label: getLabel(segment),
    href: '/' + segments.slice(0, index + 1).join('/'),
    isLast: index === segments.length - 1,
  }));

  const cleanedCrumbs = crumbs.filter((crumb, index) => {
    // D2: the Home icon already IS the Command Center, so don't repeat it as a crumb.
    if (index === 0 && crumb.href === HOME_ROUTE) return false;
    return true;
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-slate-400">
      <Link href={HOME_ROUTE} aria-label="Home (Command Center)" className="rounded-md p-1 transition-colors hover:bg-slate-100 hover:text-slate-600">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {cleanedCrumbs.map((crumb) => (
        <React.Fragment key={crumb.href}>
          <ChevronRight className="h-3 w-3" />
          {crumb.isLast ? (
            <span className="font-medium text-slate-600">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="transition-colors hover:text-slate-600">
              {crumb.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
