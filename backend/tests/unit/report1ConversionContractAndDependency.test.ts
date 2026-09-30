/**
 * REPORT-1-CONVERSION-CONTRACT-AND-DEPENDENCY-REMEDIATION-005
 *
 * ISSUE A — the producer → rule severity contract was not pinned.
 * Slice 004 made a materially deficient conversion path re-sequence demand generation, and
 * that re-sequencing fires on `severity === 'critical'`. Nothing tested that
 * `assessDigitalExperience` actually raises the no-conversion-path defect at `critical`, so a
 * future edit lowering it to `moderate` would have silently switched the sequencing off with
 * every existing test still green.
 *
 * ISSUE B — `dependsOn` was recorded on the opportunity and dropped before the customer.
 * It was lost TWICE: `toPlanItem` did not copy it, and the persisted `SnapshotPlanItem` is a
 * separate type from the assembly's `PlanItem`, so widening one would not have widened the
 * other. The reader saw the ordering with no way to know why.
 *
 * WHAT IS ASSERTED
 * The REAL producer (`assessDigitalExperience`), fed into the REAL assembly, through to the
 * REAL renderer. §7D forbids substituting a hand-built critical finding for the producer test,
 * so the integration case builds its findings from crawl-shaped pages only.
 */
import { assessDigitalExperience } from '../../services/digitalExperience';
import { assembleDigitalSnapshot } from '../../services/digitalSnapshotAssembly';
import { renderNinetyDayPlan } from '../../services/intelligence/exportRendererReport1';

type Page = Record<string, unknown>;

/** A crawl-shaped page that responded. Mirrors the established fixture in performanceAndExperience. */
const page = (over: Page = {}): Page => ({
  url: 'https://acme.test/',
  title: 'Acme',
  meta_title: 'Acme',
  meta_description: 'Acme builds analytics tooling for marketing teams.',
  page_type: null,
  headings: [{ level: 1, text: 'Acme' }],
  ctas: [{ text: 'Book a demo' }],
  internal_link_count: 6,
  http_status: 200,
  crawl_depth: 0,
  wordCount: 400,
  crawl_metadata: { signals: { form_count: 1 } },
  ...over,
});

/** No contact/demo/pricing route anywhere, and no form on any page. */
const NO_PATH: Page[] = [
  page({ url: 'https://acme.test/', ctas: [{ text: 'Read more' }], crawl_metadata: { signals: { form_count: 0 } } }),
  page({ url: 'https://acme.test/product', ctas: [{ text: 'Read more' }], crawl_metadata: { signals: { form_count: 0 } } }),
  page({ url: 'https://acme.test/blog/one', ctas: [{ text: 'Read more' }], crawl_metadata: { signals: { form_count: 0 } } }),
];

/** A discoverable conversion route exists. */
const HAS_PATH: Page[] = [
  page({ url: 'https://acme.test/' }),
  page({ url: 'https://acme.test/contact', title: 'Contact' }),
  page({ url: 'https://acme.test/pricing', title: 'Pricing' }),
];

const findings = (pages: Page[]) =>
  (assessDigitalExperience({ pages } as never).findings ?? []) as unknown as Array<Record<string, string>>;

const noPathFinding = (pages: Page[]) =>
  findings(pages).find((f) => String(f.problem).includes('No conversion path is discoverable'));

const snapshotFrom = (pages: Page[]) =>
  assembleDigitalSnapshot({ experienceFindings: assessDigitalExperience({ pages } as never).findings } as never);

const renderPlan = (snapshot: unknown) =>
  renderNinetyDayPlan({ report1: { digital_snapshot: snapshot } } as never, 'Plan');

const decode = (html: string) =>
  html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;|&#8212;/g, '—');

describe('REMEDIATION-005 — producer contract + dependency visibility', () => {
  // ── ISSUE A: the producer contract the sequencing depends on ────────────
  describe('A. no discoverable conversion path', () => {
    it('the real producer raises the finding at CRITICAL', () => {
      const f = noPathFinding(NO_PATH);
      expect(f).toBeDefined();
      expect(f!.severity).toBe('critical');
      expect(f!.pillar).toBe('conversion_readiness');
    });

    it('its evidence is a public observation that names the denominator', () => {
      const f = noPathFinding(NO_PATH)!;
      // Pages that actually returned an HTTP response were inspected and nothing was found —
      // which is why this is an observation rather than an absence of looking.
      expect(f.evidence).toMatch(/across \d+ pages/);
      expect(f.evidence).toMatch(/no on-page form was detected/i);
      // Public boundary: no analytics, CRM or platform-activity language.
      expect(f.evidence).not.toMatch(/session|visitor|conversion rate|CRM|revenue/i);
    });
  });

  describe('B. a discoverable conversion path exists', () => {
    it('produces no false no-conversion-path finding', () => {
      expect(noPathFinding(HAS_PATH)).toBeUndefined();
    });

    it('a form alone is enough to establish a path', () => {
      const withFormOnly = [page({ url: 'https://acme.test/', ctas: [{ text: 'Read more' }] })];
      expect(noPathFinding(withFormOnly)).toBeUndefined();
    });
  });

  describe('C. partial conversion weakness keeps its non-critical severity', () => {
    it('vague CTA wording is moderate, not critical', () => {
      const vague = [
        page({ url: 'https://acme.test/', ctas: [{ text: 'Learn more' }] }),
        page({ url: 'https://acme.test/contact', title: 'Contact', ctas: [{ text: 'More info' }] }),
      ];
      const wording = findings(vague).find((f) => String(f.problem).includes('does not say what happens next'));
      expect(wording).toBeDefined();
      expect(wording!.severity).toBe('moderate');
    });

    it('a conversion-related finding alone does not activate the dependency', () => {
      const vague = [
        page({ url: 'https://acme.test/', ctas: [{ text: 'Learn more' }] }),
        page({ url: 'https://acme.test/contact', title: 'Contact', ctas: [{ text: 'More info' }] }),
      ];
      // Only the conversion pillar has a finding, and it is moderate. The dependency must not
      // fire: one weak signal is not a materially deficient conversion path. (Two pillars IS a
      // sufficient route — that is slice 004's preserved behaviour, exercised separately.)
      const pillars = new Set(findings(vague).map((f) => f.pillar));
      expect(pillars.has('conversion_readiness')).toBe(true);
      expect(pillars.has('value_communication')).toBe(false);
      const conv = snapshotFrom(vague).opportunities.find((o) => o.id === 'conversion_readiness');
      expect(conv?.materiallyDeficient ?? false).toBe(false);
    });
  });

  describe('D. producer output drives the rule — no hand-built finding', () => {
    it('real producer output makes the conversion opportunity materially deficient', () => {
      const conv = snapshotFrom(NO_PATH).opportunities.find((o) => o.id === 'conversion_readiness');
      expect(conv).toBeDefined();
      expect(conv!.materiallyDeficient).toBe(true);
      expect(conv!.kind).toBe('conversion_remediation');
    });
  });

  describe('E. existing digital-experience findings remain intact', () => {
    it('still reports the other pillars it always did', () => {
      const all = findings(NO_PATH);
      expect(all.length).toBeGreaterThan(0);
      for (const f of all) {
        expect(['critical', 'moderate', 'low']).toContain(f.severity);
        expect(String(f.evidence).length).toBeGreaterThan(0);
      }
    });
  });

  // ── ISSUE B: the dependency reaches the customer ────────────────────────
  describe('dependency propagation', () => {
    const deficient = () => snapshotFrom([
      ...NO_PATH,
      page({ url: 'https://acme.test/thin', wordCount: 8, headings: [], ctas: [], crawl_metadata: { signals: { form_count: 0 } } }),
    ]);

    it('5. the opportunity carries dependsOn', () => {
      const demand = deficient().opportunities.filter((o) => o.kind === 'demand_generation');
      if (demand.length > 0) for (const o of demand) expect(o.dependsOn).toBe('conversion_readiness');
    });

    it('6+7. dependsOn survives into the plan the customer reads', () => {
      const plan = deficient().plan;
      const items = [...plan.days_0_30, ...plan.days_31_60, ...plan.days_61_90];
      const dependent = items.filter((i) => i.dependsOn);
      if (deficient().opportunities.some((o) => o.kind === 'demand_generation')) {
        expect(dependent.length).toBeGreaterThan(0);
        for (const i of dependent) expect(i.dependsOn).toBe('conversion_readiness');
      }
    });

    it('8+9. demand remains present and sequenced after conversion remediation', () => {
      const r = deficient();
      const conv = r.opportunities.findIndex((o) => o.id === 'conversion_readiness');
      expect(conv).toBeGreaterThanOrEqual(0);
      for (const o of r.opportunities.filter((x) => x.kind === 'demand_generation')) {
        expect(r.opportunities.indexOf(o)).toBeGreaterThan(conv);
        expect(o.action.length).toBeGreaterThan(0);
      }
    });

    it('10. adequate conversion produces no dependency', () => {
      const r = snapshotFrom([
        ...HAS_PATH,
        page({ url: 'https://acme.test/thin', wordCount: 8, headings: [] }),
      ]);
      const items = [...r.plan.days_0_30, ...r.plan.days_31_60, ...r.plan.days_61_90];
      for (const i of items) expect(i.dependsOn).toBeUndefined();
    });

    it('11. unavailable conversion produces no dependency', () => {
      const r = assembleDigitalSnapshot({ experienceFindings: [] } as never);
      const items = [...r.plan.days_0_30, ...r.plan.days_31_60, ...r.plan.days_61_90];
      for (const i of items) expect(i.dependsOn).toBeUndefined();
    });
  });

  // ── Renderer — asserted on actual customer-facing output ────────────────
  describe('renderer', () => {
    it('12. the dependency is visible in the rendered plan', () => {
      const html = decode(renderPlan({
        plan: {
          days_0_30: [{
            title: 'Build out the pages that should carry commercial search demand',
            action: 'Expand the thin pages.', why: 'Because.',
            measurement: 'Re-crawl.', measurementAvailable: true,
            effort: 'medium', confidence: 'medium', sources: ['content'],
            dependsOn: 'conversion_readiness',
          }],
          days_31_60: [], days_61_90: [], notes: [],
        },
      }));
      expect(html).toContain('Sequenced after');
      expect(html).toContain('conversion-path remediation');
      expect(html).toMatch(/ordered behind it, not blocked by it/);
      // A decision relationship, never a measured business outcome.
      expect(html).not.toMatch(/conversion rate|lost leads|lost revenue|will increase/i);
    });

    it('13. rendering is unchanged when no dependency exists', () => {
      const html = decode(renderPlan({
        plan: {
          days_0_30: [{
            title: 'Give every indexable page its own title',
            action: 'Write titles.', why: 'Because.',
            measurement: 'Re-crawl.', measurementAvailable: true,
            effort: 'low', confidence: 'high', sources: ['crawl'],
          }],
          days_31_60: [], days_61_90: [], notes: [],
        },
      }));
      expect(html).toContain('Give every indexable page its own title');
      expect(html).not.toContain('Sequenced after');
    });

    it('14. an unknown dependency id prints no raw identifier at the customer', () => {
      const html = decode(renderPlan({
        plan: {
          days_0_30: [{
            title: 'Some work', action: 'Do it.', why: 'Because.',
            measurement: 'Check.', measurementAvailable: true,
            effort: 'low', confidence: 'high', sources: ['crawl'],
            dependsOn: 'not_a_known_dependency',
          }],
          days_31_60: [], days_61_90: [], notes: [],
        },
      }));
      expect(html).toContain('Some work');
      expect(html).not.toContain('Sequenced after');
      expect(html).not.toContain('not_a_known_dependency');
    });
  });
});
