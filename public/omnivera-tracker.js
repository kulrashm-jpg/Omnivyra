(function () {
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  var websiteId = script && script.getAttribute('data-website-id');
  if (!websiteId) return;

  var endpoint = (script && script.getAttribute('data-endpoint')) || '/api/website-events/track';
  var queueKey = 'omnivera_event_queue';
  var maxBatch = 10;
  var flushMs = 5000;
  var memoryQueue = [];

  function read(storage, key) { try { return storage.getItem(key); } catch (_) { return null; } }
  function write(storage, key, value) { try { storage.setItem(key, value); } catch (_) {} }
  function remove(storage, key) { try { storage.removeItem(key); } catch (_) {} }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'ov_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function anon() {
    var existing = read(localStorage, 'omnivera_anonymous_id');
    if (existing) return existing;
    var next = uuid();
    write(localStorage, 'omnivera_anonymous_id', next);
    return next;
  }
  function session() {
    var existing = read(sessionStorage, 'omnivera_session_id');
    if (existing) return existing;
    var next = uuid();
    write(sessionStorage, 'omnivera_session_id', next);
    return next;
  }
  function landing() {
    var existing = read(sessionStorage, 'omnivera_landing_page');
    if (existing) return existing;
    write(sessionStorage, 'omnivera_landing_page', location.href);
    return location.href;
  }
  function touch() {
    var params = new URLSearchParams(location.search);
    var first = read(localStorage, 'omnivera_first_touch');
    var last = {
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content'),
      utm_term: params.get('utm_term'),
      omn_asset_id: params.get('omn_asset_id'),
      omn_variant_id: params.get('omn_variant_id'),
      omn_strategy_id: params.get('omn_strategy_id'),
      referrer: document.referrer || '',
      landing_page: landing(),
      current_page: location.href
    };
    if (!first) write(localStorage, 'omnivera_first_touch', JSON.stringify(last));
    write(localStorage, 'omnivera_last_touch', JSON.stringify(last));
    try { first = JSON.parse(read(localStorage, 'omnivera_first_touch') || '{}'); } catch (_) { first = last; }
    return { first_touch: first, last_touch: last };
  }
  function basePayload() {
    var t = touch();
    var params = new URLSearchParams(location.search);
    return {
      website_id: websiteId,
      anonymous_id: anon(),
      session_id: session(),
      referrer: document.referrer || '',
      landing_page: landing(),
      current_page: location.href,
      consent_state: read(localStorage, 'omnivera_consent') || 'unknown',
      utm_source: params.get('utm_source') || t.last_touch.utm_source,
      utm_medium: params.get('utm_medium') || t.last_touch.utm_medium,
      utm_campaign: params.get('utm_campaign') || t.last_touch.utm_campaign,
      utm_content: params.get('utm_content') || t.last_touch.utm_content,
      utm_term: params.get('utm_term') || t.last_touch.utm_term,
      // Creator identifiers: prefer the current URL, else the first-touch
      // value persisted in localStorage so they survive multi-page journeys.
      omn_asset_id: params.get('omn_asset_id') || t.first_touch.omn_asset_id || t.last_touch.omn_asset_id,
      omn_variant_id: params.get('omn_variant_id') || t.first_touch.omn_variant_id || t.last_touch.omn_variant_id,
      omn_strategy_id: params.get('omn_strategy_id') || t.first_touch.omn_strategy_id || t.last_touch.omn_strategy_id,
      first_touch: t.first_touch,
      last_touch: t.last_touch
    };
  }
  function storedQueue() {
    try { return JSON.parse(localStorage.getItem(queueKey) || '[]'); } catch (_) { return []; }
  }
  function persistQueue(events) {
    try { localStorage.setItem(queueKey, JSON.stringify(events.slice(-100))); } catch (_) {}
  }
  function enqueue(eventName, properties) {
    var payload = Object.assign(basePayload(), {
      event_id: uuid(),
      event_name: eventName,
      event_type: eventName,
      properties: Object.assign({ timestamp: Date.now() }, properties || {})
    });
    memoryQueue.push(payload);
    persistQueue(storedQueue().concat([payload]));
    if (memoryQueue.length >= maxBatch) flush();
  }
  function flush() {
    var pending = storedQueue().concat(memoryQueue);
    memoryQueue = [];
    if (!pending.length) return;
    var batch = pending.slice(0, 25);
    var rest = pending.slice(25);
    var body = JSON.stringify({
      website_id: websiteId,
      anonymous_id: anon(),
      session_id: session(),
      batch_id: uuid(),
      events: batch
    });
    function failed() { persistQueue(batch.concat(rest)); }
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(endpoint, blob)) {
        persistQueue(rest);
        return;
      }
    }
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    }).then(function (res) {
      if (res.ok) persistQueue(rest);
      else failed();
    }).catch(failed);
  }

  var maxScroll = 0;
  function checkScroll() {
    var height = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    var depth = Math.min(100, Math.round((window.scrollY / height) * 100));
    if (depth >= maxScroll + 25) {
      maxScroll = depth;
      enqueue('scroll_depth', { scroll_depth: depth });
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('a,button,[data-omnivera-cta],[data-ga-primary-cta]') : null;
    if (!target) return;
    var href = target.getAttribute('href') || '';
    if (target.matches('[data-omnivera-cta],[data-ga-primary-cta]')) {
      enqueue('cta_click', {
        label: target.getAttribute('data-omnivera-cta') || target.getAttribute('data-ga-primary-cta') || target.textContent || '',
        href: href
      });
    } else if (href && /^https?:\/\//i.test(href) && new URL(href).hostname !== location.hostname) {
      enqueue('outbound_click', { href: href, label: target.textContent || '' });
    }
  }, true);

  document.addEventListener('focusin', function (event) {
    if (event.target && event.target.closest && event.target.closest('form')) {
      var form = event.target.closest('form');
      var field = event.target.getAttribute('name') || event.target.id || event.target.getAttribute('data-field-key') || '';
      enqueue('form_start', { form_id: form.id || form.getAttribute('data-omnivera-form-id') || null });
      if (field) enqueue('form_field_focus', { form_id: form.id || form.getAttribute('data-omnivera-form-id') || null, field_key: field });
    }
  }, true);
  document.addEventListener('change', function (event) {
    if (event.target && event.target.closest && event.target.closest('form')) {
      var form = event.target.closest('form');
      var field = event.target.getAttribute('name') || event.target.id || event.target.getAttribute('data-field-key') || '';
      if (field) enqueue('form_field_complete', { form_id: form.id || form.getAttribute('data-omnivera-form-id') || null, field_key: field });
    }
  }, true);
  document.addEventListener('submit', function (event) {
    if (event.target && event.target.tagName === 'FORM') {
      event.target.setAttribute('data-omnivera-submitted', 'true');
      enqueue('form_submit', { form_id: event.target.id || event.target.getAttribute('data-omnivera-form-id') || null });
    }
  }, true);
  Array.prototype.slice.call(document.querySelectorAll('form')).forEach(function (form) {
    enqueue('form_impression', { form_id: form.id || form.getAttribute('data-omnivera-form-id') || null });
  });
  window.addEventListener('beforeunload', function () {
    Array.prototype.slice.call(document.querySelectorAll('form')).forEach(function (form) {
      var formId = form.id || form.getAttribute('data-omnivera-form-id') || null;
      if (formId && form.getAttribute('data-omnivera-submitted') !== 'true') enqueue('form_abandon', { form_id: formId });
    });
    flush();
  });
  window.addEventListener('scroll', function () { window.requestAnimationFrame(checkScroll); }, { passive: true });
  window.addEventListener('online', flush);
  window.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  setInterval(flush, flushMs);

  window.Omnivera = window.Omnivera || {};
  window.Omnivera.track = enqueue;
  window.Omnivera.flush = flush;
  window.Omnivera.reset = function () {
    remove(localStorage, 'omnivera_anonymous_id');
    remove(sessionStorage, 'omnivera_session_id');
    remove(localStorage, queueKey);
  };

  enqueue('page_view', {});
  flush();
})();
