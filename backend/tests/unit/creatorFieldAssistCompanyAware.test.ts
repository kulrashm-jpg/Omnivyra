import { getTemplateById } from '../../../lib/creator-templates';
import {
  buildFieldAssistMessages,
  resolveTemplateField,
  type FieldAssistRequest,
} from '../../services/creator/creatorFieldAssistService';
import type { CreatorCompanyContext, CreatorBrandVoice } from '../../services/creator/creatorCopyContextResolver';

const tpl = getTemplateById('sys-image-headline-sub-cta')!;
const field = resolveTemplateField(tpl, 'flat', 'headline')!;
const resolved = [{ target: { scope: 'flat' as const, fieldKey: 'headline', currentValue: '' }, field }];

function req(company?: CreatorCompanyContext, brandVoice?: CreatorBrandVoice, topic = 'Launch'): FieldAssistRequest {
  return {
    assetFamily: 'image',
    templateId: tpl.id,
    action: 'generate',
    targets: [{ scope: 'flat', fieldKey: 'headline', currentValue: '' }],
    context: { topic, company, brandVoice },
  };
}

function joined(request: FieldAssistRequest): string {
  return buildFieldAssistMessages(tpl, request, resolved).map((m) => m.content).join('\n');
}

describe('Company-aware field assist — brand voice (communication style)', () => {
  it('injects brand tone, personality, CTA style, preferred + forbidden words', () => {
    const text = joined(req(undefined, {
      tone: 'confident and warm',
      descriptors: ['pragmatic', 'human'],
      ctaStyle: 'soft invitation',
      requiredTerms: ['operators'],
      prohibitedPhrases: ['synergy', 'world-class'],
    }));
    expect(text).toContain('Brand tone: confident and warm');
    expect(text).toContain('Brand personality: pragmatic, human');
    expect(text).toContain('CTA style: soft invitation');
    expect(text).toContain('Prefer these terms when natural: operators');
    expect(text).toContain('NEVER use these forbidden words/phrases: synergy, world-class');
  });

  it('omits brand-voice lines entirely when no brand voice is supplied (no fabrication)', () => {
    const text = joined(req());
    expect(text).not.toContain('Brand tone:');
    expect(text).not.toContain('NEVER use these forbidden');
  });
});

describe('Company-aware field assist — company context (business understanding)', () => {
  it('grounds the prompt in the canonical company facts', () => {
    const text = joined(req({
      description: 'A workflow automation platform for RevOps teams',
      products: ['Lead router', 'Pipeline sync'],
      audience: ['RevOps leaders'],
      positioning: 'The fastest way to route inbound',
      differentiators: 'Sub-minute routing',
      industries: ['SaaS'],
    }));
    expect(text).toContain('Business: A workflow automation platform for RevOps teams');
    expect(text).toContain('Products/services: Lead router, Pipeline sync');
    expect(text).toContain('Positioning: The fastest way to route inbound');
    expect(text).toContain('Differentiators: Sub-minute routing');
    expect(text).toContain('do not invent products, claims, or company facts');
  });

  it('DIFFERENT companies on the SAME template produce DIFFERENT grounding (business alignment)', () => {
    const a = joined(req({ description: 'A fintech lender for SMBs', products: ['Working capital'] }));
    const b = joined(req({ description: 'A B2B cybersecurity SOC platform', products: ['Threat detection'] }));
    expect(a).toContain('A fintech lender for SMBs');
    expect(b).toContain('A B2B cybersecurity SOC platform');
    expect(a).not.toEqual(b); // same template + same layout, different company copy grounding
  });

  it('brand voice differs but the template/layout instructions are identical across companies', () => {
    const voiceA = joined(req({ description: 'Same biz' }, { tone: 'playful' }));
    const voiceB = joined(req({ description: 'Same biz' }, { tone: 'formal' }));
    // Layout/structure framing is template-owned and identical; only voice differs.
    expect(voiceA).toContain('asset ("Headline + Subheadline + CTA")');
    expect(voiceB).toContain('asset ("Headline + Subheadline + CTA")');
    expect(voiceA).toContain('Brand tone: playful');
    expect(voiceB).toContain('Brand tone: formal');
  });
});
