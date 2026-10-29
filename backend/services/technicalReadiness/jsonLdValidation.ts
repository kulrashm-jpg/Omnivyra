/**
 * Technical readiness — JSON-LD syntax + required-property checks for a small supported set.
 * Pure; runs on the JSON-LD blocks the crawler already extracted (no extra fetch).
 *
 * The property lists are Omnivyra's own conservative, VERSIONED ruleset. They are not a copy of
 * any search engine's rich-result rules, and passing them never implies eligibility for rich
 * results: search engines decide eligibility and display, and some types are restricted.
 * Microdata and RDFa are out of scope.
 */
export const JSONLD_RULESET_VERSION = '2026-10-29.1';

export const JSONLD_LIMITATION =
  'Valid syntax and required properties are necessary but not sufficient: search engines decide rich-result eligibility and display, and some rich-result types are restricted to particular sites. Microdata and RDFa are not evaluated.';

export type JsonLdFamily =
  | 'Organization'
  | 'WebSite'
  | 'Product'
  | 'SoftwareApplication'
  | 'LocalBusiness'
  | 'FAQPage'
  | 'Article'
  | 'BreadcrumbList';

/** Versioned subtype lists. A type not listed here is `unsupported` — not invalid. */
const FAMILY_OF: Record<string, JsonLdFamily> = {};
const add = (family: JsonLdFamily, types: string[]) => { for (const t of types) FAMILY_OF[t.toLowerCase()] = family; };
add('Organization', ['Organization', 'Corporation', 'OnlineBusiness', 'OnlineStore', 'NGO', 'EducationalOrganization', 'GovernmentOrganization', 'NewsMediaOrganization']);
add('LocalBusiness', [
  'LocalBusiness', 'Store', 'Restaurant', 'FoodEstablishment', 'Dentist', 'MedicalBusiness', 'MedicalClinic', 'Physician',
  'ProfessionalService', 'LegalService', 'Attorney', 'AutomotiveBusiness', 'AutoRepair', 'HealthAndBeautyBusiness',
  'HomeAndConstructionBusiness', 'LodgingBusiness', 'Hotel', 'RealEstateAgent', 'FinancialService', 'AccountingService',
  'SportsActivityLocation', 'EntertainmentBusiness', 'ChildCare', 'TravelAgency', 'Bakery', 'CafeOrCoffeeShop',
]);
add('WebSite', ['WebSite']);
add('Product', ['Product', 'ProductGroup', 'IndividualProduct']);
add('SoftwareApplication', ['SoftwareApplication', 'WebApplication', 'MobileApplication', 'VideoGame']);
add('FAQPage', ['FAQPage']);
add('Article', ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report', 'ScholarlyArticle']);
add('BreadcrumbList', ['BreadcrumbList']);

export function familyOfType(type: string): JsonLdFamily | null {
  const t = type.trim().replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, '');
  return FAMILY_OF[t.toLowerCase()] ?? null;
}

type Node = Record<string, unknown>;

const present = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(present);
  return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'object';
};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
const urlish = (v: unknown): string | null => {
  if (typeof v === 'string') return str(v);
  if (v && typeof v === 'object' && !Array.isArray(v)) return str((v as Node).url) ?? str((v as Node)['@id']);
  return null;
};
const typesOf = (node: Node): string[] => asArray(node['@type']).filter((t): t is string => typeof t === 'string');

/** Required / recommended properties per family. Returns [missingRequired, missingRecommended]. */
function checkNode(family: JsonLdFamily, node: Node): [string[], string[]] {
  const req: string[] = [];
  const rec: string[] = [];
  const need = (list: string[], key: string) => { if (!present(node[key])) list.push(key); };
  switch (family) {
    case 'Organization':
      need(req, 'name'); need(req, 'url'); need(rec, 'logo'); need(rec, 'sameAs');
      break;
    case 'WebSite':
      need(req, 'name'); need(req, 'url'); need(rec, 'potentialAction');
      break;
    case 'Product':
      need(req, 'name');
      if (!present(node.offers) && !present(node.review) && !present(node.aggregateRating)) req.push('offers|review|aggregateRating');
      need(rec, 'image'); need(rec, 'description'); need(rec, 'brand');
      break;
    case 'SoftwareApplication':
      need(req, 'name'); need(rec, 'offers'); need(rec, 'applicationCategory'); need(rec, 'operatingSystem'); need(rec, 'aggregateRating');
      break;
    case 'LocalBusiness':
      need(req, 'name'); need(req, 'address'); need(rec, 'telephone'); need(rec, 'openingHoursSpecification'); need(rec, 'geo'); need(rec, 'url');
      break;
    case 'FAQPage': {
      const questions = asArray(node.mainEntity).filter((q): q is Node => !!q && typeof q === 'object');
      if (questions.length === 0) { req.push('mainEntity'); break; }
      questions.forEach((q, i) => {
        if (!typesOf(q).some((t) => /^(https?:\/\/schema\.org\/)?Question$/i.test(t))) req.push(`mainEntity[${i}].@type=Question`);
        if (!present(q.name)) req.push(`mainEntity[${i}].name`);
        const answer = asArray(q.acceptedAnswer)[0] as Node | undefined;
        if (!answer || typeof answer !== 'object' || !present(answer.text)) req.push(`mainEntity[${i}].acceptedAnswer.text`);
      });
      break;
    }
    case 'Article':
      need(req, 'headline'); need(rec, 'datePublished'); need(rec, 'author'); need(rec, 'image');
      break;
    case 'BreadcrumbList': {
      const items = asArray(node.itemListElement).filter((x): x is Node => !!x && typeof x === 'object');
      if (items.length === 0) { req.push('itemListElement'); break; }
      items.forEach((it, i) => {
        if (!present(it.position)) req.push(`itemListElement[${i}].position`);
        const itemObj = it.item && typeof it.item === 'object' ? it.item as Node : null;
        if (!present(it.name) && !present(itemObj?.name)) req.push(`itemListElement[${i}].name`);
        // The last crumb (the current page) may omit `item`.
        if (i < items.length - 1 && !present(it.item)) req.push(`itemListElement[${i}].item`);
      });
      break;
    }
  }
  return [req.slice(0, 12), rec];
}

export type JsonLdNodeResult = {
  type: string;
  family: JsonLdFamily;
  missing_required: string[];
  missing_recommended: string[];
  same_as_count: number;
};

export type JsonLdOrgNode = {
  family: 'Organization' | 'LocalBusiness';
  name: string | null;
  legal_name: string | null;
  url: string | null;
  logo: string | null;
  telephone: string | null;
  address_present: boolean;
  same_as_count: number;
};

export type JsonLdValidationState =
  | 'valid_syntax_complete'
  | 'valid_syntax_missing_required'
  | 'invalid_syntax'
  | 'no_structured_data'
  | 'unsupported_types_only';

export type JsonLdValidation = {
  ruleset_version: string;
  state: JsonLdValidationState;
  blocks: number;
  valid_blocks: number;
  invalid_blocks: number;
  first_error: { block_index: number; message: string } | null;
  supported_nodes: number;
  unsupported_types: string[];
  nodes: JsonLdNodeResult[];
  org_nodes: JsonLdOrgNode[];
};

const MAX_NODES = 20;
const MAX_ORG_NODES = 3;

/** Strip wrappers that commonly surround JSON-LD inside a <script> element. */
export function cleanJsonLdBlock(block: string): string {
  return String(block)
    .trim()
    .replace(/^<!--/, '').replace(/-->$/, '')
    .replace(/^\s*(?:\/\/\s*)?<!\[CDATA\[/, '').replace(/(?:\/\/\s*)?\]\]>\s*$/, '')
    .trim();
}

/** Validate the raw JSON-LD blocks of ONE page. Never throws. */
export function validateJsonLdBlocks(blocks: readonly string[]): JsonLdValidation {
  const nodes: JsonLdNodeResult[] = [];
  const orgNodes: JsonLdOrgNode[] = [];
  const unsupported = new Set<string>();
  let valid = 0;
  let invalid = 0;
  let firstError: JsonLdValidation['first_error'] = null;
  let supported = 0;

  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const v of value) visit(v, depth + 1); return; }
    const node = value as Node;
    if (Array.isArray(node['@graph'])) visit(node['@graph'], depth + 1);
    const types = typesOf(node);
    let family: JsonLdFamily | null = null;
    let matchedType: string | null = null;
    for (const t of types) {
      const f = familyOfType(t);
      if (f) { family = f; matchedType = t; break; }
    }
    if (family && matchedType) {
      supported += 1;
      const [req, rec] = checkNode(family, node);
      if (nodes.length < MAX_NODES) {
        nodes.push({ type: matchedType, family, missing_required: req, missing_recommended: rec, same_as_count: asArray(node.sameAs).filter((s) => typeof s === 'string').length });
      }
      if ((family === 'Organization' || family === 'LocalBusiness') && orgNodes.length < MAX_ORG_NODES) {
        orgNodes.push({
          family,
          name: str(node.name),
          legal_name: str(node.legalName),
          url: urlish(node.url),
          logo: urlish(node.logo),
          telephone: str(node.telephone),
          address_present: present(node.address),
          same_as_count: asArray(node.sameAs).filter((s) => typeof s === 'string').length,
        });
      }
    } else {
      for (const t of types) if (unsupported.size < 12) unsupported.add(t);
    }
    // Property-nested entities (publisher, author, brand, …) are deliberately NOT walked: they
    // describe somebody else (a publisher, a parent) as often as the subject, and validating
    // them against top-level requirements would report defects that are not defects.
  };

  blocks.forEach((block, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanJsonLdBlock(block));
      valid += 1;
    } catch (error) {
      invalid += 1;
      if (!firstError) firstError = { block_index: index, message: (error instanceof Error ? error.message : String(error)).slice(0, 120) };
      return;
    }
    visit(parsed, 0);
  });

  let state: JsonLdValidationState;
  if (blocks.length === 0) state = 'no_structured_data';
  else if (invalid > 0) state = 'invalid_syntax';
  else if (supported === 0) state = 'unsupported_types_only';
  else if (nodes.some((n) => n.missing_required.length > 0)) state = 'valid_syntax_missing_required';
  else state = 'valid_syntax_complete';

  return {
    ruleset_version: JSONLD_RULESET_VERSION,
    state,
    blocks: blocks.length,
    valid_blocks: valid,
    invalid_blocks: invalid,
    first_error: firstError,
    supported_nodes: supported,
    unsupported_types: [...unsupported],
    nodes,
    org_nodes: orgNodes,
  };
}
