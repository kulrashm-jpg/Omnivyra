/**
 * DT-C3 — U1 EVALUATION DATASET v2  (`canonicalGrounding.u1Dataset.v2`)
 *
 * ⚠️ AUTHORSHIP DISCLOSURE — READ BEFORE USING THIS DATASET AS EVIDENCE ⚠️
 * ------------------------------------------------------------------------
 * The factual ground truth in this file was authored by the SAME AI coding agent
 * that implemented the grounding evaluation infrastructure (DT-C1/DT-C2). It is
 * therefore **NOT INDEPENDENTLY AUTHORED** and **NOT EXTERNALLY VALIDATED**.
 *
 * These are SYNTHETIC companies. They do not exist. No fact here was drawn from,
 * or verified against, any external public source. Any resemblance to a real
 * organisation is unintended and must not be relied upon.
 *
 * What v2 DOES fix, relative to `goldenDataset.v1`:
 *   • L-1 (duplicated facts) — every company has substantively distinct offerings,
 *     value proposition, ICP, positioning, voice, themes, pains, advantages and
 *     growth priorities. Machine-verified by `u1DatasetValidator`.
 *   • L-2 (internal contradiction) — `market_pulse.core_offerings` is now DERIVED
 *     from `products_services_list`, so the two can never disagree. See §11.
 *
 * What v2 does NOT fix:
 *   • L-3 (authorship independence). Unchanged and unfixable from inside this
 *     repository. Closing it requires ground truth authored or verified by a
 *     party independent of the implementation author. Until then this dataset
 *     remains an ENGINEERING FIXTURE — a materially better one, but a fixture.
 *
 * v1 (`goldenDataset.v1`) is PRESERVED UNCHANGED in `dataset.ts`. This file adds
 * a new dataset identity; it does not modify, wrap, or supersede v1 in place.
 */

import type { Activity, CompanySize, Completeness, DatasetEntry } from './types';

export const U1_DATASET_ID = 'canonicalGrounding.u1Dataset.v2' as const;
export const U1_DATASET_VERSION = 'v2' as const;
export const U1_DATASET_PROVENANCE_CLASS = 'SYNTHETIC — NOT INDEPENDENTLY AUTHORED' as const;

/** Fixed evaluation epoch — deterministic freshness/assembly. Never Date.now(). */
export const U1_EVAL_EPOCH = Date.parse('2026-07-15T00:00:00Z');
const daysAgo = (n: number) => new Date(U1_EVAL_EPOCH - n * 86_400_000).toISOString();

/**
 * One company's substantive ground truth. Every text field is company-specific;
 * no field value may be shared with another company (validator-enforced).
 */
export interface CompanySpec {
  slug: string;
  name: string;
  industry: string;
  category: string;
  /** Canonical offering list — the SINGLE source of truth for what is sold. */
  offerings: [string, string];
  uniqueValue: string;
  idealCustomerProfile: string;
  audienceRoles: [string, string];
  painSymptoms: [string, string];
  competitiveAdvantages: [string, string];
  brandPositioning: string;
  brandVoice: string;
  contentThemes: [string, string];
  growthPriorities: [string];
  businessModel: string;
  marketContext: string;
  namedCompetitors: [string, string];
  size: CompanySize;
  completeness: Completeness;
  website: boolean;
  market: boolean;
  activity: Activity;
  recentTitles: string[];
}

/**
 * 22 companies across 22 distinct industries. Each row is substantively
 * different in offering, buyer, business model and market context — not a
 * renamed copy of a template.
 */
const COMPANIES: CompanySpec[] = [
  {
    slug: 'agri', name: 'Loamwise', industry: 'Precision agriculture', category: 'Soil intelligence network',
    offerings: ['Buried soil sensor mesh', 'Agronomy advisory portal'],
    uniqueValue: 'Cut fertiliser spend without losing yield on variable soils',
    idealCustomerProfile: 'Row-crop farm operators managing 2,000+ contiguous acres',
    audienceRoles: ['Farm operations managers', 'Independent agronomists'],
    painSymptoms: ['blanket fertiliser application', 'no sub-field moisture visibility'],
    competitiveAdvantages: ['Sensors survive a full tillage season', 'Advisory tied to local extension data'],
    brandPositioning: 'practical, field-tested, sceptical of hype',
    brandVoice: 'plain-spoken and evidence-led',
    contentThemes: ['variable-rate nutrition', 'soil moisture economics'],
    growthPriorities: ['expand into irrigated corn belt districts'],
    businessModel: 'Hardware deposit plus per-acre annual subscription',
    marketContext: 'Fertiliser price volatility is pushing growers toward measured application',
    namedCompetitors: ['FieldAxis', 'TerraSignal'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['What a wet spring does to nitrogen planning', 'Reading a soil probe without fooling yourself'],
  },
  {
    slug: 'maritime', name: 'Berthclock', industry: 'Maritime logistics', category: 'Port call optimisation',
    offerings: ['Anchorage queue forecasting', 'Berth window negotiation desk'],
    uniqueValue: 'Turn idle anchorage hours into scheduled berth windows',
    idealCustomerProfile: 'Container line operations directors running 40+ vessel fleets',
    audienceRoles: ['Fleet operations directors', 'Port agency coordinators'],
    painSymptoms: ['vessels burning fuel at anchor', 'berth allocation decided by phone'],
    competitiveAdvantages: ['Direct agency integrations at 60 terminals', 'Forecasts account for tidal windows'],
    brandPositioning: 'operational, unsentimental, schedule-obsessed',
    brandVoice: 'terse and operational',
    contentThemes: ['just-in-time arrival', 'demurrage exposure'],
    growthPriorities: ['add South American east coast terminals'],
    businessModel: 'Per-vessel annual licence with terminal integration fees',
    marketContext: 'Emissions rules are penalising steaming full-speed to wait at anchor',
    namedCompetitors: ['QuayLogic', 'Tidemark Ops'],
    size: 'enterprise', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Why arriving early costs you money', 'Tidal windows and the myth of the fast ship'],
  },
  {
    slug: 'trials', name: 'Cohortly', industry: 'Clinical research', category: 'Decentralised trial recruitment',
    offerings: ['Site-agnostic patient prescreening', 'Enrolment bottleneck diagnostics'],
    uniqueValue: 'Shorten enrolment cycles for trials that keep missing first-patient-in',
    idealCustomerProfile: 'CRO study start-up managers running phase II oncology trials',
    audienceRoles: ['Study start-up managers', 'Clinical operations leads'],
    painSymptoms: ['screen failure rates above forecast', 'sites recruiting zero patients'],
    competitiveAdvantages: ['Prescreening runs without site EMR access', 'Bottleneck view is protocol-aware'],
    brandPositioning: 'rigorous, regulatory-aware, quietly confident',
    brandVoice: 'precise and clinical',
    contentThemes: ['enrolment forecasting', 'protocol amendment cost'],
    growthPriorities: ['move upstream into protocol feasibility review'],
    businessModel: 'Per-study fee with milestone payments at enrolment targets',
    marketContext: 'Sponsors are consolidating vendors after a decade of trial-tech sprawl',
    namedCompetitors: ['TrialPath', 'Enrolia'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['The site that never enrols anyone', 'Screen failure is a protocol problem'],
  },
  {
    slug: 'water', name: 'Quietmain', industry: 'Municipal water', category: 'Acoustic leak detection',
    offerings: ['Permanent acoustic logger network', 'Non-revenue water loss reporting'],
    uniqueValue: 'Find buried mains leaks before they surface as sinkholes',
    idealCustomerProfile: 'Water utility asset managers serving 100,000+ connections',
    audienceRoles: ['Utility asset managers', 'Distribution network engineers'],
    painSymptoms: ['unaccounted water above regulatory limits', 'leaks found only after road collapse'],
    competitiveAdvantages: ['Loggers correlate across pipe material changes', 'Reporting maps to regulator templates'],
    brandPositioning: 'civic, durable, infrastructure-minded',
    brandVoice: 'measured and public-service oriented',
    contentThemes: ['non-revenue water', 'ageing cast iron mains'],
    growthPriorities: ['win regulated utility framework agreements'],
    businessModel: 'Managed service priced per kilometre of monitored main',
    marketContext: 'Regulators are tightening leakage targets faster than utilities can dig',
    namedCompetitors: ['Hydrolisten', 'MainSense Civic'],
    size: 'enterprise', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Hearing a leak through cast iron', 'What non-revenue water really costs'],
  },
  {
    slug: 'parametric', name: 'Rainwrit', industry: 'Speciality insurance', category: 'Parametric crop underwriting',
    offerings: ['Rainfall-triggered policy structuring', 'Automated payout settlement'],
    uniqueValue: 'Settle drought claims without sending a loss adjuster into the field',
    idealCustomerProfile: 'Reinsurance underwriters covering smallholder agricultural portfolios',
    audienceRoles: ['Reinsurance underwriters', 'Agricultural portfolio actuaries'],
    painSymptoms: ['loss adjustment costs exceed small claims', 'payouts arrive after planting season'],
    competitiveAdvantages: ['Triggers use gauge-calibrated satellite rainfall', 'Settlement clears in days not months'],
    brandPositioning: 'actuarial, transparent about basis risk',
    brandVoice: 'analytical and candid about limitations',
    contentThemes: ['basis risk', 'index trigger design'],
    growthPriorities: ['extend index products to excess rainfall perils'],
    businessModel: 'Share of gross written premium plus structuring fees',
    marketContext: 'Traditional indemnity crop cover is uneconomic below a claim size threshold',
    namedCompetitors: ['IndexAssure', 'Pluvia Re'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Basis risk is the product, not a flaw', 'When a rain gauge disagrees with a satellite'],
  },
  {
    slug: 'fab', name: 'Waferloom', industry: 'Semiconductor manufacturing', category: 'Fab yield analytics',
    offerings: ['Wafer test correlation engine', 'Process excursion alerting'],
    uniqueValue: 'Trace yield loss back to the specific process step that caused it',
    idealCustomerProfile: 'Process integration engineers at sub-14nm logic fabs',
    audienceRoles: ['Process integration engineers', 'Yield enhancement managers'],
    painSymptoms: ['excursions found weeks after the lot ships', 'test data siloed from process logs'],
    competitiveAdvantages: ['Correlates across tool chamber identity', 'Runs entirely inside the fab network'],
    brandPositioning: 'deeply technical, no marketing gloss',
    brandVoice: 'dense and engineer-to-engineer',
    contentThemes: ['excursion detection', 'chamber-level attribution'],
    growthPriorities: ['expand from logic into advanced packaging lines'],
    businessModel: 'Perpetual enterprise licence with annual support',
    marketContext: 'Fabs will not send process data outside their own network under any terms',
    namedCompetitors: ['YieldVector', 'Litholytics'],
    size: 'enterprise', completeness: 'none', website: false, market: true, activity: 'dormant',
    recentTitles: [],
  },
  {
    slug: 'royalty', name: 'Splitledger', industry: 'Independent music', category: 'Royalty split administration',
    offerings: ['Collaborator split registry', 'Cross-society claim reconciliation'],
    uniqueValue: 'Pay every collaborator correctly the first time, without a lawyer',
    idealCustomerProfile: 'Independent label operations leads managing 200+ active releases',
    audienceRoles: ['Label operations leads', 'Distribution managers'],
    painSymptoms: ['splits agreed by text message', 'royalties held unclaimed at societies'],
    competitiveAdvantages: ['Registry is signed by every collaborator before release', 'Reconciles across four collection societies'],
    brandPositioning: 'artist-first, plain about money',
    brandVoice: 'direct and unpretentious',
    contentThemes: ['unclaimed royalties', 'split agreements before release'],
    growthPriorities: ['support publishing splits alongside master splits'],
    businessModel: 'Percentage of administered royalty flow',
    marketContext: 'Streaming volume has made manual split administration impossible at indie scale',
    namedCompetitors: ['Sharecut', 'Meridian Rights'],
    size: 'small', completeness: 'rich', website: true, market: false, activity: 'active',
    recentTitles: ['The text message that cost a band its royalties', 'Where unclaimed money actually sits'],
  },
  {
    slug: 'kitchen', name: 'Coldpeak', industry: 'Commercial foodservice', category: 'Refrigeration load scheduling',
    offerings: ['Compressor duty-cycle scheduler', 'Peak demand charge forecasting'],
    uniqueValue: 'Cut peak demand charges without ever letting a walk-in warm up',
    idealCustomerProfile: 'Facilities directors at restaurant groups with 50+ sites',
    audienceRoles: ['Multi-site facilities directors', 'Energy procurement managers'],
    painSymptoms: ['demand charges dominate the power bill', 'compressors all start at once after a power dip'],
    competitiveAdvantages: ['Scheduler holds food-safety temperature bands as a hard constraint', 'Installs without replacing controllers'],
    brandPositioning: 'pragmatic, safety-first, cost-aware',
    brandVoice: 'practical and reassuring',
    contentThemes: ['peak demand charges', 'refrigeration duty cycling'],
    growthPriorities: ['enter grocery convenience formats'],
    businessModel: 'Per-site monthly subscription with shared savings option',
    marketContext: 'Utilities are restructuring commercial tariffs toward demand-based billing',
    namedCompetitors: ['DutyCycle Systems', 'Frostgrid'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Your power bill is mostly one bad minute', 'Duty cycling without a food safety incident'],
  },
  {
    slug: 'legalaid', name: 'Thresholdly', industry: 'Legal aid services', category: 'Benefits eligibility screening',
    offerings: ['Eligibility triage questionnaire', 'Caseworker referral routing'],
    uniqueValue: 'Let a caseworker screen for twelve benefit programmes in one sitting',
    idealCustomerProfile: 'Nonprofit legal aid organisations with fewer than 40 caseworkers',
    audienceRoles: ['Legal aid caseworkers', 'Programme directors'],
    painSymptoms: ['clients bounced between agencies', 'eligibility rules change without notice'],
    competitiveAdvantages: ['Rules maintained per jurisdiction by staff attorneys', 'Works offline in courthouse basements'],
    brandPositioning: 'accessible, dignified, never patronising',
    brandVoice: 'warm and jargon-free',
    contentThemes: ['benefits cliff effects', 'caseworker triage load'],
    growthPriorities: ['secure multi-year foundation funding'],
    businessModel: 'Grant-funded, provided free to qualifying organisations',
    marketContext: 'Legal aid demand rises faster than funding in every economic downturn',
    namedCompetitors: ['AidRoute', 'Civic Eligibility Project'],
    size: 'small', completeness: 'rich', website: true, market: false, activity: 'active',
    recentTitles: ['The benefits cliff nobody warns clients about', 'Screening twelve programmes in one sitting'],
  },
  {
    slug: 'mro', name: 'Tailwatch', industry: 'Aviation maintenance', category: 'Predictive component replacement',
    offerings: ['Component life-remaining modelling', 'AOG risk scheduling board'],
    uniqueValue: 'Replace the part at the scheduled check instead of at the gate',
    idealCustomerProfile: 'Airline maintenance planners operating narrowbody fleets over 60 tails',
    audienceRoles: ['Maintenance planning managers', 'Reliability engineers'],
    painSymptoms: ['aircraft grounded away from base', 'parts replaced on calendar not condition'],
    competitiveAdvantages: ['Models trained per tail not per type', 'Schedules against actual hangar slot availability'],
    brandPositioning: 'safety-anchored, dispatch-reliability focused',
    brandVoice: 'disciplined and procedural',
    contentThemes: ['dispatch reliability', 'aircraft-on-ground economics'],
    growthPriorities: ['extend coverage to regional turboprop fleets'],
    businessModel: 'Per-tail annual subscription tiered by fleet size',
    marketContext: 'Parts lead times have not recovered, making unplanned removals far costlier',
    namedCompetitors: ['Rotable Insight', 'Hangarline'],
    size: 'enterprise', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['The cost of an AOG at an outstation', 'Calendar limits versus condition monitoring'],
  },
  {
    slug: 'textile', name: 'Fibresort', industry: 'Textile recycling', category: 'Fibre composition sorting',
    offerings: ['Near-infrared fibre classifier', 'Blend contamination reporting'],
    uniqueValue: 'Separate poly-cotton blends accurately enough for closed-loop recycling',
    idealCustomerProfile: 'Apparel brand sustainability leads with take-back programme commitments',
    audienceRoles: ['Brand sustainability leads', 'Recycling facility operators'],
    painSymptoms: ['blended garments downcycled to rags', 'take-back pledges without processing capacity'],
    competitiveAdvantages: ['Classifies blends not just pure fibres', 'Throughput matches existing sort line speed'],
    brandPositioning: 'circular-economy serious, allergic to greenwashing',
    brandVoice: 'blunt about what recycling can and cannot do',
    contentThemes: ['blend separation', 'take-back programme economics'],
    growthPriorities: ['co-locate with existing municipal sort facilities'],
    businessModel: 'Throughput fee per tonne sorted',
    marketContext: 'Extended producer responsibility rules are making take-back pledges legally binding',
    namedCompetitors: ['Loopstream Fibres', 'Reweave Systems'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Why your cotton tee is not recyclable', 'Blend separation at line speed'],
  },
  {
    slug: 'vet', name: 'Pawgram', industry: 'Veterinary medicine', category: 'Diagnostic imaging review',
    offerings: ['Radiograph second-opinion queue', 'Referral urgency triage'],
    uniqueValue: 'Give a single-vet clinic the radiology backup a referral hospital has',
    idealCustomerProfile: 'Independent small-animal practice owners without in-house radiology',
    audienceRoles: ['Practice owners', 'Veterinary technicians'],
    painSymptoms: ['radiographs read without specialist input', 'referral decisions made under time pressure'],
    competitiveAdvantages: ['Board-certified reads returned same day', 'Triage flags emergencies before the queue'],
    brandPositioning: 'clinically careful, small-practice loyal',
    brandVoice: 'collegial and clinically grounded',
    contentThemes: ['radiograph interpretation', 'referral timing'],
    growthPriorities: ['add ultrasound review to the service line'],
    businessModel: 'Per-scan fee with volume bundles',
    marketContext: 'Corporate consolidation is squeezing independent practices on specialist access',
    namedCompetitors: ['VetRead', 'Companion Imaging Group'],
    size: 'small', completeness: 'sparse', website: true, market: false, activity: 'active',
    recentTitles: ['When to refer instead of re-shoot', 'Same-day reads for single-vet practices'],
  },
  {
    slug: 'robotics', name: 'Pathbroker', industry: 'Warehouse automation', category: 'Multi-vendor fleet orchestration',
    offerings: ['Cross-vendor pick path allocator', 'Robot fleet deadlock resolution'],
    uniqueValue: 'Run robots from three vendors on one floor without deadlocking the aisles',
    idealCustomerProfile: 'Third-party logistics operators running mixed-vendor robot fleets',
    audienceRoles: ['Warehouse operations managers', 'Automation integration engineers'],
    painSymptoms: ['robot fleets from different vendors block each other', 'vendor lock-in on floor expansion'],
    competitiveAdvantages: ['Vendor-neutral by design', 'Resolves deadlocks without stopping the floor'],
    brandPositioning: 'interoperability-first, vendor-agnostic',
    brandVoice: 'systems-minded and neutral',
    contentThemes: ['fleet interoperability', 'aisle congestion'],
    growthPriorities: ['publish an open orchestration interface'],
    businessModel: 'Per-robot monthly licence',
    marketContext: 'Operators who bought one robot vendor are refusing to repeat the mistake',
    namedCompetitors: ['FloorMesh', 'Orchestra Robotics'],
    size: 'enterprise', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Three robot vendors, one aisle', 'Deadlock without stopping the floor'],
  },
  {
    slug: 'transit', name: 'Curbcall', industry: 'Public transit', category: 'Paratransit trip scheduling',
    offerings: ['Wheelchair-accessible vehicle dispatch', 'Same-day trip request handling'],
    uniqueValue: 'Give paratransit riders same-day booking instead of next-week reservations',
    idealCustomerProfile: 'Transit agency planners operating federally mandated paratransit service',
    audienceRoles: ['Transit service planners', 'Dispatch supervisors'],
    painSymptoms: ['riders booking days in advance for medical appointments', 'accessible vehicles idle in the wrong district'],
    competitiveAdvantages: ['Dispatch respects mobility-device constraints', 'Meets federal complementary paratransit rules'],
    brandPositioning: 'equity-driven, compliance-literate',
    brandVoice: 'respectful and rider-centred',
    contentThemes: ['paratransit wait times', 'accessible dispatch equity'],
    growthPriorities: ['pilot with mid-size regional transit authorities'],
    businessModel: 'Per-completed-trip fee under agency contract',
    marketContext: 'Agencies face rising paratransit demand under fixed federal formula funding',
    namedCompetitors: ['AccessRoute Transit', 'Paraflow'],
    size: 'medium', completeness: 'sparse', website: true, market: true, activity: 'dormant',
    recentTitles: [],
  },
  {
    slug: 'brewing', name: 'Kraeusen', industry: 'Craft brewing', category: 'Fermentation telemetry',
    offerings: ['In-tank fermentation probe', 'Batch consistency scorecard'],
    uniqueValue: 'Brew the same beer twice without standing over the tank at midnight',
    idealCustomerProfile: 'Production brewers at regional breweries above 10,000 barrels annually',
    audienceRoles: ['Head brewers', 'Quality control leads'],
    painSymptoms: ['batch-to-batch flavour drift', 'gravity readings taken by hand at odd hours'],
    competitiveAdvantages: ['Probe survives caustic clean-in-place cycles', 'Scorecard compares against the brewery own history'],
    brandPositioning: 'craft-respectful, process-serious',
    brandVoice: 'enthusiast but technically exacting',
    contentThemes: ['fermentation curves', 'batch consistency'],
    growthPriorities: ['expand into contract brewing operations'],
    businessModel: 'Probe hardware sale plus per-tank software subscription',
    marketContext: 'Regional brewery consolidation is raising the cost of an inconsistent batch',
    namedCompetitors: ['Gravitymark', 'Cellarsense'],
    size: 'small', completeness: 'rich', website: true, market: false, activity: 'active',
    recentTitles: ['Reading a fermentation curve properly', 'Why batch four tasted different'],
  },
  {
    slug: 'catrisk', name: 'Emberline', industry: 'Catastrophe modelling', category: 'Wildfire exposure analytics',
    offerings: ['Parcel-level ember exposure scoring', 'Portfolio accumulation stress testing'],
    uniqueValue: 'Price wildfire risk at the parcel instead of the postcode',
    idealCustomerProfile: 'Catastrophe modelling teams at property reinsurers',
    audienceRoles: ['Catastrophe modellers', 'Portfolio risk officers'],
    painSymptoms: ['exposure aggregated at postcode granularity', 'defensible space ignored in pricing'],
    competitiveAdvantages: ['Scores account for defensible space and roof class', 'Stress tests run at treaty renewal speed'],
    brandPositioning: 'quantitative, sober about tail risk',
    brandVoice: 'technical and risk-literate',
    contentThemes: ['accumulation risk', 'defensible space in pricing'],
    growthPriorities: ['extend the model to wildland-urban interface growth'],
    businessModel: 'Annual model licence with treaty-renewal support',
    marketContext: 'Insurers are withdrawing from whole regions for want of parcel-level discrimination',
    namedCompetitors: ['Firegrade Analytics', 'Perilscope'],
    size: 'enterprise', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Postcode pricing is why insurers left', 'Defensible space as an underwriting variable'],
  },
  {
    slug: 'dental', name: 'Archwise', industry: 'Orthodontics', category: 'Aligner treatment planning',
    offerings: ['Tooth movement staging planner', 'Chair-time reduction protocols'],
    uniqueValue: 'Cut chair time per case without extending total treatment length',
    idealCustomerProfile: 'Orthodontic practices running 300+ aligner cases per year',
    audienceRoles: ['Orthodontists', 'Practice treatment coordinators'],
    painSymptoms: ['refinement rounds eating practice margin', 'staging plans redone by hand'],
    competitiveAdvantages: ['Staging accounts for anchorage loss', 'Plans export to major aligner manufacturers'],
    brandPositioning: 'clinically precise, practice-economics aware',
    brandVoice: 'professional and outcome-focused',
    contentThemes: ['refinement rates', 'chair time economics'],
    growthPriorities: ['support paediatric interceptive cases'],
    businessModel: 'Per-case planning fee',
    marketContext: 'Direct-to-consumer aligner failures have pushed patients back to supervised care',
    namedCompetitors: ['Stagecraft Ortho', 'Bracketless Labs'],
    size: 'small', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Refinements are a planning failure', 'Anchorage loss in aligner staging'],
  },
  {
    slug: 'grid', name: 'Queuewright', industry: 'Grid interconnection', category: 'Interconnection application automation',
    offerings: ['Interconnection study packet assembly', 'Queue position risk tracking'],
    uniqueValue: 'Get a solar project through the interconnection queue before the tax credit lapses',
    idealCustomerProfile: 'Renewable developers with 50MW+ projects in congested ISO queues',
    audienceRoles: ['Development managers', 'Interconnection counsel'],
    painSymptoms: ['projects dying in multi-year queues', 'study packets rejected on formatting'],
    competitiveAdvantages: ['Packet templates track each ISO current rules', 'Flags withdrawal cascades ahead of restudy'],
    brandPositioning: 'regulatory-fluent, deadline-driven',
    brandVoice: 'urgent and procedurally exact',
    contentThemes: ['queue reform', 'restudy cascades'],
    growthPriorities: ['cover storage-plus-solar hybrid applications'],
    businessModel: 'Per-application fee plus queue monitoring retainer',
    marketContext: 'Interconnection queues are now the binding constraint on renewable buildout',
    namedCompetitors: ['Interlink Grid', 'Queue Commons'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Dying in the queue', 'What a restudy cascade does to a project'],
  },
  {
    slug: 'publishing', name: 'Referee', industry: 'Academic publishing', category: 'Peer-review integrity screening',
    offerings: ['Paper mill signature detection', 'Reviewer conflict-of-interest mapping'],
    uniqueValue: 'Catch fabricated submissions before they reach a volunteer reviewer',
    idealCustomerProfile: 'Journal editors-in-chief at mid-tier scholarly society publishers',
    audienceRoles: ['Journal editors', 'Publishing integrity officers'],
    painSymptoms: ['fabricated submissions reaching review', 'reviewer rings going undetected'],
    competitiveAdvantages: ['Detects image reuse across unrelated submissions', 'Conflict mapping uses co-authorship history'],
    brandPositioning: 'scholarly-integrity focused, quietly rigorous',
    brandVoice: 'formal and evidence-bound',
    contentThemes: ['research integrity', 'reviewer conflict detection'],
    growthPriorities: ['offer screening to preprint servers'],
    businessModel: 'Per-manuscript screening fee',
    marketContext: 'Retraction volumes have made integrity screening a board-level publisher concern',
    namedCompetitors: ['Integrity Desk', 'Submissio Guard'],
    size: 'medium', completeness: 'sparse', website: true, market: true, activity: 'active',
    recentTitles: ['Image reuse across unrelated papers', 'How a reviewer ring operates'],
  },
  {
    slug: 'coldchain', name: 'Excursia', industry: 'Pharmaceutical logistics', category: 'Cold chain excursion analytics',
    offerings: ['Temperature excursion root-cause tracing', 'Lane risk qualification reports'],
    uniqueValue: 'Explain why a biologics shipment warmed, not merely that it did',
    idealCustomerProfile: 'Pharmaceutical quality assurance leads shipping temperature-sensitive biologics',
    audienceRoles: ['QA leads', 'Cold chain logistics managers'],
    painSymptoms: ['excursion alerts without any cause', 'product quarantined pending investigation'],
    competitiveAdvantages: ['Traces excursions to specific handover points', 'Reports formatted for regulatory inspection'],
    brandPositioning: 'GxP-serious, investigation-grade',
    brandVoice: 'exacting and audit-ready',
    contentThemes: ['excursion investigation', 'lane qualification'],
    growthPriorities: ['qualify additional intercontinental air lanes'],
    businessModel: 'Per-lane qualification fee plus per-shipment monitoring',
    marketContext: 'Biologics value density makes a single quarantined shipment materially expensive',
    namedCompetitors: ['ChainProof Pharma', 'Thermolog Sciences'],
    size: 'enterprise', completeness: 'none', website: true, market: true, activity: 'dormant',
    recentTitles: [],
  },
  {
    slug: 'forestry', name: 'Canopyledger', industry: 'Forestry carbon', category: 'Biomass verification',
    offerings: ['LiDAR biomass estimation', 'Carbon credit issuance evidence packs'],
    uniqueValue: 'Prove standing biomass to a verifier without a field crew walking transects',
    idealCustomerProfile: 'Forest carbon project developers managing 10,000+ hectare projects',
    audienceRoles: ['Carbon project developers', 'Verification body auditors'],
    painSymptoms: ['field transect sampling too sparse to defend', 'credits challenged on measurement quality'],
    competitiveAdvantages: ['Estimates reconcile to registry methodologies', 'Evidence packs survive third-party verification'],
    brandPositioning: 'verification-grade, integrity-anxious',
    brandVoice: 'careful and methodologically explicit',
    contentThemes: ['additionality evidence', 'biomass measurement error'],
    growthPriorities: ['support mangrove and peatland project types'],
    businessModel: 'Per-hectare measurement fee at each verification cycle',
    marketContext: 'Buyers have stopped accepting carbon credits whose measurement cannot be audited',
    namedCompetitors: ['Standwise Carbon', 'Verdant Ledger'],
    size: 'medium', completeness: 'rich', website: true, market: true, activity: 'active',
    recentTitles: ['Transects will not survive an audit', 'Measurement error and credit integrity'],
  },
  {
    slug: 'safety', name: 'Loneguard', industry: 'Industrial safety', category: 'Lone-worker gas monitoring',
    offerings: ['Wearable gas exposure monitor', 'Rescue escalation dispatch'],
    uniqueValue: 'Know a lone worker is down in a confined space within ninety seconds',
    idealCustomerProfile: 'EHS managers overseeing confined-space entry at industrial sites',
    audienceRoles: ['EHS managers', 'Confined space entry supervisors'],
    painSymptoms: ['workers alone in confined spaces', 'gas alarms nobody hears'],
    competitiveAdvantages: ['Escalates to rescue teams not just to a dashboard', 'Monitors work below ground without cellular signal'],
    brandPositioning: 'life-safety absolute, no compromise framing',
    brandVoice: 'urgent and unambiguous',
    contentThemes: ['confined space entry', 'rescue escalation time'],
    growthPriorities: ['certify the device for additional hazardous-area classifications'],
    businessModel: 'Per-device annual subscription including monitoring centre',
    marketContext: 'Confined-space fatalities remain concentrated in lone-worker scenarios',
    namedCompetitors: ['Sentinel Works', 'Atmoswatch Safety'],
    size: 'medium', completeness: 'sparse', website: true, market: true, activity: 'active',
    recentTitles: ['Ninety seconds in a confined space', 'Alarms nobody is listening to'],
  },
];

/**
 * §11 — CONTRADICTION RESOLUTION.
 *
 * v1's defect: `market_pulse.core_offerings` was authored independently of
 * `products_services`, so the two disagreed for every rich entry.
 *
 * v2's rule: `products_services_list` is the SINGLE canonical representation of
 * what a company sells. `market_pulse.core_offerings` is DERIVED from it by this
 * function and by no other route. The two therefore cannot diverge — not by
 * convention, but by construction.
 */
export function deriveCoreOfferings(spec: CompanySpec): string[] {
  return [...spec.offerings];
}

function marketPulse(spec: CompanySpec, on: boolean): Record<string, unknown> {
  if (!on) return {};
  return {
    core_offerings: deriveCoreOfferings(spec),
    named_competitors: [...spec.namedCompetitors],
    primary_markets: [spec.industry, spec.marketContext],
    updated_at: daysAgo(10),
  };
}

function discoveredMeta(spec: CompanySpec, on: boolean): Record<string, unknown> {
  if (!on) return {};
  return {
    title: `${spec.name} — ${spec.category}`,
    description: spec.uniqueValue,
    seo_keywords: [...spec.contentThemes],
    discovered_at: daysAgo(5),
  };
}

function buildProfile(spec: CompanySpec): Record<string, unknown> {
  const report_settings = {
    market_pulse: marketPulse(spec, spec.market),
    discovered_metadata: discoveredMeta(spec, spec.website),
  };
  if (spec.completeness === 'none') return { report_settings };

  const websiteUrl = spec.website ? `https://${spec.slug}.example` : '';
  if (spec.completeness === 'sparse') {
    return {
      name: spec.name, industry: spec.industry, website_url: websiteUrl,
      overall_confidence: 0.5, last_refined_at: daysAgo(20), report_settings,
    };
  }
  return {
    name: spec.name,
    industry: spec.industry,
    category: spec.category,
    products_services: spec.offerings.join(', '),
    products_services_list: [...spec.offerings],
    competitive_advantages: [...spec.competitiveAdvantages],
    unique_value: spec.uniqueValue,
    ideal_customer_profile: spec.idealCustomerProfile,
    target_audience: spec.idealCustomerProfile,
    target_audience_list: [...spec.audienceRoles],
    pain_symptoms: [...spec.painSymptoms],
    brand_positioning: spec.brandPositioning,
    brand_voice: spec.brandVoice,
    content_themes: spec.contentThemes.join(', '),
    content_themes_list: [...spec.contentThemes],
    growth_priorities: [...spec.growthPriorities],
    business_model: spec.businessModel,
    website_url: websiteUrl,
    overall_confidence: 0.9,
    last_refined_at: daysAgo(3),
    report_settings,
  };
}

/** Deterministic: same call → byte-identical entries. No clock, no RNG. */
export function loadU1Dataset002(): DatasetEntry[] {
  return COMPANIES.map((spec, i) => ({
    id: `u1v2-${String(i).padStart(2, '0')}-${spec.slug}`,
    size: spec.size,
    industry: spec.industry,
    completeness: spec.completeness,
    websiteEnabled: spec.website,
    marketIntel: spec.market,
    activity: spec.activity,
    now: U1_EVAL_EPOCH,
    profile: buildProfile(spec),
    recentContent: spec.recentTitles.map((title, k) => ({ title, published_at: daysAgo(2 + k * 7) })),
  }));
}

export function u1DatasetSpecs(): readonly CompanySpec[] {
  return COMPANIES;
}
