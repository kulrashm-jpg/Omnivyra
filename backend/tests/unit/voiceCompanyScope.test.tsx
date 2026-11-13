/**
 * @jest-environment jsdom
 *
 * Paired with 55's server change (transcribe requires a company, 400 COMPANY_REQUIRED):
 * every client call to /api/voice/transcribe sends the ACTIVE company, and Viewers /
 * view-only users get no mic (Engagers keep it; e9 + owner ruling).
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

let ctx: Record<string, unknown> = {};
jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ctx }));

import ChatVoiceButton from '../../../components/ChatVoiceButton';

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'api') walk(p, out); }
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
/** Each fetch('/api/voice/transcribe', …) call: does its body (next ~400 chars) carry companyId? */
function transcribeCalls(src: string): Array<{ at: number; sendsCompany: boolean }> {
  const out: Array<{ at: number; sendsCompany: boolean }> = [];
  const re = /fetch\(\s*['"`]\/api\/voice\/transcribe['"`]/g;
  for (const m of src.matchAll(re)) {
    const body = src.slice(m.index!, m.index! + 400);
    out.push({ at: m.index!, sendsCompany: /\bcompanyId\s*:/.test(body) });
  }
  return out;
}

describe('every transcribe caller sends the active company', () => {
  const files = ['components', 'hooks', 'pages', 'lib'].flatMap((d) => walk(path.join(ROOT, d)));
  const callers = files.filter((f) => transcribeCalls(fs.readFileSync(f, 'utf8')).length > 0);
  it('finds the known callers (non-empty set)', () => {
    const rel = callers.map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort();
    expect(rel).toEqual(['components/ChatVoiceButton.tsx', 'components/VoiceNotesComponent.tsx']);
  });
  it.each(['components/ChatVoiceButton.tsx', 'components/VoiceNotesComponent.tsx'])('%s', (rel) => {
    const calls = transcribeCalls(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.sendsCompany)).toBe(true);
  });
  it('positive control: a raw call without companyId is caught', () => {
    const fixture = "await fetch('/api/voice/transcribe', { method: 'POST', body: JSON.stringify({ audioFile, provider: 'whisper', context }) });";
    expect(transcribeCalls(fixture)).toEqual([{ at: 6, sendsCompany: false }]);
  });
  it('the company sent is the SELECTED company', () => {
    expect(fs.readFileSync(path.join(ROOT, 'components/ChatVoiceButton.tsx'), 'utf8')).toMatch(/companyIdRef\.current = selectedCompanyId;[\s\S]*companyId: companyIdRef\.current/);
    expect(fs.readFileSync(path.join(ROOT, 'components/VoiceNotesComponent.tsx'), 'utf8')).toMatch(/const \{ selectedCompanyId, userRole \} = useCompanyContext\(\);[\s\S]*companyId: selectedCompanyId,/);
  });
});

describe('no active company: no call, a clear state (55: the server never infers it)', () => {
  it('the mic is disabled and says to select a company', () => {
    ctx = { selectedCompanyId: '', userRole: 'COMPANY_ADMIN' };
    render(<ChatVoiceButton onTranscription={() => undefined} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Select a company to use voice');
  });
});

describe('the mic follows the role', () => {
  it.each(['VIEWER', 'VIEW_ONLY'])('%s: no mic', (role) => {
    ctx = { selectedCompanyId: 'c1', userRole: role };
    const { container } = render(<ChatVoiceButton onTranscription={() => undefined} />);
    expect(container.innerHTML).toBe('');
  });
  it.each(['CONTENT_ENGAGER', 'CONTENT_CREATOR', 'COMPANY_ADMIN', 'SUPER_ADMIN'])('%s: mic shown', (role) => {
    ctx = { selectedCompanyId: 'c1', userRole: role };
    render(<ChatVoiceButton onTranscription={() => undefined} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('recording limits (e9: bitrate pinned for the server size bound; 5-minute cap)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  it('both recorders use the ONE shared 32 kbit/s constant', () => {
    expect(read('components/ChatVoiceButton.tsx')).toMatch(/export const AUDIO_BITS_PER_SECOND = 32_000;/);
    expect(read('components/VoiceNotesComponent.tsx')).toMatch(/audioBitsPerSecond: AUDIO_BITS_PER_SECOND,/);
    for (const rel of ['components/ChatVoiceButton.tsx', 'components/VoiceNotesComponent.tsx']) {
      expect(read(rel)).not.toMatch(/audioBitsPerSecond:\s*\d/);
    }
  });
  it('VoiceNotes auto-stops at the shared 5-minute cap and says so', () => {
    const v = read('components/VoiceNotesComponent.tsx');
    expect(v).toMatch(/capTimerRef\.current = setTimeout\(\(\) => \{\s*if \(recorder\.state !== 'inactive'\) recorder\.stop\(\);[\s\S]{0,200}\}, MAX_RECORDING_MS\);/);
    expect(v).toContain('Recordings are limited to 5 minutes');
  });
  it('a 413 (incl. AUDIO_TOO_LONG) becomes a plain sentence, never a code', async () => {
    const { transcriptionErrorMessage, MAX_RECORDING_MS } = await import('../../../components/ChatVoiceButton');
    expect(MAX_RECORDING_MS).toBe(5 * 60 * 1000);
    const msg = transcriptionErrorMessage(413, 'AUDIO_TOO_LONG');
    expect(msg).toBe('That recording was too long to send. Keep voice notes under 5 minutes, or split them.');
    expect(msg).not.toMatch(/AUDIO_TOO_LONG|413/);
  });
});
