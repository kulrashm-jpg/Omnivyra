# CREDIT_ALERT_FLOW_MAP.md

```
successful deduction (creditExecutionService CONFIRM)
  → fireAlerts(orgId)                         [non-blocking, swallows errors]
       ├─ checkCreditAlerts (existing 20/10% remaining alerts)
       └─ notifyConsumptionWarnings(orgId)    [dynamic import, .catch]
            consumedPct = used_30d / (used_30d + remaining) * 100
            forecast    = creditForecastService.computeForecast(metrics, used)   [REUSED]
            cycleStart  = first day of calendar month
            → evaluateConsumptionWarnings(orgId, deps)
                 in-app:  newlyCrossedThresholds(consumedPct, firedThisCycle)
                          → emitConsumptionAlert → notifications + credit_alert_log
                 email:   consumedPct ≥ 85 AND forecast.insufficient AND not-sent-this-cycle
                          → recordForecastEmail (dedup) → sendCreditAlert(adminEmail)
                          → Edge Function credit_alert → SES
display:
  NotificationBell        ← notifications (credit_alert rows)
  CreditWarningBanner     ← /api/notifications, highest consumed_X, once/session (sessionStorage)
```

## Dedup (no duplicates within a cycle)
- In-app: `credit_alert_log` rows `consumed_80/90/95` since cycle start ⇒ each threshold once.
- Email: `credit_alert_log` `forecast_insufficient_85` since cycle start ⇒ once per cycle;
  recorded BEFORE send (idempotency-safe), plus email idempotency key `credit_alert:org:yyyy-mm`.
- Survives refresh + duplicate deductions (server-side log, not client state).

## Reuse / safety
Forecast: existing `creditForecastService` only (no second forecaster). No balance mutation, no
billing change. Trigger is best-effort and never blocks or fails a deduction.
