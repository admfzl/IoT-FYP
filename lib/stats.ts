import type { FeedLog, FeedSource } from "./supabase";

export interface SourceLatencyStats {
  source: FeedSource;
  totalFeeds: number;
  n: number; // number of rows with measured client_rtt_ms
  min: number | null;
  avg: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
  avgTuyaApiMs: number | null;
  avgServerTotalMs: number | null;
  avgNetworkMs: number | null;
  tuyaSuccessRate: number | null; // percentage 0..100
  tokenRefreshedCount: number;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function computePercentile(sorted: number[], percentile: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round1(sorted[lower]);
  const weight = index - lower;
  return round1(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function computeAverage(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return round1(sum / nums.length);
}

export function computeSummaryBySource(logs: FeedLog[]): SourceLatencyStats[] {
  const sources: FeedSource[] = ["MANUAL_APP", "PHONE_SENSOR", "ESP32_SENSOR"];

  return sources.map((source) => {
    const sourceLogs = logs.filter((l) => l.source === source);
    const totalFeeds = sourceLogs.length;

    // Rule §7.6: Rows with client_rtt_ms IS NULL are excluded from latency stats
    const rttLogs = sourceLogs.filter(
      (l): l is FeedLog & { client_rtt_ms: number } =>
        typeof l.client_rtt_ms === "number" && Number.isFinite(l.client_rtt_ms)
    );

    const sortedRtts = rttLogs
      .map((l) => l.client_rtt_ms)
      .sort((a, b) => a - b);

    const n = sortedRtts.length;
    const min = n > 0 ? sortedRtts[0] : null;
    const max = n > 0 ? sortedRtts[n - 1] : null;
    const avg = computeAverage(sortedRtts);
    const median = computePercentile(sortedRtts, 50);
    const p95 = computePercentile(sortedRtts, 95);

    const tuyaApiVals = rttLogs
      .map((l) => l.tuya_api_ms)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const serverTotalVals = rttLogs
      .map((l) => l.server_total_ms)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const networkVals = rttLogs
      .map((l) => l.network_ms)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const successCount = sourceLogs.filter((l) => l.tuya_success).length;
    const tuyaSuccessRate =
      totalFeeds > 0 ? round1((successCount / totalFeeds) * 100) : null;

    const tokenRefreshedCount = sourceLogs.filter(
      (l) => l.token_refreshed
    ).length;

    return {
      source,
      totalFeeds,
      n,
      min,
      avg,
      median,
      p95,
      max,
      avgTuyaApiMs: computeAverage(tuyaApiVals),
      avgServerTotalMs: computeAverage(serverTotalVals),
      avgNetworkMs: computeAverage(networkVals),
      tuyaSuccessRate,
      tokenRefreshedCount
    };
  });
}

