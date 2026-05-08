# Authority Chain Drift Report

Authority-chain integrity: DRIFTING

## Single Authority Verification
| Authority | Enforced Single Authority? | Drift Surface |
|---|---:|---|
| auth authority | no | Bearer, cookie, SSR session, service helper paths coexist |
| session authority | no | authResolver, middleware, serverValidation, super-admin cookie/session surfaces |
| company authority | partial | active_company_id and membership roles are intended, but route-level helpers still vary |
| role authority | partial | CapabilityService exists, but role checks and compatibility comments/surfaces remain widespread |
| orchestration authority | partial | duplicate-owner tool says 0 but no call-graph authority proof |
| repository authority | no | 600 runtime DB writes outside repositories by current P0 definition |
| queue authority | no | scheduler, workers, queue processors, API enqueue/fallback paths coexist |

## Duplicate/Fallback Authority Indicators
- API routes still own auth parsing or pass-through token handling in multiple places.
- Queue workers can be registered directly and through helpers.
- Scheduling has API, scheduler service, structured plan scheduler, block processor, and queue processor surfaces.
- Repository authority is bypassed by direct runtime mutation records.
- Compatibility bridges exist around identity/session and campaign scheduling.

Critical unresolved authority paths: 7

- auth authority
- session authority
- company authority
- role authority
- orchestration authority
- repository authority
- queue authority
