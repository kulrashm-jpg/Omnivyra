/**
 * PI-LDB-01 — the shared contract for AI semantic attribute mapping.
 *
 * ONE mapping layer serves every acquisition channel. CSV, Sales Navigator,
 * MarketPulse, social and vendor adapters all propose through this contract;
 * none of them may implement a second semantic mapper, because two mappers
 * means two answers to "what does this column mean" and no way to say which
 * one wrote a value.
 *
 * ─── THE BOUNDARY THIS FILE ENFORCES ──────────────────────────────────────
 * The engine PROPOSES semantics. It never writes. Nothing in this module may
 * reach a database, and no type here can carry SQL, a table name, a column
 * name chosen by a model, or an executable instruction. The canonical write
 * path stays exactly where it is: `ingestionBoundary`, behind its column
 * allowlist. A proposal is an opinion about a header; a write is a decision,
 * and only trusted server code makes decisions.
 *
 * ─── WHY CONFIDENCE IS NOT A NUMBER THE MODEL CHOSE ───────────────────────
 * A model asked "how confident are you" returns a number that correlates with
 * fluency, not with accuracy. `ProposalFromModel` therefore has NO confidence
 * field, and `scoreMapping` never receives one. The model's own estimate is
 * recorded on `ModelEcho` for later calibration work and is structurally
 * unable to influence the outcome: there is no code path from `ModelEcho` into
 * a score. If a future change wants to use it, that change has to add the
 * parameter, which is a reviewable edit rather than a silent drift.
 */

import type { CanonicalFieldKey } from './canonicalFieldRegistry';

/**
 * How a mapping came to be. Ordered by how much a human should trust it.
 *
 * `approved_profile_match` is the only state that reuses a decision a tenant
 * already made, which is why it ranks above any fresh suggestion however
 * strong: a human said yes to it once, for this tenant, for a compatible
 * schema.
 */
export type MappingStatus =
  /** A tenant previously approved this exact mapping for a compatible schema. */
  | 'approved_profile_match'
  /** Strong deterministic evidence. May be applied without asking. */
  | 'high_confidence_suggestion'
  /** The engine will not choose. A tenant must answer a question. */
  | 'review_required'
  /** No canonical destination. The column is preserved, never discarded. */
  | 'unmapped'
  /** A destination was identified but the values do not fit it. */
  | 'validation_failed'
  /** A tenant explicitly refused this mapping. Never re-proposed silently. */
  | 'rejected_by_tenant';

/** The only data types the canonical vocabulary uses. */
export type CanonicalDataType =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  | 'domain'
  | 'integer'
  | 'date'
  | 'enum'
  | 'text[]';

/**
 * Whether the incoming values can live in the proposed destination.
 *
 * `unknown` is a real answer, not a failure: a column of entirely empty
 * sample values tells us nothing about its type, and pretending otherwise
 * would turn an absence of evidence into evidence.
 */
export type DataTypeCompatibility = 'compatible' | 'coercible' | 'incompatible' | 'unknown';

/**
 * Why a mapping needs a human. Every reason here is a reason the ENGINE
 * cannot resolve, not a reason it has not tried.
 */
export type AmbiguityReason =
  /** The header names a concept that maps to several canonical fields. */
  | 'polysemous_header'
  /** Person vs employer. See the geography note in the registry. */
  | 'entity_ambiguous'
  /** Two or more source columns claim one canonical field. */
  | 'competing_source_fields'
  /** One column appears to carry two canonical facts. */
  | 'composite_field'
  /** The destination is identity-critical, so no auto-apply is permitted. */
  | 'identity_critical'
  /** A stored profile exists but the source schema changed materially. */
  | 'schema_drift';

/** A question put to the tenant. Never rhetorical — it always has options. */
export interface AmbiguityQuestion {
  reason: AmbiguityReason;
  /** Plain language, addressed to the tenant, naming the actual header. */
  question: string;
  /**
   * The choices. Always at least two, and always including a way out:
   * every question can be answered "ignore this column", because a tenant
   * must never be forced to invent a destination for a column they do not
   * care about.
   */
  options: readonly AmbiguityOption[];
}

export interface AmbiguityOption {
  /** `null` means "ignore this column" — a first-class answer. */
  target: CanonicalFieldKey | null;
  label: string;
  /** Why this option might be the right one, in the tenant's terms. */
  rationale: string;
}

/** A candidate destination with the evidence behind it. */
export interface MappingCandidate {
  target: CanonicalFieldKey;
  /** Where it would land: the contact or the employer. */
  entity: 'contact' | 'company';
  /**
   * The deterministic score, 0..1. Computed here, never supplied by a model.
   * See `mappingScorer.ts` for the signals.
   */
  score: number;
  /** Which signals fired, so a human can audit the number. */
  evidence: readonly string[];
  dataTypeCompatibility: DataTypeCompatibility;
  /** A named, deterministic transformation — never arbitrary code. */
  transformation: TransformationName;
}

/**
 * The transformations the engine is allowed to propose. A closed set on
 * purpose: "apply this transformation" must never become "run this string".
 */
export type TransformationName =
  | 'none'
  | 'trim'
  | 'lowercase_email'
  | 'digits_only_phone'
  | 'url_to_domain'
  | 'split_full_name'
  | 'parse_integer'
  | 'parse_date'
  | 'split_delimited_list'
  | 'match_enum_value';

/**
 * The same closed set, as a runtime value.
 *
 * It exists because a transformation name arriving from outside the process —
 * a request body, a stored profile row — has to be checked against something,
 * and the type alone cannot do that at runtime. There are currently THREE
 * spellings of this set in the repository: this type, this list, and a
 * deliberately duplicated copy in `lib/prospects/import/applyMapping.ts`
 * (browser-side, which may not import from `backend/`). A fourth spelling
 * inside each validator is what this list prevents; the browser copy is a
 * necessary duplication and is documented as such at its own definition.
 */
export const TRANSFORMATION_NAMES = [
  'none',
  'trim',
  'lowercase_email',
  'digits_only_phone',
  'url_to_domain',
  'split_full_name',
  'parse_integer',
  'parse_date',
  'split_delimited_list',
  'match_enum_value',
] as const satisfies readonly TransformationName[];

/**
 * Compile-time exhaustiveness. `satisfies` above proves every listed name is a
 * real transformation; this proves every real transformation is listed. Adding
 * a member to the type without adding it here fails the build, which is the
 * only reason the pair can be trusted — a gate that cannot fail is worse than
 * no gate.
 */
type MissingTransformation = Exclude<TransformationName, (typeof TRANSFORMATION_NAMES)[number]>;
const _allTransformationsListed: MissingTransformation extends never ? true : never = true;
void _allTransformationsListed;

export function isTransformationName(value: unknown): value is TransformationName {
  return typeof value === 'string' && (TRANSFORMATION_NAMES as readonly string[]).includes(value);
}

/** What the model said, kept for calibration and unable to affect scoring. */
export interface ModelEcho {
  /** The model's own confidence. Recorded. Never read by the scorer. */
  selfReportedConfidence: number | null;
  /** A short reason, surfaced to the tenant as context only. */
  reasoning: string | null;
}

/** The engine's verdict for ONE source column. */
export interface FieldMappingProposal {
  sourceField: string;
  status: MappingStatus;
  /** The leading candidate, or `null` when `unmapped`/`validation_failed`. */
  candidate: MappingCandidate | null;
  /** Ranked alternatives, best first. May be empty. */
  alternatives: readonly MappingCandidate[];
  /** Present exactly when `status === 'review_required'`. */
  ambiguity: AmbiguityQuestion | null;
  /** Human-readable, safe to show a tenant. Never contains a sample value. */
  reasoning: string;
  requiresTenantApproval: boolean;
  /** Where the proposal came from. */
  provenance: 'approved_profile' | 'new_suggestion' | 'deterministic' | 'refused';
  /** Set when `status === 'validation_failed'`: how many samples failed. */
  validation: FieldValidationSummary | null;
  model: ModelEcho | null;
}

export interface FieldValidationSummary {
  samplesConsidered: number;
  samplesFailed: number;
  /** A type name or rule name. NEVER a failing value — those are tenant data. */
  failureKind: string;
}

/** The engine's verdict for a whole source schema. */
export interface MappingEngineResult {
  /** Stable hash of the header set. Gates profile reuse. */
  sourceSchemaFingerprint: string;
  /** One entry per source column, in the column order given. */
  proposals: readonly FieldMappingProposal[];
  /** True when any proposal needs a tenant answer. */
  requiresReview: boolean;
  /**
   * Set when a stored profile was consulted. `drifted` means the profile
   * exists but the schema changed materially, so it was NOT applied.
   */
  profile: ProfileOutcome | null;
  /**
   * Per-field results are independent by contract: a field that fails
   * validation or cannot be parsed yields ONE failed proposal, never an
   * exception that discards the other columns' work. Structured output from
   * a model is unreliable enough that an all-or-nothing batch would make the
   * whole feature flaky.
   */
  degraded: readonly DegradedField[];
}

export interface DegradedField {
  sourceField: string;
  /** A rule or parser name. Never a model transcript, never a sample value. */
  cause: string;
}

export interface ProfileOutcome {
  profileId: string;
  version: number;
  state: 'applied' | 'drifted' | 'absent';
  /** Headers present in the profile but missing from this file, and vice versa. */
  addedHeaders: readonly string[];
  removedHeaders: readonly string[];
}

/** What the engine is given. */
export interface MappingEngineInput {
  /** Which channel. Scopes the stored profile with `tenantId`. */
  sourceType: string;
  /** The VERIFIED tenant. Never read from a request body. */
  tenantId: string;
  /** Source column headers, in file order. */
  headers: readonly string[];
  /**
   * Representative values per header, already redacted. The engine asserts
   * redaction rather than trusting it — see `assertRedacted`.
   */
  samples: Readonly<Record<string, readonly string[]>>;
  /** Optional free-text descriptions a source supplies for its own fields. */
  fieldDescriptions?: Readonly<Record<string, string>>;
  /** A previously approved profile, when one exists for this fingerprint. */
  storedProfile?: StoredMappingProfile | null;
  /** Fields the tenant has explicitly refused before, so we do not re-ask. */
  rejectedTargets?: Readonly<Record<string, readonly CanonicalFieldKey[]>>;
}

export interface StoredMappingProfile {
  profileId: string;
  /**
   * Which kind of profile answered: the tenant's own ('tenant') or a data
   * vendor's, approved once by a Super Admin for every company ('platform').
   * Provenance cites them in different columns, and the UI says which it is.
   */
  scope: 'tenant' | 'platform';
  version: number;
  sourceSchemaFingerprint: string;
  headers: readonly string[];
  entries: readonly StoredMappingEntry[];
}

export interface StoredMappingEntry {
  sourceField: string;
  /** `null` records an approved decision to IGNORE this column. */
  target: CanonicalFieldKey | null;
  transformation: TransformationName;
  /**
   * The actor who approved it, or `null` when that user has since been
   * deleted — `approved_by` is `REFERENCES users(id) ON DELETE SET NULL`, so a
   * real null is a state the database produces. Naming someone else, or a
   * sentinel like 'unknown', would misattribute an approval, so the absence is
   * carried honestly instead.
   */
  approvedBy: string | null;
  approvedAt: string;
}

/**
 * The model-facing port. Injected, so the engine is unit-testable with no
 * network and no API key, and so the AI is one replaceable opinion rather
 * than the engine itself.
 *
 * It returns a target NAME from the registry, never a column, never SQL. An
 * unrecognised name is dropped by the engine, which is why a prompt-injected
 * response cannot invent a destination.
 */
export type MappingProposer = (
  request: ProposerRequest,
) => Promise<readonly ProposalFromModel[]>;

export interface ProposerRequest {
  headers: readonly string[];
  samples: Readonly<Record<string, readonly string[]>>;
  fieldDescriptions?: Readonly<Record<string, string>>;
  /** The registry, serialised. The model may only choose from this. */
  allowedTargets: readonly AllowedTarget[];
}

export interface AllowedTarget {
  key: CanonicalFieldKey;
  entity: 'contact' | 'company';
  label: string;
  description: string;
  dataType: CanonicalDataType;
}

/**
 * One model suggestion. Deliberately minimal, and deliberately WITHOUT a
 * confidence field: see the header note. Adding one here would be the first
 * step to letting fluency outrank evidence.
 */
export interface ProposalFromModel {
  sourceField: string;
  /** Must match a registry key. Anything else is discarded. */
  target: string;
  /** Optional ranked alternates, same validation. */
  alternatives?: readonly string[];
  /** The model's prose, surfaced as context. */
  reasoning?: string;
  /** Recorded on `ModelEcho`, never scored. */
  selfReportedConfidence?: number;
  /** The model may flag its own uncertainty; it cannot clear it. */
  uncertain?: boolean;
}
