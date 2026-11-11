/**
 * The client-side retry decision for a dead-lettered CMS publish (components/blog/publishingIssues).
 * An OUTCOME-UNKNOWN job asks for confirmation FIRST, and the confirmation carries the evidence -
 * the CMS, its last answer and when - so the operator can decide (05). Declining sends nothing.
 * An ordinary failure retries without asking.
 */
import {
  publishingIssueEvidence,
  retryConfirmText,
  retryPublishingIssue,
  type PublishingIssue,
} from '../../../components/blog/publishingIssues';

const issue = (over: Partial<PublishingIssue> = {}): PublishingIssue => ({
  job_id: 'j1', blog_id: 'b1', provider: 'wordpress', job_type: 'publish_post',
  dead_letter_at: '2026-11-12T10:00:00.000Z', last_error: 'Publish outcome unknown ...', outcome_unknown: true,
  last_attempt: { status: 'failed', error_message: 'WordPress returned status 502.', started_at: '2026-11-12T09:59:00.000Z', finished_at: '2026-11-12T10:00:00.000Z' },
  ...over,
});
const okFetch = () => jest.fn(async () => ({ ok: true, json: async () => ({ retried: true }) })) as unknown as jest.Mock;

it('outcome unknown: the confirmation shows the EVIDENCE (CMS, its answer) and warns of a duplicate', () => {
  const text = retryConfirmText(issue())!;
  expect(text).toContain('may ALREADY be live');
  expect(text).toContain('publish it a second time');
  expect(text).toContain('CMS: wordpress');
  expect(text).toContain('CMS answer: WordPress returned status 502.');
  for (const line of publishingIssueEvidence(issue())) expect(text).toContain(line);
});

it('outcome unknown + the operator DECLINES: nothing is sent', async () => {
  const fetch = okFetch();
  const r = await retryPublishingIssue(issue(), 'co-a', { fetch, confirm: () => false });
  expect(r).toMatchObject({ ok: false, cancelled: true });
  expect(fetch).not.toHaveBeenCalled();
});

it('outcome unknown + the operator CONFIRMS: POST with confirm_outcome_unknown true', async () => {
  const fetch = okFetch();
  const confirm = jest.fn(() => true);
  expect(await retryPublishingIssue(issue(), 'co-a', { fetch, confirm })).toEqual({ ok: true });
  expect(confirm).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/api/blogs/publishing-jobs/j1/retry');
  expect(JSON.parse(init.body)).toEqual({ company_id: 'co-a', confirm_outcome_unknown: true });
});

it('NEGATIVE CONTROL: an ordinary failure retries WITHOUT asking, confirm flag false', async () => {
  const fetch = okFetch();
  const confirm = jest.fn(() => true);
  expect(await retryPublishingIssue(issue({ outcome_unknown: false }), 'co-a', { fetch, confirm })).toEqual({ ok: true });
  expect(confirm).not.toHaveBeenCalled();
  expect(JSON.parse(fetch.mock.calls[0][1].body).confirm_outcome_unknown).toBe(false);
});

it('the server refuses: its reason is shown', async () => {
  const fetch = jest.fn(async () => ({ ok: false, json: async () => ({ retried: false, error: 'Only a dead-lettered publishing job can be retried.' }) })) as unknown as typeof globalThis.fetch;
  expect(await retryPublishingIssue(issue({ outcome_unknown: false }), 'co-a', { fetch, confirm: () => true }))
    .toEqual({ ok: false, message: 'Only a dead-lettered publishing job can be retried.' });
});
