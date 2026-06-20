/**
 * @jest-environment jsdom
 *
 * Phase 6H-B — shared ProgressCard render tests.
 *
 * All three builders (BOLT Text / Creator / Intelligent Mix) now render this one
 * component, so testing it proves identical stage / substage / week / failure
 * fidelity across surfaces. Pure UI over the existing BOLTProgress payload.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ProgressCard, type ProgressStep } from '@/components/bolt/ProgressCard';

const TEXT_PIPELINE: ProgressStep[] = [
  { stage: 'source-recommendation', label: 'Preparing week plan' },
  { stage: 'ai/plan', label: 'Creating week plan' },
  { stage: 'commit-plan', label: 'Saving blueprint' },
  { stage: 'generate-weekly-structure', label: 'Creating daily plans' },
];
const COMBINED_PIPELINE: ProgressStep[] = [
  { stage: 'source-recommendation', label: 'Analysing signals' },
  { stage: 'ai/plan', label: 'Creating campaign plan' },
  { stage: 'commit-plan', label: 'Saving blueprint' },
  { stage: 'generate-weekly-structure', label: 'Building daily activities' },
  { stage: 'schedule-structured-plan', label: 'Scheduling content' },
];

const NOW = 1_700_000_000_000;

describe('6H-B — ProgressCard (shared renderer)', () => {
  test('renders the stage checklist (Text + Combined pipelines)', () => {
    const { rerender } = render(
      <ProgressCard progress={{ stage: 'ai/plan', status: 'running', progress_percentage: 25 }} pipeline={TEXT_PIPELINE} startedAt={NOW} />,
    );
    expect(screen.getByText('Creating week plan')).toBeInTheDocument();
    expect(screen.getByText('Saving blueprint')).toBeInTheDocument();

    rerender(
      <ProgressCard progress={{ stage: 'ai/plan', status: 'running', progress_percentage: 25 }} pipeline={COMBINED_PIPELINE} startedAt={NOW} />,
    );
    expect(screen.getByText('Creating campaign plan')).toBeInTheDocument();
    expect(screen.getByText('Scheduling content')).toBeInTheDocument();
  });

  test('substage: ai/plan substage tip is shown while on ai/plan', () => {
    render(
      <ProgressCard
        progress={{ stage: 'ai/plan:drafting', status: 'running', progress_percentage: 22, ai_plan_substage: 'drafting' }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText(/Drafting weekly themes/)).toBeInTheDocument();
  });

  test('week counter: weeks_generated + slots are surfaced', () => {
    render(
      <ProgressCard
        progress={{ stage: 'generate-weekly-structure', status: 'running', progress_percentage: 55, weeks_generated: 2, daily_slots_created: 8 }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText(/2w generated/)).toBeInTheDocument();
    expect(screen.getByText(/8 slots/)).toBeInTheDocument();
  });

  test('failure: shows failed header + friendly error_message', () => {
    render(
      <ProgressCard
        progress={{ stage: 'schedule-structured-plan', status: 'failed', progress_percentage: 83, error_message: 'We couldn’t schedule the generated content.' }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText('BOLT failed')).toBeInTheDocument();
    expect(screen.getByText('We couldn’t schedule the generated content.')).toBeInTheDocument();
  });

  test('6H-D failure: renders failed stage label + error code', () => {
    render(
      <ProgressCard
        progress={{
          stage: 'generate-weekly-structure', status: 'failed', progress_percentage: 55,
          error_message: 'We couldn’t generate the daily plan for one or more weeks.',
          failed_stage: 'generate-weekly-structure',
          failed_stage_label: 'Creating daily plans',
          error_code: 'DAILY_PLAN_ROW_GENERATION_FAILED',
        }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText('Stage:')).toBeInTheDocument();
    expect(screen.getByText('Creating daily plans')).toBeInTheDocument();
    expect(screen.getByText(/We couldn’t generate the daily plan/)).toBeInTheDocument();
    expect(screen.getByText('Code: DAILY_PLAN_ROW_GENERATION_FAILED')).toBeInTheDocument();
  });

  test('6H-D failure: stage shown, NO code line when error_code absent', () => {
    render(
      <ProgressCard
        progress={{ status: 'failed', progress_percentage: 50, error_message: 'It failed.', failed_stage_label: 'Validating inputs' }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText('Validating inputs')).toBeInTheDocument();
    expect(screen.queryByText(/^Code:/)).not.toBeInTheDocument();
  });

  test('6H-D failure: only friendly fields rendered (no raw error exposed)', () => {
    // BOLTProgress carries only friendly fields; ProgressCard never reads
    // raw_error_message/stack/SQL. Render shows just the friendly message.
    render(
      <ProgressCard
        progress={{ status: 'failed', progress_percentage: 50, error_message: 'A friendly message.' }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText('A friendly message.')).toBeInTheDocument();
    expect(screen.queryByText(/Stage:/)).not.toBeInTheDocument(); // no stage when none provided
    expect(screen.queryByText(/^Code:/)).not.toBeInTheDocument();
  });

  test('completed: shows 100% complete state', () => {
    render(
      <ProgressCard
        progress={{ stage: 'schedule-structured-plan', status: 'completed', progress_percentage: 100 }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
      />,
    );
    expect(screen.getByText('BOLT complete!')).toBeInTheDocument();
    expect(screen.getByText(/Heading to calendar/)).toBeInTheDocument();
  });

  test('content jobs: queue progress rendered when present', () => {
    render(
      <ProgressCard
        progress={{ stage: 'schedule-structured-plan', status: 'running', progress_percentage: 90 }}
        pipeline={COMBINED_PIPELINE}
        startedAt={NOW}
        contentJobs={{ total: 10, done: 4, failed: 0, active: 2, posts_scheduled: 4, estimated_seconds_remaining: 30, is_complete: false }}
      />,
    );
    expect(screen.getByText(/4 of 10 topics scheduled/)).toBeInTheDocument();
  });
});
