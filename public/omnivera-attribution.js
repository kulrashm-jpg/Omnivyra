/*!
 * Omnivyra universal attribution SDK
 * Lightweight, framework-agnostic (works in React/Vue/Angular/Next.js/plain
 * HTML/CMS embeds). DOES NOT replace omnivera-tracker.js; it complements it
 * by persisting + propagating a cross-domain attribution token across SPA
 * routes, embedded iframes, and outbound links.
 *
 * Tenant safety: tokens carry an opaque company id; verification is
 * server-side via /api/website-intelligence/attribution-handoff (action=verify).
 * Append-only / replay-safe: the receiving endpoint enforces nonce uniqueness.
 *
 * Consent gating: if localStorage 'omnivera_consent' is the literal string
 * 'denied', the SDK becomes a no-op for capture/persistence/queue. Tokens
 * already in storage are NOT exfiltrated and outbound link tagging is skipped.
 *
 * Public API:
 *   window.OmnivyraAttribution.init({ tokenParam: '_attr', autoTagLinks: true,
 *     iframeOrigin: 'https://your-marketing-site.com', observeMutations: true,
 *     observeShadowRoots: true, offlineQueue: true })
 *   window.OmnivyraAttribution.getToken()        → captured token (string|null)
 *   window.OmnivyraAttribution.attach(url)       → url with _attr appended if available
 *   window.OmnivyraAttribution.recordConversion({ formId, fields })  → POST /api/leads
 *   window.OmnivyraAttribution.flushQueue()      → drain offline-queued conversions
 */
(function (g) {
  if (g.OmnivyraAttribution) return; // idempotent re-init
  var STORAGE_KEY = 'omnivyra_attr_token';
  var QUEUE_KEY = 'omnivyra_attr_queue';
  var CONSENT_KEY = 'omnivera_consent';
  var STORAGE_TTL_MS = 30 * 60 * 1000; // mirror server default
  var QUEUE_MAX = 50; // cap to avoid runaway storage
  var cfg = {
    tokenParam: '_attr',
    autoTagLinks: true,
    iframeOrigin: null,
    observeMutations: true,
    observeShadowRoots: true,
    offlineQueue: true,
  };
  var observer = null;
  var shadowObservers = [];
  var queueFlushing = false;

  function now() { return Date.now(); }

  function consentDenied() {
    try {
      return g.localStorage && g.localStorage.getItem(CONSENT_KEY) === 'denied';
    } catch (e) { return false; }
  }

  function readToken() {
    try {
      var raw = g.localStorage && g.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.t || !obj.exp || obj.exp < now()) return null;
      return obj.t;
    } catch (e) { return null; }
  }

  function writeToken(token, ttlMs) {
    if (consentDenied()) return;
    try {
      var payload = { t: token, exp: now() + (ttlMs || STORAGE_TTL_MS) };
      if (g.localStorage) g.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      // Cookie fallback for cross-subdomain consumers (path=/; sameSite=lax).
      var maxAge = Math.floor((ttlMs || STORAGE_TTL_MS) / 1000);
      g.document.cookie =
        STORAGE_KEY + '=' + encodeURIComponent(token) +
        '; max-age=' + maxAge + '; path=/; samesite=lax';
    } catch (e) { /* best-effort */ }
  }

  function captureFromQuery() {
    if (consentDenied()) return null;
    try {
      var u = new URL(g.location.href);
      var t = u.searchParams.get(cfg.tokenParam);
      if (t) {
        writeToken(t);
        // Clean the URL so the token doesn't leak via referrer/share.
        u.searchParams.delete(cfg.tokenParam);
        g.history.replaceState(null, '', u.toString());
        return t;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function attach(url) {
    if (consentDenied()) return url;
    var t = readToken();
    if (!t) return url;
    try {
      var u = new URL(url, g.location.href);
      // Only attach if not already present (idempotent).
      if (!u.searchParams.get(cfg.tokenParam)) u.searchParams.set(cfg.tokenParam, t);
      return u.toString();
    } catch (e) { return url; }
  }

  function tagOutboundLinksIn(root) {
    if (!cfg.autoTagLinks) return;
    if (consentDenied()) return;
    var anchors;
    try { anchors = (root || g.document).querySelectorAll('a[href]'); }
    catch (e) { return; }
    for (var i = 0; i < anchors.length; i += 1) {
      var a = anchors[i];
      var href = a.getAttribute('href');
      if (!href || href.indexOf('#') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) continue;
      try {
        var u = new URL(href, g.location.href);
        if (u.hostname && u.hostname !== g.location.hostname) {
          a.setAttribute('href', attach(href));
        }
      } catch (e) { /* skip malformed */ }
    }
  }

  function tagOutboundLinks() {
    tagOutboundLinksIn(g.document);
    if (cfg.observeShadowRoots) {
      walkShadowRoots(g.document, function (sr) { tagOutboundLinksIn(sr); });
    }
  }

  function walkShadowRoots(root, fn) {
    // Walk open shadow roots only (closed roots are inaccessible by design).
    var all;
    try { all = root.querySelectorAll('*'); } catch (e) { return; }
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el && el.shadowRoot) {
        try { fn(el.shadowRoot); } catch (e) {}
        // Recurse into nested open shadow roots.
        walkShadowRoots(el.shadowRoot, fn);
      }
    }
  }

  function watchSpaRoutes() {
    // Token persists in storage; re-tag links after each route change so
    // dynamically rendered anchors get the attribution param.
    var orig = g.history.pushState;
    g.history.pushState = function () {
      var r = orig.apply(this, arguments);
      try { tagOutboundLinks(); } catch (e) {}
      return r;
    };
    g.addEventListener('popstate', function () { try { tagOutboundLinks(); } catch (e) {} });
  }

  function setupMutationObserver() {
    if (!cfg.observeMutations) return;
    if (typeof g.MutationObserver !== 'function') return;
    if (observer) return;
    var pending = false;
    observer = new g.MutationObserver(function () {
      // Coalesce multiple mutations into a single rAF-scheduled re-tag.
      if (pending) return;
      pending = true;
      var raf = g.requestAnimationFrame || function (cb) { return g.setTimeout(cb, 16); };
      raf(function () { pending = false; try { tagOutboundLinks(); attachShadowRootObservers(); } catch (e) {} });
    });
    try {
      observer.observe(g.document.documentElement || g.document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href'],
      });
    } catch (e) {}
  }

  function attachShadowRootObservers() {
    // Attach a sub-observer to each newly-discovered open shadow root so
    // dynamic inserts inside a custom element are re-tagged on the next frame.
    if (!cfg.observeShadowRoots) return;
    if (typeof g.MutationObserver !== 'function') return;
    walkShadowRoots(g.document, function (sr) {
      // De-dupe: keep a flag on the shadowRoot host to avoid double-observe.
      if (sr.__omnivyraObserved) return;
      sr.__omnivyraObserved = true;
      var subPending = false;
      var sub = new g.MutationObserver(function () {
        if (subPending) return;
        subPending = true;
        var raf = g.requestAnimationFrame || function (cb) { return g.setTimeout(cb, 16); };
        raf(function () { subPending = false; try { tagOutboundLinksIn(sr); } catch (e) {} });
      });
      try { sub.observe(sr, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] }); }
      catch (e) {}
      shadowObservers.push(sub);
    });
  }

  function setupIframeBridge() {
    // Parent → embedded iframe: respond to "omnivyra:request_token" with the
    // current token. Iframe → parent: same. Origin-gated when configured.
    g.addEventListener('message', function (ev) {
      if (!ev || !ev.data) return;
      if (cfg.iframeOrigin && ev.origin !== cfg.iframeOrigin) return;
      var d = ev.data;
      if (d && d.type === 'omnivyra:request_token') {
        if (consentDenied()) return;
        var t = readToken();
        if (ev.source && typeof ev.source.postMessage === 'function') {
          try { ev.source.postMessage({ type: 'omnivyra:token', token: t }, cfg.iframeOrigin || '*'); } catch (e) {}
        }
      }
      if (d && d.type === 'omnivyra:token' && typeof d.token === 'string') {
        writeToken(d.token);
      }
    }, false);
  }

  // ── Offline queue ─────────────────────────────────────────────────────────
  function readQueue() {
    try {
      var raw = g.localStorage && g.localStorage.getItem(QUEUE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function writeQueue(arr) {
    try {
      if (!g.localStorage) return;
      var trimmed = arr.length > QUEUE_MAX ? arr.slice(arr.length - QUEUE_MAX) : arr;
      g.localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
    } catch (e) { /* storage full / blocked */ }
  }
  function enqueue(body) {
    if (!cfg.offlineQueue) return;
    if (consentDenied()) return;
    var q = readQueue();
    q.push({ body: body, ts: now() });
    writeQueue(q);
  }
  function postLead(body) {
    return fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
  }
  function flushQueue() {
    if (queueFlushing) return Promise.resolve();
    if (consentDenied()) return Promise.resolve();
    if (typeof g.navigator !== 'undefined' && g.navigator.onLine === false) return Promise.resolve();
    queueFlushing = true;
    var q = readQueue();
    if (q.length === 0) { queueFlushing = false; return Promise.resolve(); }
    var remaining = q.slice();
    return (function drain() {
      if (remaining.length === 0) {
        writeQueue([]); queueFlushing = false; return;
      }
      var head = remaining[0];
      return postLead(head.body).then(function (res) {
        if (res && (res.ok || (res.status >= 200 && res.status < 300))) {
          remaining.shift();
          writeQueue(remaining);
          return drain();
        }
        // Non-2xx: stop draining to avoid burning quota; keep queue intact.
        writeQueue(remaining);
        queueFlushing = false;
      }).catch(function () {
        // Network failure → leave queue as-is; will retry on next 'online'.
        writeQueue(remaining);
        queueFlushing = false;
      });
    })();
  }
  function setupQueueListeners() {
    if (!cfg.offlineQueue) return;
    g.addEventListener('online', function () { try { flushQueue(); } catch (e) {} });
    // Best-effort drain on init + on visibility change (mobile background→foreground).
    g.addEventListener('visibilitychange', function () {
      if (g.document.visibilityState === 'visible') { try { flushQueue(); } catch (e) {} }
    });
  }

  function recordConversion(opts) {
    var body = {
      form_id: opts && opts.formId,
      attribution_token: readToken(),
      fields: (opts && opts.fields) || {},
    };
    // POSTs to the EXISTING /api/leads (embedded mode) — does NOT introduce
    // a parallel ingestion path; SDK only attaches the attribution token so
    // the existing writer can lineage-link the conversion.
    // If consent denied → do not send and do not queue.
    if (consentDenied()) return Promise.resolve(null);
    // If offline → queue and return a resolved placeholder.
    if (cfg.offlineQueue && typeof g.navigator !== 'undefined' && g.navigator.onLine === false) {
      enqueue(body);
      return Promise.resolve({ queued: true });
    }
    return postLead(body).then(function (res) {
      // If the request failed AND offline-queue is enabled, queue for retry.
      if (cfg.offlineQueue && (!res || !res.ok)) { enqueue(body); }
      return res;
    }).catch(function (err) {
      if (cfg.offlineQueue) enqueue(body);
      throw err;
    });
  }

  g.OmnivyraAttribution = {
    init: function (options) {
      cfg = Object.assign({}, cfg, options || {});
      if (!consentDenied()) {
        captureFromQuery();
        tagOutboundLinks();
        watchSpaRoutes();
        setupIframeBridge();
        setupMutationObserver();
        attachShadowRootObservers();
      }
      setupQueueListeners();
      // Best-effort drain on init.
      try { flushQueue(); } catch (e) {}
      return this;
    },
    getToken: readToken,
    attach: attach,
    recordConversion: recordConversion,
    flushQueue: flushQueue,
  };
})(typeof window !== 'undefined' ? window : globalThis);
