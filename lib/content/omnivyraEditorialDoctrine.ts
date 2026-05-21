export type OmnivyraPovArchetypeId =
  | 'operator_first'
  | 'systems_over_outputs'
  | 'intelligence_to_execution'
  | 'authority_with_proof'
  | 'workflow_realism';

export interface OmnivyraEditorialDoctrine {
  id: 'omnivyra-editorial-doctrine';
  version: '1.0.0';
  worldview: {
    thesis: string;
    principles: readonly string[];
  };
  categoryNarrative: {
    category: string;
    narrative: string;
    marketShift: string;
  };
  strategicBeliefs: readonly string[];
  enemyAssumptions: readonly string[];
  preferredAnalyticalPatterns: readonly string[];
  approvedPovArchetypes: readonly {
    id: OmnivyraPovArchetypeId;
    label: string;
    useWhen: string;
    editorialMove: string;
  }[];
  forbiddenGenericFraming: readonly string[];
  preferredTerminology: readonly string[];
  proprietaryConcepts: readonly {
    id: string;
    label: string;
    role: string;
  }[];
  operationalPhilosophy: readonly string[];
  proofStandards: readonly string[];
  authorityPosture: readonly string[];
  toneConstraints: readonly string[];
  audienceSophisticationExpectations: readonly string[];
}

export interface OmnivyraDoctrineGenerationContext {
  worldview: OmnivyraEditorialDoctrine['worldview'];
  strategicBeliefs: OmnivyraEditorialDoctrine['strategicBeliefs'];
  forbiddenGenericFraming: OmnivyraEditorialDoctrine['forbiddenGenericFraming'];
  approvedPovArchetypes: OmnivyraEditorialDoctrine['approvedPovArchetypes'];
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

const OMNIVYRA_EDITORIAL_DOCTRINE = deepFreeze<OmnivyraEditorialDoctrine>({
  id: 'omnivyra-editorial-doctrine',
  version: '1.0.0',
  worldview: {
    thesis:
      'Modern growth is not won by producing more content; it is won by connecting intelligence, execution, proof, and iteration into an operating system.',
    principles: [
      'Strategy must survive contact with real workflows.',
      'Content only compounds when it is tied to audience pain, proof, distribution, and learning.',
      'AI should reduce operational ambiguity, not manufacture generic volume.',
      'Authority is earned through useful judgment, not through polished formatting.',
    ],
  },
  categoryNarrative: {
    category: 'marketing intelligence and execution systems',
    narrative:
      'Omnivyra sits at the intersection of marketing intelligence, content operations, creator workflows, and execution governance.',
    marketShift:
      'Teams are moving from disconnected content production toward evidence-led systems that decide what to create, why it matters, how it ships, and how it learns.',
  },
  strategicBeliefs: [
    'Generic content is usually a symptom of weak upstream context, not weak writing.',
    'Editorial authority requires a visible operating belief in every major section.',
    'Planning, creation, distribution, and feedback should be treated as one system.',
    'Useful AI content must expose decisions, tradeoffs, constraints, and proof mechanics.',
    'Search visibility and AI citation readiness depend on semantic authority, not keyword decoration.',
  ],
  enemyAssumptions: [
    'More content automatically creates more authority.',
    'A formatted article is the same thing as an intelligent article.',
    'SEO checklists can compensate for weak editorial judgment.',
    'Brand voice is only tone rather than a strategic point of view.',
    'AI generation should start with a blank prompt instead of a governed doctrine.',
  ],
  preferredAnalyticalPatterns: [
    'diagnose the hidden operating problem before prescribing tactics',
    'contrast surface activity with system-level consequence',
    'move from belief to mechanism to workflow to proof',
    'name the tradeoff behind every recommendation',
    'translate strategy into decisions, roles, checks, and feedback loops',
  ],
  approvedPovArchetypes: [
    {
      id: 'operator_first',
      label: 'Operator-first diagnosis',
      useWhen: 'The topic risks becoming abstract, motivational, or beginner-grade.',
      editorialMove: 'Start from the workflow pressure an experienced operator actually feels.',
    },
    {
      id: 'systems_over_outputs',
      label: 'Systems over outputs',
      useWhen: 'The topic is being framed as volume, production, or isolated tactics.',
      editorialMove: 'Reframe the issue around repeatable systems, governance, and feedback.',
    },
    {
      id: 'intelligence_to_execution',
      label: 'Intelligence to execution',
      useWhen: 'The topic involves insights, recommendations, planning, or AI assistance.',
      editorialMove: 'Show how intelligence becomes decisions, assets, schedules, and learning loops.',
    },
    {
      id: 'authority_with_proof',
      label: 'Authority with proof',
      useWhen: 'The content needs credibility, GEO readiness, or buyer trust.',
      editorialMove: 'Tie claims to evidence, examples, constraints, and transferable proof.',
    },
    {
      id: 'workflow_realism',
      label: 'Workflow realism',
      useWhen: 'The topic includes implementation advice.',
      editorialMove: 'Name the actor, trigger, constraint, decision point, failure mode, and success signal.',
    },
  ],
  forbiddenGenericFraming: [
    'in today\'s fast-paced digital landscape',
    'businesses need to leverage innovative solutions',
    'unlock the full potential of your content strategy',
    'drive growth with actionable insights',
    'streamline your workflow for better results',
    'stay ahead of the competition with cutting-edge tools',
    'content is king',
    'best practices for success',
  ],
  preferredTerminology: [
    'editorial intelligence',
    'execution intelligence',
    'authority architecture',
    'content operating system',
    'proof mechanics',
    'workflow realism',
    'semantic authority',
    'governed generation',
    'distribution learning loop',
  ],
  proprietaryConcepts: [
    {
      id: 'authority_architecture',
      label: 'Authority Architecture',
      role: 'Explains how topics, proof, POV, internal links, and semantic depth compound into trust.',
    },
    {
      id: 'execution_intelligence_loop',
      label: 'Execution Intelligence Loop',
      role: 'Connects planning, asset creation, publishing, measurement, and learning.',
    },
    {
      id: 'company_conditioned_editorial_intelligence',
      label: 'Company-Conditioned Editorial Intelligence',
      role: 'Defines content that thinks from the company worldview instead of generic category advice.',
    },
    {
      id: 'proof_mechanics',
      label: 'Proof Mechanics',
      role: 'Requires claims to show evidence, constraint, implementation, and outcome logic.',
    },
  ],
  operationalPhilosophy: [
    'Start from the operator situation, not the content format.',
    'Expose the system behind the recommendation.',
    'Prefer specific workflow consequences over abstract benefits.',
    'Treat constraints, tradeoffs, and failure modes as authority signals.',
    'Close with an operating implication, not a generic CTA.',
  ],
  proofStandards: [
    'Use concrete scenarios when verified data is unavailable.',
    'Never invent metrics, studies, customer names, or outcomes.',
    'Distinguish observed patterns from sourced facts.',
    'Tie recommendations to implementation checks and evidence signals.',
    'Case-study claims require supplied proof or explicit qualification.',
  ],
  authorityPosture: [
    'direct but not inflated',
    'opinionated but evidence-aware',
    'practitioner-aware rather than academic',
    'strategic without becoming vague',
    'confident about mechanisms, careful about unsupported claims',
  ],
  toneConstraints: [
    'avoid hype language',
    'avoid generic SaaS optimism',
    'avoid motivational filler',
    'avoid empty thought-leadership abstractions',
    'prefer precise operating language over broad adjectives',
  ],
  audienceSophisticationExpectations: [
    'Assume readers understand basic marketing and content concepts.',
    'Respect senior operators by naming constraints and tradeoffs.',
    'Do not over-explain obvious definitions unless search intent requires it.',
    'Provide implementation nuance for experienced teams.',
    'Make examples credible to people who run real workflows.',
  ],
});

export function getOmnivyraEditorialDoctrine(): OmnivyraEditorialDoctrine {
  return OMNIVYRA_EDITORIAL_DOCTRINE;
}

export function resolveOmnivyraDoctrineGenerationContext(): OmnivyraDoctrineGenerationContext {
  const doctrine = getOmnivyraEditorialDoctrine();
  return {
    worldview: doctrine.worldview,
    strategicBeliefs: doctrine.strategicBeliefs,
    forbiddenGenericFraming: doctrine.forbiddenGenericFraming,
    approvedPovArchetypes: doctrine.approvedPovArchetypes,
  };
}

