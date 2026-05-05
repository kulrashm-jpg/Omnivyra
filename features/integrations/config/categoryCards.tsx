import React from 'react';
import { BarChart3, Database, Files, Globe, Plug } from 'lucide-react';
import type { FocusArea, Integration, IntegrationAction } from '../types';

export interface CategoryCard {
  id: string;
  focus: FocusArea;
  title: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  badgeClassName: string;
  items: string[];
  actions: IntegrationAction[];
}

// Pure factory: presentation config for the category-grid section.
export function buildCategoryCards(
  isAdmin: boolean,
  openModal: (m: { mode: 'create' | 'edit'; integration?: Integration }) => void,
): CategoryCard[] {
  return [
    {
      id: 'website-publishing',
      focus: 'website',
      title: 'Website Publishing',
      description: 'Choose where blogs and site content should publish once content is ready.',
      badge: 'Live now',
      icon: <Globe className="h-5 w-5" />,
      badgeClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      items: ['WordPress publishing', 'Custom blog API endpoints', 'Website content delivery'],
      actions: [
        { label: 'Manage website publishing', href: '#website-publishing-section' },
        ...(isAdmin ? [{ label: 'Add WordPress', onClick: () => openModal({ mode: 'create', integration: { type: 'wordpress' } as Integration }), tone: 'secondary' as const }] : []),
      ],
    },
    {
      id: 'lead-capture-forms',
      focus: 'website',
      title: 'Lead Capture Forms',
      description: 'Control how the website or landing pages collect leads and where those leads flow next.',
      badge: 'Live now',
      icon: <Plug className="h-5 w-5" />,
      badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      items: ['Hosted lead capture pages', 'Embeddable website forms', 'Webhook delivery to downstream tools'],
      actions: [
        { label: 'Open forms workspace', href: '/leads?tab=forms' },
        { label: 'Open webhook setup', href: '/leads?tab=connections' },
      ],
    },
    {
      id: 'crm-pipeline',
      focus: 'data',
      title: 'CRM & Pipeline',
      description: 'Bring deal, account, and owner context into the product so growth work can use real pipeline state.',
      badge: 'Planned next',
      icon: <Database className="h-5 w-5" />,
      badgeClassName: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      items: ['CRM account sync', 'Lead and deal stage mapping', 'Owner and revenue context'],
      actions: [],
    },
    {
      id: 'google-analytics',
      focus: 'data',
      title: 'Google Analytics',
      description: 'Connect your Google Analytics account to track traffic, user behavior, and performance insights.',
      badge: 'Live now',
      icon: <BarChart3 className="h-5 w-5" />,
      badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      items: ['Sessions and traffic sources', 'Page views and engagement', 'Conversion events'],
      actions: [],
    },
    {
      id: 'files-imports',
      focus: 'data',
      title: 'Files & Imports',
      description: 'Use external files when leads, calling reports, or manual business inputs still live outside APIs.',
      badge: 'Planned next',
      icon: <Files className="h-5 w-5" />,
      badgeClassName: 'border-violet-200 bg-violet-50 text-violet-700',
      items: ['CSV and spreadsheet uploads', 'Calling and outreach reports', 'Email lead lists and manual dumps'],
      actions: [],
    },
  ];
}
