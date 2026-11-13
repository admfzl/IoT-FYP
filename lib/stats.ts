import type { FeedEventRow, TriggerSourceKey } from "./supabase-server";

export interface SourceLatencyStats {
  source: TriggerSourceKey;
  totalAttempts: number;
  fedCount: number;
  failedCount: number;
  skippedCount: number;
  n: number; // number of FED rows with measured client_rtt_ms
  min: number | null;
  mean: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
  meanTuyaApiMs: number | null;
  meanServerTotalMs: number | null;
  meanServerOverheadMs: number | null;
  meanNetworkMs: number | null;
  successRate: number | null; // percentage 0..100 among non-skipped attempts
  tokenRefreshedCount: number;
  fallbackCount: number;
}

export interface ScheduleServerLatencyStats {
  totalRuns: number;
  fedCount: number;
  skippedCount: number;
  failedCount: number;
  n: number; // number of FED runs with server_total_ms
  minServerMs: number | null;
  meanServerMs: number | null;
  medianServerMs: number | null;
  p95ServerMs: number | null;
  maxServerMs: number | null;
  meanTuyaApiMs: number | null;
  successRate: number | null;
  tokenRefreshedCount: number;
  fallbackCount: number;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function computePercentile(
  sorted: number[],
  percentile: number
): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return round1(sorted[0]);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round1(sorted[lower]);
  const weight = index - lower;
  return round1(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

export function computeAverage(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sum = nums.reduce((acc, v) => acc + v, 0);
  return round1(sum / nums.length);
}

export function computeClientLatencyBySource(
  events: FeedEventRow[]
): SourceLatencyStats[] {
  const clientSources: TriggerSourceKey[] = [
    "MANUAL",
    "ESP32_SENSOR",
    "PHONE_SENSOR"
  ];

  return clientSources.map((source) => {
    const rows = events.filter((e) => e.source === source && e.result !== "PENDING");
    const totalAttempts = rows.length;
    const fedRows = rows.filter((e) => e.result === "FED");
    const failedRows = rows.filter((e) => e.result === "FAILED");
    const skippedRows = rows.filter((e) => e.result.startsWith("SKIPPED_"));

    const rttRows = fedRows.filter(
      (e): e is FeedEventRow & { client_rtt_ms: number } =>
        typeof e.client_rtt_ms === "number" && Number.isFinite(e.client_rtt_ms)
    );

    const sortedRtts = rttRows
      .map((e) => e.client_rtt_ms)
      .sort((a, b) => a - b);

    const n = sortedRtts.length;
    const min = n > 0 ? round1(sortedRtts[0]) : null;
    const max = n > 0 ? round1(sortedRtts[n - 1]) : null;
    const mean = computeAverage(sortedRtts);
    const median = computePercentile(sortedRtts, 50);
    const p95 = computePercentile(sortedRtts, 95);

    const tuyaVals = fedRows
      .map((e) => e.tuya_api_ms)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const serverVals = fedRows
      .map((e) => e.server_total_ms)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const netVals = rttRows
      .map((e) => e.network_ms)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const overheadVals = fedRows
      .filter(
        (e) =>
          typeof e.server_total_ms === "number" &&
          typeof e.tuya_api_ms === "number"
      )
      .map((e) => Math.max(0, (e.server_total_ms ?? 0) - (e.tuya_api_ms ?? 0)));

    const actuatedAttempts = fedRows.length + failedRows.length;
    const successRate =
      actuatedAttempts > 0
        ? round1((fedRows.length / actuatedAttempts) * 100)
        : null;

    const tokenRefreshedCount = rows.filter((e) => e.token_refreshed).length;
    const fallbackCount = rows.filter(
      (e) => e.tuya_endpoint === "v1_commands"
    ).length;

    return {
      source,
      totalAttempts,
      fedCount: fedRows.length,
      failedCount: failedRows.length,
      skippedCount: skippedRows.length,
      n,
      min,
      mean,
      median,
      p95,
      max,
      meanTuyaApiMs: computeAverage(tuyaVals),
      meanServerTotalMs: computeAverage(serverVals),
      meanServerOverheadMs: computeAverage(overheadVals),
      meanNetworkMs: computeAverage(netVals),
      successRate,
      tokenRefreshedCount,
      fallbackCount
    };
  });
}

export function computeScheduleServerStats(
  events: FeedEventRow[]
): ScheduleServerLatencyStats {
  const rows = events.filter(
    (e) => e.source === "SCHEDULE" && e.result !== "PENDING"
  );
  const fedRows = rows.filter((e) => e.result === "FED");
  const failedRows = rows.filter((e) => e.result === "FAILED");
  const skippedRows = rows.filter((e) => e.result.startsWith("SKIPPED_"));

  const srvVals = fedRows
    .map((e) => e.server_total_ms)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);

  const tuyaVals = fedRows
    .map((e) => e.tuya_api_ms)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const n = srvVals.length;
  const actuated = fedRows.length + failedRows.length;

  return {
    totalRuns: rows.length,
    fedCount: fedRows.length,
    skippedCount: skippedRows.length,
    failedCount: failedRows.length,
    n,
    minServerMs: n > 0 ? round1(srvVals[0]) : null,
    meanServerMs: computeAverage(srvVals),
    medianServerMs: computePercentile(srvVals, 50),
    p95ServerMs: computePercentile(srvVals, 95),
    maxServerMs: n > 0 ? round1(srvVals[n - 1]) : null,
    meanTuyaApiMs: computeAverage(tuyaVals),
    successRate: actuated > 0 ? round1((fedRows.length / actuated) * 100) : null,
    tokenRefreshedCount: rows.filter((e) => e.token_refreshed).length,
    fallbackCount: rows.filter((e) => e.tuya_endpoint === "v1_commands").length
  };
}
