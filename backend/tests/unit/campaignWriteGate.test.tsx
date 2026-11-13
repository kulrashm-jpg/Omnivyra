/**
 * @jest-environment jsdom
 *
 * F3b: campaign CREATION pages (BOLT Text / Creator / Intelligent Mix / Strategic Mix) show
 * AccessRestricted to Viewers, view-only users and Engagers, and never mount the creation
 * screen (so its hooks never fetch or generate). Writers get the page.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

let ctx: Record<string, unknown> = {};
jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ctx }));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn(), query: {}, pathname: '/' }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children }: any) => <a href={href}>{children}</a> }));

import CampaignWriteGate from '../../../components/access/CampaignWriteGate';

const ready = (userRole: string | null) => ({ authChecked: true, isLoading: false, companiesResolved: true, userRole });
const Screen = () => <div data-testid="creation-screen" />;

describe('CampaignWriteGate', () => {
  it.each(['VIEWER', 'VIEW_ONLY', 'CONTENT_ENGAGER', 'SOMETHING_UNKNOWN'])('%s: AccessRestricted, the screen never mounts', (role) => {
    ctx = ready(role);
    render(<CampaignWriteGate><Screen /></CampaignWriteGate>);
    expect(screen.queryByTestId('creation-screen')).toBeNull();
    expect(screen.getByText(/You don.t have access to campaign creation/)).toBeInTheDocument();
  });
  it.each(['CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER', 'COMPANY_ADMIN', 'SUPER_ADMIN', 'CONTENT_ARCHITECT'])('%s: the creation screen', (role) => {
    ctx = ready(role);
    render(<CampaignWriteGate><Screen /></CampaignWriteGate>);
    expect(screen.getByTestId('creation-screen')).toBeInTheDocument();
  });
  it('while the role is still loading: neither the screen nor the refusal', () => {
    ctx = { authChecked: true, isLoading: false, companiesResolved: false, userRole: null };
    render(<CampaignWriteGate><Screen /></CampaignWriteGate>);
    expect(screen.queryByTestId('creation-screen')).toBeNull();
    expect(screen.queryByText(/have access/)).toBeNull();
  });
});

describe('every campaign creation page is wrapped in the gate', () => {
  const fs = require('fs') as typeof import('fs');
  const read = (p: string) => fs.readFileSync(require('path').join(process.cwd(), p), 'utf8');
  it.each([
    'pages/command-center/bolt-text.tsx',
    'pages/command-center/bolt-creator-strategy.tsx',
    'pages/command-center/bolt-combined-strategy.tsx',
    'pages/campaign-planner.tsx',
  ])('%s', (p) => {
    expect(read(p)).toMatch(/<CampaignWriteGate>\s*<\w+ \/>\s*<\/CampaignWriteGate>/);
  });
  it('Intelligent Mix renders the gated combined page', () => {
    expect(read('pages/command-center/intelligent-mix-strategy.tsx')).toMatch(/return <BoltCombinedStrategyPage \/>;/);
  });
});
