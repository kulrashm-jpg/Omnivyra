/**
 * Omnivyra Blog Intelligence Tracker v4
 *
 * New in v4 — Intent Signals:
 *   cta_click        — button or [data-cta] element clicked
 *   link_click       — outbound link clicked
 *   copy             — text selected & copied (≥30 chars)
 *   form_interaction — first focus inside a <form>
 *
 * Also new in v4:
 *   referrer_source  — hostname of document.referrer (or 'direct')
 *   intent_meta      — JSON with signal-specific detail
 *
 * Retained from v3:
 *   session_id, multi-tab dedup, visibility-aware timer,
 *   session-level pageview dedup, milestone scroll (25/50/75/100%),
 *   5s batch queue + beacon on unload
 */
(function () {
  'use strict';

  var sc = document.currentScript;
  if (!sc) return;

  var accountId = (sc.getAttribute('data-account') || '').trim();
  if (!accountId) return;

  var apiBase  = (sc.getAttribute('data-api') || 'https://app.omnivyra.com').replace(/\/$/, '');
  var endpoint = apiBase + '/api/track';

  // ── Session ID ────────────────────────────────────────────────────────────
  var SES_KEY   = 'omn_session';
  var sessionId = sessionStorage.getItem(SES_KEY);
  if (!sessionId) {
    try { sessionId = crypto.randomUUID(); }
    catch { sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2); }
    sessionStorage.setItem(SES_KEY, sessionId);
  }

  // ── Multi-tab dedup ───────────────────────────────────────────────────────
  var TAB_KEY  = 'omn_tab_' + accountId;
  var TAB_TTL  = 30000;
  var lastTab  = parseInt(localStorage.getItem(TAB_KEY) || '0', 10);
  if ((Date.now() - lastTab) <= TAB_TTL) return; // another tab is active
  localStorage.setItem(TAB_KEY, String(Date.now()));
  var tabHB = setInterval(function () { localStorage.setItem(TAB_KEY, String(Date.now())); }, 15000);

  // ── Referrer source ───────────────────────────────────────────────────────
  var referrerSource = 'direct';
  if (document.referrer) {
    try { referrerSource = new URL(document.referrer).hostname || 'direct'; }
    catch { referrerSource = document.referrer.slice(0, 100); }
  }

  // ── Visibility-aware timer ────────────────────────────────────────────────
  var activeMs    = 0;
  var lastVisible = document.visibilityState !== 'hidden' ? Date.now() : null;
  var leaveSent   = false;

  function pauseTimer() {
    if (lastVisible !== null) { activeMs += Date.now() - lastVisible; lastVisible = null; }
  }
  function resumeTimer() {
    if (lastVisible === null && !leaveSent) lastVisible = Date.now();
  }
  document.addEventListener('visibilitychange', function () {
    document.hidden ? pauseTimer() : resumeTimer();
  });
  function getActiveTime() {
    var extra = lastVisible !== null ? (Date.now() - lastVisible) : 0;
    return Math.round((activeMs + extra) / 1000);
  }

  // ── Scroll milestones ─────────────────────────────────────────────────────
  var milestones = { 25: false, 50: false, 75: false, 100: false };
  function getScroll() {
    var el = document.documentElement;
    var h  = el.scrollHeight - el.clientHeight;
    return h > 0 ? Math.min(100, Math.round((el.scrollTop / h) * 100)) : 100;
  }

  // ── Queue & batching ─────────────────────────────────────────────────────
  var queue = [];

  function enqueue(type, scrollOverride, intentMeta) {
    queue.push({
      account_id:      accountId,
      session_id:      sessionId,
      referrer_source: referrerSource,
      url:             location.href,
      event_type:      type,
      time_on_page:    getActiveTime(),
      scroll_depth:    scrollOverride !== undefined ? scrollOverride : getScroll(),
      timestamp:       new Date().toISOString(),
      intent_meta:     intentMeta || null,
    });
  }

  var flushing = false;
  function flushFetch() {
    if (!queue.length || flushing) return;
    flushing = true;
    var body    = JSON.stringify({ events: queue.splice(0) });
    var attempt = 0;
    (function go() {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
        .catch(function () { if (attempt++ < 2) setTimeout(go, 1000 * attempt); })
        .finally(function () { flushing = false; });
    })();
  }
  function flushBeacon() {
    if (!queue.length) return;
    navigator.sendBeacon(endpoint, new Blob([JSON.stringify({ events: queue.splice(0) })], { type: 'application/json' }));
  }

  var flushTimer = setInterval(flushFetch, 5000);

  // ── Scroll debounce ───────────────────────────────────────────────────────
  var scrollDebounce = null;
  window.addEventListener('scroll', function () {
    clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(function () {
      var pct = getScroll();
      [25, 50, 75, 100].forEach(function (m) {
        if (!milestones[m] && pct >= m) { milestones[m] = true; enqueue('scroll_milestone', m); }
      });
    }, 200);
  }, { passive: true });

  // ── Pageview (session-deduplicated) ───────────────────────────────────────
  var PV_KEY = 'omnivyra_v_' + accountId;
  if (!sessionStorage.getItem(PV_KEY)) {
    sessionStorage.setItem(PV_KEY, '1');
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', function () { enqueue('pageview'); })
      : enqueue('pageview');
  }

  // ── INTENT SIGNALS ────────────────────────────────────────────────────────

  var pageHost = location.hostname;

  // CTA keyword heuristic (case-insensitive)
  var CTA_RE = /\b(get|start|try|sign\s?up|subscribe|download|contact|book|schedule|register|join|demo|free|buy|order|shop|learn\s?more|get\s?started)\b/i;

  document.addEventListener('click', function (e) {
    var el = e.target;

    // ── Outbound link click ──────────────────────────────────────────────
    var anchor = el.closest ? el.closest('a') : null;
    if (anchor && anchor.href) {
      try {
        var lHost = new URL(anchor.href).hostname;
        if (lHost && lHost !== pageHost) {
          enqueue('link_click', undefined, {
            link_url:  anchor.href.slice(0, 200),
            link_text: (anchor.textContent || '').trim().slice(0, 80),
          });
          return; // counted as link_click, not cta_click
        }
      } catch {}
    }

    // ── CTA click — button or [data-cta] ────────────────────────────────
    var btn = el.closest ? el.closest('button, [data-cta], input[type="submit"]') : null;
    if (btn) {
      var text = (btn.textContent || btn.value || '').trim().slice(0, 80);
      if (btn.hasAttribute('data-cta') || CTA_RE.test(text)) {
        enqueue('cta_click', undefined, { element_text: text });
      }
    }
  }, true); // capture phase

  // ── Copy intent ──────────────────────────────────────────────────────────
  document.addEventListener('copy', function () {
    var sel  = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (text.length >= 30) {
      enqueue('copy', undefined, { chars: text.length });
    }
  });

  // ── Form interaction ─────────────────────────────────────────────────────
  document.addEventListener('focusin', function (e) {
    var form = e.target && e.target.closest ? e.target.closest('form') : null;
    if (form && !form._omn) {
      form._omn = true;
      enqueue('form_interaction', undefined, {
        form_id:    form.id   || null,
        form_class: (form.className || '').split(' ')[0] || null,
      });
    }
  }, true);

  // ── Page leave ────────────────────────────────────────────────────────────
  function onLeave() {
    if (leaveSent) return;
    leaveSent = true;
    pauseTimer();
    clearInterval(flushTimer);
    clearInterval(tabHB);
    enqueue('pageleave');
    navigator.sendBeacon ? flushBeacon() : flushFetch();
  }
  window.addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', function () { if (document.hidden) onLeave(); });
})();
