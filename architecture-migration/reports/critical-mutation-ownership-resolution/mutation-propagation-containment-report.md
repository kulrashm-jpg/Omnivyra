# Mutation Propagation Containment Report

## Status
Mutation propagation containment is PARTIAL. Target critical DB propagation through service-owned Supabase mutation chains was removed. Global uncontrolled runtime payload propagation remains at 67.

## Counts
- critical DB mutations outside repository ownership: 547
- high DB mutations outside repository ownership: 475
- critical runtime payload mutations: 67
- high runtime payload mutations: 0
- remaining dangerous mutation surfaces: 1089
- remaining uncontrolled mutation propagations: 67

## Target Validation
| file | repository-owned DB records | critical DB outside repository | high DB outside repository | critical payload mutations |
| --- | ---: | ---: | ---: | ---: |
| backend/services/companyIntelligenceConfigService.ts | 15 | 0 | 0 | 0 |
| backend/services/boltPipelineService.ts | 11 | 0 | 0 | 0 |
| backend/services/structuredPlanScheduler.ts | 11 | 0 | 0 | 0 |
| backend/services/externalApi/dbHelpers.ts | 10 | 0 | 0 | 0 |
| backend/services/intelligenceGovernanceService.ts | 10 | 0 | 0 | 0 |
| backend/services/whatsappBroadcastService.ts | 10 | 0 | 0 | 0 |

