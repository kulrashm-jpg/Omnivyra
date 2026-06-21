import {
  getVideoFormatsForPlatform,
  isValidPlatformVideoFormat,
  platformSupportsVideo,
  normalizeVideoPlatform,
} from '../../../lib/shared/videoFormatCapabilities';

describe('videoFormatCapabilities — platform × format governance', () => {
  it('exposes the spec format set per platform', () => {
    expect(getVideoFormatsForPlatform('instagram')).toEqual(['Reel']);
    expect(getVideoFormatsForPlatform('facebook')).toEqual(['Reel', 'Video']);
    expect(getVideoFormatsForPlatform('youtube')).toEqual(['Short', 'Long Video']);
    expect(getVideoFormatsForPlatform('tiktok')).toEqual(['Short Video']);
    expect(getVideoFormatsForPlatform('linkedin')).toEqual(['Video']);
    expect(getVideoFormatsForPlatform('pinterest')).toEqual(['Video Pin']);
    expect(getVideoFormatsForPlatform('x')).toEqual(['Video']);
  });

  it('normalizes twitter → x', () => {
    expect(normalizeVideoPlatform('twitter')).toBe('x');
    expect(getVideoFormatsForPlatform('twitter')).toEqual(['Video']);
  });

  it('rejects the spec invalid combinations (fail-closed)', () => {
    expect(isValidPlatformVideoFormat('instagram', 'Long Video')).toBe(false);
    expect(isValidPlatformVideoFormat('tiktok', 'Long Video')).toBe(false);
    expect(isValidPlatformVideoFormat('youtube', 'Reel')).toBe(false);
    expect(isValidPlatformVideoFormat('instagram', '')).toBe(false);
    expect(isValidPlatformVideoFormat('unknown', 'Video')).toBe(false);
  });

  it('accepts the spec valid combinations', () => {
    expect(isValidPlatformVideoFormat('youtube', 'Short')).toBe(true);
    expect(isValidPlatformVideoFormat('youtube', 'Long Video')).toBe(true);
    expect(isValidPlatformVideoFormat('instagram', 'Reel')).toBe(true);
    expect(isValidPlatformVideoFormat('facebook', 'Video')).toBe(true);
    expect(isValidPlatformVideoFormat('tiktok', 'Short Video')).toBe(true);
  });

  it('reports video support', () => {
    expect(platformSupportsVideo('youtube')).toBe(true);
    expect(platformSupportsVideo('unknown')).toBe(false);
  });
});
