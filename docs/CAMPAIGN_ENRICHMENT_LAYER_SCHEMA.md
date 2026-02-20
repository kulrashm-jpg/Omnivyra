# Campaign Enrichment Layer — Output Schema

## Input (unchanged — from current recommendation)

```
RECOMMENDATION_INPUT
├── context: string
├── aspect: string
├── facets: string[]
├── sub_angles: string[]
├── audience_personas: string[]
├── messaging_hooks: string[]
├── estimated_reach: string | number | null
└── formats: string[]
```

---

## Output Schema

```
CAMPAIGN_ENRICHED_RECOMMENDATION
├── input_signature
│   └── { hash or ref to RECOMMENDATION_INPUT }
│
├── duration_suggestion
│   ├── value: "2_weeks" | "4_weeks" | "8_weeks" | "12_weeks"
│   ├── weeks: 2 | 4 | 8 | 12
│   └── rationale: string | null
│
├── weekly_progression
│   └── weeks: [
│       ├── week_number: number
│       ├── intent: string
│       ├── psychological_movement: string
│       └── content_objective: string
│     ]
│
├── campaign_intensity
│   └── mode: "educational" | "trust_building" | "conversion_acceleration"
│
├── content_distribution
│   ├── educational_pct: number
│   ├── authority_pct: number
│   ├── engagement_pct: number
│   └── conversion_pct: number
│
└── baton_passing
    ├── start_signal: string
    ├── continuation_signal: string
    ├── transition_signal: string
    └── closing_signal: string
```

---

## TypeScript-style structure (reference)

```ts
type DurationValue = "2_weeks" | "4_weeks" | "8_weeks" | "12_weeks";
type IntensityMode = "educational" | "trust_building" | "conversion_acceleration";

interface DurationSuggestion {
  value: DurationValue;
  weeks: number;
  rationale: string | null;
}

interface WeekProgression {
  week_number: number;
  intent: string;
  psychological_movement: string;
  content_objective: string;
}

interface ContentDistribution {
  educational_pct: number;
  authority_pct: number;
  engagement_pct: number;
  conversion_pct: number;
}

interface BatonPassing {
  start_signal: string;
  continuation_signal: string;
  transition_signal: string;
  closing_signal: string;
}

interface CampaignEnrichedRecommendation {
  input_signature?: Record<string, unknown>;
  duration_suggestion: DurationSuggestion;
  weekly_progression: { weeks: WeekProgression[] };
  campaign_intensity: { mode: IntensityMode };
  content_distribution: ContentDistribution;
  baton_passing: BatonPassing;
}
```
