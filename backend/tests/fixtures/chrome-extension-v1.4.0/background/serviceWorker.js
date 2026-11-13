// VENDORED EXCERPTS of extension v1.4.0 background/serviceWorker.js (test fixture only; see README.md). Not runnable.
// ---- background/serviceWorker.js L31-31 md5=dcb959996863370b502cd4756c8ea1cb
const DEFAULT_API_BASE_URL = 'https://www.omnivyra.com';
// ---- background/serviceWorker.js L128-128 md5=1ff43383a038d90796b0235dd8b0e215
const PRODUCTION_EXTENSION_ID = 'khlballmijciomdbigljpafliajdekbg';
// ---- background/serviceWorker.js L141-180 md5=59a687d1bbfe7afd17b4d872cc9f8303
function isDevelopmentBuild() {
  try {
    const id = chrome?.runtime?.id;
    if (!id) return false;
    return id !== PRODUCTION_EXTENSION_ID;
  } catch (_) {
    return false;
  }
}

// Dev fallback: when the SW has no HMAC secret AND apiBaseUrl points at
// production (the default), try to detect a localhost dev server via the
// user's open tabs. If a localhost:3000 / 127.0.0.1:3000 tab is open we
// assume the user is running Omnivyra in dev mode and use that as the API
// base for this request. Combined with DEV_EXTENSION_AUTH_BYPASS=1 on the
// backend, this lets dev work without re-redeeming on every SW restart.
//
// PRODUCTION SAFETY: this scans every open tab and, on a hit, retargets
// Omnivyra API traffic — including organization_id — to that origin, unsigned.
// It is therefore hard-disabled outside a developer build. The guard is
// repeated at each call site as well; this one is the backstop.
async function resolveDevLocalhostBase() {
  try {
    if (!isDevelopmentBuild()) return null;
    if (!chrome?.tabs?.query) return null;
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs || []) {
      const u = tab?.url || '';
      const m = u.match(/^https?:\/\/(localhost|127\.0\.0\.1):(\d+)/i);
      if (m) {
        return `http://${m[1]}:${m[2]}`;
      }
    }
  } catch {
    /* tab access denied — fall through */
  }
  return null;
}

function syncApiClientBaseUrl() {
// ---- background/serviceWorker.js L357-357 md5=0dcbd7d2241f51933d7a02dd4462dc96
      const devBase = isDevelopmentBuild() ? await resolveDevLocalhostBase() : null;
// ---- background/serviceWorker.js L1047-1047 md5=2d0e0fa996160f4d04ec99c0331f6287
    const devBase = isDevelopmentBuild() ? await resolveDevLocalhostBase() : null;
