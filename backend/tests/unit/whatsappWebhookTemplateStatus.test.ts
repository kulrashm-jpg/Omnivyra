/**
 * CLASS-2 B9 (e9 sweep): the webhook processor hands each template status event Meta's own event
 * time (entry.time, unix seconds) so events apply in EVENT order, and a status event that failed to
 * apply makes the JOB fail (BullMQ retries it) instead of being logged and dropped - a lost PAUSED /
 * DISABLED left the template sendable. The other events in the payload are still processed first;
 * a retry re-runs them, which is safe (inbound messages upsert on (thread_id, platform_message_id);
 * delivery updates re-apply the same status).
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

function job(entries: unknown[]) {
  return { data: { payload: { entry: entries } } } as never;
}
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
  await processWhatsAppWebhookJob(job([{ time: 1794477000, changes: [templateChange('PAUSED')] }]));
  expect(mockHandle).toHaveBeenCalledWith(expect.objectContaining({ event: 'PAUSED', event_at: new Date(1794477000 * 1000) }));
});

it('no usable entry.time -> event_at null (the service applies it at receipt time and warns)', async () => {
  await processWhatsAppWebhookJob(job([{ changes: [templateChange('PAUSED')] }, { time: 'x', changes: [templateChange('DISABLED')] }]));
  expect(mockHandle.mock.calls.map((c) => (c[0] as { event_at: unknown }).event_at)).toEqual([null, null]);
});

it('a template status event that FAILS to apply fails the job (retried) - after the rest of the payload ran', async () => {
  const boom = new Error('Template PAUSED not applied: timeout');
  mockHandle.mockRejectedValueOnce(boom);
  await expect(processWhatsAppWebhookJob(job([
    { time: 1794477000, changes: [templateChange('PAUSED', 'meta-1'), templateChange('APPROVED', 'meta-2')] },
    { time: 1794477001, changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] },
  ]))).rejects.toBe(boom);
  expect(mockHandle).toHaveBeenCalledTimes(2); // the second template event still applied
  expect(mockDelivery).toHaveBeenCalledTimes(1); // and the later entry's delivery update
});

it('NEGATIVE CONTROL: every event applies -> the job succeeds', async () => {
  await expect(processWhatsAppWebhookJob(job([{ time: 1794477000, changes: [templateChange('APPROVED')] }]))).resolves.toBeUndefined();
});
