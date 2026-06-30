/**
 * Platform Intelligence plugin auto-registration (Phase 21D, Phase L).
 *
 * Importing this module registers every domain plugin with the registry. Adding a future
 * engine is registration-only: create a `<domain>Plugin` (impact config + provide) and add
 * one import line here — no report, renderer, dashboard, or repository change.
 */
import '../../websiteIntelligence/websitePlugin'; // registers websitePlugin (Plugin #1)
import '../../leadIntelligence/leadIntelligenceSnapshotAdapter'; // registers leadPlugin
import './growthPlugin'; // registers growthPlugin
import './readinessPlugin'; // registers readinessPlugin
import '../../marketingGrowth/marketingGrowthPlugin'; // registers marketingGrowthPlugin
import '../../commercialIntelligence/commercialIntelligencePlugin'; // registers commercialIntelligencePlugin
import '../../customerIntelligence/customerIntelligencePlugin'; // registers customerIntelligencePlugin
import '../../revenueOperations/revenueOperationsPlugin'; // registers revenueOperationsPlugin
import '../../productUsage/productUsagePlugin'; // registers productUsagePlugin (#11)
import '../../partnerChannel/partnerChannelPlugin'; // registers partnerChannelPlugin (#12)
import '../../predictiveIntelligence/predictiveIntelligencePlugin'; // registers predictiveIntelligencePlugin (#13)
import '../../crossDomain/unifiedBusinessIntelligencePlugin'; // registers unifiedBusinessIntelligencePlugin (orchestrator)
import '../../decisionIntelligence/decisionIntelligencePlugin'; // registers decisionIntelligencePlugin (consumes the registry, incl. unified)

export { getPlugins, getPlugin, getPluginsForReport, getPluginsForDashboard, composePluginSnapshot, toPresentationModel, renderPluginHtml, registerPlugin, unregisterPlugin } from '../registry';
