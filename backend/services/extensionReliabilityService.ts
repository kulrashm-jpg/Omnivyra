/**
 * Extension reliability tracker — closes the "partial = silent risk" gap.
 *
 * Every /api/extension/action-result call records a pass/fail against the
 * (platform, action) pair. Pass = result.confirmed === true. Fail = status
 * failed OR confirmed=false (sent_unverified also counts as a fail here
 * because it is not trusted platform ack).
 *
 * The service maintains a rolling window of the last N results per pair.
 * When confirmation rate drops below MIN_CONFIRM_RATE, the capability is
 * auto-disabled and the backend stops emitting commands for that pair —
 * the extension also rejects them defense-in-depth via its own capability
 * map snapshot.
 *
 * Storage: in-memory ring. Fine for a single instance. Multi-instance
 * deployments should swap in Redis — the interface (recordOutcome,
 * getReliability, isCurrentlyDisabled) is drop-in replaceable.
 */

type Outcome = 'confirmed' | 'unconfirmed' | 'failed';

type RingEntry = {
  at: number;
  outcome: Outcome;
};

const WINDOW_SIZE = 20;        // keep last 20 outcomes per pair
const MIN_SAMPLES = 10;        // need at least this many to make a call
const MIN_CONFIRM_RATE = 0.6;  // below 60% → auto-disable
const COOLOFF_MS = 30 * 60 * 1000; // re-open 30 min after auto-disable

type PairState = {
  ring: RingEntry[];
  disabledUntil: number | null;
  disabledReason: string | null;
};

const state = new Map<string, PairState>();

function keyOf(platform: string, action: string) {
  return `${String(platform || '').toLowerCase().trim()}.${String(action || '').toLowerCase().trim()}`;
}

function ensure(key: string): PairState {
  let s = state.get(key);
  if (!s) {
    s = { ring: [], disabledUntil: null, disabledReason: null };
    state.set(key, s);
  }
  return s;
}

export function recordOutcome(platform: string, action: string, outcome: Outcome) {
  const s = ensure(keyOf(platform, action));
  s.ring.push({ at: Date.now(), outcome });
  if (s.ring.length > WINDOW_SIZE) s.ring.splice(0, s.ring.length - WINDOW_SIZE);

  if (s.ring.length >= MIN_SAMPLES) {
    const confirms = s.ring.filter((e) => e.outcome === 'confirmed').length;
    const rate = confirms / s.ring.length;
    if (rate < MIN_CONFIRM_RATE && (!s.disabledUntil || s.disabledUntil < Date.now())) {
      s.disabledUntil = Date.now() + COOLOFF_MS;
      s.disabledReason = `Auto-disabled: confirmation rate ${(rate * 100).toFixed(0)}% < ${Math.round(MIN_CONFIRM_RATE * 100)}% over last ${s.ring.length} dispatches.`;
       
      console.warn('[extensionReliability]', keyOf(platform, action), s.disabledReason);
    }
  }
}

export function getReliability(platform: string, action: string) {
  const key = keyOf(platform, action);
  const s = state.get(key);
  if (!s || s.ring.length === 0) return { samples: 0, confirm_rate: null, disabled_until: null, reason: null };
  const confirms = s.ring.filter((e) => e.outcome === 'confirmed').length;
  return {
    samples: s.ring.length,
    confirm_rate: confirms / s.ring.length,
    disabled_until: s.disabledUntil,
    reason: s.disabledReason,
  };
}

export function isCurrentlyDisabled(platform: string, action: string): boolean {
  const s = state.get(keyOf(platform, action));
  if (!s || !s.disabledUntil) return false;
  if (s.disabledUntil < Date.now()) {
    // Cool-off expired; reset and give it another chance.
    s.disabledUntil = null;
    s.disabledReason = null;
    // Clear older samples so the pair is judged on fresh data, not stale.
    s.ring = [];
    return false;
  }
  return true;
}
