import React from 'react';
import type {
  LeadProfile,
  VisitorJourneyProjection,
  CampaignAttributionProjection,
  ContentReferenceProjection,
  WebsiteBehaviourProjection,
  SourceDetailProjection,
  BuyingIntentProfile,
  LeadActionPlan,
  CompanyIntelligenceSummary,
} from '@/lib/leadIntelligence';

type Enrichment = Partial<{
  visitorJourney: VisitorJourneyProjection;
  campaignAttribution: CampaignAttributionProjection;
  contentReferences: ContentReferenceProjection;
  websiteBehaviour: WebsiteBehaviourProjection;
  sourceDetail: SourceDetailProjection;
  buyingIntent: BuyingIntentProfile;
  actionPlan: LeadActionPlan;
  company: CompanyIntelligenceSummary | null;
}>;

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-amber-100 text-amber-700',
  medium: 'bg-sky-100 text-sky-700',
  low: 'bg-gray-100 text-gray-600',
};
const READINESS_STYLE: Record<string, string> = {
  ready: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  not_ready: 'bg-gray-100 text-gray-500',
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-3 text-sm text-gray-700">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-1.5 last:border-0">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-gray-900">{value || '—'}</span>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-gray-400">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x) => <span key={x} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{x}</span>)}
    </div>
  );
}

function pct(v: number | null | undefined): string {
  return typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
}

export default function LeadProfileView({ profile, onExport }: { profile: LeadProfile & Enrichment; onExport: () => void }) {
  const { view, identity, campaign, journey, content, opportunity, marketPulse, crm, engagement, analytics, timeline } = profile;
  const { visitorJourney, campaignAttribution, contentReferences, websiteBehaviour, sourceDetail, buyingIntent, actionPlan, company } = profile;
  const meta = view.attribution.sourceMetadata ?? {};
  const metaCompany = String(meta.company_name ?? '') || null;
  const name = String(meta.name ?? '') || null;

  return (
    <div className="space-y-6">
      {/* Header: AI summary + recommended action + export */}
      <section className="rounded-2xl border border-purple-200 bg-purple-50/60 p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-600">AI Summary</p>
            <p className="mt-1 text-base font-medium text-gray-900">{profile.summary}</p>
            <p className="mt-3 text-sm text-gray-700"><span className="font-semibold text-purple-700">Recommended next action:</span> {profile.recommendedNextAction}</p>
          </div>
          <button onClick={onExport} className="shrink-0 rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50">Export profile</button>
        </div>
      </section>

      {company && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Company Intelligence</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{company.companyName ?? company.companyKey}</p>
              <p className="text-sm text-gray-600">
                {company.contactCount} known contact{company.contactCount === 1 ? '' : 's'} · Account intent {company.accountIntentScore}/100 · Stage <span className="capitalize">{company.accountStage}</span>
                {company.multiThreaded ? ' · Multi-threaded' : ' · Single-threaded'}
              </p>
            </div>
            <div className="flex max-w-md flex-wrap gap-1.5">
              {company.identifiedRoles.map((r) => (
                <span key={r} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">{r.replace('_', ' ')}</span>
              ))}
              {company.topInterests.slice(0, 3).map((i) => (
                <span key={i} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{i}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      {buyingIntent && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Buying Intent</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{buyingIntent.score}<span className="text-base font-medium text-gray-400">/100</span></p>
              <p className="mt-1 text-sm text-gray-600">Stage: <strong className="capitalize">{buyingIntent.decisionStage}</strong> · Confidence {buyingIntent.confidence}% · {buyingIntent.decisionStageRationale}</p>
            </div>
            <div className="flex max-w-md flex-wrap gap-1.5">
              {buyingIntent.interestProfile.slice(0, 5).map((i) => (
                <span key={i.interest} className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-medium text-emerald-700">{i.interest}</span>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Score breakdown</h4>
              <ul className="mt-2 space-y-1">
                {buyingIntent.scoreBreakdown.length === 0 && <li className="text-sm text-gray-400">No scoring evidence yet.</li>}
                {buyingIntent.scoreBreakdown.map((b, i) => (
                  <li key={`${b.label}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-gray-700">{b.label}</span>
                    <span className="shrink-0 font-semibold text-emerald-700">+{b.points}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Conversation guidance</h4>
              <p className="mt-2 text-sm text-gray-700"><span className="font-semibold">Opening:</span> {buyingIntent.recommendations.recommendedOpening}</p>
              <p className="mt-1 text-sm text-gray-700"><span className="font-semibold">Next action:</span> {buyingIntent.recommendations.recommendedNextAction}</p>
              <p className="mt-1 text-sm text-gray-700"><span className="font-semibold">Likely concerns:</span> {buyingIntent.concerns.join('; ')}</p>
              {buyingIntent.recommendations.contentToMention.length > 0 && (
                <p className="mt-1 text-sm text-gray-700"><span className="font-semibold">Mention:</span> {buyingIntent.recommendations.contentToMention.join(', ')}</p>
              )}
              {buyingIntent.recommendations.campaignToMention && (
                <p className="mt-1 text-sm text-gray-700"><span className="font-semibold">Campaign:</span> {buyingIntent.recommendations.campaignToMention}</p>
              )}
            </div>
          </div>

          {buyingIntent.decisionJourney.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-gray-900">Decision journey</h4>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {buyingIntent.decisionJourney.map((stepItem, i) => (
                  <React.Fragment key={`${stepItem.label}-${i}`}>
                    {i > 0 && <span className="text-gray-300">→</span>}
                    <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm text-gray-700" title={stepItem.detail ?? undefined}>{stepItem.label}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {actionPlan && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Recommended Actions</h3>
          <div className="mt-3 space-y-2">
            {actionPlan.actions.map((a) => (
              <div key={a.id} className="rounded-xl border border-indigo-100 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900">{a.label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.low}`}>{a.priority}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{a.category.replace('_', ' ')}</span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-600">{a.reason}</p>
                <p className="mt-1 text-xs text-gray-500">Outcome: {a.expectedOutcome} · Confidence {a.confidence}%{a.dependencies.length ? ` · Needs: ${a.dependencies.join(', ')}` : ''}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Channel readiness</h4>
              <div className="mt-2 space-y-1">
                {actionPlan.readiness.map((r) => (
                  <div key={r.channel} className="flex items-center justify-between gap-3 text-sm">
                    <span className="capitalize text-gray-700">{r.channel}{r.missingInformation.length ? <span className="text-xs text-gray-400"> · needs {r.missingInformation.join(', ')}</span> : null}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${READINESS_STYLE[r.status] ?? READINESS_STYLE.not_ready}`}>{r.status.replace('_', ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Qualification (BANT)</h4>
              <Row label="Budget" value={actionPlan.qualification.bant.budget.value} />
              <Row label="Authority" value={actionPlan.qualification.bant.authority.value} />
              <Row label="Need" value={actionPlan.qualification.bant.need.value} />
              <Row label="Timeline" value={actionPlan.qualification.bant.timeline.value} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Follow-up</h4>
              <Row label="Cadence" value={actionPlan.followUp.cadence} />
              <Row label="Next touch" value={`${actionPlan.followUp.nextTouch.date} (${actionPlan.followUp.nextTouch.channel})`} />
              <Row label="Expires" value={actionPlan.followUp.expiry.date} />
              <Row label="CRM owner" value={actionPlan.crmPackage.recommendedOwner} />
            </div>
          </div>
        </section>
      )}

      {sourceDetail && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Source Details</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sourceDetail.path.map((seg, i) => (
              <React.Fragment key={`${seg}-${i}`}>
                {i > 0 && <span className="text-gray-300">→</span>}
                <span className="rounded-full bg-purple-50 px-3 py-1 text-sm font-medium text-purple-700">{seg}</span>
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Identity">
          <Row label="Unified person" value={identity.unifiedPersonId} />
          <Row label="Email" value={identity.email} />
          <Row label="Phone" value={identity.phone} />
          <Row label="Platforms" value={<Chips items={identity.platforms} />} />
        </Card>

        <Card title="Company">
          <Row label="Company" value={metaCompany} />
          <Row label="Contact name" value={name} />
        </Card>

        <Card title="Contact Details">
          <Row label="Email" value={view.identity.email} />
          <Row label="Phone" value={view.identity.phone} />
          <Row label="Platform" value={view.identity.platform} />
          <Row label="Platform user" value={view.identity.platformUserId} />
        </Card>

        <Card title="Lead Source">
          <Row label="Source" value={view.sourceLabel} />
          <Row label="Original source" value={view.attribution.originalSource} />
          <Row label="Origin table" value={view.sourceRef?.table} />
        </Card>

        <Card title="Buying Intent">
          <Row label="Intent" value={pct(analytics.intent)} />
          <Row label="ICP fit" value={pct(analytics.icp)} />
          <Row label="Confidence" value={pct(analytics.confidence)} />
          <Row label="Total score" value={pct(analytics.total)} />
        </Card>

        <Card title="Interest Profile">
          <Row label="Interest" value={view.content} />
          <Row label="Pages viewed" value={String(content.pagesViewed.length)} />
          <Row label="Assets" value={String(content.assets.length)} />
          <Row label="Downloads" value={String(content.downloads.length)} />
        </Card>

        <Card title="Campaign Intelligence">
          <Row label="Campaign" value={campaign.campaign} />
          <Row label="Campaign id" value={campaign.campaignId} />
          <Row label="Channel" value={campaign.channel} />
          <Row label="Touchpoints" value={String(campaign.touchpointCount)} />
        </Card>

        <Card title="Attribution">
          <Row label="UTM source" value={view.utm.source} />
          <Row label="UTM medium" value={view.utm.medium} />
          <Row label="UTM campaign" value={view.utm.campaign} />
          <Row label="Referrer" value={view.referrer} />
        </Card>

        <Card title="Content Intelligence">
          <Row label="Blogs" value={String(content.blogs.length)} />
          <Row label="Forms" value={String(content.forms.length)} />
          <Row label="Conversions" value={String(content.conversions)} />
          <Row label="Engagement events" value={String(content.engagementEvents)} />
          <Row label="Time spent (s)" value={String(content.timeSpentSeconds)} />
        </Card>

        <Card title="Opportunity Signals">
          <Row label="Types" value={<Chips items={opportunity.opportunityTypes} />} />
          <Row label="Top score" value={pct(opportunity.topScore)} />
        </Card>

        <Card title="MarketPulse Signals">
          <Row label="Categories" value={<Chips items={marketPulse.signalCategories} />} />
          <Row label="Risk class" value={marketPulse.riskClass} />
        </Card>

        <Card title="Engagement Signals">
          <Row label="Threads" value={String(engagement.threads)} />
          <Row label="Last message" value={engagement.lastMessageAt ? new Date(engagement.lastMessageAt).toLocaleString() : null} />
          <Row label="CRM status" value={crm.status} />
          <Row label="Revenue" value={crm.revenue != null ? `$${crm.revenue.toLocaleString()}` : null} />
        </Card>
      </div>

      {/* Phase 9 enrichment — projection-backed (no UI metadata parsing) */}
      {(visitorJourney || campaignAttribution || contentReferences || websiteBehaviour) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {visitorJourney && (
            <Card title="Visitor Journey">
              <Row label="First landing page" value={visitorJourney.firstLandingPage} />
              <Row label="Current landing page" value={visitorJourney.currentLandingPage} />
              <Row label="Entry URL" value={visitorJourney.entryUrl} />
              <Row label="Exit URL" value={visitorJourney.exitUrl} />
              <Row label="Referrer" value={visitorJourney.referrer} />
              <Row label="First referrer" value={visitorJourney.firstReferrer} />
              <Row label="Session ID" value={visitorJourney.sessionId} />
              <Row label="Visitor ID" value={visitorJourney.visitorId} />
              <Row label="Journey ID" value={visitorJourney.journeyId} />
              <Row label="Return visitor" value={visitorJourney.returnVisitor == null ? null : visitorJourney.returnVisitor ? 'Yes' : 'No'} />
              <Row label="Visit count" value={visitorJourney.visitCount != null ? String(visitorJourney.visitCount) : null} />
            </Card>
          )}
          {campaignAttribution && (
            <Card title="Campaign Attribution">
              <Row label="Campaign ID" value={campaignAttribution.campaignId} />
              <Row label="Campaign name" value={campaignAttribution.campaignName} />
              <Row label="Campaign type" value={campaignAttribution.campaignType} />
              <Row label="Source" value={campaignAttribution.campaignSource} />
              <Row label="Medium" value={campaignAttribution.campaignMedium} />
              <Row label="Content" value={campaignAttribution.campaignContent} />
              <Row label="Term" value={campaignAttribution.campaignTerm} />
            </Card>
          )}
          {contentReferences && (
            <Card title="Content Intelligence">
              <Row label="Content ID" value={contentReferences.contentId} />
              <Row label="Content type" value={contentReferences.contentType} />
              <Row label="Content title" value={contentReferences.contentTitle} />
              <Row label="Asset ID" value={contentReferences.assetId} />
              <Row label="CTA ID" value={contentReferences.ctaId} />
              <Row label="Form ID" value={contentReferences.formId} />
              <Row label="Website ID" value={contentReferences.websiteId} />
            </Card>
          )}
          {websiteBehaviour && (
            <Card title="Website Behaviour">
              <Row label="Time on site (s)" value={String(websiteBehaviour.timeOnSiteSeconds)} />
              <Row label="Time on page (s)" value={String(websiteBehaviour.timeOnPageSeconds)} />
              <Row label="Scroll depth" value={`${websiteBehaviour.scrollDepth}%`} />
              <Row label="Pages viewed" value={String(websiteBehaviour.pagesViewed)} />
              <Row label="Blog pages viewed" value={String(websiteBehaviour.blogPagesViewed)} />
              <Row label="Assets viewed" value={String(websiteBehaviour.assetsViewed)} />
              <Row label="Downloads" value={String(websiteBehaviour.downloads)} />
              <Row label="CTA clicks" value={String(websiteBehaviour.ctaClicks)} />
              <Row label="Return visits" value={String(websiteBehaviour.returnVisits)} />
            </Card>
          )}
        </div>
      )}

      {/* Timelines */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Lead Timeline">
          {timeline.length === 0 ? <p className="text-gray-400">No events.</p> : (
            <ol className="relative space-y-4 border-l border-gray-200 pl-4">
              {timeline.map((e, i) => (
                <li key={`${e.origin}-${e.entityId ?? i}-${i}`} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-purple-500" />
                  <p className="text-sm font-medium text-gray-900">{e.eventType.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-gray-500">{e.origin} · {e.source}{e.occurredAt ? ` · ${new Date(e.occurredAt).toLocaleString()}` : ''}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Journey Timeline">
          {journey.length === 0 ? <p className="text-gray-400">No journey touchpoints recorded.</p> : (
            <ol className="relative space-y-4 border-l border-gray-200 pl-4">
              {journey.map((s, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-sky-500" />
                  <p className="text-sm font-medium text-gray-900">{s.campaign ?? s.source}</p>
                  <p className="text-xs text-gray-500">{s.page ?? s.source}{s.occurredAt ? ` · ${new Date(s.occurredAt).toLocaleString()}` : ''}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
