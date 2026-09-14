/**
 * DT-C4B — FROZEN 12-COMPANY RAINA-ORIGINATED CORPUS
 * `canonicalGrounding.u1Dataset.raina12`
 *
 * PROVENANCE
 * ----------
 * These 12 records were supplied by Raina, an author independent of the agent
 * that implemented DT-C1/DT-C2/DT-C3. They describe REAL companies and cite
 * REAL external sources (YourStory, Inc42, CEO Insider, Business India, Times of
 * India, eChai Ventures, CB Insights / Startup Pedia, Dealroom).
 *
 * TRANSCRIPTION RULE — the whole point of this file
 * ------------------------------------------------
 * Every factual string below is transcribed VERBATIM from the supplied corpus.
 * The agent did NOT author, infer, improve, complete, strengthen, re-word or
 * research any fact. Where the source is silent, the field is recorded as
 * `NOT AVAILABLE FROM SOURCE` — never backfilled.
 *
 * In particular the agent did NOT:
 *   • convert a target or projection into revenue,
 *   • annualise a monthly run-rate,
 *   • convert an order book into revenue,
 *   • resolve a "verify" placeholder into a name,
 *   • supply products/services, value proposition, ICP, brand voice, content
 *     themes, pain points, competitive advantages or positioning — none of which
 *     the source corpus contains.
 *
 * FACT vs SYNTHESIS (DT-C4B §5) — enforced structurally
 * ----------------------------------------------------
 * `sourceFacts`          — company evidence, may be treated as source-supported.
 * `derivedIntelligence`  — Omnivyra scoring/routing output. This is SYNTHESIS.
 *                          It must NEVER be presented as independent company
 *                          fact, and must NEVER be used as grounding input.
 * The two are separate objects so they cannot be conflated by accident.
 *
 * ⚠️ WHAT THIS CORPUS IS NOT
 * This is a PROSPECT / LEAD list, not a company-profile corpus. It carries no
 * products_services, unique_value, ideal_customer_profile, brand_voice,
 * content_themes, pain_symptoms, competitive_advantages or brand_positioning —
 * the fields the U1 workloads actually consume. See `groundingFieldCoverage()`.
 *
 * Preserves, unmodified: goldenDataset.v1, u1Dataset.v2, u1-001, u1-002, u1-003.
 */

export const RAINA12_DATASET_ID = 'canonicalGrounding.u1Dataset.raina12' as const;
export const RAINA12_DATASET_VERSION = 'raina12-v1' as const;
export const RAINA12_PROVENANCE_CLASS = 'REAL COMPANIES — EXTERNALLY SOURCED, INDEPENDENTLY PREPARED' as const;
export const RAINA12_COMPANY_COUNT = 12;

/** DT-C4B §2 — explicitly out of scope. Recorded so exclusion is auditable. */
export const EXCLUDED_APPENDED_COMPANIES: readonly string[] = Object.freeze([
  'SpesNet', 'Speso', 'Spetrol', 'SPETECH', 'SPETS AB',
  'Spetco International Petroleum Co.', 'Spesafacile', 'Spesasicura',
]);

export const NOT_AVAILABLE = 'NOT AVAILABLE FROM SOURCE' as const;

/** DT-C4B §6 revenue classification vocabulary. */
export type RevenueClass =
  | 'VERIFIED SOURCE FACT'
  | 'REPORTED FACT'
  | 'TARGET / PROJECTION'
  | 'RUN-RATE'
  | 'ORDER BOOK'
  | 'NOT AVAILABLE FROM SOURCE';

export interface RevenueClaim {
  /** Verbatim from the supplied corpus. Never re-worded. */
  verbatim: string;
  classification: RevenueClass;
  /** Why this classification; and any wording that could mislead. */
  note: string;
}

/** Company evidence — may be treated as source-supported where cited. */
export interface SourceFacts {
  name: string;
  industry: string;
  city: string;
  revenueEvidenceVerbatim: string;
  revenueClaims: RevenueClaim[];
  growthSignalVerbatim: string;
  /** Only where the source explicitly identifies a person (§5). */
  identifiedPeople: { name: string; role: string }[];
  /** Role placeholders the source did NOT resolve — synthesis, not fact. */
  unresolvedPersonaSlots: string[];
  sourceProvenanceVerbatim: string;
  sourceCitations: string[];
  /** Raina's own pre-freeze instruction, where present. Verbatim. */
  reVerificationFlag: string | null;
}

/**
 * Omnivyra-derived intelligence. SYNTHESIS — never a company fact, never
 * grounding input. Retained verbatim for fidelity to the supplied corpus.
 */
export interface DerivedIntelligence {
  fit: number;
  need: number;
  intent: number;
  persona: number;
  evidence: number;
  total: number;
  priority: string;
  recommendedChannel: string;
  outreachAngle: string;
}

export interface Raina12Record {
  index: number;
  slug: string;
  sourceFacts: SourceFacts;
  derivedIntelligence: DerivedIntelligence;
}

/** Grounding fields the U1 workloads consume. Absent across this corpus. */
export const GROUNDING_FIELDS_NOT_SUPPLIED: readonly string[] = Object.freeze([
  'products_services', 'products_services_list', 'unique_value',
  'ideal_customer_profile', 'target_audience', 'target_audience_list',
  'pain_symptoms', 'competitive_advantages', 'brand_positioning', 'brand_voice',
  'content_themes', 'content_themes_list',
]);

const RECORDS: Raina12Record[] = [
  {
    index: 1, slug: 'secure-it-simply',
    sourceFacts: {
      name: 'Secure IT Simply', industry: 'IT Services / Cybersecurity', city: 'India / Remote',
      revenueEvidenceVerbatim: '₹10 Cr+ revenue reported; 20+ specialists',
      revenueClaims: [{
        verbatim: '₹10 Cr+ revenue reported',
        classification: 'REPORTED FACT',
        note: 'Company/profile-reported, not independently audited. Source carries an explicit pre-freeze re-verification instruction.',
      }],
      growthSignalVerbatim: 'Expansion toward Middle East, Singapore, Australia & NZ; AI/security focus',
      identifiedPeople: [{ name: 'Jitesh Midha', role: 'Co-founder' }],
      unresolvedPersonaSlots: ['Head of Sales / Marketing — verify'],
      sourceProvenanceVerbatim: 'CB Insights / Startup Pedia profile; re-verify revenue and current expansion evidence before final experimental freeze',
      sourceCitations: ['CB Insights', 'Startup Pedia'],
      reVerificationFlag: 're-verify revenue and current expansion evidence before final experimental freeze',
    },
    derivedIntelligence: { fit: 18, need: 17, intent: 18, persona: 17, evidence: 9, total: 79, priority: 'A', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Turn existing credibility and international expansion into a repeatable pipeline of qualified SMB prospects across India and overseas markets.' },
  },
  {
    index: 2, slug: 'tensech-solutions',
    sourceFacts: {
      name: 'Tensech Solutions', industry: 'IT Services / Software Engineering', city: 'Noida / Lucknow',
      revenueEvidenceVerbatim: '₹7 Cr FY25 reported; ₹10 Cr FY26 target — distinguish reported revenue from target',
      revenueClaims: [
        { verbatim: '₹7 Cr FY25 reported', classification: 'REPORTED FACT', note: 'Source states this must be labelled company/profile-reported, not independently verified.' },
        { verbatim: '₹10 Cr FY26 target', classification: 'TARGET / PROJECTION', note: 'Forward target. MUST NOT be represented as revenue.' },
      ],
      growthSignalVerbatim: 'US/EU customer base; building proprietary products; continued expansion',
      identifiedPeople: [
        { name: 'Abhilekh Kumar Choudhary', role: 'Co-founder' },
        { name: 'Abhishek Shukla', role: 'Co-founder' },
        { name: 'Rajesh Sharma', role: 'Co-founder' },
      ],
      unresolvedPersonaSlots: [],
      sourceProvenanceVerbatim: 'LinkedIn / Startup Pedia; revenue should be labelled company/profile-reported, not independently verified',
      sourceCitations: ['LinkedIn', 'Startup Pedia'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 18, intent: 18, persona: 18, evidence: 10, total: 82, priority: 'A', recommendedChannel: 'LinkedIn + Email + Phone', outreachAngle: 'Founder-led growth and international customers create a strong use case for ICP-led account discovery and outbound pipeline generation.' },
  },
  {
    index: 3, slug: 'dreamtime-learning',
    sourceFacts: {
      name: 'Dreamtime Learning', industry: 'Education / EdTech', city: 'Hyderabad / Pune',
      revenueEvidenceVerbatim: '~₹10 Cr prior-year revenue reported; ₹20 Cr FY27 is target',
      revenueClaims: [
        { verbatim: '~₹10 Cr prior-year revenue reported', classification: 'REPORTED FACT', note: 'Source-reported prior-year figure; approximate ("~").' },
        { verbatim: '₹20 Cr FY27 is target', classification: 'TARGET / PROJECTION', note: 'Forward target. MUST NOT be represented as revenue.' },
      ],
      growthSignalVerbatim: 'India + Middle East; Malaysia pilot; exploring additional markets',
      identifiedPeople: [
        { name: 'Sudip Saha', role: 'Co-founder' },
        { name: 'Lina Ashar', role: 'Founder' },
      ],
      unresolvedPersonaSlots: [],
      sourceProvenanceVerbatim: 'YourStory, Apr 2026; revenue and expansion statements are source-reported',
      sourceCitations: ['YourStory (Apr 2026)'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 18, intent: 20, persona: 18, evidence: 10, total: 84, priority: 'A', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Use geographic expansion signals to build targeted school, parent and partner prospect lists in new markets.' },
  },
  {
    index: 4, slug: 'tautmore',
    sourceFacts: {
      name: 'TAUTMORE', industry: 'Education / EdTech B2B', city: 'India',
      revenueEvidenceVerbatim: '₹10 Cr+ in 2025 reported; ₹20 Cr+ 2026 projection',
      revenueClaims: [
        { verbatim: '₹10 Cr+ in 2025 reported', classification: 'REPORTED FACT', note: 'Reported in a company presentation. Source flags it for independent re-verification.' },
        { verbatim: '₹20 Cr+ 2026 projection', classification: 'TARGET / PROJECTION', note: 'Explicit projection. MUST NOT be represented as revenue.' },
      ],
      growthSignalVerbatim: '200+ schools; targeting 400+; direct sales, education fairs and inside sales',
      identifiedPeople: [],
      unresolvedPersonaSlots: ['Founder / CEO — verify', 'Head of Sales / Marketing — verify'],
      sourceProvenanceVerbatim: 'Automate.video company presentation; founder, revenue and school-count evidence should be independently re-verified',
      sourceCitations: ['Automate.video company presentation'],
      reVerificationFlag: 'founder, revenue and school-count evidence should be independently re-verified',
    },
    derivedIntelligence: { fit: 19, need: 19, intent: 20, persona: 16, evidence: 9, total: 83, priority: 'A', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Build a repeatable school-prospecting engine beyond event-led and direct-sales acquisition.' },
  },
  {
    index: 5, slug: 'kruu',
    sourceFacts: {
      name: 'Kruu', industry: 'Education / EdTech', city: 'Chennai',
      revenueEvidenceVerbatim: '~₹18–20 Cr annualised target; profitability reported — not equivalent to audited revenue',
      revenueClaims: [
        { verbatim: '~₹18–20 Cr annualised target', classification: 'TARGET / PROJECTION', note: 'Annualised TARGET. Source explicitly states it is not equivalent to audited revenue and must remain labelled as annualised.' },
        { verbatim: 'profitability reported', classification: 'REPORTED FACT', note: 'A profitability statement, not a revenue figure.' },
      ],
      growthSignalVerbatim: '500+ schools; 100+ locations; Middle East/East Africa/East Asia expansion',
      identifiedPeople: [{ name: 'Anil Srinivasan', role: 'Founder' }],
      unresolvedPersonaSlots: ['Partnerships / Growth — verify'],
      sourceProvenanceVerbatim: 'Business India, May 2026; annualised figure should remain explicitly labelled as such',
      sourceCitations: ['Business India (May 2026)'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 19, intent: 20, persona: 17, evidence: 8, total: 82, priority: 'A', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Account-based school and education-partner prospecting across India and international expansion markets.' },
  },
  {
    index: 6, slug: 'inlife-healthcare',
    sourceFacts: {
      name: 'INLIFE Healthcare', industry: 'Nutraceuticals / D2C', city: 'Hyderabad',
      revenueEvidenceVerbatim: '₹20 Cr+ FY25 reported',
      revenueClaims: [{
        verbatim: '₹20 Cr+ FY25 reported',
        classification: 'REPORTED FACT',
        note: 'Directly reported in the cited source (YourStory / company statements). No forward figure conflated.',
      }],
      growthSignalVerbatim: 'Ships to 20+ countries; aims to double revenue; expanding exports, D2C and B2B/distribution',
      identifiedPeople: [
        { name: 'Prateek Agarwal', role: 'Co-founder' },
        { name: 'Chetan Agarwal', role: 'Co-founder' },
      ],
      unresolvedPersonaSlots: [],
      sourceProvenanceVerbatim: 'YourStory / company statements; FY25 >₹20Cr and 20+ markets are directly reported',
      sourceCitations: ['YourStory', 'company statements'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 18, intent: 20, persona: 18, evidence: 10, total: 84, priority: 'A', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Convert D2C and international growth into structured distributor, partner, retail and market prospecting.' },
  },
  {
    index: 7, slug: 'mrmed',
    sourceFacts: {
      name: 'MrMed', industry: 'Healthcare / Specialty Medicines', city: 'Chennai',
      revenueEvidenceVerbatim: '₹33.5 Cr FY25; ₹23.9 Cr FY24',
      revenueClaims: [
        { verbatim: '₹33.5 Cr FY25', classification: 'VERIFIED SOURCE FACT', note: 'Independently reported by Inc42 (third-party financial coverage), corroborated by YourStory. Strongest revenue evidence in the corpus.' },
        { verbatim: '₹23.9 Cr FY24', classification: 'VERIFIED SOURCE FACT', note: 'Prior-year figure from the same third-party coverage.' },
        { verbatim: '₹80–90 Cr current-year expectation', classification: 'TARGET / PROJECTION', note: 'Appears in the growth signal. Forward EXPECTATION. MUST NOT be represented as revenue.' },
      ],
      growthSignalVerbatim: '~40% FY25 growth; ₹80–90 Cr current-year expectation; home-based cancer-care expansion',
      identifiedPeople: [
        { name: 'Devashish Singh', role: 'Co-founder' },
        { name: 'Saurab Jain', role: 'Co-founder' },
      ],
      unresolvedPersonaSlots: [],
      sourceProvenanceVerbatim: 'Inc42 + YourStory; FY25 ₹33.5Cr and ~40% growth independently reported',
      sourceCitations: ['Inc42', 'YourStory'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 16, need: 18, intent: 20, persona: 18, evidence: 10, total: 82, priority: 'A-', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Map institutional, specialist, healthcare and partner ecosystems as the company expands beyond digital medicine distribution.' },
  },
  {
    index: 8, slug: 'sensivision',
    sourceFacts: {
      name: 'Sensivision Health Technologies', industry: 'Medtech / Healthcare B2B', city: 'Bengaluru',
      revenueEvidenceVerbatim: 'Do not treat ₹4Cr→₹20–30Cr as actual revenue. Retain only as stated trajectory/target until independently verified.',
      revenueClaims: [{
        verbatim: '₹4Cr→₹20–30Cr',
        classification: 'TARGET / PROJECTION',
        note: 'Source issues an EXPLICIT PROHIBITION against treating this as actual revenue. Retained as stated trajectory/target only. No verified revenue figure exists for this company.',
      }],
      growthSignalVerbatim: 'Export ambitions; capital seeking; second product planned; international expansion',
      identifiedPeople: [],
      unresolvedPersonaSlots: ['Founder / CEO — verify', 'Business Development / Commercial Head — verify'],
      sourceProvenanceVerbatim: 'YourStory, Feb 2025; revenue evidence requires re-verification',
      sourceCitations: ['YourStory (Feb 2025)'],
      reVerificationFlag: 'revenue evidence requires re-verification',
    },
    derivedIntelligence: { fit: 17, need: 18, intent: 20, persona: 15, evidence: 8, total: 78, priority: 'B+', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Build hospital, distributor and importer prospecting for domestic and export expansion.' },
  },
  {
    index: 9, slug: 'vector-technics',
    sourceFacts: {
      name: 'Vector Technics', industry: 'Advanced Manufacturing / Drone Propulsion', city: 'India',
      revenueEvidenceVerbatim: 'Current monthly run-rate ₹3–5 Cr; FY order book ₹40 Cr',
      revenueClaims: [
        { verbatim: 'Current monthly run-rate ₹3–5 Cr', classification: 'RUN-RATE', note: 'MONTHLY run-rate. MUST NOT be annualised. No annual revenue figure exists for this company.' },
        { verbatim: 'FY order book ₹40 Cr', classification: 'ORDER BOOK', note: 'Order book, i.e. contracted future work. MUST NOT be represented as revenue.' },
      ],
      growthSignalVerbatim: 'Factory/capacity expansion; domestic demand + export-market development; FY27 growth ambition',
      identifiedPeople: [{ name: 'Prudhvi Raj Pakalapati', role: 'CEO' }],
      unresolvedPersonaSlots: ['Business Development / Sales Head — verify'],
      sourceProvenanceVerbatim: 'CEO Insider, 2026; CEO reports ₹3–5Cr monthly run-rate and ₹40Cr order book',
      sourceCitations: ['CEO Insider (2026)'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 19, intent: 20, persona: 18, evidence: 10, total: 85, priority: 'A', recommendedChannel: 'Email + LinkedIn + Phone', outreachAngle: 'Target OEMs, drone companies, integrators and export buyers using account-level prospect intelligence.' },
  },
  {
    index: 10, slug: 'hummingbird-consulting',
    sourceFacts: {
      name: 'Hummingbird Consulting', industry: 'Professional / HR Consulting', city: 'Ahmedabad',
      revenueEvidenceVerbatim: '₹10 Cr 2025 target, not verified actual revenue',
      revenueClaims: [{
        verbatim: '₹10 Cr 2025 target',
        classification: 'TARGET / PROJECTION',
        note: 'Source explicitly states this is a target and NOT verified actual revenue. No revenue figure exists for this company.',
      }],
      growthSignalVerbatim: 'Planned Bengaluru/Jaipur offices; overseas expansion; hiring',
      identifiedPeople: [{ name: 'Harsha Bhurani', role: 'CEO' }],
      unresolvedPersonaSlots: ['Business Development / Growth — verify'],
      sourceProvenanceVerbatim: 'eChai Ventures founder post; revenue must remain labelled target, not actual',
      sourceCitations: ['eChai Ventures founder post'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 18, intent: 18, persona: 19, evidence: 7, total: 80, priority: 'B+', recommendedChannel: 'LinkedIn + Email + Phone', outreachAngle: 'Founder-led geographic expansion creates a strong opportunity for structured account discovery and outbound.' },
  },
  {
    index: 11, slug: 'yoho',
    sourceFacts: {
      name: 'Yoho', industry: 'D2C Footwear / E-commerce', city: 'New Delhi',
      revenueEvidenceVerbatim: '₹17 Cr+ FY24; ~356% YoY growth reported',
      revenueClaims: [
        { verbatim: '₹17 Cr+ FY24', classification: 'VERIFIED SOURCE FACT', note: 'Independently reported by Inc42 and Dealroom (third-party financial coverage).' },
        { verbatim: '~356% YoY growth reported', classification: 'REPORTED FACT', note: 'Growth rate, not a revenue figure. FY24 is the most recent year cited — no FY25 figure supplied.' },
      ],
      growthSignalVerbatim: 'Fresh 2026 funding; offline retail expansion; performance-running category expansion',
      identifiedPeople: [
        { name: 'Prateek Singhal', role: 'Co-founder' },
        { name: 'Ahmad Hushsham', role: 'Co-founder' },
      ],
      unresolvedPersonaSlots: [],
      sourceProvenanceVerbatim: 'Inc42 + Dealroom; FY24 revenue and 2026 funding/expansion independently reported',
      sourceCitations: ['Inc42', 'Dealroom'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 16, need: 18, intent: 20, persona: 18, evidence: 7, total: 79, priority: 'B+', recommendedChannel: 'Email + LinkedIn', outreachAngle: 'Use funding, retail expansion and category expansion signals to identify channel, retail and partnership opportunities.' },
  },
  {
    index: 12, slug: 'nxtface',
    sourceFacts: {
      name: 'NXTFACE', industry: 'D2C Skincare / Beauty', city: 'Chennai',
      revenueEvidenceVerbatim: 'Revenue not verified; ₹10 Cr initial investment; ₹100 Cr 2026 ambition',
      revenueClaims: [
        { verbatim: 'Revenue not verified', classification: 'NOT AVAILABLE FROM SOURCE', note: 'No revenue figure exists for this company.' },
        { verbatim: '₹10 Cr initial investment', classification: 'REPORTED FACT', note: 'INVESTMENT, not revenue. Source states investment must be treated separately from actual revenue.' },
        { verbatim: '₹100 Cr 2026 ambition', classification: 'TARGET / PROJECTION', note: 'Stated AMBITION. MUST NOT be represented as revenue.' },
      ],
      growthSignalVerbatim: 'New D2C launch; omnichannel distribution; AI skincare recommendation; customer-acquisition partnership',
      identifiedPeople: [{ name: 'Dhamyanthi Kumaravel', role: 'Founder & CEO' }],
      unresolvedPersonaSlots: ['Marketing / Growth Head — verify'],
      sourceProvenanceVerbatim: 'Times of India, 2025; investment/ambition should be treated separately from actual revenue',
      sourceCitations: ['Times of India (2025)'],
      reVerificationFlag: null,
    },
    derivedIntelligence: { fit: 18, need: 19, intent: 20, persona: 18, evidence: 9, total: 84, priority: 'A', recommendedChannel: 'Email + LinkedIn', outreachAngle: 'Convert launch momentum into structured prospecting across digital partners, distribution channels and customer-acquisition ecosystems.' },
  },
];

export function loadRaina12(): readonly Raina12Record[] {
  return RECORDS;
}

/**
 * The GROUNDING-RELEVANT projection: source facts only, synthesis excluded.
 * This is what a U1 grounded arm could legitimately inject.
 */
export function raina12GroundingFacts(): Record<string, unknown>[] {
  return RECORDS.map((r) => ({
    id: `raina12-${String(r.index).padStart(2, '0')}-${r.slug}`,
    name: r.sourceFacts.name,
    industry: r.sourceFacts.industry,
    city: r.sourceFacts.city,
    revenue_evidence: r.sourceFacts.revenueEvidenceVerbatim,
    growth_signal: r.sourceFacts.growthSignalVerbatim,
    identified_people: r.sourceFacts.identifiedPeople.map((p) => `${p.name} — ${p.role}`),
    source_provenance: r.sourceFacts.sourceProvenanceVerbatim,
  }));
}

/** Which U1 workload grounding fields this corpus can populate. */
export function groundingFieldCoverage(): { field: string; populated: number; total: number }[] {
  const total = RECORDS.length;
  return [
    { field: 'name', populated: RECORDS.filter((r) => r.sourceFacts.name).length, total },
    { field: 'industry', populated: RECORDS.filter((r) => r.sourceFacts.industry).length, total },
    { field: 'growth_priorities (via growth signal)', populated: RECORDS.filter((r) => r.sourceFacts.growthSignalVerbatim).length, total },
    ...GROUNDING_FIELDS_NOT_SUPPLIED.map((field) => ({ field, populated: 0, total })),
  ];
}
