# Phase 6 Ownership Map

Repository-owned mutations confirmed in this phase:
- ScheduleRepository.insertBoltContentJob owns bolt_content_jobs insertion for structuredPlanScheduler.
- CampaignRepository.updateCampaignVersion owns campaign_versions snapshot mutation for boltPipelineService.
- CampaignRepository.updateCampaignById owns campaign status/stage mutations for boltPipelineService.

Remaining oversized ownership blockers:
- aiGateway.ts still exceeds ownership-size target.
- recommendationEngine.ts still exceeds ownership-size target.
- structuredPlanScheduler.ts still exceeds ownership-size target.
- boltPipelineService.ts still exceeds ownership-size target.
- companyProfileService.ts still exceeds ownership-size target.
- competitorEngineService.ts still exceeds ownership-size target.
- planner orchestration modules still require ownership extraction.

Hard enforcement blocker:
- direct DB writes, dependency cycles, duplicate execution owners, oversized files, and any/unknown leaks remain above zero/current phase targets.
