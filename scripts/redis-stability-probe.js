const Redis = require('ioredis');
const url = process.env.PROBE_URL;
const r = new Redis(url, { lazyConnect: true, connectTimeout: 10000, maxRetriesPerRequest: 1 });
function g(s, k) { const m = s.match(new RegExp(k + ':(\\d+)')); return m ? parseInt(m[1], 10) : 0; }
(async () => {
  try {
    await r.connect();
    const c = await r.info('clients');
    const s = await r.info('stats');
    console.log('connected_clients=' + g(c, 'connected_clients'));
    console.log('instantaneous_ops_per_sec=' + g(s, 'instantaneous_ops_per_sec'));
    console.log('evicted_keys=' + g(s, 'evicted_keys'));
    const queues = ['publish', 'bolt-execution', 'ai-heavy', 'engine-jobs', 'engagement-polling',
      'intelligence-polling', 'lead-thread-recompute', 'conversation-memory-rebuild', 'creator-render',
      'analytics-ingestion'];
    let wait = 0, active = 0, failed = 0;
    for (const q of queues) {
      wait += await r.llen('bull:' + q + ':wait').catch(() => 0);
      active += await r.llen('bull:' + q + ':active').catch(() => 0);
      failed += await r.zcard('bull:' + q + ':failed').catch(() => 0);
    }
    console.log('queues_total wait=' + wait + ' active=' + active + ' failed=' + failed);
  } catch (e) {
    console.error('PROBE_FAILED:', e.message);
    process.exit(1);
  } finally {
    try { r.disconnect(); } catch {}
  }
})();
