// Real benchmark dataset adapter.
//
// Reads a vertical-segmented JSON benchmark dataset from disk. Activates when
// BENCHMARK_DATASET_PATH points to a valid file. The dataset format is the
// canonical contract — operators populate it from real peer measurements
// (curated peer set, scraped corpus, or imported from an external dataset).
//
// Phase 4 contract: we never fabricate peer data. When the file is missing,
// malformed, or has insufficient peer coverage for the requested vertical,
// the adapter returns `state: 'unavailable'` with the actual reason.
//
// File format:
// {
//   "generated_at": "2026-04-01T00:00:00.000Z",
//   "bands": [
//     {
//       "vertical": "B2B SaaS",
//       "size_band": "mid",
//       "peer_count": 47,
//       "median": { "index_integrity": 62, ... },
//       "top_quartile": { "index_integrity": 81, ... },
//       "score_distribution": [40, 45, ..., 89]   // optional, used for percentile
//     },
//     ...
//   ]
// }

import fs from 'fs';
import path from 'path';
import type {
  BenchmarkBand,
  BenchmarkProvider,
  BenchmarkResult,
} from '../providerInterfaces';
import { unavailableEvidence } from '../providerInterfaces';
import { freshnessFromTimestamp, logProviderCall } from '../productionPrimitives';
import type { EvidenceTrace } from '../../canonicalReport/canonicalReportTypes';

const MIN_PEER_COUNT = 12;

type BenchmarkDatasetFile = {
  generated_at: string;
  bands: Array<{
    vertical: string;
    size_band: 'small' | 'mid' | 'enterprise' | 'unspecified';
    peer_count: number;
    median: Record<string, number>;
    top_quartile: Record<string, number>;
    score_distribution?: number[];
  }>;
};

function percentileFromDistribution(distribution: number[], userScore: number): number {
  if (distribution.length === 0) return 0;
  const below = distribution.filter((v) => v <= userScore).length;
  return Math.round((below / distribution.length) * 100);
}

export class BenchmarkDatasetAdapter implements BenchmarkProvider {
  public readonly id = 'curated_vertical';
  private dataset: BenchmarkDatasetFile | null = null;
  private datasetError: string | null = null;
  private loadedAt: string | null = null;

  constructor(private readonly datasetPath: string) {}

  async isAvailable(): Promise<boolean> {
    if (!this.datasetPath) return false;
    if (this.dataset) return true;
    if (this.datasetError) return false;
    return this.loadDataset();
  }

  private loadDataset(): boolean {
    try {
      const resolvedPath = path.isAbsolute(this.datasetPath)
        ? this.datasetPath
        : path.resolve(process.cwd(), this.datasetPath);
      if (!fs.existsSync(resolvedPath)) {
        this.datasetError = `Benchmark dataset file not found at ${resolvedPath}`;
        return false;
      }
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(raw) as BenchmarkDatasetFile;
      if (!Array.isArray(parsed.bands) || parsed.bands.length === 0) {
        this.datasetError = `Benchmark dataset has no bands.`;
        return false;
      }
      this.dataset = parsed;
      this.loadedAt = parsed.generated_at ?? new Date().toISOString();
      return true;
    } catch (error) {
      this.datasetError = `Failed to load benchmark dataset: ${error instanceof Error ? error.message : 'unknown error'}`;
      return false;
    }
  }

  async lookup(params: {
    vertical: string | null;
    sizeHint: 'small' | 'mid' | 'enterprise' | 'unspecified';
    userScore: number | null;
  }): Promise<BenchmarkResult> {
    const available = await this.isAvailable();
    if (!available || !this.dataset) {
      const reason = this.datasetError ?? 'Benchmark dataset not loaded.';
      logProviderCall({ providerId: this.id, operation: 'lookup', status: 'unavailable', reason });
      return {
        state: 'unavailable',
        band: null,
        percentile: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }

    if (!params.vertical) {
      const reason = 'Vertical not specified — cannot pick a benchmark band.';
      return {
        state: 'unavailable',
        band: null,
        percentile: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }

    const verticalLower = params.vertical.toLowerCase();
    let band = this.dataset.bands.find(
      (b) => b.vertical.toLowerCase() === verticalLower && b.size_band === params.sizeHint,
    );
    if (!band) {
      band = this.dataset.bands.find((b) => b.vertical.toLowerCase() === verticalLower);
    }
    if (!band) {
      const reason = `No benchmark band matches vertical "${params.vertical}".`;
      return {
        state: 'unavailable',
        band: null,
        percentile: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }
    if (band.peer_count < MIN_PEER_COUNT) {
      const reason = `Insufficient benchmark coverage for "${band.vertical}" (peer_count=${band.peer_count}, minimum=${MIN_PEER_COUNT}).`;
      return {
        state: 'unavailable',
        band: null,
        percentile: null,
        evidence: unavailableEvidence(reason),
        reason_unavailable: reason,
      };
    }

    const observedAt = this.loadedAt ?? new Date().toISOString();
    const benchmarkBand: BenchmarkBand = {
      vertical: band.vertical,
      size_band: band.size_band,
      median: band.median,
      top_quartile: band.top_quartile,
      peer_count: band.peer_count,
      observed_at: observedAt,
    };

    const percentile =
      params.userScore != null && Array.isArray(band.score_distribution) && band.score_distribution.length > 0
        ? percentileFromDistribution(band.score_distribution, params.userScore)
        : null;

    const evidence: EvidenceTrace = {
      count: 2,
      sources: ['benchmark_dataset'],
      freshness: freshnessFromTimestamp(observedAt),
      observations: [
        {
          signal: `benchmark:${band.vertical}:${band.size_band}:peers=${band.peer_count}`,
          source: 'benchmark_dataset',
          observed_at: observedAt,
        },
        {
          signal: `benchmark:percentile=${percentile ?? 'n/a'}`,
          source: 'benchmark_dataset',
          observed_at: observedAt,
        },
      ],
    };

    logProviderCall({ providerId: this.id, operation: 'lookup', status: 'ok' });
    return {
      state: 'measured',
      band: benchmarkBand,
      percentile,
      evidence,
      reason_unavailable: null,
    };
  }
}
