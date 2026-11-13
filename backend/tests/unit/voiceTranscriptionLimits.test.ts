import {
  MAX_AUDIO_BYTES, creditsForSeconds, decodedAudioBytes, exceedsDurationLimit, exceedsPreCallSizeBound,
} from '../../services/voice/transcriptionLimits';

describe('voice transcription limits', () => {
  it('duration: 5:00 and 5:01 (tolerance 1 s) pass; above 301 s is refused', () => {
    expect(exceedsDurationLimit(300)).toBe(false);
    expect(exceedsDurationLimit(301)).toBe(false);
    expect(exceedsDurationLimit(301.01)).toBe(true);
  });
  it('size bound = 5 min x 32 kbps x 1.1', () => {
    expect(MAX_AUDIO_BYTES).toBe(1_320_000);
    const atBound = 'data:audio/webm;base64,' + Buffer.alloc(MAX_AUDIO_BYTES).toString('base64');
    const over = 'data:audio/webm;base64,' + Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64');
    expect(decodedAudioBytes(atBound)).toBe(MAX_AUDIO_BYTES);
    expect(exceedsPreCallSizeBound(atBound)).toBe(false);
    expect(exceedsPreCallSizeBound(over)).toBe(true);
    expect(exceedsPreCallSizeBound(Buffer.alloc(10))).toBe(false);
  });
  it('credits: max(1, ceil(seconds x perMin / 60))', () => {
    expect(creditsForSeconds(300, 14)).toBe(70);
    expect(creditsForSeconds(1, 14)).toBe(1);
    expect(creditsForSeconds(0, 14)).toBe(1);
    expect(creditsForSeconds(61, 14)).toBe(15);
  });
});
