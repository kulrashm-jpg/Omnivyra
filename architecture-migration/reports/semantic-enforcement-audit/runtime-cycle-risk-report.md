# Runtime Cycle Risk Report

Runtime cycle risk: HIGH

## Runtime Cycles
### 1. backend/services/omnivyreclient.ts -> backend/services/viralityadvisorservice.ts -> backend/services/omnivyreclient.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 2. backend/services/companyprofileservice.ts -> backend/services/companyprofile/businessclassification.ts -> backend/services/competitorengineservice.ts -> backend/services/reportinputresolver.ts -> backend/services/companyprofileservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: high
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 3. backend/services/competitorengineservice.ts -> backend/services/reportinputresolver.ts -> backend/services/competitorengineservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 4. backend/services/competitorengineservice.ts -> backend/services/competitorfeedbackservice.ts -> backend/services/competitorengineservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 5. backend/services/decisionobjectservice.ts -> backend/services/decisionscoringservice.ts -> backend/services/decisionobjectservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 6. backend/services/rbacservice.ts -> backend/services/usercontextservice.ts -> backend/services/contentarchitectservice.ts -> backend/services/rbacservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: high
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: critical

### 7. backend/services/strategicthemeengine.ts -> backend/services/opportunityservice.ts -> backend/services/opportunitygenerators.ts -> backend/services/strategicthemeengine.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 8. lib/content/longformplanningengine.ts -> lib/content/longformseointelligence.ts -> lib/content/longformplanningengine.ts
- mutation amplification risk: moderate
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 9. lib/content/longformplanningengine.ts -> lib/content/longformseointelligence.ts -> lib/content/longformperformancelearning.ts -> lib/content/longformplanningengine.ts
- mutation amplification risk: moderate
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 10. lib/content/longformplanningengine.ts -> lib/content/longformseointelligence.ts -> lib/content/longformperformancelearning.ts -> lib/content/longformdifferentiationintelligence.ts -> lib/content/longformplanningengine.ts
- mutation amplification risk: moderate
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 11. backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rpataskqueue.ts -> backend/services/rpaworker/rpaworkerservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: high
- severity: critical

### 12. backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rpaplatformscripts.ts -> backend/services/rpaworker/rpaplaywrightrunner.ts -> backend/services/rpaworker/rpaworkerservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: high
- severity: critical

### 13. backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rpaplatformscripts.ts -> backend/services/rpaworker/rpaworkerservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: high
- severity: critical

### 14. backend/services/rpaworker/rpaworkerservice.ts -> backend/services/rpaworker/rparetryqueue.ts -> backend/services/rpaworker/rpaworkerservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: high
- severity: critical

### 15. backend/services/trends/trendalignmentservice.ts -> backend/services/campaignrecommendationservice.ts -> backend/services/trends/trendalignmentservice.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: high
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 16. backend/services/performancehtmlrenderer.ts -> backend/services/performancereportmapper.ts -> backend/services/performancereportservice.ts -> backend/services/performancehtmlrenderer.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 17. backend/services/performancereportmapper.ts -> backend/services/performancereportservice.ts -> backend/services/performancereportmapper.ts
- mutation amplification risk: high
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

### 18. components/engagement/contentopportunitiespanel.tsx -> components/engagement/contentopportunityreviewmodal.tsx -> components/engagement/contentopportunitiespanel.tsx
- mutation amplification risk: moderate
- initialization-order risk: high
- authority contamination risk: moderate
- runtime recursion risk: moderate
- scheduler/queue corruption risk: low
- severity: high

## Cycle Class Summary
- runtime-cycle: 18
- barrel/export-cycle: 4
- type-only-cycle: 3
