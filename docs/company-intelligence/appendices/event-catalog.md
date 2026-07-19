# Appendix — Domain Event Catalog

Every canonical domain event, its producing context, and primary consumers. All events share the envelope from DESIGN-002 §5 (tenant, aggregate id+version, causation/correlation, producer+version, timestamp), are delivered at-least-once with per-aggregate ordering, are idempotent by (event id + aggregate version), and are replayable. This is the **only** cross-context communication mechanism (P23).

## Knowledge (I2A §9)

| Event | Payload core | Primary consumers |
|---|---|---|
| KnowledgeCreated | company id, initial node set | Distribution, Trust |
| KnowledgeChanged | fact id/version, field key, state, actor class | Distribution (projections), Trust, consumers |
| KnowledgeSuperseded | fact id, old/new version | projections |
| KnowledgeConfirmed | fact id/version, confirming actor, disposition | Trust, Learning |
| KnowledgeContradicted | fact id, contradiction id, conflicting basis | Trust (review), Conversation (resolution) |
| KnowledgeMerged / KnowledgeArchived / KnowledgeRestored | node ids / fact id + versions | structural |
| SystemStateRecorded | sub-key, version | transitional custody (report_settings) |

## Trust (I2B §11)

| Event | Payload core | Producer |
|---|---|---|
| ConfidenceCalculated / ConfidenceUpdated / ConfidenceDecayed / ConfidenceCorrected | fact id/version, old/new composite, limiting dimension, calculator version | Trust |
| ProvenanceCreated | fact id/version, provenance ref | Trust |
| ReviewRequested / ReviewAssigned / ReviewAccepted / ReviewRejected / ReviewExpired | review id, subject, disposition, reviewer | Trust |
| LearningSignalCaptured | signal type, subject ref | Trust |

## Evidence (I2C §10)

| Event | Payload core | Producer |
|---|---|---|
| EvidenceCollected / EvidenceExtracted / EvidenceActivated | evidence id/version, type, source class, locator | Evidence |
| EvidenceSuperseded / EvidenceExpired / EvidenceArchived | evidence id, basis | Evidence |
| CollectionRequested / CollectionSkipped / CollectionFailed | locator, policy decision, reason | Evidence |
| CollectionPolicyDecided | gate verdict, action, budget/cooldown basis | Evidence |

## Grounding & Validation (I2D §12)

| Event | Payload core | Producer |
|---|---|---|
| GroundingRequested | consumer profile id, request scope | Grounding |
| GroundingPrepared | grounding-context id/version, source versions, assembly version | Grounding |
| GroundingRejected | reason (prohibited input / unregistered / missing required) | Grounding |
| ValidationStarted / ValidationPassed / ValidationFailed | subject ref, tier results, failure taxonomy, token | Validation |
| ConsumerRegistered / ConsumerUpdated | consumer profile id/version, declaration | Grounding |

## Conversation (I2E §10)

| Event | Payload core | Producer |
|---|---|---|
| ConversationStarted / Paused / Resumed / Completed / Closed | session id, mode, target set, completion score | Conversation |
| QuestionAsked / QuestionAnswered | session id, node, grounding-context id / answer type | Conversation |
| CompletionUpdated / ClarificationRequested | session id, readiness delta / missing dimension | Conversation |

## Generation (I2F §11)

| Event | Payload core | Producer |
|---|---|---|
| WorkflowStarted / WorkflowCompleted / WorkflowFailed | run id, workflow key, grounding-context id, cost | Generation |
| PromptResolved / ModelSelected | run id, prompt version / model version, routing basis | Generation |
| RetryStarted | run id, attempt, reason | Generation |

## Projections (I2G §10)

| Event | Payload core | Producer |
|---|---|---|
| ProjectionRequested / ProjectionBuilt / ProjectionUpdated | projection id/version, source fact/confidence versions | Projection |
| ProjectionInvalidated / ProjectionPublished | projection id, invalidating event / version | Projection |
| ConsumerRefreshed | consumer id, projection version, contract version | Consumer |

## Learning (I2H §11)

| Event | Payload core | Producer |
|---|---|---|
| LearningSignalReceived / LearningAggregated | signal id, type, source / aggregation ref, window | Learning |
| CalibrationRecommended | target context, calibration params, basis | Learning |
| PromptRecommendationGenerated / WorkflowRecommendationGenerated / IndustryPackRecommendationGenerated | target asset, recommendation, basis | Learning |
| EvaluationCompleted | bench run ref, per-workflow scores | Learning |

**Note:** `KnowledgeDeleted` does not exist — knowledge is append-only (P15); retention emits `KnowledgeArchived`. Learning recommendation events are advisory; adoption events are emitted by the *owning* context when it applies through governance (keeps the recommend-only boundary auditable).
