# Blog Generation Flow

## Input

Primary entry points:

- `pages/api/blogs/generate.ts` for company-authored blogs in `blogs`.
- `pages/api/admin/blog/generate.ts` for super-admin public blogs in `public_blogs`.
- `backend/adapters/commandCenter/blogContentAdapter.ts` for queued long-form jobs, processed by `backend/queue/jobProcessors/contentGenerationProcessor.ts`.

Canonical generation facade:

- `lib/content/unifiedLongFormEngine.ts`

Compatibility core:

- `lib/blog/runBlogGeneration.ts`

## Processing Stages

1. Request validation and authorization
   - Validates `company_id`, `topic`, `mode`, `format_type`, selected angle, and template data.
   - Enforces company access and role gates.

2. Company context injection
   - `lib/content/buildContentContext.ts`
   - Populates `CompanyContext`, writing style, canonical company profile, strategic inputs, recommendation context, and completeness telemetry.
   - `lib/blog/runBlogGeneration.ts` adds contextual answers and section strategic assignments.

3. Organizational POV layer
   - `backend/services/longForm/organizationPerspectiveEngine.ts`
   - Produces company viewpoint, market observation, strategic recommendation, tradeoff analysis, proprietary insight, and primary executive audience.
   - Threaded into planned long-form and compatibility prompts.

4. Topic and angle generation
   - `lib/blog/blogGenerationEngine.ts`
   - `buildAnglesSystemPrompt`, `buildAnglesUserPrompt`, `validateAnglesOutput`, `buildFallbackAngles`.
   - Model: `gpt-4o-mini`.

5. Content planning
   - `lib/content/longFormPlanningEngine.ts`
   - `generateContentPlan`, `attemptPlannerGeneration`, planner stability validation, adaptive section sizing.
   - Model: `gpt-4o-mini`.

6. Outline and section generation
   - Planned engine: `generateSection` in `lib/content/longFormPlanningEngine.ts`.
   - Compatibility engine: `buildGenerationSystemPrompt`, `buildGenerationUserPrompt`, template-specific runners in `lib/blog/runTemplateBlogGeneration.ts`, `runClassicBlogGeneration.ts`, `runEditorialBlogGeneration.ts`, `runTutorialBlogGeneration.ts`, `runComparisonBlogGeneration.ts`.
   - Models: planned sections use `gpt-4o-mini`; compatibility full HTML uses `gpt-4o`.

7. Strategic insight and framework generation
   - Planned engine creates `ContentPlan.framework` and section-level opinionated insight requirements.
   - Compatibility engine receives mandatory organization perspective and strategic assignment prompt blocks.

8. References generation
   - Planned engine assembles references from section outputs.
   - Compatibility engine requires references in `buildGenerationSystemPrompt`.

9. Validators
   - Existing: planner stability, content variation, long-form SEO scoring, differentiation scoring, hook assessment, company-context scoring, template repairs.
   - New: `rebrandResistanceValidator`, `executiveAudienceValidator`, `genericContentDetector`, `editorialBodyStructureValidator`, `contentDuplicationValidator`, and `thoughtLeadershipQualityGate`.

10. Quality scoring and gates
    - Before returning a full generation, `ThoughtLeadershipQualityGateError` is thrown unless:
      - POV >= 80
      - Strategic >= 80
      - Executive >= 75
      - Rebrand >= 70
      - Framework = PASS
      - Genericity <= 30
      - Editorial body >= 75
      - Duplication <= 25

11. Final assembly
    - Planned engine assembles `BlogGenerationOutput` from content plan, generated sections, FAQ, summary, references, and blocks.
    - Compatibility engine assembles HTML or block-structured template output.
    - Final result includes `thought_leadership_quality` for full successful generations.

## Final Output

Successful full result:

- `needs_clarification: false`
- `mode: "full"`
- `result: BlogGenerationOutput & { content_blocks: unknown[] }`
- `hook_assessment`
- `governance`
- `thought_leadership_quality`
- `engine_trace` when routed through `runUnifiedLongFormGeneration`

Rejected generation:

- API returns `422 THOUGHT_LEADERSHIP_QUALITY_GATE_FAILED`.
- Payload includes the quality report and failures.
