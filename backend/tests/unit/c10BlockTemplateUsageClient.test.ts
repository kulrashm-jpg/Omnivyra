/**
 * C10: the client helper the three template pages call on "use this template".
 * One use = exactly one POST; no saved template = no call; a failure is
 * REPORTED (console.error with the template id), never swallowed.
 */
import { recordBlockTemplateUse } from '../../../lib/client/recordBlockTemplateUse';

const CO = '00000000-0000-4000-8000-0000000000aa';
const TPL = '00000000-0000-4000-8000-0000000000c1';

describe('recordBlockTemplateUse (client)', () => {
  it('one use = exactly ONE POST to the template, tenant on the query, keepalive set', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    expect(await recordBlockTemplateUse(CO, TPL, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(`/api/block-templates/${TPL}?company_id=${CO}`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', keepalive: true });
  });

  it('no saved template (a built-in layout) or no company = no call', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await recordBlockTemplateUse(CO, null, fetchImpl)).toBe(false);
    expect(await recordBlockTemplateUse(null, TPL, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a non-2xx or a network failure is reported, not swallowed', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await recordBlockTemplateUse(CO, TPL, (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch)).toBe(false);
    expect(await recordBlockTemplateUse(CO, TPL, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1]).toMatchObject({ templateId: TPL, status: 503 });
    expect(spy.mock.calls[1][1]).toMatchObject({ templateId: TPL, error: 'offline' });
    spy.mockRestore();
  });
});
