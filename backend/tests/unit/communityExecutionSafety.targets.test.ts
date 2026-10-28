/**
 * Community execution safety — target validation.
 *
 *   - RPA target-URL policy (single source of truth): host, subdomain,
 *     lookalikes, malformed, http, credentials, IP literal, port,
 *     cross-platform, unsupported action, empty / missing allowlist.
 *   - Platform scripts: exactly one commit (submit) step per script, and
 *     like clicks can never toggle an existing like off.
 *   - DM command chains fail closed when no thread / recipient is resolved,
 *     and thread URLs are host-checked and anchored.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('../../queue/bullmqClient', () => ({ withHeavyJobSlot: (fn: () => any) => fn() }));
jest.mock('../../services/platformTokenService', () => ({ getToken: jest.fn() }));

import {
  validateRpaTarget,
  hostMatchesDomains,
  RPA_PLATFORM_URL_POLICY,
} from '../../services/rpaWorker/rpaTargetUrlPolicy';
import { buildScript } from '../../services/rpaWorker/rpaPlatformScripts';
import {
  buildDmCommandChain,
  dmCommandChainRefusal,
  isPlatformDmThreadUrl,
} from '../../services/communityAiActionExecutorContracts';

const v = (platform: string, target_url: string, action_type = 'reply') =>
  validateRpaTarget({ platform, action_type, target_url });

describe('RPA target URL policy', () => {
  it('accepts the exact platform host and proper subdomains', () => {
    expect(v('facebook', 'https://facebook.com/posts/1')).toMatchObject({ ok: true, host: 'facebook.com' });
    expect(v('facebook', 'https://www.facebook.com/posts/1')).toMatchObject({ ok: true });
    expect(v('facebook', 'https://m.facebook.com/story.php?id=1')).toMatchObject({ ok: true });
    expect(v('linkedin', 'https://www.linkedin.com/feed/update/urn:li:activity:1/')).toMatchObject({ ok: true });
    expect(v('twitter', 'https://x.com/a/status/1')).toMatchObject({ ok: true });
    expect(v('twitter', 'https://mobile.twitter.com/a/status/1')).toMatchObject({ ok: true });
    expect(v('reddit', 'https://old.reddit.com/r/x/comments/1/')).toMatchObject({ ok: true });
    expect(v('instagram', 'HTTPS://WWW.INSTAGRAM.COM/p/abc/')).toMatchObject({ ok: true, host: 'www.instagram.com' });
  });

  it('rejects a wrong host', () => {
    expect(v('facebook', 'https://evil.com/facebook.com')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED' });
  });

  it('rejects deceptive suffix and prefix lookalikes', () => {
    expect(v('facebook', 'https://facebook.com.evil.com/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED' });
    expect(v('facebook', 'https://evilfacebook.com/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED' });
    expect(v('facebook', 'https://facebook.co/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED' });
    expect(v('linkedin', 'https://linkedin.com.attacker.io/feed')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HOST_NOT_ALLOWED' });
    expect(v('facebook', 'https://facebook.com./p')).toMatchObject({ ok: false });
    expect(v('facebook', 'https://xn--facebok-y0a.com/p')).toMatchObject({ ok: false });
  });

  it('rejects malformed URLs', () => {
    for (const bad of ['', '   ', 'not a url', 'facebook.com/p', '//facebook.com/p', 'https://', 'https://face book.com/p', 'https://evil.com\\@facebook.com/p']) {
      expect(v('facebook', bad)).toMatchObject({ ok: false });
    }
    expect(v('facebook', 'not a url')).toEqual({ ok: false, error: 'RPA_TARGET_URL_MALFORMED' });
    expect(validateRpaTarget({ platform: 'facebook', action_type: 'reply', target_url: null })).toEqual({ ok: false, error: 'RPA_TARGET_URL_MALFORMED' });
  });

  it('rejects http and other schemes', () => {
    expect(v('facebook', 'http://www.facebook.com/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_NOT_HTTPS' });
    expect(v('facebook', 'javascript:alert(1)')).toMatchObject({ ok: false });
    expect(v('facebook', 'file:///etc/passwd')).toMatchObject({ ok: false });
  });

  it('rejects credentials in the URL', () => {
    expect(v('facebook', 'https://user:pw@www.facebook.com/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HAS_CREDENTIALS' });
    expect(v('facebook', 'https://user@www.facebook.com/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HAS_CREDENTIALS' });
    expect(v('facebook', 'https://@www.facebook.com/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HAS_CREDENTIALS' });
    expect(v('facebook', 'https://www.facebook.com@evil.com/p')).toMatchObject({ ok: false });
  });

  it('rejects IP literals and explicit ports', () => {
    expect(v('facebook', 'https://157.240.1.35/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_IP_LITERAL' });
    expect(v('facebook', 'https://[2a03:2880::1]/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_IP_LITERAL' });
    expect(v('facebook', 'https://2647654435/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_IP_LITERAL' });
    expect(v('facebook', 'https://www.facebook.com:8443/p')).toEqual({ ok: false, error: 'RPA_TARGET_URL_HAS_PORT' });
  });

  it('rejects cross-platform URLs', () => {
    expect(v('facebook', 'https://www.linkedin.com/feed/')).toEqual({ ok: false, error: 'RPA_TARGET_URL_CROSS_PLATFORM' });
    expect(v('twitter', 'https://www.reddit.com/r/x')).toEqual({ ok: false, error: 'RPA_TARGET_URL_CROSS_PLATFORM' });
  });

  it('rejects action types the platform does not support', () => {
    expect(v('facebook', 'https://www.facebook.com/p', 'follow')).toEqual({ ok: false, error: 'RPA_ACTION_NOT_SUPPORTED_FOR_PLATFORM' });
    expect(v('linkedin', 'https://www.linkedin.com/in/x', 'share')).toEqual({ ok: false, error: 'RPA_ACTION_NOT_SUPPORTED_FOR_PLATFORM' });
    expect(v('linkedin', 'https://www.linkedin.com/in/x', 'dm')).toEqual({ ok: false, error: 'RPA_ACTION_NOT_SUPPORTED_FOR_PLATFORM' });
  });

  it('refuses when the allowlist is missing or empty', () => {
    expect(v('youtube', 'https://www.youtube.com/watch?v=1')).toEqual({ ok: false, error: 'RPA_PLATFORM_NOT_ALLOWLISTED' });
    expect(v('', 'https://www.facebook.com/p')).toEqual({ ok: false, error: 'RPA_PLATFORM_NOT_ALLOWLISTED' });
    const empty = { facebook: { domains: [] as string[], actions: ['reply' as const] } };
    expect(validateRpaTarget({ platform: 'facebook', action_type: 'reply', target_url: 'https://www.facebook.com/p' }, empty))
      .toEqual({ ok: false, error: 'RPA_PLATFORM_NOT_ALLOWLISTED' });
    const junk = { facebook: { domains: ['', '.facebook.com', 'facebook.com/'] , actions: ['reply' as const] } };
    expect(validateRpaTarget({ platform: 'facebook', action_type: 'reply', target_url: 'https://www.facebook.com/p' }, junk))
      .toEqual({ ok: false, error: 'RPA_PLATFORM_NOT_ALLOWLISTED' });
    expect(hostMatchesDomains('facebook.com', [])).toBe(false);
    expect(hostMatchesDomains('facebook.com', undefined)).toBe(false);
  });

  it('every RPA script platform has a non-empty allowlist (single source of truth)', () => {
    for (const p of ['linkedin', 'facebook', 'instagram', 'twitter', 'reddit']) {
      expect(RPA_PLATFORM_URL_POLICY[p].domains.length).toBeGreaterThan(0);
    }
  });
});

describe('RPA platform scripts', () => {
  const platforms = ['linkedin', 'facebook', 'instagram', 'twitter', 'reddit'];
  const task = (platform: string, action_type: 'reply' | 'like') => ({
    tenant_id: 't', organization_id: 'o', platform, action_type, action_id: 'a',
    target_url: 'https://www.example.com/x', text: 'hello',
  });

  it('declares exactly one commit (submit) step per script', () => {
    for (const p of platforms) {
      for (const a of ['reply', 'like'] as const) {
        const s = buildScript(task(p, a));
        if ('error' in s) throw new Error(`${p}/${a}: ${s.error}`);
        expect(s.steps.filter((st) => st.commit === true)).toHaveLength(1);
        expect(['click', 'press', 'fill']).toContain(s.steps.find((st) => st.commit === true)!.kind);
      }
    }
  });

  it('like click candidates can never toggle an existing like off', () => {
    for (const p of platforms) {
      const s = buildScript(task(p, 'like'));
      if ('error' in s) throw new Error(s.error);
      const commit = s.steps.find((st) => st.commit === true) as any;
      for (const c of commit.selectors) {
        // Only plain CSS candidates are allowed on the commit click, and each
        // must exclude the pressed / liked state (or target an element whose
        // label/testid flips when liked).
        expect(typeof c).toBe('string');
        const guarded = /:not\(\[aria-pressed="true"\]\)/.test(c)
          || /aria-label="Like"/.test(c)
          || /data-testid="like"/.test(c);
        expect(guarded).toBe(true);
        if (/aria-label\*="Like" i/.test(c)) expect(c).toMatch(/:not\(\[aria-label\*="Unlike" i\]\)/);
      }
    }
  });
});

describe('DM command chains fail closed', () => {
  const dm = (over: Record<string, any>) => ({
    id: 'a', tenant_id: 't', organization_id: 'o', platform: 'linkedin',
    action_type: 'dm' as const, target_id: 'Rajesh Singh', suggested_text: 'hi', ...over,
  });

  it('refuses a LinkedIn DM with no resolved thread or recipient (never the open conversation)', () => {
    expect(buildDmCommandChain(dm({}))).toBeNull();
    expect(dmCommandChainRefusal(dm({}))).toBe('DM_TARGET_UNRESOLVED');
    expect(dmCommandChainRefusal(dm({ target_id: 'https://www.linkedin.com/in/rajesh' }))).toBe('DM_TARGET_UNRESOLVED');
  });

  it('refuses dm_thread_ready with nothing naming the thread', () => {
    const a = dm({ platform: 'facebook', metadata: { dm_thread_ready: true } });
    expect(buildDmCommandChain(a)).toBeNull();
    expect(dmCommandChainRefusal(a)).toBe('DM_TARGET_UNRESOLVED');
  });

  it('accepts an explicit, host-checked thread URL and keeps it on both steps', () => {
    const url = 'https://www.linkedin.com/messaging/thread/2-abcDEF123456/';
    const chain = buildDmCommandChain(dm({ target_id: url }));
    expect(chain).toEqual([
      { action_type: 'open_thread', payload: { threadUrl: url } },
      { action_type: 'continue_thread', payload: { text: 'hi', autoSubmit: true, threadUrl: url } },
    ]);
  });

  it('rejects unanchored / foreign-host thread URLs', () => {
    expect(isPlatformDmThreadUrl('linkedin', 'https://evil.com/linkedin.com/messaging/thread/2-abc/')).toBe(false);
    expect(isPlatformDmThreadUrl('linkedin', 'https://linkedin.com.evil.com/messaging/thread/2-abc/')).toBe(false);
    expect(isPlatformDmThreadUrl('linkedin', 'http://www.linkedin.com/messaging/thread/2-abc/')).toBe(false);
    expect(isPlatformDmThreadUrl('linkedin', 'https://www.linkedin.com/x/messaging/thread/2-abc/')).toBe(false);
    expect(isPlatformDmThreadUrl('facebook', 'https://www.messenger.com/t/123')).toBe(true);
    expect(isPlatformDmThreadUrl('facebook', 'https://www.linkedin.com/messaging/thread/2-abc/')).toBe(false);
    expect(dmCommandChainRefusal(dm({ target_id: 'https://evil.com/linkedin.com/messaging/thread/2-abc/' }))).toBe('DM_TARGET_UNRESOLVED');
    expect(dmCommandChainRefusal(dm({ platform: 'instagram', target_id: 'https://evil.com/instagram.com/direct/t/1' })))
      .toBe('DM_TARGET_URL_NOT_ALLOWED');
    expect(dmCommandChainRefusal(dm({
      metadata: { dm_thread_ready: true, dm_thread_url: 'https://evil.com/messaging/thread/2-abc/' },
    }))).toBe('DM_THREAD_URL_INVALID');
  });

  it('still addresses explicit recipients (handle, participant name)', () => {
    expect(buildDmCommandChain(dm({ platform: 'twitter', target_id: '@someone' }))).toEqual([
      { action_type: 'start_new_dm', payload: { recipientHandle: '@someone', text: 'hi', autoSubmit: true } },
    ]);
    const chain = buildDmCommandChain(dm({ metadata: { dm_thread_ready: true, dm_participant_name: 'Rajesh Singh' } }));
    expect(chain?.[0]).toEqual({ action_type: 'open_thread', payload: { participantName: 'Rajesh Singh' } });
  });
});
