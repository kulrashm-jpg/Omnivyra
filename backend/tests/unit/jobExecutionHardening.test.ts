import { assertCronAuthorized } from '../../utils/cronAuthGuard';
import { JOB_REGISTRY } from '../../jobs/jobRegistry';
import { RETRY_POLICIES } from '../../jobs/retryPolicy';
import {
  assertValidExecutionTransition,
  isTerminalExecutionState,
  normalizeExecutionState,
} from '../../governance/ExecutionStateMachine';
import { assertNoCampaignStateBypass } from '../../services/campaignStateWriteGuard';
import { REQUIRED_EXECUTION_LOG_EVENTS, assertExecutionObservabilityReady } from '../../jobs/observabilityCheck';

describe('cron auth hardening', () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it('fails closed when CRON_SECRET is missing', () => {
    delete process.env.CRON_SECRET;
    expect(() => assertCronAuthorized({ headers: {} } as any)).toThrow('CRON_SECRET is required');
  });

  it('rejects mismatched bearer token', () => {
    process.env.CRON_SECRET = 'secret';
    expect(() => assertCronAuthorized({ headers: { authorization: 'Bearer wrong' } } as any)).toThrow('Unauthorized');
  });

  it('accepts only bearer CRON_SECRET', () => {
    process.env.CRON_SECRET = 'secret';
    expect(() => assertCronAuthorized({ headers: { authorization: 'Bearer secret' } } as any)).not.toThrow();
  });
});

describe('job registry hardening', () => {
  it('has deterministic publish idempotency and lock keys', () => {
    const entry = JOB_REGISTRY.publish;
    const payload = { scheduled_post_id: 'post-1', trigger_source: 'cron' };
    expect(entry.idempotency_key_builder(payload)).toBe(entry.idempotency_key_builder(payload));
    expect(entry.lock_key_builder(payload)).toBe(entry.lock_key_builder(payload));
  });

  it('marks external side-effect jobs as non-replayable', () => {
    expect(JOB_REGISTRY.publish.replayable).toBe(false);
    expect(JOB_REGISTRY.token_refresh.replayable).toBe(false);
    expect(JOB_REGISTRY.campaign_schedule.replayable).toBe(false);
  });

  it('defines retry policies for required side-effect areas', () => {
    expect(RETRY_POLICIES.publish.attempts).toBeGreaterThan(1);
    expect(RETRY_POLICIES.analytics_ingestion.attempts).toBeGreaterThan(1);
    expect(RETRY_POLICIES.campaign_schedule.attempts).toBe(1);
  });
});

describe('campaign state machine', () => {
  it('allows canonical production transitions', () => {
    expect(() => assertValidExecutionTransition('draft', 'proposed')).not.toThrow();
    expect(() => assertValidExecutionTransition('proposed', 'approved')).not.toThrow();
    expect(() => assertValidExecutionTransition('approved', 'committed')).not.toThrow();
    expect(() => assertValidExecutionTransition('committed', 'scheduled')).not.toThrow();
    expect(() => assertValidExecutionTransition('scheduled', 'executing')).not.toThrow();
    expect(() => assertValidExecutionTransition('executing', 'completed')).not.toThrow();
  });

  it('rejects invalid canonical transitions', () => {
    expect(() => assertValidExecutionTransition('draft', 'executing')).toThrow('Illegal execution state transition');
  });

  it('normalizes canonical and terminal states', () => {
    expect(normalizeExecutionState('executing')).toBe('executing');
    expect(normalizeExecutionState('EXECUTING')).toBe('executing');
    expect(isTerminalExecutionState('completed')).toBe(true);
  });
});

describe('final production hardening', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('blocks direct campaign state column writes in production runtime', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNoCampaignStateBypass({ status: 'approved' })).toThrow('CAMPAIGN_STATE_BYPASS_DETECTED:status');
    expect(() => assertNoCampaignStateBypass({ blueprint_status: 'ACTIVE', execution_status: 'scheduled' })).toThrow(
      'CAMPAIGN_STATE_BYPASS_DETECTED:blueprint_status,execution_status',
    );
  });

  it('allows non-state campaign updates through the runtime guard', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertNoCampaignStateBypass({ start_date: '2026-01-01' })).not.toThrow();
  });

  it('has complete execution observability event coverage', () => {
    expect(REQUIRED_EXECUTION_LOG_EVENTS).toEqual([
      'job_started',
      'job_skipped_locked',
      'job_completed',
      'job_failed',
      'job_dlq',
      'job_replayed',
      'campaign_state_transition',
    ]);
    expect(() => assertExecutionObservabilityReady()).not.toThrow();
  });
});
