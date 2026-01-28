# Virality Assessment Redesign: Executive Summary

## Key Findings

### Current Problems
1. **Conflation**: System treats engagement metrics (likes, shares) as virality
2. **No Objective**: Virality assessed without explicit goal (reach? conversation? authority? conversion?)
3. **Post-Hoc Only**: Assessment happens after publication using platform APIs
4. **Platform-Centric**: Analysis tied to platforms rather than objectives
5. **Single Metric**: `viral_coefficient` suggests one number captures everything

### Evidence
- `content_performance_insights.viral_coefficient` stored alongside engagement metrics
- `ContentAnalyzer` calculates "engagement potential" without objective context
- No explicit objective required before assessment

---

## Proposed Solution

### Core Model: Objective-Driven Diagnostic Assessment

**Input Required**:
- Content (text/media metadata)
- **Objective** (reach | conversation | authority | conversion) ← **REQUIRED**
- Company context (industry, audience, brand voice)
- Optional: Platform constraints

**Output** (Canonical Schema):
```json
{
  "objective": "conversation",
  "virality_score": 72,  // 0-100, relative to objective
  "confidence": 0.85,
  "primary_drivers": [
    {
      "factor": "resonance",
      "strength": 0.88,
      "explanation": "Why this helps spread",
      "evidence": ["specific content elements"]
    }
  ],
  "primary_risks": [
    {
      "factor": "friction",
      "severity": 0.45,
      "explanation": "Why this reduces spread",
      "evidence": ["specific content elements"]
    }
  ],
  "improvement_levers": [
    {
      "lever": "Content structure",
      "impact": 0.25,
      "action": "Add executive summary...",
      "priority": "high"
    }
  ]
}
```

### Assessment Factors

**Drivers** (increase spread probability):
- **Signal Strength**: Message clarity, coherence
- **Resonance**: Alignment with audience values/needs
- **Amplification Potential**: Structural features enabling sharing

**Risks** (decrease spread probability):
- **Noise**: Elements obscuring core message
- **Friction**: Barriers to sharing
- **Contradiction**: Conflicts with company context

---

## Failure Conditions (System Refuses to Run)

1. ❌ Missing objective
2. ❌ Incoherent content (empty, malformed)
3. ❌ Unsupported format
4. ❌ Missing company context (when required)
5. ❌ Objective-content mismatch (fundamentally incompatible)

---

## Multi-Tenant Architecture

### Company Context Schema
```sql
CREATE TABLE company_contexts (
    id UUID PRIMARY KEY,
    company_id VARCHAR(255) UNIQUE,
    industry VARCHAR(100),
    target_audience JSONB,
    brand_voice TEXT,
    brand_values TEXT[],
    content_objectives JSONB
);
```

### Assessment Storage
```sql
CREATE TABLE virality_assessments (
    id UUID PRIMARY KEY,
    company_id VARCHAR(255) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    objective VARCHAR(50) NOT NULL,
    virality_score DECIMAL(5,2),
    confidence DECIMAL(3,2),
    primary_drivers JSONB,
    primary_risks JSONB,
    improvement_levers JSONB,
    assessment_metadata JSONB
);
```

**Tenant Isolation**: All queries filtered by `company_id`, RLS policies enforce boundaries.

---

## Integration Points (Decoupled)

### Content Generation
- Assessment called AFTER generation (not during)
- REST API: `POST /api/virality/assess`
- Result stored separately, generator can iterate

### Content Scheduling
- Assessment independent of scheduling
- Scheduler can prioritize by score (optional)
- Assessment doesn't depend on timing

### Social Engagement Analysis
- Assessment is PRE-publication (diagnostic)
- Engagement data is POST-publication (validation)
- Separate "post-mortem" analysis (not part of assessment)

---

## Implementation Phases

1. **Phase 1** (Week 1-2): Core rule-based engine
2. **Phase 2** (Week 3): Company context integration
3. **Phase 3** (Week 4): LLM enhancement (optional)
4. **Phase 4** (Week 5): API & integrations
5. **Phase 5** (Week 6): Migration from old system

---

## Key Principles

✅ **Objective-Driven**: Virality meaningless without explicit objective  
✅ **Diagnostic**: Explains WHY, not HOW  
✅ **Deterministic**: Same input = same output (replayable)  
✅ **Platform-Agnostic Core**: Platform behavior is optional layer  
✅ **Company Context Aware**: Uses company-specific factors  
✅ **API-Friendly**: RESTful, stateless, cacheable  

---

## Success Metrics

- **Determinism**: 100% replayability (same input = same output)
- **Latency**: < 2s (rule-based), < 10s (LLM)
- **Throughput**: 100/sec (rule-based), 10/sec (LLM)
- **Correlation**: r > 0.6 between score and actual spread
- **Adoption**: 80% of content assessed before publication

---

## Next Steps

1. Review full design document: `VIRALITY_ASSESSMENT_REDESIGN.md`
2. Approve architecture and schema
3. Begin Phase 1 implementation
4. Set up testing framework for deterministic validation

---

**Full Report**: See `VIRALITY_ASSESSMENT_REDESIGN.md` for complete technical specifications, diagnostic questions, examples, and implementation details.
