"use client";

import React from "react";
import type { FeedLog } from "@/lib/supabase";

interface FeedLogTableProps {
  logs: FeedLog[];
}

export function FeedLogTable({ logs }: FeedLogTableProps) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Recent Feed Logs (Latest 50)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Complete telemetry record including Tuya endpoint, token refresh flag, and latency breakdown.
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500">
          Showing {logs.length} rows
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 uppercase">
            <tr>
              <th className="py-2.5 px-3">ID</th>
              <th className="py-2.5 px-3">Time</th>
              <th className="py-2.5 px-3">Origin</th>
              <th className="py-2.5 px-3">Source</th>
              <th className="py-2.5 px-3">Run Label</th>
              <th className="py-2.5 px-3 text-right">Vib (g)</th>
              <th className="py-2.5 px-3">Endpoint</th>
              <th className="py-2.5 px-3 text-center">Token Refresh</th>
              <th className="py-2.5 px-3 text-right">Tuya (ms)</th>
              <th className="py-2.5 px-3 text-right">Server (ms)</th>
              <th className="py-2.5 px-3 text-right">Client RTT (ms)</th>
              <th className="py-2.5 px-3 text-right">Network (ms)</th>
              <th className="py-2.5 px-3 text-right">Remaining</th>
              <th className="py-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
            {logs.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="py-8 text-center font-sans text-slate-500 dark:text-slate-400"
                >
                  No feed logs recorded yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <td className="py-2 px-3 text-slate-500">#{log.id}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.data_origin === "LIVE"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : log.data_origin === "SIMULATED"
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-purple-500/15 text-purple-400"
                      }`}
                    >
                      {log.data_origin}
                    </span>
                  </td>
                  <td className="py-2 px-3 font-sans font-medium">
                    {log.source}
                  </td>
                  <td className="py-2 px-3 text-slate-500">
                    {log.run_label ?? "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {log.vibration_g !== null ? log.vibration_g.toFixed(2) : "—"}
                  </td>
                  <td className="py-2 px-3 text-slate-500">
                    {log.tuya_endpoint ?? "—"}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {log.token_refreshed ? (
                      <span className="text-amber-500 font-bold">YES</span>
                    ) : (
                      <span className="text-slate-400">no</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {log.tuya_api_ms ?? "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {log.server_total_ms ?? "—"}
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-sky-500">
                    {log.client_rtt_ms ?? "NULL"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {log.network_ms ?? "—"}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    {log.remaining_grams}g ({log.remaining_percent}%)
                  </td>
                  <td className="py-2 px-3 font-sans">
                    {log.tuya_success ? (
                      <span className="text-emerald-500 font-semibold">OK</span>
                    ) : (
                      <span
                        className="text-rose-500 font-semibold"
                        title={log.tuya_error ?? "Failed"}
                      >
                        ERR: {log.tuya_error ?? "Failed"}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

