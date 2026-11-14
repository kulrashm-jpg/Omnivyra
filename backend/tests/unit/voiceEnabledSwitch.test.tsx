/**
 * @jest-environment jsdom
 *
 * e9 (2026-11-14): no mic until voice is charged. The server switch (GET /api/voice/status
 * -> { enabled }) decides, and the client FAILS CLOSED: loading, errors, a missing endpoint
 * or anything but `{ enabled: true }` means no mic and no Record button.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({ selectedCompanyId: 'c1', userRole: 'COMPANY_ADMIN' }),
}));

import ChatVoiceButton from '../../../components/ChatVoiceButton';
import { VOICE_STATUS_URL } from '../../../hooks/useVoiceEnabled';
import { insideWriteGate } from '../helpers/writeGateScan';
import * as fs from 'fs';
import * as path from 'path';

type FetchReply = { ok: boolean; status: number; json: () => Promise<unknown> };
function stubFetch(reply: FetchReply | 'reject') {
  const fn = jest.fn(async (url: string) => {
    if (reply === 'reject') throw new Error('network down');
    expect(url).toBe(VOICE_STATUS_URL);
    return reply;
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}
// A fresh SWR cache per test, so one case's answer never leaks into the next.
const renderButton = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChatVoiceButton onTranscription={() => undefined} />
    </SWRConfig>,
  );

describe('voice switch: the mic appears only when the server says enabled', () => {
  it('enabled: true -> mic shown', async () => {
    const fetchFn = stubFetch({ ok: true, status: 200, json: async () => ({ enabled: true }) });
    renderButton();
    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['enabled: false', { ok: true, status: 200, json: async () => ({ enabled: false }) }],
    ['endpoint missing (404)', { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }],
    ['server error (500)', { ok: false, status: 500, json: async () => ({}) }],
    ['truthy but not true ("yes")', { ok: true, status: 200, json: async () => ({ enabled: 'yes' }) }],
    ['malformed body', { ok: true, status: 200, json: async () => { throw new Error('bad json'); } }],
  ] as Array<[string, FetchReply]>)('%s -> no mic', async (_name, reply) => {
    const fetchFn = stubFetch(reply);
    const { container } = renderButton();
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('network failure -> no mic', async () => {
    const fetchFn = stubFetch('reject');
    const { container } = renderButton();
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('while the status is still loading -> no mic', () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise(() => undefined));
    const { container } = renderButton();
    expect(container.innerHTML).toBe('');
  });
});

describe('voice notes: only RECORDING needs the switch (55: saving a note makes no provider call)', () => {
  const V = fs.readFileSync(path.join(process.cwd(), 'components/VoiceNotesComponent.tsx'), 'utf8');
  it('Record needs the switch AND the role; Delete needs the role only', () => {
    expect(V).toContain('const mayRecord = voiceEnabled && mayManageNotes;');
    expect(insideWriteGate(V, 'onClick={startRecording}', 'mayRecord')).toBe(true);
    expect(insideWriteGate(V, 'onClick={() => deleteVoiceNote(note.id)}', 'mayManageNotes')).toBe(true);
    expect(insideWriteGate(V, 'onClick={() => deleteVoiceNote(note.id)}', 'mayRecord')).toBe(false);
  });
});
