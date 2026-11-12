"use client";

import React, { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";
import type { FeedLog } from "@/lib/supabase";
import type { SourceLatencyStats } from "@/lib/stats";

interface LatencyChartsProps {
  chartLogs: FeedLog[];
  summaryBySource: SourceLatencyStats[];
}

export function LatencyCharts({
  chartLogs,
  summaryBySource
}: LatencyChartsProps) {
  const [viewMode, setViewMode] = useState<"line" | "stacked">("line");

  // Rule §7.6: Rows with client_rtt_ms IS NULL are excluded from the latency chart and summary table
  const validLogs = chartLogs.filter(
    (log): log is FeedLog & { client_rtt_ms: number } =>
      typeof log.client_rtt_ms === "number" &&
      Number.isFinite(log.client_rtt_ms)
  );

  const chartData = validLogs.map((log, index) => {
    const seq = index + 1;
    const tuyaMs = log.tuya_api_ms ?? 0;
    const serverTotal = log.server_total_ms ?? 0;
    const otherServerMs = Math.max(0, serverTotal - tuyaMs);
    const networkMs =
      log.network_ms !== null
        ? Math.max(0, log.network_ms)
        : Math.max(0, log.client_rtt_ms - serverTotal);

    return {
      seq,
      logId: log.id,
      source: log.source,
      runLabel: log.run_label,
      dataOrigin: log.data_origin,
      MANUAL_APP: log.source === "MANUAL_APP" ? log.client_rtt_ms : null,
      PHONE_SENSOR: log.source === "PHONE_SENSOR" ? log.client_rtt_ms : null,
      ESP32_SENSOR: log.source === "ESP32_SENSOR" ? log.client_rtt_ms : null,
      client_rtt_ms: log.client_rtt_ms,
      network_ms: networkMs,
      tuya_api_ms: tuyaMs,
      server_overhead_ms: otherServerMs
    };
  });

  const formatMetric = (val: number | null) =>
    val === null || val === undefined ? "—" : `${val}`;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Chart 1 — Trigger-to-cloud-acknowledgement latency (ms)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Client-measured round-trip time (<code className="font-mono">client_rtt_ms</code>) from trigger event to Tuya Cloud acknowledgement. Rows with <code className="font-mono">client_rtt_ms IS NULL</code> are excluded.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-1 bg-slate-100 dark:bg-slate-950 self-start">
          <button
            type="button"
            onClick={() => setViewMode("line")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              viewMode === "line"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            By Source (Line)
          </button>
          <button
            type="button"
            onClick={() => setViewMode("stacked")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              viewMode === "stacked"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            Decomposition (Stacked Bar)
          </button>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-sm text-slate-500 dark:text-slate-400">
          No feeds with measured client_rtt_ms in current view. Press &quot;Feed Now&quot; to record a live trial.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {viewMode === "line" ? (
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148, 163, 184, 0.2)"
                />
                <XAxis
                  dataKey="seq"
                  tick={{ fontSize: 12 }}
                  label={{
                    value: "Feed Sequence (#)",
                    position: "insideBottom",
                    offset: -5,
                    fontSize: 11
                  }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{
                    value: "Latency (ms)",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    color: "#f8fafc",
                    fontSize: "12px",
                    borderRadius: "8px"
                  }}
                  formatter={(value: unknown, name: string) => [
                    `${value} ms`,
                    name
                  ]}
                  labelFormatter={(seq) => `Sequence #${seq}`}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Line
                  type="monotone"
                  dataKey="MANUAL_APP"
                  name="MANUAL_APP"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="PHONE_SENSOR"
                  name="PHONE_SENSOR"
                  stroke="#a855f7"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="ESP32_SENSOR"
                  name="ESP32_SENSOR"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            ) : (
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148, 163, 184, 0.2)"
                />
                <XAxis
                  dataKey="seq"
                  tick={{ fontSize: 12 }}
                  label={{
                    value: "Feed Sequence (#)",
                    position: "insideBottom",
                    offset: -5,
                    fontSize: 11
                  }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{
                    value: "Latency (ms)",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    color: "#f8fafc",
                    fontSize: "12px",
                    borderRadius: "8px"
                  }}
                  formatter={(value: unknown, name: string) => [
                    `${value} ms`,
                    name
                  ]}
                  labelFormatter={(seq) => `Sequence #${seq}`}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                <Bar
                  dataKey="network_ms"
                  name="Client↔Worker Network (ms)"
                  stackId="a"
                  fill="#38bdf8"
                />
                <Bar
                  dataKey="tuya_api_ms"
                  name="Tuya Cloud API (ms)"
                  stackId="a"
                  fill="#f59e0b"
                />
                <Bar
                  dataKey="server_overhead_ms"
                  name="Supabase DB + Worker Overhead (ms)"
                  stackId="a"
                  fill="#64748b"
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {/* Latency Summary Table */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
          Trigger-to-Cloud-Acknowledgement Latency Summary Table
        </h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 uppercase">
              <tr>
                <th className="py-2.5 px-3">Source</th>
                <th className="py-2.5 px-3 text-right">n (with RTT)</th>
                <th className="py-2.5 px-3 text-right">Min (ms)</th>
                <th className="py-2.5 px-3 text-right">Avg (ms)</th>
                <th className="py-2.5 px-3 text-right">Median (ms)</th>
                <th className="py-2.5 px-3 text-right">p95 (ms)</th>
                <th className="py-2.5 px-3 text-right">Max (ms)</th>
                <th className="py-2.5 px-3 text-right">Avg Tuya (ms)</th>
                <th className="py-2.5 px-3 text-right">Avg Net (ms)</th>
                <th className="py-2.5 px-3 text-right">Tuya Success</th>
                <th className="py-2.5 px-3 text-right">Token Refreshed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
              {summaryBySource.map((row) => (
                <tr
                  key={row.source}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 dark:text-slate-100">
                    {row.source}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {row.n}{" "}
                    <span className="text-slate-400">/{row.totalFeeds}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatMetric(row.min)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-sky-500">
                    {formatMetric(row.avg)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatMetric(row.median)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-500">
                    {formatMetric(row.p95)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatMetric(row.max)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatMetric(row.avgTuyaApiMs)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {formatMetric(row.avgNetworkMs)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {row.tuyaSuccessRate !== null
                      ? `${row.tuyaSuccessRate}%`
                      : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {row.tokenRefreshedCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

