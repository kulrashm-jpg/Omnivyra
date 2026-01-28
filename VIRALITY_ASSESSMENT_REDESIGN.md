# Virality Assessment System: Conceptual Redesign

**Version:** 1.0  
**Date:** 2025-01-23  
**Status:** Design Proposal

---

## Executive Summary

This document proposes a fundamental redesign of the virality assessment system, moving from engagement-metric-based analysis to an objective-driven, diagnostic model. The new system separates virality assessment from content generation, scheduling, and platform analytics, enabling multi-tenant deployment with company-specific context.

---

## A. Current System Analysis

### A.1 Current Virality Definition

**Finding:** The system conflates virality with engagement metrics.

**Evidence:**
- `content_performance_insights.viral_coefficient` (line 60, `step13-advanced-analytics.sql`) is stored alongside `engagement_velocity` and `reach_amplification` without explicit objective context
- `ContentAnalyzer` (lib/content-analyzer.ts) calculates "engagement potential" and "trending relevance" as platform scores without reference to campaign objectives
- Analytics service (`analyticsService.ts`) aggregates likes, shares, comments, retweets as primary success indicators
- No explicit virality objective is required before assessment

### A.2 Implicit Assumptions

1. **Engagement = Virality**: High engagement (likes, shares) is treated as evidence of virality
2. **Platform-centric**: Analysis is platform-specific (LinkedIn, Twitter, Instagram) rather than objective-centric
3. **Post-hoc measurement**: Virality is measured after publication using platform APIs
4. **Single metric focus**: `viral_coefficient` suggests a single number captures virality
5. **Growth hack orientation**: System optimizes for "trending" and "uniqueness" without strategic context

### A.3 Conflation Points

**Location:** `database/step13-advanced-analytics.sql:60-62`
```sql
viral_coefficient DECIMAL(5,2), -- How viral the content became
engagement_velocity DECIMAL(5,2), -- Rate of engagement growth
reach_amplification DECIMAL(5,2), -- How much reach was amplified
```

**Problem:** These metrics are calculated from platform engagement data without:
- An explicit objective (reach? conversation? conversion?)
- A baseline or expected value
- Context about why spread occurred or didn't occur

**Location:** `lib/content-analyzer.ts:199-201`
```typescript
const uniquenessScore = this.calculateUniquenessScore(platformScores);
const repetitionRisk = this.calculateRepetitionRisk(platformScores, analyzedTopic);
const overallScore = this.calculateOverallScore(platformScores, uniquenessScore, repetitionRisk);
```

**Problem:** Scores are calculated without reference to:
- Campaign objectives
- Target audience characteristics
- Success criteria
- Company context

---

## B. Proposed Virality Assessment Model

### B.1 Core Principles

1. **Objective-Driven**: Virality is meaningless without an explicit objective
2. **Diagnostic, Not Generative**: System explains why content may spread, not how to make it spread
3. **Deterministic**: Same input produces same output (replayable)
4. **Platform-Agnostic Core**: Platform behavior is an optional layer
5. **Company Context Aware**: Assessment considers company-specific factors

### B.2 Model Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Virality Assessment Engine                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Input:                                                       │
│  - Content (text, media metadata)                            │
│  - Objective (reach | conversation | authority | conversion)  │
│  - Company Context (industry, audience, brand voice)         │
│  - Optional: Platform constraints                            │
│                                                               │
│  Processing:                                                  │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Driver Analysis │  │  Risk Analysis   │                  │
│  │ - Signal strength│  │ - Noise factors │                  │
│  │ - Resonance      │  │ - Friction       │                  │
│  │ - Amplification │  │ - Contradiction  │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                                                               │
│  Output:                                                      │
│  - Virality Score (0-100, relative to objective)             │
│  - Confidence (0-1)                                          │
│  - Primary Drivers (explained)                                │
│  - Primary Risks (explained)                                 │
│  - Improvement Levers (actionable)                           │
└─────────────────────────────────────────────────────────────┘
```

### B.3 Driver Analysis

**Drivers** are factors that increase the probability of content spread relative to the objective.

#### B.3.1 Signal Strength
- **Definition**: How clearly the content communicates its core message
- **Assessment**: Semantic coherence, message clarity, topic focus
- **Objective Mapping**:
  - **Reach**: High signal = broad appeal, universal themes
  - **Conversation**: High signal = debatable claims, open questions
  - **Authority**: High signal = expertise demonstration, credibility markers
  - **Conversion**: High signal = clear value proposition, call-to-action clarity

#### B.3.2 Resonance
- **Definition**: Alignment between content and target audience's values, needs, or interests
- **Assessment**: Audience-content fit, emotional alignment, cultural relevance
- **Company Context**: Uses company's audience profile, industry norms, brand positioning

#### B.3.3 Amplification Potential
- **Definition**: Structural features that enable sharing/forwarding
- **Assessment**: Shareability cues, network effects, platform mechanics (optional layer)
- **Note**: Platform-specific only if platform constraints provided

### B.4 Risk Analysis

**Risks** are factors that decrease the probability of spread or create negative outcomes.

#### B.4.1 Noise Factors
- **Definition**: Elements that obscure the core message
- **Assessment**: Information density, competing claims, ambiguity

#### B.4.2 Friction
- **Definition**: Barriers to sharing or engagement
- **Assessment**: Length, complexity, accessibility, platform constraints

#### B.4.3 Contradiction
- **Definition**: Internal inconsistencies or conflicts with company context
- **Assessment**: Brand voice mismatch, factual contradictions, audience misalignment

### B.5 Implementation Approach

**Rule-Based Core** (deterministic, fast):
- Pattern matching for signal strength indicators
- Keyword/phrase analysis for resonance markers
- Structural analysis for amplification features

**LLM Enhancement** (optional, for complex content):
- Semantic analysis for nuanced understanding
- Context-aware interpretation
- Explanation generation

**Hybrid**: Rule-based scoring with LLM-generated explanations

---

## C. Canonical Virality Output Schema

### C.1 JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "objective",
    "virality_score",
    "confidence",
    "primary_drivers",
    "primary_risks",
    "improvement_levers",
    "assessment_metadata"
  ],
  "properties": {
    "objective": {
      "type": "string",
      "enum": ["reach", "conversation", "authority", "conversion"],
      "description": "The explicit objective for virality assessment"
    },
    "virality_score": {
      "type": "number",
      "minimum": 0,
      "maximum": 100,
      "description": "Score relative to objective (0 = no spread expected, 100 = maximum spread potential)"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "Confidence in assessment (0 = low, 1 = high)"
    },
    "primary_drivers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["factor", "strength", "explanation"],
        "properties": {
          "factor": {
            "type": "string",
            "enum": ["signal_strength", "resonance", "amplification_potential"]
          },
          "strength": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "explanation": {
            "type": "string",
            "description": "Why this factor contributes to spread potential"
          },
          "evidence": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific content elements that support this driver"
          }
        }
      }
    },
    "primary_risks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["factor", "severity", "explanation"],
        "properties": {
          "factor": {
            "type": "string",
            "enum": ["noise", "friction", "contradiction"]
          },
          "severity": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "explanation": {
            "type": "string",
            "description": "Why this factor reduces spread potential"
          },
          "evidence": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific content elements that indicate this risk"
          }
        }
      }
    },
    "improvement_levers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["lever", "impact", "action"],
        "properties": {
          "lever": {
            "type": "string",
            "description": "The factor that can be modified"
          },
          "impact": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Expected impact on virality score (0-1)"
          },
          "action": {
            "type": "string",
            "description": "Specific, actionable recommendation"
          },
          "priority": {
            "type": "string",
            "enum": ["high", "medium", "low"]
          }
        }
      }
    },
    "assessment_metadata": {
      "type": "object",
      "required": ["timestamp", "version", "method"],
      "properties": {
        "timestamp": {
          "type": "string",
          "format": "date-time"
        },
        "version": {
          "type": "string",
          "description": "Assessment model version"
        },
        "method": {
          "type": "string",
          "enum": ["rule_based", "llm", "hybrid"],
          "description": "Assessment method used"
        },
        "company_id": {
          "type": "string",
          "description": "Company context identifier (for multi-tenant)"
        },
        "content_hash": {
          "type": "string",
          "description": "SHA-256 hash of content for replayability"
        }
      }
    }
  }
}
```

### C.2 Example Output

```json
{
  "objective": "conversation",
  "virality_score": 72,
  "confidence": 0.85,
  "primary_drivers": [
    {
      "factor": "resonance",
      "strength": 0.88,
      "explanation": "Content addresses a widely debated topic in the target industry, with clear positions that invite discussion",
      "evidence": [
        "Question format in opening: 'Should companies...'",
        "Controversial claim: 'Traditional marketing is dead'",
        "Industry-specific terminology matches audience profile"
      ]
    },
    {
      "factor": "signal_strength",
      "strength": 0.75,
      "explanation": "Core message is clearly articulated with supporting evidence",
      "evidence": [
        "Thesis statement in first paragraph",
        "Three supporting arguments with examples",
        "Conclusion restates main point"
      ]
    }
  ],
  "primary_risks": [
    {
      "factor": "friction",
      "severity": 0.45,
      "explanation": "Content length (1,200 words) may reduce sharing likelihood on platforms optimized for shorter content",
      "evidence": [
        "Word count exceeds typical shareable length",
        "No summary or TL;DR provided"
      ]
    },
    {
      "factor": "noise",
      "severity": 0.30,
      "explanation": "Multiple competing claims in middle section may dilute core message",
      "evidence": [
        "Three different frameworks introduced",
        "Transition between sections is abrupt"
      ]
    }
  ],
  "improvement_levers": [
    {
      "lever": "Content structure",
      "impact": 0.25,
      "action": "Add executive summary (2-3 sentences) at the beginning to reduce friction for time-constrained readers",
      "priority": "high"
    },
    {
      "lever": "Message focus",
      "impact": 0.15,
      "action": "Consolidate middle section to focus on one primary framework, move secondary frameworks to appendix or separate post",
      "priority": "medium"
    }
  ],
  "assessment_metadata": {
    "timestamp": "2025-01-23T12:00:00Z",
    "version": "1.0",
    "method": "hybrid",
    "company_id": "acme-corp-123",
    "content_hash": "a3f5d8e2b1c9f4a7d6e8b2c1f9a4d7e6b8c2f1a9d4e7b6c8f2a1d9e4b7c6f8a2d1"
  }
}
```

---

## D. Diagnostic Questions (Internal)

The system must answer these questions internally to generate the assessment:

### D.1 Objective Alignment
1. Does the content clearly serve the stated objective?
2. What evidence supports alignment with the objective?
3. Are there elements that conflict with the objective?

### D.2 Signal Strength
1. What is the core message of the content?
2. How clearly is this message communicated?
3. Are there competing messages that obscure the core?
4. Is the message complete (has beginning, middle, end)?

### D.3 Resonance
1. Who is the intended audience (from company context)?
2. What values, needs, or interests does this audience have?
3. How well does the content align with these characteristics?
4. Are there cultural or industry-specific references that enhance or detract?

### D.4 Amplification Potential
1. What structural features enable sharing?
2. Are there clear shareability cues (questions, calls-to-action)?
3. Does the content format support platform mechanics (if platform provided)?
4. Are there network effects (mentions, tags, references)?

### D.5 Risk Factors
1. What elements create noise (obscure the message)?
2. What creates friction (barriers to sharing)?
3. Are there contradictions (internal or with company context)?
4. Does the content violate brand guidelines or voice?

### D.6 Improvement Opportunities
1. Which drivers can be strengthened?
2. Which risks can be mitigated?
3. What is the expected impact of each change?
4. What is the priority order for improvements?

---

## E. Failure Conditions

The system MUST refuse to run assessment in these cases:

### E.1 Missing Objective
**Condition**: `objective` parameter is null, undefined, or not in enum `["reach", "conversation", "authority", "conversion"]`

**Response**: 
```json
{
  "error": "MISSING_OBJECTIVE",
  "message": "Virality assessment requires an explicit objective. Provide one of: reach, conversation, authority, conversion",
  "code": "VALIDATION_ERROR"
}
```

### E.2 Incoherent Content
**Condition**: Content cannot be parsed or analyzed (empty, malformed, unreadable)

**Detection**: 
- Content length < 10 characters (after whitespace removal)
- Content is only whitespace
- Content contains only special characters (no alphanumeric)
- LLM analysis returns "cannot_analyze" (if using LLM)

**Response**:
```json
{
  "error": "INCOHERENT_CONTENT",
  "message": "Content cannot be analyzed. Ensure content is readable and contains meaningful text.",
  "code": "VALIDATION_ERROR"
}
```

### E.3 Unsupported Format
**Condition**: Content format is not supported by the assessment engine

**Supported Formats**: 
- Plain text
- Markdown
- HTML (stripped to text)
- JSON (if structured content format)

**Unsupported**: 
- Binary files (images, videos) without text metadata
- Encrypted content
- Content in unsupported languages (if language detection fails)

**Response**:
```json
{
  "error": "UNSUPPORTED_FORMAT",
  "message": "Content format is not supported. Provide plain text, markdown, or HTML.",
  "code": "VALIDATION_ERROR",
  "detected_format": "<format>"
}
```

### E.4 Missing Company Context (Multi-Tenant)
**Condition**: Company context is required but not provided

**When Required**: 
- Resonance analysis requires audience profile
- Brand voice assessment requires brand guidelines
- Industry-specific analysis requires industry classification

**Response**:
```json
{
  "error": "MISSING_COMPANY_CONTEXT",
  "message": "Company context is required for accurate assessment. Provide company_id or company context object.",
  "code": "VALIDATION_ERROR",
  "required_fields": ["audience_profile", "industry"]
}
```

### E.5 Objective-Content Mismatch
**Condition**: Content fundamentally cannot serve the stated objective

**Examples**:
- Objective: "conversion", Content: No call-to-action, no value proposition
- Objective: "authority", Content: No expertise markers, no citations
- Objective: "conversation", Content: No questions, no debatable claims

**Response**:
```json
{
  "error": "OBJECTIVE_CONTENT_MISMATCH",
  "message": "Content cannot serve the stated objective. Consider changing objective or content.",
  "code": "VALIDATION_ERROR",
  "conflicts": ["<specific conflict 1>", "<specific conflict 2>"]
}
```

---

## F. Integration Points (Decoupled)

### F.1 Content Generation

**Interface**: Assessment is called AFTER content generation, not during.

**Flow**:
```
Content Generator → Generated Content → Virality Assessment → Assessment Result
```

**Integration Pattern**:
- Assessment service exposes REST API: `POST /api/virality/assess`
- Content generator calls assessment after draft creation
- Assessment result is stored separately from content (not embedded)
- Content generator can use assessment to iterate, but assessment doesn't generate

**Data Contract**:
```typescript
interface AssessmentRequest {
  content: string;
  objective: "reach" | "conversation" | "authority" | "conversion";
  company_id?: string;
  platform?: string; // optional
  metadata?: Record<string, any>;
}

interface AssessmentResponse {
  // ... (canonical schema from Section C)
}
```

### F.2 Content Scheduling

**Interface**: Assessment is independent of scheduling decisions.

**Flow**:
```
Scheduled Content → Virality Assessment → Assessment Stored → Scheduler Uses Assessment (Optional)
```

**Integration Pattern**:
- Assessment can be run on scheduled content
- Scheduler can prioritize based on virality score (optional feature)
- Assessment doesn't depend on schedule timing
- Schedule timing can be a "risk factor" in assessment (optional)

**Data Contract**:
- Assessment stored in `virality_assessments` table (new)
- Foreign key to `scheduled_posts.id` (optional, nullable)
- Assessment can exist without scheduled post

### F.3 Social Engagement Analysis

**Interface**: Engagement data informs assessment confidence, but assessment doesn't require engagement data.

**Flow**:
```
Published Content → Engagement Data Collected → Post-Assessment Validation (Optional)
```

**Integration Pattern**:
- Assessment is PRE-publication (diagnostic)
- Engagement data is POST-publication (validation)
- System can compare predicted vs. actual (separate analysis)
- Engagement data doesn't change assessment (assessment is immutable)

**Data Contract**:
```typescript
interface PostPublicationValidation {
  assessment_id: string;
  actual_engagement: EngagementMetrics;
  predicted_score: number;
  actual_outcome: "spread" | "limited" | "failed";
  validation_metadata: {
    timestamp: string;
    time_to_spread?: number; // hours
    peak_engagement_time?: string;
  };
}
```

**Note**: This is a separate analysis, not part of virality assessment itself.

---

## G. Multi-Tenant Architecture

### G.1 Company Context Schema

```sql
CREATE TABLE company_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR(255) UNIQUE NOT NULL,
    
    -- Company Profile
    industry VARCHAR(100),
    company_size VARCHAR(50), -- 'startup', 'small', 'medium', 'large', 'enterprise'
    target_audience JSONB, -- { demographics, interests, values, pain_points }
    
    -- Brand Identity
    brand_voice TEXT, -- Description of brand voice
    brand_values TEXT[], -- Array of brand values
    brand_guidelines JSONB, -- { tone, style, do_not_use, preferred_terms }
    
    -- Content Strategy
    content_objectives JSONB, -- Default objectives and priorities
    content_themes TEXT[], -- Recurring themes
    content_pillars JSONB, -- { pillar_name: description, percentage }
    
    -- Performance Baselines (optional, for calibration)
    historical_performance JSONB, -- { avg_engagement_rate, avg_reach, etc. }
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_company_contexts_company_id ON company_contexts(company_id);
```

### G.2 Assessment Storage (Multi-Tenant)

```sql
CREATE TABLE virality_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR(255) NOT NULL,
    
    -- Content Reference
    content_hash VARCHAR(64) NOT NULL, -- SHA-256 for deduplication
    content_text TEXT, -- Stored for replayability (optional, can be hash-only)
    content_metadata JSONB, -- { length, format, language, etc. }
    
    -- Assessment Input
    objective VARCHAR(50) NOT NULL,
    assessment_method VARCHAR(20) NOT NULL, -- 'rule_based', 'llm', 'hybrid'
    
    -- Assessment Output (canonical schema)
    virality_score DECIMAL(5,2) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL,
    primary_drivers JSONB NOT NULL,
    primary_risks JSONB NOT NULL,
    improvement_levers JSONB NOT NULL,
    
    -- Optional References
    scheduled_post_id UUID REFERENCES scheduled_posts(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
    -- Metadata
    assessment_metadata JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT chk_objective CHECK (objective IN ('reach', 'conversation', 'authority', 'conversion')),
    CONSTRAINT chk_score_range CHECK (virality_score >= 0 AND virality_score <= 100),
    CONSTRAINT chk_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX idx_virality_assessments_company_id ON virality_assessments(company_id);
CREATE INDEX idx_virality_assessments_content_hash ON virality_assessments(content_hash);
CREATE INDEX idx_virality_assessments_objective ON virality_assessments(objective);
CREATE INDEX idx_virality_assessments_score ON virality_assessments(virality_score);
```

### G.3 Tenant Isolation

**Data Isolation**:
- All queries filtered by `company_id`
- Row-level security (RLS) policies enforce tenant boundaries
- Assessments are company-scoped (no cross-tenant access)

**Context Isolation**:
- Each company has its own `company_contexts` record
- Assessment uses company-specific context for resonance analysis
- Brand voice, audience profile, industry norms are company-specific

**Performance Isolation**:
- Assessments are independent (no shared state)
- Can be cached per company (optional optimization)
- Rate limiting per company (optional)

---

## H. Implementation Roadmap

### Phase 1: Core Assessment Engine (Week 1-2)
- [ ] Implement rule-based driver analysis (signal strength, resonance, amplification)
- [ ] Implement rule-based risk analysis (noise, friction, contradiction)
- [ ] Create canonical output schema validator
- [ ] Implement failure condition checks
- [ ] Unit tests for deterministic behavior

### Phase 2: Company Context Integration (Week 3)
- [ ] Create `company_contexts` table
- [ ] Implement context loading and application
- [ ] Update resonance analysis to use company context
- [ ] Multi-tenant data isolation tests

### Phase 3: LLM Enhancement (Optional, Week 4)
- [ ] Integrate LLM for complex content analysis
- [ ] Hybrid mode (rule-based + LLM explanations)
- [ ] LLM prompt engineering for diagnostic questions
- [ ] Cost optimization (cache LLM responses for identical content)

### Phase 4: API & Integration (Week 5)
- [ ] REST API endpoint: `POST /api/virality/assess`
- [ ] Integration with content generation (optional hook)
- [ ] Integration with scheduling (optional priority)
- [ ] Post-publication validation endpoint (separate)

### Phase 5: Migration (Week 6)
- [ ] Migrate existing `viral_coefficient` data (if needed)
- [ ] Deprecate old engagement-based "virality" metrics
- [ ] Update UI to use new assessment model
- [ ] Documentation and training

---

## I. Technical Specifications

### I.1 Assessment Engine Interface

```typescript
interface ViralityAssessmentEngine {
  /**
   * Assess content virality relative to an objective
   * @param request Assessment request with content, objective, and context
   * @returns Virality assessment following canonical schema
   * @throws ValidationError if failure conditions are met
   */
  assess(request: AssessmentRequest): Promise<AssessmentResponse>;
  
  /**
   * Validate assessment request before processing
   * @param request Assessment request to validate
   * @returns Validation result with errors if any
   */
  validate(request: AssessmentRequest): ValidationResult;
}

interface AssessmentRequest {
  content: string;
  objective: "reach" | "conversation" | "authority" | "conversion";
  company_id?: string;
  platform?: string;
  metadata?: Record<string, any>;
}

interface AssessmentResponse {
  // ... (canonical schema from Section C)
}
```

### I.2 Rule-Based Implementation

**Signal Strength Rules**:
- Message clarity: Count of topic keywords vs. total words
- Coherence: Sentence structure analysis (subject-verb-object completeness)
- Focus: Topic consistency across paragraphs

**Resonance Rules**:
- Audience alignment: Keyword matching against company audience profile
- Emotional markers: Detection of emotional language (if audience profile includes emotional preferences)
- Industry relevance: Industry-specific terminology detection

**Amplification Rules**:
- Shareability cues: Question marks, call-to-action phrases
- Structure: Headers, lists, formatting that supports scanning

**Risk Rules**:
- Noise: Information density (words per sentence, sentences per paragraph)
- Friction: Length thresholds, complexity metrics
- Contradiction: Brand voice keyword mismatches, conflicting claims detection

### I.3 LLM Integration (Optional)

**When to Use LLM**:
- Content length > 500 words
- Complex semantic analysis needed
- Explanation generation required

**LLM Prompt Structure**:
```
You are a virality assessment analyst. Analyze the following content for its potential to spread, relative to the objective: {objective}.

Company Context:
- Industry: {industry}
- Target Audience: {audience_profile}
- Brand Voice: {brand_voice}

Content:
{content}

Answer these diagnostic questions:
1. What is the core message? (signal strength)
2. How well does it resonate with the target audience? (resonance)
3. What structural features enable sharing? (amplification)
4. What factors create noise, friction, or contradiction? (risks)

Provide structured JSON response following the canonical schema.
```

---

## J. Success Metrics

### J.1 Assessment Quality
- **Determinism**: Same content + objective + context = same assessment (100% replayability)
- **Explanation Quality**: Human evaluators can understand why score was assigned
- **Actionability**: Improvement levers lead to measurable score increases

### J.2 System Performance
- **Latency**: < 2 seconds for rule-based, < 10 seconds for LLM-enhanced
- **Throughput**: 100 assessments/second (rule-based), 10 assessments/second (LLM)
- **Accuracy**: Post-publication validation shows correlation between score and actual spread (target: r > 0.6)

### J.3 Adoption
- **Usage**: 80% of content goes through assessment before publication
- **Iteration**: Average 2.5 iterations per content piece (using improvement levers)
- **Satisfaction**: Users report assessment helps improve content quality

---

## K. Open Questions & Future Work

1. **Calibration**: Should the system learn from post-publication outcomes to calibrate scores?
   - **Recommendation**: Keep assessment deterministic. Create separate calibration service that adjusts company baselines.

2. **Platform-Specific Optimization**: How deep should platform layer go?
   - **Recommendation**: Keep platform layer optional and shallow. Focus on content-level drivers first.

3. **Real-Time Assessment**: Should assessment be available during content editing?
   - **Recommendation**: Yes, but as optional feature. Core API remains stateless.

4. **Historical Analysis**: Should system analyze why past content spread or didn't?
   - **Recommendation**: Separate "post-mortem" analysis service. Not part of virality assessment.

---

## L. Conclusion

This redesign separates virality assessment from engagement metrics, making it objective-driven, diagnostic, and company-context-aware. The system is deterministic, replayable, and API-friendly, enabling integration with content generation and scheduling without tight coupling.

The multi-tenant architecture supports company-specific context while maintaining data isolation and performance. The canonical output schema ensures consistency and enables downstream analysis.

**Next Steps**: 
1. Review and approve design
2. Begin Phase 1 implementation
3. Create detailed technical specifications for each component
4. Set up testing framework for deterministic behavior validation

---

**Document Status**: Ready for Review  
**Author**: AI Assistant  
**Reviewers**: [Pending]  
**Approval**: [Pending]
