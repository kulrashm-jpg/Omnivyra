/**
 * CLASS-2 B9 (e9 sweep): the webhook processor hands each template status event Meta's own event
 * time (entry.time, unix seconds) so events apply in EVENT order, and a status event that failed to
 * apply makes the JOB fail (BullMQ retries it) instead of being logged and dropped - a lost PAUSED /
 * DISABLED left the template sendable. The other events in the payload are processed first, and the
 * retry carries ONLY the failed template changes (job.updateData): updateRecipientDelivery is not
 * idempotent (each run increments the broadcast's delivered / read counters), so a whole-payload
 * retry would count them twice.
 */
const mockHandle = jest.fn();
const mockDelivery = jest.fn();

jest.mock('../../services/whatsappTemplateService', () => ({
  handleTemplateStatusWebhook: (...a: unknown[]) => mockHandle(...a),
}));
jest.mock('../../services/whatsappBroadcastService', () => ({
  updateRecipientDelivery: (...a: unknown[]) => mockDelivery(...a),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no db in this suite'); } } }));

import { processWhatsAppWebhookJob } from '../../queue/jobProcessors/whatsappWebhookProcessor';

type FakeJob = { data: { payload: { entry: unknown[] } }; updateData: jest.Mock };
function job(entries: unknown[]): FakeJob {
  const j: FakeJob = { data: { payload: { entry: entries } }, updateData: jest.fn() };
  j.updateData.mockImplementation(async (d: FakeJob['data']) => { j.data = d; }); // as BullMQ: the retry sees it
  return j;
}
const run = (j: FakeJob) => processWhatsAppWebhookJob(j as never);
const templateChange = (event: string, id = 'meta-1') => ({
  field: 'message_template_status_update',
  value: { message_template_id: id, message_template_name: 'hello', event },
});

beforeEach(() => {
  mockHandle.mockReset().mockResolvedValue(undefined);
  mockDelivery.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('passes Meta\'s event time (entry.time, seconds) as event_at', async () => {
  await run(job([{ time: 1794477000, changes: [templateChange('PAUSED')] }]));
  expect(mockHandle).toHaveBeenCalledWith(expect.objectContaining({ event: 'PAUSED', event_at: new Date(1794477000 * 1000) }));
});

it('no usable entry.time -> event_at null (the service then REFUSES the event, logged by name)', async () => {
  await run(job([{ changes: [templateChange('PAUSED')] }, { time: 'x', changes: [templateChange('DISABLED')] }]));
  expect(mockHandle.mock.calls.map((c) => (c[0] as { event_at: unknown }).event_at)).toEqual([null, null]);
});

it('a template status event that FAILS to apply fails the job (retried) - after the rest of the payload ran', async () => {
  const boom = new Error('Template PAUSED not applied: timeout');
  mockHandle.mockRejectedValueOnce(boom);
  await expect(run(job([
    { time: 1794477000, changes: [templateChange('PAUSED', 'meta-1'), templateChange('APPROVED', 'meta-2')] },
    { time: 1794477001, changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] },
  ]))).rejects.toBe(boom);
  expect(mockHandle).toHaveBeenCalledTimes(2); // the second template event still applied
  expect(mockDelivery).toHaveBeenCalledTimes(1); // and the later entry's delivery update
});

it('05 (c): the RETRY carries only the failed template change - each effect happens exactly once across both runs', async () => {
  const boom = new Error('Template PAUSED not applied: timeout');
  mockHandle.mockRejectedValueOnce(boom);
  const j = job([
    { id: 'waba-1', time: 1794477000, changes: [templateChange('PAUSED', 'meta-1'), templateChange('APPROVED', 'meta-2')] },
    { id: 'waba-1', time: 1794477001, changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] },
  ]);
  await expect(run(j)).rejects.toBe(boom);
  expect(j.data.payload.entry).toEqual([{ id: 'waba-1', time: 1794477000, changes: [templateChange('PAUSED', 'meta-1')] }]);
  await expect(run(j)).resolves.toBeUndefined(); // BullMQ's retry, with the narrowed data
  expect(mockDelivery).toHaveBeenCalledTimes(1); // counted ONCE, not again on the retry
  expect(mockHandle.mock.calls.map((c) => (c[0] as { message_template_id: string; event: string }).message_template_id + ':' + (c[0] as { event: string }).event))
    .toEqual(['meta-1:PAUSED', 'meta-2:APPROVED', 'meta-1:PAUSED']); // meta-2 not re-applied; meta-1 retried with its time
  expect(mockHandle.mock.calls[2][0]).toMatchObject({ event_at: new Date(1794477000 * 1000) });
});

it('narrowing the retry FAILS: still thrown (a sendable stopped template is worse than a double count), logged by name', async () => {
  const boom = new Error('Template PAUSED not applied: timeout');
  mockHandle.mockRejectedValueOnce(boom);
  const j = job([{ time: 1794477000, changes: [templateChange('PAUSED')] }]);
  j.updateData.mockRejectedValueOnce(new Error('redis down'));
  await expect(run(j)).rejects.toBe(boom);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WA_WEBHOOK_RETRY_NARROW_FAILED'), expect.any(Error));
});

it('NEGATIVE CONTROL: every event applies -> the job succeeds', async () => {
  await expect(run(job([{ time: 1794477000, changes: [templateChange('APPROVED')] }]))).resolves.toBeUndefined();
});
