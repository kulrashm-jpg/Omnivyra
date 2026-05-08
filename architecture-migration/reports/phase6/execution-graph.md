# Phase 6 Execution Graph

Canonical execution owners:
- RecommendationEngine: recommendation generation/scoring entrypoint and adapter-facing owner.
- ContentGenerationPipeline: content generation orchestration owner.
- CampaignExecutionOrchestrator: campaign execution coordination owner.
- AIExecutionService: AI execution facade owner.
- ScheduleCommandService: scheduling mutation command owner.

Remaining duplicate owner blockers:
- recommendation execution paths still report duplicate ownership in service/API/intelligence modules.
- content generation paths still report duplicate ownership in processors and generator modules.
- campaign execution paths still report duplicate ownership in orchestration services.
- AI execution paths still report duplicate ownership outside AIExecutionService.
- queue processors still contain execution coordination logic rather than adapter-only boundaries.

Phase 6 ownership movement completed:
- structuredPlanScheduler bolt_content_jobs creation now routes through ScheduleRepository.
- boltPipelineService campaign_versions mutation now routes through CampaignRepository.
- boltPipelineService campaign status mutations now route through CampaignRepository.
