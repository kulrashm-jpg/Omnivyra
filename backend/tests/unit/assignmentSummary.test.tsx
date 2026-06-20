/**
 * @jest-environment jsdom
 *
 * Phase 6G-2 (refined) — AssignmentSummary panel render test.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { AssignmentSummary } from '@/components/bolt/AssignmentSummary';
import type { AssignmentDecision } from '@/lib/shared/intelligence/assignmentExplanation';

const DECISIONS: AssignmentDecision[] = [
  { format: 'video', platform: 'youtube', action: 'ALLOWED', reason: 'youtube supports video content.' },
  { format: 'tweet', platform: 'x', action: 'RESTRICTED', reason: 'tweet is exclusive to x/twitter.' },
  { format: 'carousel', platform: 'youtube', action: 'REMOVED', reason: 'youtube does not support carousel content.' },
];

describe('6G-2 — AssignmentSummary panel', () => {
  test('renders supported + removed groups with reasons', () => {
    render(<AssignmentSummary decisions={DECISIONS} />);
    expect(screen.getByText(/Supported assignments/)).toBeInTheDocument();
    expect(screen.getByText(/Removed assignments/)).toBeInTheDocument();
    expect(screen.getByText(/youtube does not support carousel content/)).toBeInTheDocument();
    expect(screen.getByText(/tweet is exclusive to x\/twitter/)).toBeInTheDocument();
    expect(screen.getByText('video → youtube')).toBeInTheDocument();
  });

  test('renders nothing when there are no decisions', () => {
    const { container } = render(<AssignmentSummary decisions={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
