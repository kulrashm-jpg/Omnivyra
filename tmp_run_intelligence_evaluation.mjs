import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.4-mini";

const companyProfileSchema = {
  name: "company_profile",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      basic_info: {
        type: "object",
        additionalProperties: false,
        properties: {
          company: { type: ["string", "null"] },
          category: { type: ["string", "null"] },
          subcategories: { type: "array", items: { type: "string" } },
          positioning: { type: ["string", "null"] },
          core_problem: { type: ["string", "null"] },
          business_model: { type: ["string", "null"] },
        },
        required: ["company", "category", "subcategories", "positioning", "core_problem", "business_model"],
      },
      icp: {
        type: "object",
        additionalProperties: false,
        properties: {
          segment: { type: ["string", "null"] },
          team_size: { type: ["string", "null"] },
          buyer_roles: { type: "array", items: { type: "string" } },
        },
        required: ["segment", "team_size", "buyer_roles"],
      },
      market: {
        type: "object",
        additionalProperties: false,
        properties: {
          primary_geography: { type: ["string", "null"] },
          secondary_geography: { type: ["string", "null"] },
          market_maturity: { type: ["string", "null"] },
          gtm_motion: { type: ["string", "null"] },
        },
        required: ["primary_geography", "secondary_geography", "market_maturity", "gtm_motion"],
      },
      features: {
        type: "object",
        additionalProperties: false,
        properties: {
          atomic: { type: "array", items: { type: "string" } },
          clusters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                features: { type: "array", items: { type: "string" } },
              },
              required: ["name", "features"],
              additionalProperties: false,
            },
          },
          core: { type: "array", items: { type: "string" } },
          extended: { type: "array", items: { type: "string" } },
        },
        required: ["atomic", "clusters", "core", "extended"],
      },
      pricing: {
        type: "object",
        additionalProperties: false,
        properties: {
          tier: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          positioning: { type: ["string", "null"] },
        },
        required: ["tier", "model", "positioning"],
      },
    },
    required: ["basic_info", "icp", "market", "features", "pricing"],
  },
};

const candidatePoolSchema = {
  name: "competitor_candidate_pool",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        minItems: 20,
        maxItems: 30,
        items: { type: "string" },
      },
    },
    required: ["candidates"],
  },
};

const structuredScoringSchema = {
  name: "competitor_structured_scoring",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ranked: {
        type: "array",
        minItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            breakdown: {
              type: "object",
              additionalProperties: false,
              properties: {
                feature: { type: "number" },
                pricing: { type: "number" },
                icp: { type: "number" },
                geography: { type: "number" },
                business_model: { type: "number" },
              },
              required: ["feature", "pricing", "icp", "geography", "business_model"],
            },
            reason: { type: "string" },
          },
          required: ["name", "breakdown", "reason"],
        },
      },
    },
    required: ["ranked"],
  },
};

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function normalizeClusters(value) {
  if (Array.isArray(value)) {
    const out = {};
    for (const item of value) {
      const cleanKey = typeof item?.name === "string" ? item.name.trim() : "";
      if (!cleanKey) continue;
      out[cleanKey] = normalizeArray(item?.features);
    }
    return out;
  }
  if (!value || typeof value !== "object") return {};
  const out = {};
  for (const [key, items] of Object.entries(value)) {
    const cleanKey = typeof key === "string" ? key.trim() : "";
    if (cleanKey) out[cleanKey] = normalizeArray(items);
  }
  return out;
}

function normalizeBusinessModel(value) {
  const allowed = new Set(["SaaS", "Marketplace", "Agency", "Service", "Manufacturer", "Reseller", "Hybrid"]);
  const normalized = normalizeString(value);
  return normalized && allowed.has(normalized) ? normalized : null;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeProfile(profile) {
  return {
    basic_info: {
      company: normalizeString(profile?.basic_info?.company),
      category: normalizeString(profile?.basic_info?.category),
      subcategories: normalizeArray(profile?.basic_info?.subcategories),
      positioning: normalizeString(profile?.basic_info?.positioning),
      core_problem: normalizeString(profile?.basic_info?.core_problem),
      business_model: normalizeBusinessModel(profile?.basic_info?.business_model),
    },
    icp: {
      segment: normalizeString(profile?.icp?.segment),
      team_size: normalizeString(profile?.icp?.team_size),
      buyer_roles: normalizeArray(profile?.icp?.buyer_roles),
    },
    market: {
      primary_geography: normalizeString(profile?.market?.primary_geography),
      secondary_geography: normalizeString(profile?.market?.secondary_geography),
      market_maturity: normalizeString(profile?.market?.market_maturity),
      gtm_motion: normalizeString(profile?.market?.gtm_motion),
    },
    features: {
      atomic: normalizeArray(profile?.features?.atomic),
      clusters: normalizeClusters(profile?.features?.clusters),
      core: normalizeArray(profile?.features?.core),
      extended: normalizeArray(profile?.features?.extended),
    },
    pricing: {
      tier: normalizeString(profile?.pricing?.tier),
      model: normalizeString(profile?.pricing?.model),
      positioning: normalizeString(profile?.pricing?.positioning),
    },
  };
}

async function extractCompanyProfile(rawDescription, options = {}) {
  const client = options.client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = options.model || DEFAULT_MODEL;
  console.log("SCHEMA BEING USED:", JSON.stringify(companyProfileSchema, null, 2));
  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Extract a standardized company profile. Return JSON only. Unknown scalar fields must be null. Unknown arrays must be []. business_model must be one of SaaS, Marketplace, Agency, Service, Manufacturer, Reseller, Hybrid, or null. Prefer SaaS for product-led software, Agency/Service for done-for-you, Hybrid for mixed.",
      },
      { role: "user", content: rawDescription },
    ],
    response_format: { type: "json_schema", json_schema: companyProfileSchema },
  });
  return normalizeProfile(JSON.parse(completion.choices[0].message.content));
}

function computeWeightedScore(b) {
  return Number((b.feature * 2.5 + b.icp * 2.5 + b.business_model * 2 + b.pricing * 1 + b.geography * 0.5).toFixed(2));
}

function classifyCompetitor(item) {
  if (item.total_score >= 12 && item.breakdown.business_model >= 1) return "Direct";
  if (item.total_score >= 7) return "Indirect";
  return "Replacement";
}

function indicatesReplacement(reason) {
  const text = (reason || "").toLowerCase();
  return ["replacement", "alternative", "same outcome", "agency", "service provider", "outsource", "manual workflow", "substitute"].some((s) => text.includes(s));
}

function reasonMentionsFeatureOverlap(reason, companyProfile) {
  const text = (reason || "").toLowerCase();
  const terms = [
    ...normalizeArray(companyProfile?.features?.atomic),
    ...normalizeArray(companyProfile?.features?.core),
    ...normalizeArray(companyProfile?.features?.extended),
    "feature", "workflow", "platform", "automation", "analytics", "audit", "seo", "content", "campaign", "crm", "marketplace", "ecommerce", "payments", "design", "vehicle", "retail",
  ];
  return [...new Set(terms.flatMap((t) => String(t).toLowerCase().split(/[^a-z0-9]+/)).filter((t) => t.length >= 3))].some((term) => text.includes(term));
}

function reasonMentionsIcpOverlap(reason, companyProfile) {
  const text = (reason || "").toLowerCase();
  const terms = [
    normalizeString(companyProfile?.icp?.segment),
    normalizeString(companyProfile?.icp?.team_size),
    ...normalizeArray(companyProfile?.icp?.buyer_roles),
    "buyer", "customer", "team", "business", "enterprise", "smb", "creator", "founder", "marketer", "developer", "freelancer", "consumer", "merchant",
  ];
  return [...new Set(terms.filter(Boolean).flatMap((t) => String(t).toLowerCase().split(/[^a-z0-9]+/)).filter((t) => t.length >= 3))].some((term) => text.includes(term));
}

function isSoftwareLikeProfile(companyProfile) {
  const text = [
    normalizeString(companyProfile?.basic_info?.category),
    ...normalizeArray(companyProfile?.basic_info?.subcategories),
    normalizeString(companyProfile?.basic_info?.positioning),
    normalizeString(companyProfile?.basic_info?.core_problem),
    ...normalizeArray(companyProfile?.features?.atomic),
  ].filter(Boolean).join(" ").toLowerCase();
  return ["software", "saas", "crm", "platform", "marketing", "automation", "analytics", "seo", "content", "ecommerce", "marketplace", "payments", "design"].some((s) => text.includes(s));
}

function isManufacturerLikeProfile(companyProfile) {
  const text = [
    normalizeString(companyProfile?.basic_info?.category),
    ...normalizeArray(companyProfile?.basic_info?.subcategories),
    normalizeString(companyProfile?.basic_info?.positioning),
    normalizeString(companyProfile?.basic_info?.core_problem),
  ].filter(Boolean).join(" ").toLowerCase();
  return ["manufacturer", "vehicle", "automotive", "footwear", "apparel", "consumer brand", "hardware", "energy", "retail brand"].some((s) => text.includes(s));
}

function isObviousCrossIndustryMismatch(companyProfile, item) {
  const text = `${item.name} ${item.reason}`.toLowerCase();
  const softwareVsPhysicalMismatch =
    isSoftwareLikeProfile(companyProfile) &&
    ["automotive", "vehicle", "fashion", "footwear", "apparel", "energy storage", "car manufacturer", "pharmaceutical", "airline"].some((term) => text.includes(term));
  const physicalVsSoftwareMismatch =
    isManufacturerLikeProfile(companyProfile) &&
    ["crm", "email marketing", "seo platform", "freelancer marketplace", "customer service software", "website builder"].some((term) => text.includes(term));
  return softwareVsPhysicalMismatch || physicalVsSoftwareMismatch;
}

function isSameDomain(companyProfile, item) {
  const category = (companyProfile?.basic_info?.category || "").toLowerCase();
  const text = `${item.name} ${item.reason}`.toLowerCase();
  if (!category) return true;
  return text.includes(category.split(" ")[0]);
}

function normalizeScoredItem(item) {
  const name = normalizeString(item?.name);
  if (!name) return null;
  return {
    name,
    breakdown: {
      feature: clampNumber(item?.breakdown?.feature, 0, 5),
      pricing: clampNumber(item?.breakdown?.pricing, 0, 3),
      icp: clampNumber(item?.breakdown?.icp, 0, 3),
      geography: clampNumber(item?.breakdown?.geography, 0, 2),
      business_model: clampNumber(item?.breakdown?.business_model, 0, 2),
    },
    reason: normalizeString(item?.reason) || "",
  };
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of normalizeArray(values)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function dedupeRanked(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.name) continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isAnchorCompetitor(item) {
  return item.total_score >= 12 && item.breakdown?.icp >= 2;
}

function isValidAnchor(item) {
  return item.total_score >= 12 && item.breakdown?.icp >= 2 && item.breakdown?.feature >= 3;
}

function finalizeRanked(items) {
  return dedupeRanked(items).sort(
    (a, b) =>
      b.total_score - a.total_score ||
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      (b.breakdown?.feature ?? 0) - (a.breakdown?.feature ?? 0) ||
      a.name.localeCompare(b.name)
  );
}

function applyHardRules(items, companyProfile) {
  const survivors = [];
  for (const item of items) {
    const replacement = indicatesReplacement(item.reason);
    if (item.breakdown.icp === 0) continue;
    if (item.breakdown.business_model === 0 && !replacement) continue;
    if (item.breakdown.feature < 2 && item.breakdown.icp < 2 && !replacement) continue;
    if (isObviousCrossIndustryMismatch(companyProfile, item) && !isSameDomain(companyProfile, item)) continue;
    survivors.push(item);
  }
  return { survivors };
}

function applyValidationAndScoring(items, companyProfile) {
  const kept = [];
  const softFailed = [];
  for (const item of items) {
    let totalScore = computeWeightedScore(item.breakdown);
    const hasFeatureMention = reasonMentionsFeatureOverlap(item.reason, companyProfile);
    const hasIcpMention = reasonMentionsIcpOverlap(item.reason, companyProfile);
    if (!hasFeatureMention && !hasIcpMention) totalScore = Number((totalScore - 1).toFixed(2));
    const confidence = (item.breakdown.feature / 5) * 0.4 + (item.breakdown.icp / 3) * 0.3 + (item.breakdown.business_model / 2) * 0.3;
    const finalized = {
      name: item.name,
      total_score: totalScore,
      breakdown: item.breakdown,
      reason: item.reason,
      confidence: Number(confidence.toFixed(2)),
    };
    finalized.type = classifyCompetitor(finalized);
    if (totalScore >= 5) kept.push(finalized);
    else softFailed.push(finalized);
  }
  return { kept, softFailed };
}

function backfillToMinimum(primary, fallback, minCount) {
  const merged = [...primary];
  const seen = new Set(primary.map((item) => item.name.toLowerCase()));
  for (const item of fallback) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    merged.push(item);
    seen.add(key);
    if (merged.length >= minCount) break;
  }
  return merged;
}

function getCategoryKey(item) {
  if (item.breakdown.feature >= 4 && item.breakdown.icp >= 2) return "core";
  const text = `${item.name} ${item.reason}`.toLowerCase();
  if (text.includes("seo")) return "seo";
  if (text.includes("content")) return "content";
  if (text.includes("crm")) return "crm";
  if (text.includes("automation")) return "automation";
  if (text.includes("marketplace")) return "marketplace";
  if (text.includes("ecommerce")) return "ecommerce";
  if (text.includes("analytics")) return "analytics";
  return "adjacent";
}

function enforceDiversity(ranked) {
  if (!Array.isArray(ranked) || ranked.length <= 3) return ranked;
  const topThree = ranked.slice(0, 3);
  const remaining = ranked.slice(3);
  const selected = [...topThree];
  const deferred = [];
  const categoryKeys = new Set(topThree.map(getCategoryKey));
  const targetDiversity = 4;
  for (const item of remaining) {
    const categoryKey = getCategoryKey(item);
    const shouldPreserve = isAnchorCompetitor(item);
    if (shouldPreserve || categoryKeys.size >= targetDiversity || !categoryKeys.has(categoryKey)) {
      selected.push(item);
      categoryKeys.add(categoryKey);
    } else {
      deferred.push(item);
    }
  }
  return [...selected, ...deferred];
}

function meetsTopCompetitorConditions(item) {
  return item?.breakdown?.icp >= 2 && item?.breakdown?.feature >= 3 && item?.breakdown?.business_model >= 1;
}

function validateTopCompetitors(ranked) {
  if (!Array.isArray(ranked) || ranked.length <= 3) return ranked;
  const usedNames = new Set();
  const finalTop = [];
  for (let i = 0; i < 3; i += 1) {
    const current = ranked[i];
    let chosen = current;
    if (!meetsTopCompetitorConditions(current)) {
      const replacement = ranked.find((candidate, index) => index >= 3 && !usedNames.has(candidate.name.toLowerCase()) && meetsTopCompetitorConditions(candidate));
      if (replacement) chosen = replacement;
    }
    finalTop.push(chosen);
    usedNames.add(chosen.name.toLowerCase());
  }
  const remaining = ranked.filter((item) => !usedNames.has(item.name.toLowerCase()));
  return [...finalTop, ...remaining];
}

function preserveAnchorCompetitors(originalRanked, currentRanked) {
  const anchors = originalRanked.filter(isValidAnchor);
  const seen = new Set(currentRanked.map((item) => item.name.toLowerCase()));
  const result = [...currentRanked];
  for (const anchor of anchors) {
    const key = anchor.name.toLowerCase();
    if (!seen.has(key)) {
      result.push(anchor);
      seen.add(key);
    }
  }
  return result;
}

async function generateAndScoreCompetitors(companyProfile, options = {}) {
  const client = options.client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = options.model || DEFAULT_MODEL;
  const candidateResponse = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Generate a competitor candidate pool. Return JSON only. Return 20-30 real companies/tools. Use multi-category reasoning across features, ICP, pricing, geography, and business model. A competitor must be a realistic alternative a buyer would evaluate. Include direct, indirect, and replacement-style alternatives when relevant. Do NOT include unrelated industries. Do NOT include scores or classifications.",
      },
      { role: "user", content: `Company profile JSON:\n${JSON.stringify(companyProfile, null, 2)}` },
    ],
    response_format: { type: "json_schema", json_schema: candidatePoolSchema },
  });
  const candidates = dedupeStrings(JSON.parse(candidateResponse.choices[0].message.content).candidates);
  const scoringResponse = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "Score competitor candidates. Return JSON only. Score each candidate on feature 0-5, pricing 0-3, icp 0-3, geography 0-2, business_model 0-2. Do NOT compute total_score. Do NOT classify. A competitor must be a realistic alternative a buyer would evaluate. Provide a short reason explaining why this competes. Do NOT include unrelated industries.",
      },
      { role: "user", content: `Company profile JSON:\n${JSON.stringify(companyProfile, null, 2)}\n\nCandidate list:\n${JSON.stringify(candidates, null, 2)}` },
    ],
    response_format: { type: "json_schema", json_schema: structuredScoringSchema },
  });
  const normalizedScored = dedupeRanked((JSON.parse(scoringResponse.choices[0].message.content).ranked || []).map(normalizeScoredItem).filter(Boolean));
  const { survivors } = applyHardRules(normalizedScored, companyProfile);
  const { kept, softFailed } = applyValidationAndScoring(survivors, companyProfile);
  let ranked = finalizeRanked(kept);
  if (ranked.length < 8) {
    const eligibleFallback = finalizeRanked(
      softFailed.filter(
        (item) =>
          item.breakdown.icp > 0 &&
          !(isObviousCrossIndustryMismatch(companyProfile, item) && !isSameDomain(companyProfile, item)) &&
          (item.breakdown.icp >= 2 || item.breakdown.business_model >= 1)
      )
    );
    ranked = finalizeRanked(backfillToMinimum(ranked, eligibleFallback, 8));
  }
  const preDiversityRanked = [...ranked];
  ranked = enforceDiversity(ranked);
  if (ranked.length < 8) {
    const rankedBackup = finalizeRanked([...ranked, ...softFailed]);
    ranked = finalizeRanked(backfillToMinimum(ranked, rankedBackup, 8));
  }
  ranked = preserveAnchorCompetitors(preDiversityRanked, ranked);
  ranked = finalizeRanked(ranked);
  ranked = validateTopCompetitors(ranked);
  if (ranked.length < 8) ranked = backfillToMinimum(ranked, preDiversityRanked, 8);
  if (ranked.length < 8) throw new Error("Competitor generation returned fewer than 8 valid competitors after filtering.");
  return { candidates, ranked };
}

function bucketCompetitors(ranked) {
  const knownMarketLeaders = new Set([
    "hubspot", "semrush", "ahrefs", "salesforce", "adobe", "marketo", "mailchimp", "activecampaign", "sprout social", "hootsuite", "buffer", "jasper", "copy.ai", "writesonic", "moz", "brevo", "surfer", "shopify", "stripe", "tesla", "canva", "upwork", "fiverr",
  ]);
  const feature_closest = ranked.filter((item) => item.breakdown.feature >= 4);
  const icp_closest = ranked.filter((item) => item.breakdown.icp >= 2);
  const pricing_neighbour = ranked.filter((item) => item.breakdown.pricing >= 2);
  const market_leaders = ranked.filter((item) => knownMarketLeaders.has(item.name.toLowerCase()) || item.total_score >= 12);
  const emerging = ranked.filter((item) => item.total_score <= 10 || (!knownMarketLeaders.has(item.name.toLowerCase()) && item.total_score < 12));
  const replacements = ranked.filter((item) => item.type === "Replacement");
  const fill = (bucket, source, n = 3) => (bucket.length ? bucket : source.slice(0, n));
  return {
    feature_closest: fill(feature_closest, ranked),
    icp_closest: fill(icp_closest, ranked),
    pricing_neighbour: fill(pricing_neighbour, ranked),
    market_leaders: fill(market_leaders, ranked),
    emerging: fill(emerging, [...ranked].reverse()),
    replacements: fill(replacements, ranked),
  };
}

async function buildCompanyIntelligence(rawDescription, options = {}) {
  const profile = await extractCompanyProfile(rawDescription, { client: options.client, model: options.profileModel });
  const competitors = await generateAndScoreCompetitors(profile, { client: options.client, model: options.competitorModel });
  const buckets = bucketCompetitors(competitors.ranked);
  return { profile, competitors, buckets };
}

const COMPANY_FIXTURES = [
  { company: "Omnivyra", expected_business_model: "SaaS", description: "AI marketing platform for SMBs providing audits, content, and campaign execution." },
  { company: "Shopify", expected_business_model: "SaaS", description: "Ecommerce SaaS platform enabling businesses to build and run online stores." },
  { company: "Tesla", expected_business_model: "Manufacturer", description: "Electric vehicle and energy product manufacturer with vertically integrated operations." },
  { company: "Upwork", expected_business_model: "Marketplace", description: "Marketplace connecting businesses with freelancers for digital services." },
  { company: "HubSpot", expected_business_model: "SaaS", description: "CRM and marketing automation platform for SMB and mid-market businesses." },
  { company: "Nike", expected_business_model: "Manufacturer", description: "Global brand designing and selling athletic apparel and footwear." },
  { company: "Stripe", expected_business_model: "SaaS", description: "Payments infrastructure platform for developers and online businesses." },
  { company: "Canva", expected_business_model: "SaaS", description: "Design and content creation platform for individuals and teams." },
  { company: "Salesforce", expected_business_model: "SaaS", description: "Enterprise CRM platform for sales, service, and marketing." },
  { company: "Fiverr", expected_business_model: "Marketplace", description: "Marketplace for freelance services across design, development, and marketing." },
  { company: "McKinsey & Company", expected_business_model: "Service", description: "Global consulting firm providing strategic advisory services to enterprises." },
  { company: "Amazon", expected_business_model: "Hybrid", description: "Global company operating ecommerce marketplace, cloud infrastructure, and logistics." },
];

function summarizeBuckets(buckets) {
  return {
    feature_closest: Array.isArray(buckets?.feature_closest) ? buckets.feature_closest.length : 0,
    icp_closest: Array.isArray(buckets?.icp_closest) ? buckets.icp_closest.length : 0,
    pricing_neighbour: Array.isArray(buckets?.pricing_neighbour) ? buckets.pricing_neighbour.length : 0,
    market_leaders: Array.isArray(buckets?.market_leaders) ? buckets.market_leaders.length : 0,
    emerging: Array.isArray(buckets?.emerging) ? buckets.emerging.length : 0,
    replacements: Array.isArray(buckets?.replacements) ? buckets.replacements.length : 0,
  };
}

function getTopCompetitors(result, limit = 5) {
  return Array.isArray(result?.competitors?.ranked)
    ? result.competitors.ranked.slice(0, limit).map((item) => ({ name: item.name, total_score: item.total_score, type: item.type }))
    : [];
}

function getTextFingerprint(entry) {
  return `${entry.name} ${entry.type}`.toLowerCase();
}

function evaluateCompetitorQuality(topCompetitors, expectedBusinessModel) {
  const businessModel = (expectedBusinessModel || "").toLowerCase();
  const wrong = [];
  const mismatchRules = {
    saas: ["nike", "tesla", "toyota", "ford", "adidas", "puma"],
    marketplace: ["hubspot", "salesforce", "tesla", "nike"],
    manufacturer: ["hubspot", "salesforce", "semrush", "ahrefs", "canva"],
  };
  const blocked = mismatchRules[businessModel] || [];
  for (const competitor of topCompetitors) {
    const fingerprint = getTextFingerprint(competitor);
    if (blocked.some((token) => fingerprint.includes(token))) wrong.push(competitor.name);
  }
  const realistic = wrong.length === 0 && topCompetitors.length >= 5;
  let quality = "Good";
  if (!realistic || topCompetitors.length < 4) quality = "Poor";
  else if (wrong.length > 0 || topCompetitors.some((item) => item.total_score < 7)) quality = "Mixed";
  return { realistic, wrong, quality };
}

function evaluateDiversity(topCompetitors) {
  const categories = new Set();
  for (const competitor of topCompetitors) {
    const text = competitor.name.toLowerCase();
    if (text.includes("hubspot") || text.includes("salesforce")) categories.add("crm");
    else if (text.includes("semrush") || text.includes("ahrefs")) categories.add("seo");
    else if (text.includes("upwork") || text.includes("fiverr")) categories.add("marketplace");
    else if (text.includes("shopify") || text.includes("bigcommerce")) categories.add("ecommerce");
    else if (text.includes("canva") || text.includes("adobe")) categories.add("design");
    else if (text.includes("stripe") || text.includes("adyen") || text.includes("paypal")) categories.add("payments");
    else if (text.includes("nike") || text.includes("adidas") || text.includes("puma")) categories.add("consumer-brand");
    else if (text.includes("tesla") || text.includes("rivian") || text.includes("byd")) categories.add("automotive");
    else categories.add("other");
  }
  return { diverse: categories.size >= 2, category_count: categories.size };
}

function buildEvaluation(entry, result, seenCompetitors) {
  const actualBusinessModel = result?.profile?.basic_info?.business_model ?? null;
  const topCompetitors = getTopCompetitors(result);
  const bucketSummary = summarizeBuckets(result?.buckets);
  const businessModelValid = actualBusinessModel === entry.expected_business_model;
  const qualityCheck = evaluateCompetitorQuality(topCompetitors, entry.expected_business_model);
  const diversityCheck = evaluateDiversity(topCompetitors);
  const issues = [];
  if (!businessModelValid) issues.push(`Business model mismatch: expected ${entry.expected_business_model}, got ${actualBusinessModel || "null"}`);
  if (qualityCheck.wrong.length > 0) issues.push(`Obvious wrong competitors: ${qualityCheck.wrong.join(", ")}`);
  if (!diversityCheck.diverse) issues.push("Weak category diversity in top competitors");
  for (const competitor of topCompetitors) {
    const key = competitor.name.toLowerCase();
    seenCompetitors.set(key, (seenCompetitors.get(key) || 0) + 1);
  }
  return {
    company: entry.company,
    business_model: actualBusinessModel,
    business_model_valid: businessModelValid,
    top_competitors: topCompetitors,
    bucket_summary: bucketSummary,
    evaluation: {
      competitor_quality: qualityCheck.quality,
      diversity: diversityCheck.diverse ? "Good" : "Weak",
      issues,
    },
  };
}

function finalizeGlobalSummary(results, failures, seenCompetitors) {
  const successful = results.length;
  const validBusinessModels = results.filter((item) => item.business_model_valid).length;
  const qualityScoreMap = { Good: 3, Mixed: 2, Poor: 1 };
  const avgQualityScore = successful === 0 ? 0 : results.reduce((sum, item) => sum + (qualityScoreMap[item.evaluation.competitor_quality] || 0), 0) / successful;
  let avgCompetitorQuality = "Poor";
  if (avgQualityScore >= 2.5) avgCompetitorQuality = "Good";
  else if (avgQualityScore >= 1.75) avgCompetitorQuality = "Mixed";
  const repeatedCompetitors = Array.from(seenCompetitors.entries()).filter(([, count]) => count >= 5).map(([name]) => name);
  const commonIssues = new Set();
  for (const result of results) for (const issue of result.evaluation.issues) commonIssues.add(issue);
  if (repeatedCompetitors.length > 0) commonIssues.add(`Same competitors repeated across many companies: ${repeatedCompetitors.join(", ")}`);
  if (failures.length > 0) commonIssues.add(`Failed companies: ${failures.map((item) => item.company).join(", ")}`);
  const businessModelAccuracy = successful === 0 ? 0 : Number(((validBusinessModels / successful) * 100).toFixed(1));
  let systemHealth = "Weak";
  if (businessModelAccuracy >= 80 && avgCompetitorQuality === "Good" && repeatedCompetitors.length <= 2) systemHealth = "Strong";
  else if (businessModelAccuracy >= 60 && avgCompetitorQuality !== "Poor") systemHealth = "Needs Improvement";
  return {
    total_companies: COMPANY_FIXTURES.length,
    business_model_accuracy: businessModelAccuracy,
    avg_competitor_quality: avgCompetitorQuality,
    common_issues: Array.from(commonIssues),
    system_health: systemHealth,
  };
}

async function runIntelligenceEvaluation() {
  const results = [];
  const failures = [];
  const seenCompetitors = new Map();
  console.log("Starting evaluation...");
  for (const entry of COMPANY_FIXTURES) {
    try {
      const intelligence = await buildCompanyIntelligence(entry.description);
      results.push(buildEvaluation(entry, intelligence, seenCompetitors));
    } catch (error) {
      failures.push({ company: entry.company, error: error instanceof Error ? error.message : String(error) });
      results.push({
        company: entry.company,
        error: error instanceof Error ? error.message : String(error),
        business_model: null,
        business_model_valid: false,
        top_competitors: [],
        bucket_summary: {
          feature_closest: 0,
          icp_closest: 0,
          pricing_neighbour: 0,
          market_leaders: 0,
          emerging: 0,
          replacements: 0,
        },
        evaluation: {
          competitor_quality: "Poor",
          diversity: "Weak",
          issues: ["Execution failed"],
        },
      });
    }
  }
  const report = { results, global_summary: finalizeGlobalSummary(results.filter((r) => !r.error), failures, seenCompetitors) };
  console.log("Evaluation complete.");
  console.log(JSON.stringify(report, null, 2));
}

await runIntelligenceEvaluation();
