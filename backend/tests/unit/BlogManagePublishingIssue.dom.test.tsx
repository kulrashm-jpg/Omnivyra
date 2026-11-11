/**
 * @jest-environment jsdom
 *
 * The blog card shows a dead-lettered publish with its evidence and a Retry button (e9). An
 * OUTCOME-UNKNOWN job says the post may already be live and to check the site; an unreadable
 * publishing queue is shown as unavailable, never as "no problems". The hook is stubbed: this pins
 * what the operator SEES and that Retry calls the hook's retry for that blog.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: any) => <a href={href}>{children}</a> }));

import BlogManageView from '../../../components/blog/BlogManageView';

const blog = { id: 'b1', title: 'Spring launch', slug: 'spring', excerpt: 'x', category: 'News', tags: [], status: 'draft', published_at: null, views_count: 0, likes_count: 0, created_at: '2026-11-12' };
const issue = (over: Record<string, unknown> = {}) => ({
  job_id: 'j1', blog_id: 'b1', provider: 'wordpress', job_type: 'publish_post', dead_letter_at: '2026-11-12T10:00:00.000Z',
  last_error: 'x', outcome_unknown: true,
  last_attempt: { status: 'failed', error_message: 'WordPress returned status 502.', started_at: null, finished_at: '2026-11-12T10:00:00.000Z' },
  ...over,
});
const d = (over: Record<string, unknown> = {}): any => ({
  blogs: [blog], filteredBlogs: [blog], canManage: true, deleteId: null, deleting: false, error: '', filter: 'all', loading: false,
  metrics: { total: 1, drafts: 1, published: 0, views: 0 }, ga4Views: {}, analyticsSummary: null, deleteAlsoRemote: false,
  setDeleteAlsoRemote: jest.fn(), setDeleteId: jest.fn(), setFilter: jest.fn(), startCreate: jest.fn(), startEdit: jest.fn(),
  confirmDelete: jest.fn(), reload: jest.fn(),
  publishingIssues: {}, publishingIssuesError: '', retryingJobId: null, retryMessage: '', retryPublish: jest.fn(),
  ...over,
});

it('OUTCOME UNKNOWN: the card says it may already be live, shows the evidence, and Retry calls retryPublish for that blog', () => {
  const props = d({ publishingIssues: { b1: issue() } });
  render(<BlogManageView d={props} />);
  const panel = screen.getByTestId('publishing-issue-b1');
  expect(panel).toHaveTextContent('Publish outcome unknown - the post may already be live');
  expect(panel).toHaveTextContent('CMS: wordpress');
  expect(panel).toHaveTextContent('CMS answer: WordPress returned status 502.');
  expect(panel).toHaveTextContent('Check your site before retrying');
  fireEvent.click(within(panel).getByRole('button', { name: /retry publish/i }));
  expect(props.retryPublish).toHaveBeenCalledWith('b1');
});

it('an ordinary failure: "failed", no check-the-site warning', () => {
  render(<BlogManageView d={d({ publishingIssues: { b1: issue({ outcome_unknown: false }) } })} />);
  const panel = screen.getByTestId('publishing-issue-b1');
  expect(panel).toHaveTextContent('Publishing to wordpress failed');
  expect(panel).not.toHaveTextContent('Check your site');
});

it('a non-admin sees the issue but no Retry button', () => {
  render(<BlogManageView d={d({ canManage: false, publishingIssues: { b1: issue() } })} />);
  expect(screen.getByTestId('publishing-issue-b1')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /retry publish/i })).not.toBeInTheDocument();
});

it('an UNREADABLE publishing queue is shown as unavailable, never as no problems', () => {
  render(<BlogManageView d={d({ publishingIssuesError: 'Could not load publishing issues' })} />);
  expect(screen.getByText(/Publishing status unavailable/)).toBeInTheDocument();
});

it('NEGATIVE CONTROL: no issue for the blog - no panel', () => {
  render(<BlogManageView d={d()} />);
  expect(screen.queryByTestId('publishing-issue-b1')).not.toBeInTheDocument();
});
