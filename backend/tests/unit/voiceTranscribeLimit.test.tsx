/**
 * @jest-environment jsdom
 *
 * Owner 2026-10-26: "Transcription failed" on the chat mic. Prod logs showed
 * /api/voice/transcribe answering 413 — the base64 recording exceeded Next's default
 * 1 MB body limit after ~30-60 s of speech. The route now accepts 4 MB, the mic records
 * at a speech bitrate with a 5-minute cap, and failures say what happened.
 *
 * SECRETS: none. No network.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ChatVoiceButton, { MAX_RECORDING_MS, transcriptionErrorMessage } from '../../../components/ChatVoiceButton';

const ROUTE = fs.readFileSync(path.join(__dirname, '../../../pages/api/voice/transcribe.ts'), 'utf8');

describe('voice transcription fits and explains itself', () => {
  it('the route raises the body limit to 4 MB (under the 4.5 MB platform cap)', () => {
    expect(ROUTE).toMatch(/export const config = \{\s*api: \{\s*bodyParser: \{ sizeLimit: '4mb' \}/);
  });

  it('a 5-minute note at 32 kbps fits the limit as base64', () => {
    const bytes = (32_000 / 8) * (MAX_RECORDING_MS / 1000);
    expect(Math.ceil(bytes / 3) * 4).toBeLessThan(4 * 1024 * 1024);
  });

  it('error messages are specific, never a bare "Transcription failed"', () => {
    expect(transcriptionErrorMessage(413)).toMatch(/too long/);
    expect(transcriptionErrorMessage(429, 'Rate limit: retry in 20s')).toBe('Rate limit: retry in 20s');
    expect(transcriptionErrorMessage(429)).toMatch(/Too many voice notes/);
    expect(transcriptionErrorMessage(401)).toMatch(/sign in again/);
    expect(transcriptionErrorMessage(500)).toBe('Transcription failed — please try again.');
  });

  it('records at the speech bitrate, shows a timer, and stops itself at the cap', async () => {
    jest.useFakeTimers();
    const stop = jest.fn();
    const created: Array<{ options: MediaRecorderOptions | undefined }> = [];
    class FakeRecorder {
      static isTypeSupported = () => true;
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_s: unknown, options?: MediaRecorderOptions) { created.push({ options }); }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; stop(); }
    }
    (global as any).MediaRecorder = FakeRecorder;
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true,
    });

    render(<ChatVoiceButton onTranscription={jest.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(created[0].options?.audioBitsPerSecond).toBe(32_000);
    await act(async () => { jest.advanceTimersByTime(61_000); });
    expect(screen.getByText('1:01')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(MAX_RECORDING_MS); });
    expect(stop).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
