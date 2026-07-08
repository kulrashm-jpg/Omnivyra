/**
 * Creator type-workflow domain model — BARREL. Extracted from
 * pages/command-center/creator-content/[type].tsx and split into three <1000-LOC modules:
 *   creatorWorkflowConfig       — type ids, WORKFLOW_CONFIG, starter chips, overlay defaults
 *   creatorWorkflowModel        — results/saved-asset/brand model, writer-source mapping
 *   creatorSuggestionAndPayload — suggestion-chip builders + shared generation payload (P1-1)
 * The page (and everything else) imports from THIS barrel — module layout is an internal detail.
 */
export * from './creatorWorkflowConfig';
export * from './creatorWorkflowModel';
export * from './creatorSuggestionAndPayload';
