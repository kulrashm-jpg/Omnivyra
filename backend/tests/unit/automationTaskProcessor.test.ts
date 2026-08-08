/**
 * WS-6D — Automation task processor.
 *
 * The load-bearing assertion is the NO-REBUILD invariant: the processor must
 * consume an already-built AutomationSummary and must never reach
 * `buildAutomationSummary`. Everything else guards the payload contract and the
 * throw-don't-swallow behaviour that retry and the DLQ depend on.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Job } from 'bullmq';
import {
  processAutomationTaskJob,
  assertAutomationPayload,
  AutomationPayloadError,
  type AutomationTaskJobPayload,
} from '../../queue/jobProcessors/automationTaskProcessor';

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const summary = () => ({
  leadId: 'lead-1',
  status: 'ready' as never,
  statusReasons: [],
  executionTimeline: [],
  tasks: [{ id: 't1' }, { id: 't2' }] as never,
  channelSequence: [],
  review: {} as never,
  confidence: 0.9,
  generatedAt: '1970-01-01T00:00:00.000Z',
});

const job = (data: unknown) => ({ id: 'j1', data } as unknown as Job<AutomationTaskJobPayload>);

const SRC = readFileSync(
  join(__dirname, '../../queue/jobProcessors/automationTaskProcessor.ts'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('WS-6D — automation task processor', () => {
  describe('NO-REBUILD invariant', () => {
    // The whole point of the async path: the summary is built ONCE, in the
    // orchestrator. A rebuild here would diverge from the synchronous path that
    // already feeds WS-3.
    it('never references buildAutomationSummary', () => {
      expect(SRC).not.toContain('buildAutomationSummary');
    });

    it('does not import the automationExecution runtime (builder unreachable)', () => {
      expect(SRC).not.toMatch(/import\s+\{[^}]*\}\s+from\s+'[^']*automationExecution'/);
    });

    it('consumes the supplied summary verbatim', async () => {
      const s = summary();
      const out = await processAutomationTaskJob(job({ companyId: 'c-1', summary: s }));
      expect(out).toEqual({
        companyId: 'c-1',
        taskCount: 2,
        status: s.status,
        generatedAt: s.generatedAt,
      });
    });
  });

  describe('payload contract', () => {
    it.each([
      ['missing payload', undefined],
      ['null payload', null],
      ['missing companyId', { summary: summary() }],
      ['blank companyId', { companyId: '  ', summary: summary() }],
      ['missing summary', { companyId: 'c-1' }],
      ['tasks not an array', { companyId: 'c-1', summary: { ...summary(), tasks: 'nope' } }],
      ['missing generatedAt', { companyId: 'c-1', summary: { ...summary(), generatedAt: '' } }],
    ])('rejects %s', (_label, payload) => {
      expect(() => assertAutomationPayload(payload as never)).toThrow(AutomationPayloadError);
    });

    // Throwing is what routes a job to retry and ultimately the DLQ. Swallowing
    // would mark a broken job successful and bypass both.
    it('THROWS rather than swallowing an invalid payload', async () => {
      await expect(processAutomationTaskJob(job({ companyId: 'c-1' }))).rejects.toThrow(
        AutomationPayloadError,
      );
    });
  });

  describe('remains unreachable', () => {
    it('registers no worker and no queue consumer', () => {
      expect(SRC).not.toContain('new Worker');
      expect(SRC).not.toContain('registerSharedConsumers');
    });
  });
});
