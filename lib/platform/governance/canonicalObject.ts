/**
 * Canonical platform foundation (CREATOR-137) — the shared contracts EVERY canonical
 * object implements. Governance (RULE 7), scope/marketplace (RULE 8), serialization
 * (RULE 9), and validation (RULE 10) live here ONCE so no canonical module re-invents
 * them and no consumer owns them. Pure types + a tiny pure helper set — no runtime
 * dependencies, no UI, no renderer.
 */

/* ── RULE 8 — scope / marketplace foundation ─────────────────────────────── */
export type LibraryScope = 'system' | 'organization' | 'personal' | 'marketplace';
export type Origin = 'authored' | 'ai' | 'forked' | 'imported';
export type LifecycleStatus = 'draft' | 'validated' | 'approved' | 'published' | 'archived';
export type Visibility = 'private' | 'shared' | 'listed';

/* ── RULE 7 — governance metadata every canonical object carries ─────────── */
export interface GovernanceMeta {
  id: string;
  scope: LibraryScope;
  ownerId: string | null;     // user id (personal) — null for system
  orgId: string | null;       // org id (organization/enterprise) — null otherwise
  origin: Origin;
  status: LifecycleStatus;
  visibility: Visibility;
  version: number;
  parentId: string | null;    // fork lineage
  createdAt: string | null;   // ISO; stamped by the repository, never in-process
  updatedAt: string | null;
  audit: Record<string, unknown>;
}

/** A canonical object = its domain payload + governance metadata. The payload `T`
 *  is the object's SOLE responsibility; the meta is uniform across all objects. */
export interface CanonicalObject<T> {
  meta: GovernanceMeta;
  data: T;
}

/* ── RULE 10 — validation (owned by the object, never the consumer) ──────── */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
export interface Validatable<T> {
  /** Validate a payload structurally + semantically. Pure, deterministic. */
  validate(data: T): ValidationResult;
}

/* ── RULE 9 — serialization (no runtime deps; supports version/clone/fork/import/export) ── */
export interface Serializer<T> {
  serialize(obj: CanonicalObject<T>): string;
  deserialize(raw: string): CanonicalObject<T>;
  clone(obj: CanonicalObject<T>): CanonicalObject<T>;
  /** Copy-on-write fork into a new scope; resets version + sets parentId. */
  fork(obj: CanonicalObject<T>, into: { scope: LibraryScope; ownerId: string | null; orgId: string | null; newId: string }): CanonicalObject<T>;
}

/** Default, dependency-free serializer usable by any module (JSON round-trip +
 *  structural clone/fork). Modules may specialize but rarely need to. */
export function makeSerializer<T>(): Serializer<T> {
  const deep = (o: CanonicalObject<T>): CanonicalObject<T> => JSON.parse(JSON.stringify(o)) as CanonicalObject<T>;
  return {
    serialize: (obj) => JSON.stringify(obj),
    deserialize: (raw) => JSON.parse(raw) as CanonicalObject<T>,
    clone: (obj) => deep(obj),
    fork: (obj, into) => {
      const next = deep(obj);
      next.meta = {
        ...next.meta,
        id: into.newId, scope: into.scope, ownerId: into.ownerId, orgId: into.orgId,
        origin: 'forked', status: 'draft', visibility: 'private',
        version: 1, parentId: obj.meta.id, createdAt: null, updatedAt: null,
      };
      return next;
    },
  };
}

/* ── Repository contract (RULE 3 — persistence boundary; impl per module) ── */
export interface Repository<T> {
  get(id: string): Promise<CanonicalObject<T> | null>;
  list(filter: Partial<Pick<GovernanceMeta, 'scope' | 'ownerId' | 'orgId' | 'status'>>): Promise<CanonicalObject<T>[]>;
  save(obj: CanonicalObject<T>): Promise<CanonicalObject<T>>;
  archive(id: string): Promise<void>;
}

/** A canonical module's public surface (RULE 1/3). Each module exposes exactly this. */
export interface CanonicalModule<T> {
  readonly name: string;
  readonly validator: Validatable<T>;
  readonly serializer: Serializer<T>;
}
