# Runtime Cycle Removal Report

- lib/redis/client.ts -> lib/redis/healthmetrics.ts -> lib/redis/client.ts
- backend/services/decisionobjectservice.ts -> backend/services/decisionscoringservice.ts -> backend/services/decisionobjectservice.ts
- backend/services/companyprofileservice.ts -> backend/services/reportcompetitorintelligenceservicehelpers.ts -> backend/services/reportinputresolver.ts -> backend/services/companyprofileservice.ts
- backend/services/usercontextservice.ts -> backend/services/contentarchitectservice.ts -> backend/services/rbacservice.ts -> backend/services/usercontextservice.ts
- backend/domain/from-lib/content/longformplanningengine.ts -> backend/domain/from-lib/content/longformseointelligence.ts -> backend/domain/from-lib/content/longformplanningengine.ts
- backend/domain/from-lib/content/longformplanningengine.ts -> backend/domain/from-lib/content/longformseointelligence.ts -> backend/domain/from-lib/content/longformperformancelearning.ts -> backend/domain/from-lib/content/longformplanningengine.ts
- backend/domain/from-lib/content/longformplanningengine.ts -> backend/domain/from-lib/content/longformseointelligence.ts -> backend/domain/from-lib/content/longformperformancelearning.ts -> backend/domain/from-lib/content/longformdifferentiationintelligence.ts -> backend/domain/from-lib/content/longformplanningengine.ts
- backend/services/omnivyreclient.ts -> backend/services/viralityadvisorservice.ts -> backend/services/omnivyreclient.ts
- backend/services/strategicthemeengine.ts -> backend/services/opportunityservice.ts -> backend/services/opportunitygenerators.ts -> backend/services/strategicthemeengine.ts
- backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rpataskqueue.ts -> backend/services/rpaworker/rpaworkerservice.ts
- backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rpaplatformscripts.ts -> backend/services/rpaworker/rpaplaywrightrunner.ts -> backend/services/rpaworker/rpaworkerservice.ts
- backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rpaplatformscripts.ts -> backend/services/rpaworker/rpaworkerservice.ts
- backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rparetryqueue.ts -> backend/services/rpaworker/rpaworkerservice.ts
- backend/services/trends/trendalignmentservice.ts -> backend/services/campaignrecommendationservice.ts -> backend/services/trends/trendalignmentservice.ts
- backend/services/intelligence/data/fetchintelligencedata.ts -> backend/services/intelligence/intelligenceorchestrator.ts -> backend/services/intelligence/data/fetchintelligencedata.ts
- backend/services/performancehtmlrenderer.ts -> backend/services/performancereportmapper.ts -> backend/services/performancereportservice.ts -> backend/services/performancehtmlrenderer.ts
- backend/services/performancereportmapper.ts -> backend/services/performancereportservice.ts -> backend/services/performancereportmapper.ts
- components/engagement/contentopportunitiespanel.tsx -> components/engagement/contentopportunityreviewmodal.tsx -> components/engagement/contentopportunitiespanel.tsx
