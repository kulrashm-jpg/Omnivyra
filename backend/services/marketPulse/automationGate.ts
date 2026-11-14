/**
 * The ONE gate for automated Market Pulse (e9 BLOCKING-NOW 2026-11-14; owner ruling: automated scans stay OFF until
 * charging is live). Automated runs make AI calls and bill nothing today, so every producer of automated work asks this
 * function: the cron (pages/api/cron/market-pulse-automation), an on-demand run with mode 'automated'
 * (pages/api/market-pulse/run), and ENABLING automation (pages/api/market-pulse/automation POST is_active=true).
 * Turning automation OFF is always allowed. Strict: only the exact string 'true' enables it (no trim, no lower-casing).
 * Re-enable together with the hold-then-settle Market Pulse billing release (8 credits per region, weekly default).
 */
export const MARKET_PULSE_AUTOMATION_ENV = 'MARKET_PULSE_AUTOMATION_ENABLED';

export const MARKET_PULSE_AUTOMATION_DISABLED = {
  code: 'MARKET_PULSE_AUTOMATION_DISABLED',
  retryable: false,
  error: 'Automated Market Pulse is turned off until charging for it is live.',
} as const;

export function isMarketPulseAutomationEnabled(): boolean {
  return process.env[MARKET_PULSE_AUTOMATION_ENV] === 'true';
}

/** Thrown by the settings WRITER itself (upsertAutomationSettings) when enrolment is attempted while the gate is off:
 *  the structural backstop for any caller that does not check the gate first (05: indirect producers). */
export class MarketPulseAutomationDisabledError extends Error {
  readonly code = MARKET_PULSE_AUTOMATION_DISABLED.code;
  readonly retryable = false;
  constructor() { super(MARKET_PULSE_AUTOMATION_DISABLED.error); this.name = 'MarketPulseAutomationDisabledError'; }
}
